import { scheduleMultiSigKeysSyncFromNetConfig } from "./services/transactionVerification";

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
import MemoryReporting, {
  memoryReportingInstance,
  setMemoryReportingInstance,
} from './profiler/memoryReporting'
import NestedCounters, { setNestedCountersInstance } from './profiler/nestedCounters'
import Profiler, { setProfilerInstance } from './profiler/profiler'
import Statistics from './statistics'
import * as dbstore from './dbstore'
import * as CycleDB from './dbstore/cycles'
import * as ReceiptDB from './dbstore/receipts'
import * as OriginalTxDB from './dbstore/originalTxsData'
import { startSaving } from './saveConsoleOutput'
import { setupArchiverDiscovery } from '@shardeum-foundation/lib-archiver-discovery'
import * as Collector from './Data/Collector'
import { loadGlobalAccounts, syncGlobalAccount } from './GlobalAccount'
import { setShutdownCycleRecord, cycleRecordWithShutDownMode, ArchiverCycleResponse } from './Data/Cycles'
import { queryFromArchivers, registerRoutes } from './API'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { healthCheckRouter } from './routes/healthCheck'
import { initializeTickets } from './routes/tickets';
import { initAjvSchemas } from './types/ajv/Helpers'
import { initializeSerialization } from './utils/serialization/SchemaHelpers'
import { allowedArchiversManager } from './shardeum/allowedArchiversManager'
import { cycleCheckpointManager } from './checkpoint/CycleData'
import { receiptCheckpointManager } from './checkpoint/ReceiptData'
import { originalTxCheckpointManager } from './checkpoint/OriginalTxsData'
import { createDirectories } from "./Utils";
import { initCheckpointV2, syncMissingCheckpoints } from './checkpoint/CheckpointV2';
import { RequestDataType } from './API';

const configFile = resolve(__dirname, '../archiver-config.json')
const allowedArchiversConfigPath = join(__dirname, '../allowed-archivers.json')
let logDir: string
const cluster = clusterModule as unknown as clusterModule.Cluster

async function start(): Promise<void> {
  overrideDefaultConfig(configFile)
  initAjvSchemas();
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
  // Initialize allowed archivers manager
  allowedArchiversManager.initialize(allowedArchiversConfigPath)
  // Global error handling
  process.on('uncaughtException', (error) => {
    Logger.mainLogger.error('Uncaught Exception - Global:', error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    Logger.mainLogger.error('Unhandled Rejection - Global:', promise, 'reason:', reason);
  });

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

  try {
    await setupArchiverDiscovery({
      hashKey,
      customConfigPath: configFile.toString(),
      archiverTimeoutInMilliSeconds: 2000, // 2 seconds
    })
  } catch (e) {
    console.log('Error setting up archiver discovery: ', e)
  }
  // Initialize state from config
  await State.initFromConfig(config)

  if (State.isFirst) {
    Logger.mainLogger.debug('We are first archiver. Starting archive-server')
    const lastStoredCycle = await CycleDB.queryLatestCycleRecords(1)
    if (lastStoredCycle && lastStoredCycle.length > 0) {
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
        } catch (err: unknown) {
          Logger.mainLogger.error('Error while joining network:')
          Logger.mainLogger.error(err as Error)
          Logger.mainLogger.error((err as Error).stack)
          Logger.mainLogger.debug(`Trying to join again in ${cycleDuration} seconds...`)
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
      syncAndStartServer()
    } catch (err) {
      Logger.mainLogger.error('Error syncing and starting archive-server', err)
    }
  }

  setTimeout(() => {
    scheduleMultiSigKeysSyncFromNetConfig();
  }, 60 * 1000); // Start after 60 seconds

  // Create the failed buckets directory
  createDirectories(config.failedBucketsDir)

  // Initialize checkpoint V2 system if enabled
  if (config.checkpointV2?.enabled) {
    Logger.mainLogger.info('Initializing checkpoint V2 system')
    initCheckpointV2()

    // Sync missing checkpoints on startup if enabled
    if (config.checkpointV2?.syncOnStartup) {
      Logger.mainLogger.info('Syncing missing checkpoints on startup')
      setTimeout(async () => {
        try {
          await syncMissingCheckpoints(config.checkpointV2.maxCyclesToSync)
        } catch (error) {
          Logger.mainLogger.error('Error syncing missing checkpoints on startup:', error)
        }
      }, 30 * 1000) // Wait 30 seconds after startup to begin syncing
    }
  }

  async function updateCheckpoints() {
    const startTime = Date.now()

    try {
      // Initialize checkpoint system with null checks
      if (cycleCheckpointManager && receiptCheckpointManager && originalTxCheckpointManager) {
        await Promise.all([
          cycleCheckpointManager.update(),
          receiptCheckpointManager.update(),
          originalTxCheckpointManager.update(),
        ])
      }
    } catch (error) {
      Logger.mainLogger.error('Error updating checkpoints:', error)
    }

    const elapsedTime = Date.now() - startTime
    const nextExecutionDelay = Math.max(0, config.checkpointUpdateInterval - elapsedTime)

    setTimeout(updateCheckpoints, nextExecutionDelay)
  }

  if (config.checkpointBucketConfig.allowCheckpointUpdates) {
    // Start the update loop
    updateCheckpoints()
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
  // Validate data if there is any in db
  // Retrieve the count of receipts currently stored in the database
  let lastStoredReceiptCount = await ReceiptDB.queryReceiptCount()

  // Retrieve the count of cycles currently stored in the database
  let lastStoredCycleCount = await CycleDB.queryCyleCount()
  let lastStoredOriginalTxCount = await OriginalTxDB.queryOriginalTxDataCount()
  // Query the latest cycle record from the database
  let lastStoredCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

  // Initialize last stored receipt cycle as 0
  let lastStoredReceiptCycle = 0
  let lastStoredOriginalTxCycle = 0

  interface TotalDataResponse {
    totalCycles: number
    totalAccounts: number
    totalTransactions: number
    totalReceipts: number
    totalOriginalTxs: number
  }

  // Request total data from the random archiver
  const response: TotalDataResponse = await Data.getTotalDataFromArchivers()

  // Check if the response is valid and all data fields are non-negative
  if (
    !response ||
    response.totalCycles < 0 ||
    response.totalAccounts < 0 ||
    response.totalTransactions < 0 ||
    response.totalReceipts < 0
  ) {
    throw Error(`Can't fetch total data from archivers`)
  }
  // Destructure the response to get total counts for cycles, accounts, transactions and receipts
  const { totalCycles, totalReceipts } = response

  // Check if local database has more data than the network, if so, clear the database
  if (lastStoredReceiptCount > totalReceipts || lastStoredCycleCount > totalCycles) {
    throw Error(
      'The existing db has more data than the network data! Clear the DB and start the server again!'
    )
  }

  // If there are stored cycles, validate the old cycle data
  if (lastStoredCycleCount > 0) {
    Logger.mainLogger.debug('Validating old cycles data!')

    // Compare old cycle data with the archiver data
    const cycleResult = await Data.compareWithOldCyclesData(lastStoredCycleInfo.counter)

    // If the cycle data does not match, patch the data instead of throwing an error
    if (!cycleResult.success) {
      Logger.mainLogger.warn(
        'The last saved 10 cycles data does not match with the archiver data. Attempting to patch the data...'
      )

      // Get the latest cycle from archivers to know how far we need to sync
      const latestNetworkCycle = await Cycles.getNewestCycleFromArchivers()

      // Find the last valid cycle we have
      let lastValidCycle = cycleResult.matchedCycle
      if (lastValidCycle === 0) {
        // If no valid cycle was found, we'll start from scratch
        Logger.mainLogger.warn('No valid cycles found. Starting from cycle 0.')
        lastStoredCycleCount = 0
      } else {
        // We have a valid cycle, so we'll start from there
        Logger.mainLogger.info(`Last valid cycle found: ${lastValidCycle}. Will sync from there.`)
        lastStoredCycleCount = lastValidCycle
      }

      // Sync cycles in batches
      const BATCH_SIZE = 10
      let currentStart = lastStoredCycleCount
      let currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)

      while (currentStart < latestNetworkCycle.counter) {
        Logger.mainLogger.info(`Patching cycles from ${currentStart} to ${currentEnd}...`)

        try {
          const response = await queryFromArchivers(
            RequestDataType.CYCLE,
            {
              start: currentStart,
              end: currentEnd
            },
            10000 // 10 seconds
          ) as ArchiverCycleResponse

          if (response && response.cycleInfo && response.cycleInfo.length > 0) {
            // Sort cycles in ascending order
            const cycles = response.cycleInfo.sort((a, b) => a.counter - b.counter)

            // Process and store the cycles
            await Cycles.processCycles(cycles)

            // Update our progress
            currentStart = currentEnd
            currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)
          } else {
            Logger.mainLogger.error(`Failed to fetch cycles from ${currentStart} to ${currentEnd}. Retrying...`)
            // Reduce batch size on failure
            const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
            currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)
          }
        } catch (error) {
          Logger.mainLogger.error(`Error patching cycles from ${currentStart} to ${currentEnd}:`, error)
          // Reduce batch size on error
          const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
          currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)

          // If we're trying to fetch just one cycle and still failing, skip it
          if (currentEnd - currentStart === 1) {
            Logger.mainLogger.warn(`Skipping problematic cycle ${currentStart}`)
            currentStart++
            currentEnd = Math.min(currentStart + 1, latestNetworkCycle.counter)
          }
        }
      }

      // Update lastStoredCycleCount to reflect our progress
      lastStoredCycleCount = await CycleDB.queryCyleCount()
      lastStoredCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

      Logger.mainLogger.info(`Cycle data patching complete. Now at cycle ${lastStoredCycleInfo.counter}`)
    } else {
      // Update the last stored cycle count
      lastStoredCycleCount = cycleResult.matchedCycle
    }
  }

  // Log the last stored cycle and receipt counts
  Logger.mainLogger.debug(
    'lastStoredCycleCount',
    lastStoredCycleCount,
    'lastStoredReceiptCount',
    lastStoredReceiptCount,
    'lastStoredOriginalTxCount',
    lastStoredOriginalTxCount
  )

  // If your not the first archiver node, get a nodelist from the others

  // Initialize variables for joining the network
  let isJoined = false
  let firstTime = true

  // Get the cycle duration
  const cycleDuration = await Data.getCycleDuration()

  // Attempt to join the network until successful
  do {
    try {
      const randomArchiver = State.getRandomArchiver()
      // Get active nodes from Archiver
      const nodeList: NodeList.ConsensusNodeInfo[] =
        await NodeList.getActiveNodeListFromArchiver(randomArchiver)

      // If no nodes are active, retry the loop
      if (nodeList.length === 0) continue

      // Attempt to join the network
      isJoined = await Data.joinNetwork(nodeList, firstTime)
    } catch (err) {
      // Log the error if the joining process fails
      Logger.mainLogger.error('Error while joining network:')
      Logger.mainLogger.error(err)
      Logger.mainLogger.error(err.stack)

      // Sleep for a cycle duration and then retry
      Logger.mainLogger.debug(`Trying to join again in ${cycleDuration} seconds...`)
      await Utils.sleep(cycleDuration * 1000)
    }

    // After the first attempt, set firstTime to false
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

  // Once the archiver is joined, check if the existing data (receipt/originalTxData) is valid
  // If there are stored receipts, validate the old receipt data
  if (lastStoredReceiptCount > 0) {
    Logger.mainLogger.debug('Validating old receipts data!')
    // Query latest receipts from the DB
    const lastStoredReceiptInfo = await ReceiptDB.queryLatestReceipts(1)

    // If there's any stored receipt, update lastStoredReceiptCycle
    if (lastStoredReceiptInfo && lastStoredReceiptInfo.length > 0)
      lastStoredReceiptCycle = lastStoredReceiptInfo[0].cycle

    // Compare old receipts data with the archiver data
    const receiptResult = await Data.compareWithOldReceiptsData(lastStoredReceiptCycle)

    // If the receipt data does not match, patch the data instead of throwing an error
    if (!receiptResult.success) {
      Logger.mainLogger.warn(
        'The last saved receipts of last 10 cycles data do not match with the archiver data. Attempting to patch the data...'
      )

      // Get the latest cycle to know how far we need to sync
      const latestNetworkCycle = await Cycles.getNewestCycleFromArchivers()

      // Find the last valid cycle for receipts
      let lastValidReceiptCycle = receiptResult.matchedCycle
      if (lastValidReceiptCycle === 0) {
        // If no valid cycle was found, we'll start from scratch
        Logger.mainLogger.warn('No valid receipt cycles found. Starting from cycle 0.')
        lastStoredReceiptCycle = 0
      } else {
        // We have a valid cycle, so we'll start from there
        Logger.mainLogger.info(`Last valid receipt cycle found: ${lastValidReceiptCycle}. Will sync from there.`)
        lastStoredReceiptCycle = lastValidReceiptCycle
      }

      // Sync receipts in batches by cycle
      const BATCH_SIZE = 5
      let currentStart = lastStoredReceiptCycle
      let currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)

      while (currentStart < latestNetworkCycle.counter) {
        Logger.mainLogger.info(`Patching receipts from cycle ${currentStart} to ${currentEnd}...`)

        try {
          const response = await queryFromArchivers(
            RequestDataType.RECEIPT,
            {
              startCycle: currentStart,
              endCycle: currentEnd,
              type: 'full'
            },
            10000 // 10 seconds
          ) as any

          if (response && response.receipts && response.receipts.length > 0) {
            // Store the receipts
            await Collector.storeReceiptData(response.receipts)

            // Update our progress
            currentStart = currentEnd
            currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)
          } else {
            Logger.mainLogger.error(`Failed to fetch receipts from cycle ${currentStart} to ${currentEnd}. Retrying...`)
            // Reduce batch size on failure
            const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
            currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)
          }
        } catch (error) {
          Logger.mainLogger.error(`Error patching receipts from cycle ${currentStart} to ${currentEnd}:`, error)
          // Reduce batch size on error
          const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
          currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)

          // If we're trying to fetch just one cycle and still failing, skip it
          if (currentEnd - currentStart === 1) {
            Logger.mainLogger.warn(`Skipping problematic receipt cycle ${currentStart}`)
            currentStart++
            currentEnd = Math.min(currentStart + 1, latestNetworkCycle.counter)
          }
        }
      }

      // Update lastStoredReceiptCycle to reflect our progress
      const updatedReceiptInfo = await ReceiptDB.queryLatestReceipts(1)
      if (updatedReceiptInfo && updatedReceiptInfo.length > 0) {
        lastStoredReceiptCycle = updatedReceiptInfo[0].cycle
      }

      Logger.mainLogger.info(`Receipt data patching complete. Now at cycle ${lastStoredReceiptCycle}`)
    } else {
      // Update the last stored receipt cycle
      lastStoredReceiptCycle = receiptResult.matchedCycle
    }
  }

  if (lastStoredOriginalTxCount > 0) {
    Logger.mainLogger.debug('Validating old Original Txs data!')
    const lastStoredOriginalTxInfo = await OriginalTxDB.queryLatestOriginalTxs(1)
    if (lastStoredOriginalTxInfo && lastStoredOriginalTxInfo.length > 0)
      lastStoredOriginalTxCycle = lastStoredOriginalTxInfo[0].cycle
    const txResult = await Data.compareWithOldOriginalTxsData(lastStoredOriginalTxCycle)

    // If the original tx data does not match, patch the data instead of throwing an error
    if (!txResult.success) {
      Logger.mainLogger.warn(
        'The saved Original-Txs of last 10 cycles data do not match with the archiver data. Attempting to patch the data...'
      )

      // Get the latest cycle to know how far we need to sync
      const latestNetworkCycle = await Cycles.getNewestCycleFromArchivers()

      // Find the last valid cycle for original txs
      let lastValidOriginalTxCycle = txResult.matchedCycle
      if (lastValidOriginalTxCycle === 0) {
        // If no valid cycle was found, we'll start from scratch
        Logger.mainLogger.warn('No valid original tx cycles found. Starting from cycle 0.')
        lastStoredOriginalTxCycle = 0
      } else {
        // We have a valid cycle, so we'll start from there
        Logger.mainLogger.info(`Last valid original tx cycle found: ${lastValidOriginalTxCycle}. Will sync from there.`)
        lastStoredOriginalTxCycle = lastValidOriginalTxCycle
      }

      // Sync original txs in batches by cycle
      const BATCH_SIZE = 5
      let currentStart = lastStoredOriginalTxCycle
      let currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)

      while (currentStart < latestNetworkCycle.counter) {
        Logger.mainLogger.info(`Patching original txs from cycle ${currentStart} to ${currentEnd}...`)

        try {
          const response = await queryFromArchivers(
            RequestDataType.ORIGINALTX,
            {
              startCycle: currentStart,
              endCycle: currentEnd,
              type: 'full'
            },
            10000 // 10 seconds
          ) as any

          if (response && response.originalTxs && response.originalTxs.length > 0) {
            // Store the original txs
            await Collector.storeOriginalTxData(response.originalTxs)

            // Update our progress
            currentStart = currentEnd
            currentEnd = Math.min(currentStart + BATCH_SIZE, latestNetworkCycle.counter)
          } else {
            Logger.mainLogger.error(`Failed to fetch original txs from cycle ${currentStart} to ${currentEnd}. Retrying...`)
            // Reduce batch size on failure
            const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
            currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)
          }
        } catch (error) {
          Logger.mainLogger.error(`Error patching original txs from cycle ${currentStart} to ${currentEnd}:`, error)
          // Reduce batch size on error
          const newBatchSize = Math.max(1, Math.floor(BATCH_SIZE / 2))
          currentEnd = Math.min(currentStart + newBatchSize, latestNetworkCycle.counter)

          // If we're trying to fetch just one cycle and still failing, skip it
          if (currentEnd - currentStart === 1) {
            Logger.mainLogger.warn(`Skipping problematic original tx cycle ${currentStart}`)
            currentStart++
            currentEnd = Math.min(currentStart + 1, latestNetworkCycle.counter)
          }
        }
      }

      // Update lastStoredOriginalTxCycle to reflect our progress
      const updatedOriginalTxInfo = await OriginalTxDB.queryLatestOriginalTxs(1)
      if (updatedOriginalTxInfo && updatedOriginalTxInfo.length > 0) {
        lastStoredOriginalTxCycle = updatedOriginalTxInfo[0].cycle
      }

      Logger.mainLogger.info(`Original tx data patching complete. Now at cycle ${lastStoredOriginalTxCycle}`)
    } else {
      // Update the last stored original tx cycle
      lastStoredOriginalTxCycle = txResult.matchedCycle
    }
  }

  // Synchronize Genesis accounts and transactions from the network archivers
  await Data.syncGenesisAccountsFromArchiver() // Sync Genesis Accounts that the network start with.
  await Data.syncGenesisTransactionsFromArchiver()

  // Sync cycle and node list information
  if (config.useSyncV2 === true) {
    await Data.syncCyclesAndNodeListV2(State.activeArchivers, lastStoredCycleCount)
  } else {
    await Data.syncCyclesAndNodeList(lastStoredCycleCount)
  }

  // If experimentalSnapshot is enabled, perform receipt synchronization
  if (config.experimentalSnapshot) {
    // Sync GlobalAccountsList and cache the Global Network Account
    await syncGlobalAccount()

    // If checkpoint V2 is enabled, use it for syncing
    if (config.checkpointV2.enabled) {
      Logger.mainLogger.info('Using checkpoint V2 for data synchronization')

      // Import checkpoint status types
      const { CheckpointStatusType, CheckpointSyncStatus } = await import('./dbstore/checkpointStatus')

      // Get the latest cycle from the network
      const latestNetworkCycle = await Cycles.getNewestCycleFromArchivers()

      // Record checkpoint status for cycles that need syncing
      for (let cycle = lastStoredCycleCount; cycle <= latestNetworkCycle.counter; cycle++) {
        // Record cycle checkpoint status
        await import('./dbstore/checkpointStatus').then(({ upsertCheckpointStatus }) => {
          upsertCheckpointStatus({
            cycle,
            type: CheckpointStatusType.CYCLE,
            status: cycle <= lastStoredCycleCount ? CheckpointSyncStatus.COMPLETED : CheckpointSyncStatus.PENDING,
            timestamp: Date.now(),
            totalArchivers: State.activeArchivers.length,
            matchedArchivers: cycle <= lastStoredCycleCount ? State.activeArchivers.length : 0
          })
        })

        // Record receipt checkpoint status
        await import('./dbstore/checkpointStatus').then(({ upsertCheckpointStatus }) => {
          upsertCheckpointStatus({
            cycle,
            type: CheckpointStatusType.RECEIPT,
            status: cycle <= lastStoredReceiptCycle ? CheckpointSyncStatus.COMPLETED : CheckpointSyncStatus.PENDING,
            timestamp: Date.now(),
            totalArchivers: State.activeArchivers.length,
            matchedArchivers: cycle <= lastStoredReceiptCycle ? State.activeArchivers.length : 0
          })
        })

        // Record original tx checkpoint status
        await import('./dbstore/checkpointStatus').then(({ upsertCheckpointStatus }) => {
          upsertCheckpointStatus({
            cycle,
            type: CheckpointStatusType.ORIGINAL_TX,
            status: cycle <= lastStoredOriginalTxCycle ? CheckpointSyncStatus.COMPLETED : CheckpointSyncStatus.PENDING,
            timestamp: Date.now(),
            totalArchivers: State.activeArchivers.length,
            matchedArchivers: cycle <= lastStoredOriginalTxCycle ? State.activeArchivers.length : 0
          })
        })
      }

      // Start the server first, then sync missing data in the background
      await startServer()

      // Sync missing data in the background
      setTimeout(async () => {
        try {
          // Import and run the sync function
          const { syncMissingCheckpoints } = await import('./checkpoint/CheckpointV2')
          await syncMissingCheckpoints(config.checkpointV2.maxCyclesToSync)
        } catch (error) {
          Logger.mainLogger.error('Error syncing missing checkpoints after server start:', error)
        }
      }, 10 * 1000) // Wait 10 seconds after server start

    } else {
      // Use the original sync method
      // If no receipts stored, synchronize all receipts, otherwise synchronize by cycle
      if (lastStoredReceiptCount === 0) await Data.syncReceipts()
      else {
        Logger.mainLogger.debug('lastStoredReceiptCycle', lastStoredReceiptCycle)
        await Data.syncReceiptsByCycle(lastStoredReceiptCycle)
      }

      if (lastStoredOriginalTxCount === 0) await Data.syncOriginalTxs()
      else {
        Logger.mainLogger.debug('lastStoredOriginalTxCycle', lastStoredOriginalTxCycle)
        await Data.syncOriginalTxsByCycle(lastStoredOriginalTxCycle)
      }

      // After receipt data syncing completes, check cycle and receipt again to be sure it's not missing any data
      // Query for the cycle and receipt counts
      lastStoredReceiptCount = await ReceiptDB.queryReceiptCount()
      lastStoredOriginalTxCount = await OriginalTxDB.queryOriginalTxDataCount()
      lastStoredCycleCount = await CycleDB.queryCyleCount()
      lastStoredCycleInfo = (await CycleDB.queryLatestCycleRecords(1))[0]

      // Check for any missing data and perform syncing if necessary
      if (lastStoredCycleCount - 1 !== lastStoredCycleInfo.counter) {
        throw Error(
          `The archiver has ${lastStoredCycleCount} and the latest stored cycle is ${lastStoredCycleInfo.counter}`
        )
      }
      await Data.syncCyclesAndTxsData(lastStoredCycleCount, lastStoredReceiptCount, lastStoredOriginalTxCount)

      // Start the server after syncing
      await startServer()
    }
  } else {
    // Sync all state metadata until no older data is fetched from other archivers
    await syncStateMetaData(State.activeArchivers)

    // Wait for one cycle before sending data request if experimentalSnapshot is not enabled
    await Utils.sleep(cycleDuration * 1000)

    // Start the server
    await startServer()
  }

  if (!config.sendActiveMessage) {
    await Data.subscribeNodeForDataTransfer()
    return
  }
  const beforeCycle = Cycles.getCurrentCycleCounter()
  // Sending active message to the network
  let isActive = false
  while (!isActive) {
    await Data.sendActiveRequest()

    // TODO not used for now
    // isActive = await Data.checkActiveStatus()

    // Set as true for now, This needs to be removed after the active record for the archiver is added on the validator side
    isActive = true
  }
  Data.subscribeNodeForDataTransfer()

  // Sync the missing data during the cycle of sending active request
  const latestCycle = await Cycles.getNewestCycleFromArchivers()
  await Data.syncCyclesAndTxsDataBetweenCycles(beforeCycle - 1, latestCycle.counter + 1)
  scheduleMultiSigKeysSyncFromNetConfig();
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
      Logger.mainLogger.info(`Worker ${process.pid}: Archive-server is listening on http://0.0.0.0:${config.ARCHIVER_PORT}`)
      State.setActive()
      Collector.scheduleMissingTxsDataQuery()
      // setupWorkerProcesses(cluster)
    }
  )

}

// Add this before starting the server
try {
  initializeTickets();
} catch (err) {
  console.error('Failed to initialize tickets. Server startup aborted:', err);
  process.exit(1);
}

start()
