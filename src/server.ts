import { scheduleMultiSigKeysSyncFromNetConfig } from './services/transactionVerification'

const _startingMessage = `@shardeum-foundation/archiver starting at
  locale:  ${new Date().toLocaleString()}
  ISO/UTC: ${new Date().toISOString()}`
console.log(_startingMessage)
console.error(_startingMessage)

import { join } from 'path'
import fastify, { FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
import * as clusterModule from 'cluster'
import { Server, IncomingMessage, ServerResponse } from 'http'
import { overrideDefaultConfig, config } from './Config'
import * as Crypto from './Crypto'
import * as State from './State'
import * as NodeList from './NodeList'
import * as Storage from './archivedCycle/Storage'
import * as Data from './Data/Data'
import * as Cycles from './Data/Cycles'
import { initDataLogWriter } from './Data/DataLogWriter'
import * as Utils from './Utils'
import { syncStateMetaData } from './archivedCycle/StateMetaData'
import * as Logger from './Logger'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import MemoryReporting, { memoryReportingInstance, setMemoryReportingInstance } from './profiler/memoryReporting'
import NestedCounters, { setNestedCountersInstance } from './profiler/nestedCounters'
import Profiler, { setProfilerInstance } from './profiler/profiler'
import Statistics from './statistics'
import * as dbstore from './dbstore'
import * as CycleDB from './dbstore/cycles'
import * as ReceiptDB from './dbstore/receipts'
import { startSaving } from './saveConsoleOutput'
import { setupArchiverDiscovery } from '@shardeum-foundation/lib-archiver-discovery'
import * as Collector from './Data/Collector'
import { loadGlobalAccounts, syncGlobalAccount } from './GlobalAccount'
import { setShutdownCycleRecord, cycleRecordWithShutDownMode, ArchiverCycleResponse } from './Data/Cycles'
import { queryFromArchivers, registerRoutes } from './API'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { healthCheckRouter } from './routes/healthCheck'
import { initializeTickets } from './routes/tickets'
import { initAjvSchemas } from './types/ajv/Helpers'
import { initializeSerialization } from './utils/serialization/SchemaHelpers'
import { allowedArchiversManager } from './shardeum/allowedArchiversManager'
import { cycleCheckpointManager } from './checkpoint/CycleData'
import { receiptCheckpointManager } from './checkpoint/ReceiptData'
import { originalTxCheckpointManager } from './checkpoint/OriginalTxsData'
import { createDirectories } from './Utils'
import { syncMissingCheckpoints } from './checkpoint/CheckpointV2'
import { RequestDataType } from './API'
import { getOldestPendingOrFailedCheckpointStatus } from './dbstore/checkpointStatus'
import { ArchiverLogging } from './profiler/archiverLogging'
import { logEnvSetup } from './utils/environment'
import { Log } from 'ethers'

const configFile = resolve(__dirname, '../archiver-config.json')
const allowedArchiversConfigPath = join(__dirname, '../allowed-archivers.json')
let logDir: string
const cluster = clusterModule as unknown as clusterModule.Cluster

async function start(): Promise<void> {
  overrideDefaultConfig(configFile)
  initAjvSchemas()
  initializeSerialization()
  // Set crypto hash keys from config
  const hashKey = config.ARCHIVER_HASH_KEY
  Crypto.setCryptoHashKey(hashKey)
  let logsConfig
  try {
    logsConfig = StringUtils.safeJsonParse(readFileSync(resolve(__dirname, '../archiver-log.json'), 'utf8'))
  } catch (err) {
    console.log('Failed to parse archiver log file:', err)
  }
  logDir = `${config.ARCHIVER_LOGS}/${config.ARCHIVER_IP}_${config.ARCHIVER_PORT}`
  const baseDir = '.'
  logsConfig.dir = logDir
  Logger.initLogger(baseDir, logsConfig)
  if (logsConfig.saveConsoleOutput) {
    startSaving(join(baseDir, logsConfig.dir))
  }

  logEnvSetup()
  
  // Initialize allowed archivers manager
  allowedArchiversManager.initialize(allowedArchiversConfigPath)
  // Global error handling
  process.on('uncaughtException', (error) => {
    Logger.mainLogger.error('Uncaught Exception - Global:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    Logger.mainLogger.error('Unhandled Rejection - Global:', promise, 'reason:', reason)
  })

  // Initialize storage and checkpoints
  if (config.experimentalSnapshot) {
    await dbstore.initializeDB(config)
  } else {
    await Storage.initStorage(config)
  }
  State.addSigListeners()

  if (!cluster.isPrimary) {
    // Initialize state from config
    await State.initFromConfig(config, false, false)
    // await initWorkerProcess()
    return
  }

  try {
    await setupArchiverDiscovery({
      hashKey,
      customConfigPath: configFile.toString(),
      archiverTimeoutInMilliSeconds: 2000, // 2 seconds
    })
  } catch (e) {
    console.log('Error setting up archiver discovery: ', e)
  }

  const lastStoredCycle = await CycleDB.queryLatestCycleRecords(1)
  if (lastStoredCycle && lastStoredCycle.length > 0) {
    const lastStoredCycleMode = lastStoredCycle[0].mode
    if (lastStoredCycleMode === 'shutdown') {
      setShutdownCycleRecord(lastStoredCycle[0])
      Logger.mainLogger.debug('Found shutdown cycleRecord', cycleRecordWithShutDownMode)
      // Initialize state from config
      await State.initFromConfig(config, true)
      const result = await State.compareCycleRecordWithOtherArchivers(
        cycleRecordWithShutDownMode.archiversAtShutdown,
        cycleRecordWithShutDownMode
      )
      if (result) {
        State.resetActiveArchivers(cycleRecordWithShutDownMode.archiversAtShutdown)
        // Load global account from db
        await loadGlobalAccounts()
        await startServer()
        return
      }
    }
  }

  // Initialize state from config
  await State.initFromConfig(config)

  if (State.isFirst) {
    Logger.mainLogger.debug('We are first archiver. Starting archive-server')
    const lastStoredCycle = await CycleDB.queryLatestCycleRecords(1)
    if (lastStoredCycle && lastStoredCycle.length > 0) {
      ArchiverLogging.logArchiverRegistration({
        archiverId: config.ARCHIVER_IP,
        timestamp: Date.now(),
        validators: {
          discovered: 0,
          connected: 0,
        },
        state: 'REGISTERING',
      })

      // Load global account from db
      await loadGlobalAccounts()
      // Seems you got restarted, and there are no other archivers to check; build nodelists and send join request to the nodes first
      await Data.buildNodeListFromStoredCycle(lastStoredCycle[0])

      let isJoined = false
      let firstTime = true
      const cycleDuration = Cycles.currentCycleDuration
      do {
        try {
          // Get active nodes from Archiver
          const nodeList = NodeList.getActiveList()

          // try to join the network
          isJoined = await Data.joinNetwork(nodeList, firstTime)

          if (isJoined) {
            ArchiverLogging.logArchiverRegistration({
              archiverId: config.ARCHIVER_IP,
              timestamp: Date.now(),
              validators: {
                discovered: nodeList.length,
                connected: nodeList.length,
              },
              state: 'REGISTERED',
            })
          }
        } catch (err: unknown) {
          Logger.mainLogger.error('Error while joining network:')
          Logger.mainLogger.error(err as Error)
          Logger.mainLogger.error((err as Error).stack)
          Logger.mainLogger.debug(`Trying to join again in ${cycleDuration} seconds...`)

          const nodeList = NodeList.getActiveList()
          ArchiverLogging.logArchiverRegistration({
            archiverId: config.ARCHIVER_IP,
            timestamp: Date.now(),
            validators: {
              discovered: nodeList.length,
              connected: 0,
            },
            state: 'ERROR',
          })

          await Utils.sleep(cycleDuration)
        }
        firstTime = false
      } while (!isJoined)

      /**
       * [NOTE] [AS] There's a possibility that we could get stuck in this loop
       * if the joinRequest was sent in the wrong cycle quarter (Q2, Q3, or Q4).
       *
       * Since we've dealt with this problem in shardus-global-server, it might be
       * good to refactor this code to do what shardus-global-server does to join
       * the network.
       */

      Logger.mainLogger.debug('We have successfully joined the network')
      await startServer()
      await Data.subscribeNodeForDataTransfer()
    } else {
      await startServer()
    }
  } else {
    try {
      Logger.mainLogger.debug('We are not first archiver. Syncing and starting archive-server')
      
      if(config.passiveMode){
        Logger.mainLogger.debug('Archiver is in passive mode. Skipping network join.')
        await startServer()
      } else {
        Logger.mainLogger.debug('Syncing and starting archive-server')
        syncAndStartServer()
      }
    } catch (err) {
      Logger.mainLogger.error('Error syncing and starting archive-server', err)
    }
  }

  setTimeout(() => {
    scheduleMultiSigKeysSyncFromNetConfig()
  }, 60 * 1000) // Start after 60 seconds

  // Create the failed buckets directory
  createDirectories(config.failedBucketsDir)

  // Initialize checkpoint V2 system if enabled and checkpoint updates and storage are allowed
  if (config.checkpoint.bucketConfig.allowCheckpointUpdates) {
    Logger.mainLogger.info('Initializing checkpoint system...')

    // Start the update loop
    updateCheckpoints()

    // Sync missing checkpoints on startup if enabled
    if (config.checkpoint.syncOnStartup) {
      setTimeout(async () => {
        try {
          await syncMissingCheckpoints(config.checkpoint.maxCyclesToSync)
        } catch (error) {
          Logger.mainLogger.error('Error syncing missing checkpoints on startup:', error)
        }
      }, config.checkpoint.syncInterval) // Wait 10 seconds after startup to begin syncing
    }
  }

  async function updateCheckpoints() {
    const startTime = Date.now()
    try {
      if (cycleCheckpointManager && receiptCheckpointManager && originalTxCheckpointManager) {
        await Promise.allSettled([
          cycleCheckpointManager.update(),
          receiptCheckpointManager.update(),
          originalTxCheckpointManager.update(),
        ])
      }
    } catch (error) {
      Logger.mainLogger.error('Error updating checkpoints:', error)
    }

    const elapsedTime = Date.now() - startTime
    const nextExecutionDelay = Math.max(0, config.checkpoint.updateInterval - elapsedTime)

    setTimeout(updateCheckpoints, nextExecutionDelay)
  }
}

function initProfiler(server: FastifyInstance): void {
  const memoryReporter = new MemoryReporting(server)
  setMemoryReportingInstance(memoryReporter)
  const nestedCounter = new NestedCounters(server)
  setNestedCountersInstance(nestedCounter)
  const profiler = new Profiler(server)
  setProfilerInstance(profiler)
  const statistics = new Statistics(
    logDir,
    config.STATISTICS,
    {
      counters: [],
      watchers: {},
      timers: [],
      manualStats: ['cpuPercent'],
    },
    {}
  )
  statistics.startSnapshots()
  statistics.on('snapshot', memoryReportingInstance.updateCpuPercent)

  // ========== ENDPOINTS ==========
  memoryReporter.registerEndpoints()
  nestedCounter.registerEndpoints()
  profiler.registerEndpoints()
}

/** Asynchronous function to synchronize and start the server. */
async function syncAndStartServer(): Promise<void> {
  try {



    // Set the syncing flag to true to know we are patching the data
    State.setSyncing(true)

    // Get the cycle duration
    const cycleDuration = await Data.getCycleDuration()
    const oldestFailedCheckpointStatus = await getOldestPendingOrFailedCheckpointStatus()
    const firstUnifiedCheckpointCycle = oldestFailedCheckpointStatus?.cycle || 0

    // Retrieve database state
    const lastStoredReceiptCount = await ReceiptDB.queryReceiptCount()
    const lastStoredCycleCount = await CycleDB.queryCyleCount()
    const lastStoredCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

    // Get the latest cycle from archivers to know how far we need to sync
    const latestNetworkCycle = await Cycles.getNewestCycleFromArchivers()
    State.setLastCycleToSync(latestNetworkCycle?.counter || oldestFailedCheckpointStatus?.cycle || 0)

    // Sync cycle data if checkpoint updates are allowed
    if (config.checkpoint.bucketConfig.allowCheckpointUpdates) {
      await syncCycleDataWithCheckpoints(firstUnifiedCheckpointCycle, latestNetworkCycle)
    } else {
      await validateAndSyncCycleData(lastStoredCycleCount, lastStoredCycleInfo)
    }

    
    // Join the network
    await joinNetwork(cycleDuration)

    // Synchronize Genesis accounts and transactions from the network archivers
    await Data.syncGenesisAccountsFromArchiver()
    await Data.syncGenesisTransactionsFromArchiver()

    // Sync cycle and node list information
    if (config.useSyncV2 === true) {
      await Data.syncCyclesAndNodeListV2(State.activeArchivers, lastStoredCycleCount)
    } else {
      await Data.syncCyclesAndNodeList(lastStoredCycleCount)
    }

    // Handle receipts and transaction data based on configuration
    if (config.experimentalSnapshot) {
      await syncGlobalAccount()

      if (config.checkpoint.bucketConfig.allowCheckpointUpdates) {
        await handleReceiptSyncWithCheckpoints(lastStoredReceiptCount, firstUnifiedCheckpointCycle, latestNetworkCycle)
      } else {
        await handleTraditionalReceiptSync(lastStoredReceiptCount, lastStoredCycleCount)
      }
    } else {
      // Sync all state metadata until no older data is fetched from other archivers
      await syncStateMetaData(State.activeArchivers)

      // Wait for one cycle before sending data request if experimentalSnapshot is not enabled
      await Utils.sleep(cycleDuration * 1000)

      // Start the server
      await startServer()
    }

    // Sync any missing data that may have been created during startup
    const latestCycle = await Cycles.getNewestCycleFromArchivers()
    const beforeCycle = Cycles.getCurrentCycleCounter()
    await Data.syncCyclesAndTxsDataBetweenCycles(beforeCycle - 1, latestCycle.counter + 1)

    // Send active message if configured
    if (config.sendActiveMessage) {
      await sendActiveMessage()
    } else {
      State.setSyncing(false)
      await Data.subscribeNodeForDataTransfer()
    }

    // Schedule multi-signature keys sync
    scheduleMultiSigKeysSyncFromNetConfig()
  } catch (error) {
    Logger.mainLogger.error('Error in syncAndStartServer:', error)
    throw error
  }
}

// Helper functions for syncAndStartServer
async function syncCycleDataWithCheckpoints(
  firstUnifiedCheckpointCycle: number,
  latestNetworkCycle: any
): Promise<void> {
  const response: any = await Data.getTotalDataFromArchivers()
  const { totalCycles } = response

  if (firstUnifiedCheckpointCycle > totalCycles) {
    Logger.mainLogger.info('The existing db has more data than the network data! Proceeding with joining the network!')
    return
  }

  const startCycle = firstUnifiedCheckpointCycle
  let endCycle = Math.max(totalCycles, latestNetworkCycle?.counter || 0)

  const BATCH_SIZE = config.checkpoint.batchSize
  let currentStart = startCycle
  let currentEnd = Math.min(currentStart + BATCH_SIZE, endCycle)
  Logger.mainLogger.info(`Need to patch cycles from ${currentStart} to ${currentEnd}...`)
}

async function validateAndSyncCycleData(lastStoredCycleCount: number, lastStoredCycleInfo: any): Promise<void> {
  const response: any = await Data.getTotalDataFromArchivers()

  if (
    !response ||
    response.totalCycles < 0 ||
    response.totalAccounts < 0 ||
    response.totalTransactions < 0 ||
    response.totalReceipts < 0
  ) {
    throw Error(`Can't fetch total data from archivers`)
  }

  const { totalCycles, totalReceipts } = response
  const lastStoredReceiptCount = await ReceiptDB.queryReceiptCount()

  if (lastStoredReceiptCount > totalReceipts || lastStoredCycleCount > totalCycles) {
    throw Error('The existing db has more data than the network data! Clear the DB and start the server again!')
  }

  if (lastStoredCycleCount > 0) {
    Logger.mainLogger.debug('Validating old cycles data!')
    const cycleResult = await Data.compareWithOldCyclesData(lastStoredCycleInfo.counter)

    if (!cycleResult.success) {
      throw Error(
        'The last saved 10 cycles data does not match with the archiver data! Clear the DB and start the server again!'
      )
    }
  }
}

async function joinNetwork(cycleDuration: number): Promise<void> {
  if(config.passiveMode){
    Logger.mainLogger.debug('Archiver is in passive mode. Skipping network join.')
    return
  }
  
  
  let isJoined = false
  let firstTime = true

  do {
    try {
      const randomArchiver = State.getRandomArchiver()
      const nodeList: NodeList.ConsensusNodeInfo[] = await NodeList.getActiveNodeListFromArchiver(randomArchiver)

      if (nodeList.length === 0) continue

      isJoined = await Data.joinNetwork(nodeList, firstTime)
    } catch (err) {
      Logger.mainLogger.error('Error while joining network:', err)
      await Utils.sleep(cycleDuration * 1000)
    }

    firstTime = false
  } while (!isJoined)

  /**
   * [NOTE] [AS] There's a possibility that we could get stuck in this loop
   * if the joinRequest was sent in the wrong cycle quarter (Q2, Q3, or Q4).
   *
   * Since we've dealt with this problem in shardus-global-server, it might be
   * good to refactor this code to do what shardus-global-server does to join
   * the network.
   */
  Logger.mainLogger.debug('We have successfully joined the network')
}

async function handleReceiptSyncWithCheckpoints(
  lastStoredReceiptCount: number,
  firstUnifiedCheckpointCycle: number,
  latestNetworkCycle: any
): Promise<void> {
  Logger.mainLogger.info('Using checkpoint V2 for data synchronization')

  // Find the last valid cycle for receipts
  let lastStoredReceiptCycle = Math.max(firstUnifiedCheckpointCycle - 1, 0)

  // Sync receipts based on what's stored
  if (lastStoredReceiptCount === 0) {
    await Data.syncReceipts()
  } else {
    await Data.syncReceiptsByCycle(lastStoredReceiptCycle)
  }

  // Verify database integrity after syncing
  const updatedReceiptCount = await ReceiptDB.queryReceiptCount()
  const updatedCycleCount = await CycleDB.queryCyleCount()
  const updatedCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

  if (updatedCycleCount - 1 !== updatedCycleInfo.counter) {
    throw Error(
      `The archiver has ${updatedCycleCount} cycles but the latest stored cycle is ${updatedCycleInfo.counter}`
    )
  }

  await Data.syncCyclesAndTxsData(updatedCycleCount, updatedReceiptCount)

  // Start the server first, then sync missing data in the background
  await startServer()

  // Schedule background sync
  setTimeout(async () => {
    try {
      const { syncMissingCheckpoints } = await import('./checkpoint/CheckpointV2')
      await syncMissingCheckpoints(config.checkpoint.maxCyclesToSync)
    } catch (error) {
      Logger.mainLogger.error('Error syncing missing checkpoints after server start:', error)
    }
  }, config.checkpoint.syncInterval)
}

async function handleTraditionalReceiptSync(
  lastStoredReceiptCount: number,
  lastStoredCycleCount: number
): Promise<void> {
  if (lastStoredReceiptCount === 0) {
    await Data.syncReceipts()
  } else {
    const lastStoredReceiptInfo = await ReceiptDB.queryLatestReceipts(1)
    const lastStoredReceiptCycle = lastStoredReceiptInfo?.[0]?.cycle || 0

    Logger.mainLogger.debug('lastStoredReceiptCycle', lastStoredReceiptCycle)
    await Data.syncReceiptsByCycle(lastStoredReceiptCycle)
  }

  // Verify database integrity
  const updatedReceiptCount = await ReceiptDB.queryReceiptCount()
  const updatedCycleCount = await CycleDB.queryCyleCount()
  const updatedCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

  if (updatedCycleCount - 1 !== updatedCycleInfo.counter) {
    throw Error(
      `The archiver has ${updatedCycleCount} cycles but the latest stored cycle is ${updatedCycleInfo.counter}`
    )
  }

  await Data.syncCyclesAndTxsData(updatedCycleCount, updatedReceiptCount)
  await startServer()
}

async function sendActiveMessage(): Promise<void> {
  let isActive = false
  while (!isActive) {
    await Data.sendActiveRequest()
    // TODO not used for now
    // isActive = await Data.checkActiveStatus()

    // Set as true for now, This needs to be removed after the active record for the archiver is added on the validator side
    isActive = true
  }

  await Data.subscribeNodeForDataTransfer()
  State.setSyncing(false)
}

// Define all endpoints, all requests, and start REST server
async function startServer(): Promise<void> {
  const server: FastifyInstance<Server, IncomingMessage, ServerResponse> = fastify({
    logger: false,
  })

  await server.register(fastifyCors)
  await server.register(fastifyRateLimit, {
    global: true,
    max: config.RATE_LIMIT,
    timeWindow: 10,
    allowList: ['127.0.0.1', '0.0.0.0'], // Excludes local IPs from rate limits
  })
  await server.register(healthCheckRouter)

  server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      const jsonString = typeof body === 'string' ? body : body.toString('utf8')
      done(null, StringUtils.safeJsonParse(jsonString))
    } catch (err) {
      err.statusCode = 400
      done(err, undefined)
    }
  })

  server.setReplySerializer((payload) => {
    return StringUtils.safeStringify(payload)
  })

  initProfiler(server)

  logEnvSetup()

  // Initialize the data log writer
  if (config.dataLogWrite) await initDataLogWriter()

  // Register API routes
  registerRoutes(server as FastifyInstance<Server, IncomingMessage, ServerResponse>)

  // Start server and bind to port on all interfaces
  server.listen(
    {
      port: config.ARCHIVER_PORT,
      host: '0.0.0.0',
    },
    (err) => {
      if (err) {
        server.log.error(err)
        process.exit(1)
      }
      Logger.mainLogger.info(
        `Worker ${process.pid}: Archive-server is listening on http://0.0.0.0:${config.ARCHIVER_PORT}`
      )
      State.setActive()
      Collector.scheduleMissingTxsDataQuery()
      // setupWorkerProcesses(cluster)
    }
  )
}

// Add this before starting the server
try {
  initializeTickets()
} catch (err) {
  console.error('Failed to initialize tickets. Server startup aborted:', err)
  process.exit(1)
}

start()
