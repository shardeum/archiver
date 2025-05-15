import * as fs from 'fs'
import * as path from 'path'
import { config } from './Config'
import * as Utils from './Utils'
import * as Logger from './Logger'
import * as Crypto from './Crypto'
import * as CycleDB from './dbstore/cycles'
import * as ReceiptDB from './dbstore/receipts'
import * as Collector from './Data/Collector'
import * as P2P from './P2P'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import * as dbstore from './dbstore'
import { readFileSync } from 'fs'
import { resolve, join } from 'path'
import { initAjvSchemas } from './types/ajv/Helpers'
import { initializeSerialization } from './utils/serialization/SchemaHelpers'

// Initialize crypto with a hardcoded key for the heal script
// This is done before any other operations to ensure crypto is ready
Crypto.setCryptoHashKey('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

// Get archiver keys from environment variables or config
const ARCHIVER_PUBLIC_KEY = process.env.ARCHIVER_PUBLIC_KEY || config.ARCHIVER_PUBLIC_KEY
const ARCHIVER_SECRET_KEY = process.env.ARCHIVER_SECRET_KEY || config.ARCHIVER_SECRET_KEY

// Start time for tracking total execution time
const startTime = Date.now()

// Command line arguments parsing
const args = process.argv.slice(2)
const showHelp = args.includes('--help') || args.includes('-h')
const healingMode = getArgValue('--heal') === 'true'
const minCycle = parseInt(getArgValue('--min-cycle') || '0')
const maxCycle = getArgValue('--max-cycle') ? parseInt(getArgValue('--max-cycle')) : undefined
const cycleOffset = parseInt(getArgValue('--offset') || '0')
const batchSize = parseInt(getArgValue('--batch-size') || '100')
const receiptBatchSize = parseInt(getArgValue('--receipt-batch-size') || '10')
const cycleBatchSize = parseInt(getArgValue('--cycle-batch-size') || '10')
const sleepBetweenBatchesMs = parseInt(getArgValue('--sleep-ms') || '100')
const logFile = getArgValue('--log-file') || 'healArchiver.log'
const jsonLogFile = getArgValue('--json-log') || 'missing-data-summary.json'
const archiverIp = getArgValue('--archiver-ip') || '127.0.0.1'
const archiverPort = parseInt(getArgValue('--archiver-port') || '4000')
const removeTxGroupCycle = getArgValue('--remove-txgroupcycle') === 'true'
const disableReceiptOverride = getArgValue('--disable-receipt-override') === 'true'

/**
 * Display help message for command line arguments
 */
function displayHelp(): void {
  console.log(`
Archiver Healing Script - Help
=============================

This script analyzes and heals missing or mismatched data between local and remote archivers.

Usage:
  node healArchiver.js [options]

Options:
  --help, -h                   Show this help message
  --heal <true|false>          Enable healing mode (default: false)
  --min-cycle <number>         Minimum cycle to check (default: 0)
  --max-cycle <number>         Maximum cycle to check (default: max cycle from remote)
  --offset <number>            Offset to subtract from max cycle (default: 0)
  --batch-size <number>        General batch size for operations (default: 100)
  --cycle-batch-size <number>  Number of cycles to process in each batch for receipts (default: 10)
  --receipt-batch-size <number> Number of receipts to process in each batch (default: 500)
  --sleep-ms <number>          Sleep time between batches in ms (default: 100)
  --log-file <filename>        Log file name (default: healArchiver.log)
  --json-log <filename>        JSON log file name (default: healArchiver-results.json)
  --archiver-ip <ip>           Remote archiver IP address (default: 127.0.0.1)
  --archiver-port <port>       Remote archiver port (default: 4000)
  --remove-txgroupcycle <true|false> Remove txgroupcycle field from receipts before storing (default: false)
                                     Note: For hash comparison, txgroupcycle is always ignored regardless of this flag
  --disable-receipt-override <true|false> Only insert missing or mismatched receipts (default: false)

Examples:
  # Check for missing data without healing
  ts-node healArchiver.ts --min-cycle 1000 --max-cycle 2000

  # Heal missing data for all cycles
  ts-node healArchiver.ts --heal true

  # Heal only missing or mismatched receipts
  ts-node healArchiver.ts --heal true --disable-receipt-override true

  # Heal missing data with an offset from the max cycle
  ts-node healArchiver.ts --heal true --offset 100

  # Heal missing data with custom batch sizes
  ts-node healArchiver.ts --heal true --cycle-batch-size 5 --receipt-batch-size 200
`)
  process.exit(0)
}

// Show help if requested
if (showHelp) {
  displayHelp()
}

// Configuration
const REQUEST_TIMEOUT_SECONDS = 30
const MAX_CYCLES_PER_REQUEST = 100
const MAX_RECEIPTS_PER_REQUEST = 100

// Stats tracking
const endpointStats: Record<
  string,
  { count: number; totalTime: number; avgTime: number; minTime: number; maxTime: number }
> = {}
const missingData: {
  cycles: { counter: number; hash: string; missing: boolean }[]
  receipts: { id: string; cycle: number; hash: string; missing: boolean }[]
} = {
  cycles: [],
  receipts: [],
}

// Counter for txgroupcycle occurrences
let txGroupCycleCounter = 0
// Set to track unique receipt IDs with txGroupCycle to avoid double counting
const receiptsWithTxGroupCycle = new Set<string>()

// Table counts for summary
let tableCounts: Record<string, number> = {}

// Logger setup
let mainLogger: any

/**
 * Helper function to get command line argument values
 */
function getArgValue(flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1]
  }
  return undefined
}

/**
 * Initialize the logger
 */
function initLogger() {
  try {
    console.log('Initializing logger')
    // Try to load the logger config from file
    let logsConfig
    try {
      logsConfig = StringUtils.safeJsonParse(readFileSync(resolve(__dirname, '../archiver-log.json'), 'utf8'))
    } catch (err) {
      console.log('Failed to parse archiver log file:', err)

      // Fallback to basic config
      logsConfig = {
        dir: 'healArchiver',
        files: {
          main: logFile,
        },
        options: {
          appenders: {
            out: { type: 'stdout' },
            main: { type: 'file', maxLogSize: 10485760, backups: 10 },
          },
        },
        categories: {
          default: { appenders: ['out', 'main'], level: 'info' },
          main: { appenders: ['out', 'main'], level: 'info' },
        },
      }
    }

    const logDir = `${config.ARCHIVER_LOGS}/healArchiver`
    const baseDir = '.'
    logsConfig.dir = logDir

    // Create log directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true })
    }

    Logger.initLogger(baseDir, logsConfig)
    mainLogger = Logger.mainLogger

    // Start saving console output if configured
    if (logsConfig.saveConsoleOutput) {
      try {
        // Import dynamically to avoid dependency issues if the module is not available
        const { startSaving } = require('./saveConsoleOutput')
        startSaving(join(baseDir, logsConfig.dir))
      } catch (err) {
        console.warn('Could not start console output saving:', err.message)
      }
    }
  } catch (error) {
    console.error('Failed to initialize logger:', error)
    // Create a basic console logger as fallback
    mainLogger = {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      log: console.log,
    } as any
  }
}

/**
 * Record endpoint statistics for performance tracking
 */
function recordEndpointStat(endpoint: string, durationMs: number) {
  if (!endpointStats[endpoint]) {
    endpointStats[endpoint] = { count: 0, totalTime: 0, avgTime: 0, minTime: Number.MAX_SAFE_INTEGER, maxTime: 0 }
  }
  endpointStats[endpoint].count++
  endpointStats[endpoint].totalTime += durationMs
  endpointStats[endpoint].avgTime = endpointStats[endpoint].totalTime / endpointStats[endpoint].count
  endpointStats[endpoint].minTime = Math.min(endpointStats[endpoint].minTime, durationMs)
  endpointStats[endpoint].maxTime = Math.max(endpointStats[endpoint].maxTime, durationMs)
}

/**
 * Log endpoint statistics summary
 */
function logEndpointStatsSummary() {
  mainLogger.info('===== API ENDPOINT CALLS SUMMARY =====')
  console.log('\n===== API ENDPOINT CALLS SUMMARY =====')

  // Create a table-like format
  const header = 'Endpoint         | Requests | Total Time       | Avg Time (ms) | Min (ms) | Max (ms)'
  const separator = '-----------------|----------|------------------|---------------|----------|----------'
  mainLogger.info(header)
  mainLogger.info(separator)
  console.log(header)
  console.log(separator)

  for (const [endpoint, stats] of Object.entries(endpointStats)) {
    const totalTimeFormatted = formatTime(stats.totalTime)
    const line = `${endpoint.padEnd(16)} | ${String(stats.count).padEnd(8)} | ${totalTimeFormatted.padEnd(16)} | ${stats.avgTime.toFixed(2).padEnd(13)} | ${String(stats.minTime).padEnd(8)} | ${stats.maxTime}`
    mainLogger.info(line)
    console.log(line)
  }

  // Log total run time
  const totalRunTimeMs = Date.now() - startTime
  const totalTimeLine = `run totaltime:  ${formatTime(totalRunTimeMs)}`
  mainLogger.info(totalTimeLine)
  console.log(totalTimeLine)
}

/**
 * Format time in appropriate units (ms, sec, min) based on the value
 */
function formatTime(timeMs: number): string {
  if (timeMs < 1000) {
    return `${timeMs} ms`
  } else if (timeMs < 60000) {
    return `${(timeMs / 1000).toFixed(2)} sec`
  } else {
    return `${(timeMs / 60000).toFixed(2)} min`
  }
}

/**
 * Log progress during batch operations
 */
function logProgress(current: number, total: number, prefix: string) {
  const percent = Math.round((current / total) * 100)
  mainLogger.info(`${prefix}: ${current}/${total} (${percent}%)`)
}

/**
 * Make a direct API call to the remote archiver
 */
async function callArchiverApi(endpoint: string, data: any): Promise<any> {
  const startTime = Date.now()
  try {
    // Sign the request data
    const signedData = Crypto.core.signObj(
      {
        ...data,
        sender: ARCHIVER_PUBLIC_KEY,
      },
      ARCHIVER_SECRET_KEY,
      ARCHIVER_PUBLIC_KEY
    )

    // Make the API call
    const url = `http://${archiverIp}:${archiverPort}${endpoint}`
    const response = await P2P.postJson(url, signedData, REQUEST_TIMEOUT_SECONDS)

    recordEndpointStat(endpoint, Date.now() - startTime)

    if (!response) {
      throw new Error(`Invalid response from archiver: null response`)
    }

    return response
  } catch (error) {
    mainLogger.error(`Error calling archiver API ${endpoint}:`, error)
    throw error
  }
}

/**
 * Get the maximum cycle number from remote archiver
 */
async function getMaxCycleFromRemote(): Promise<number> {
  try {
    // Get total data from remote archiver
    const response = await callArchiverApi('/totalData', {})

    if (!response || !response.totalCycles) {
      mainLogger.error('Failed to get total cycles from remote archiver')
      return 0
    }

    return response.totalCycles
  } catch (error) {
    mainLogger.error('Error fetching max cycle:', error)
    return 0
  }
}

/**
 * Get cycle info from remote archiver for a range of cycles
 */
async function getCycleInfo(start: number, end: number): Promise<any[]> {
  try {
    // Ensure we don't exceed the max cycles per request
    if (end - start + 1 > MAX_CYCLES_PER_REQUEST) {
      end = start + MAX_CYCLES_PER_REQUEST - 1
    }

    const response = await callArchiverApi('/cycleinfo', {
      start,
      end,
    })

    if (!response || !response.cycleInfo) {
      return []
    }

    return response.cycleInfo
  } catch (error) {
    mainLogger.error(`Error fetching cycle info for range ${start}-${end}:`, error)
    return []
  }
}

/**
 * Get receipt data from remote archiver for a specific cycle range with pagination
 * with optimizations for handling large data sets
 */
async function getReceipts(startCycle: number, endCycle: number, page: number = 1): Promise<any[]> {
  try {
    // Ensure we don't request too many cycles at once to avoid memory issues
    const maxCyclesPerRequest = 10
    if (endCycle - startCycle + 1 > maxCyclesPerRequest) {
      endCycle = startCycle + maxCyclesPerRequest - 1
      mainLogger.debug(`Limiting receipt request to cycles ${startCycle}-${endCycle} to manage memory usage`)
    }

    mainLogger.debug(`Requesting receipts for cycles ${startCycle}-${endCycle}, page ${page}`)

    // Add timeout handling to avoid hanging on large requests
    const timeoutMs = 120000 // 2 minutes timeout for large receipt requests

    // Create a promise that resolves with the API call result or rejects after timeout
    const receiptPromise = new Promise<any[]>(async (resolve, reject) => {
      try {
        const response = await callArchiverApi('/receipt', {
          startCycle,
          endCycle,
          page, // Add pagination parameter
        })

        if (!response || !response.receipts) {
          resolve([])
          return
        }

        mainLogger.debug(`Got ${response.receipts.length} receipts for cycles ${startCycle}-${endCycle}, page ${page}`)
        resolve(response.receipts)
      } catch (error) {
        reject(error)
      }
    })

    // Create a timeout promise
    const timeoutPromise = new Promise<any[]>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `Timeout of ${timeoutMs}ms exceeded when fetching receipts for cycles ${startCycle}-${endCycle}, page ${page}`
          )
        )
      }, timeoutMs)
    })

    // Race the API call against the timeout
    return await Promise.race([receiptPromise, timeoutPromise])
  } catch (error) {
    mainLogger.error(`Error fetching receipts for cycle range ${startCycle}-${endCycle}, page ${page}:`, error)
    return []
  }
}


/**
 * Process a receipt to remove txgroupcycle if flag is enabled
 * Note: This function is now only used when the removeTxGroupCycle flag is true
 * For hash comparison purposes, use getReceiptForHashComparison instead
 */
function processReceipt(receipt: any): any {
  // Create a copy of the receipt to avoid modifying the original
  const processedReceipt = { ...receipt }

  // Check if receipt has txgroupcycle field
  if (processedReceipt?.signedReceipt?.txGroupCycle !== undefined) {
    const receiptId =
      processedReceipt.id ||
      processedReceipt.receiptId ||
      processedReceipt.txId ||
      processedReceipt?.tx?.txId ||
      processedReceipt?.appReceiptData?.data?.txId ||
      'unknown'

    // Only count unique receipts
    if (!receiptsWithTxGroupCycle.has(receiptId)) {
      receiptsWithTxGroupCycle.add(receiptId)
      txGroupCycleCounter++
      mainLogger.info(`Found txgroupcycle in receipt with id: ${receiptId}`)
    }

    // Remove txgroupcycle if flag is enabled
    if (removeTxGroupCycle) {
      delete processedReceipt?.signedReceipt?.txGroupCycle
      mainLogger.info(`Removed txgroupcycle from receipt with id: ${receiptId}`)
    }
  }

  return processedReceipt
}

/**
 * Creates a copy of receipt with txGroupCycle removed for hash comparison purposes
 */
function getReceiptForHashComparison(receipt: any): any {
  // Create a deep copy of the receipt to avoid modifying the original
  const receiptCopy = StringUtils.safeJsonParse(StringUtils.safeStringify(receipt))

  // Remove txGroupCycle field if it exists
  if (receiptCopy?.signedReceipt?.txGroupCycle !== undefined) {
    const receiptId =
      receiptCopy.id ||
      receiptCopy.receiptId ||
      receiptCopy.txId ||
      receiptCopy?.tx?.txId ||
      receiptCopy?.appReceiptData?.data?.txId ||
      'unknown'

    // Only count unique receipts if not already counted by processReceipt
    if (!receiptsWithTxGroupCycle.has(receiptId)) {
      receiptsWithTxGroupCycle.add(receiptId)
      txGroupCycleCounter++
      mainLogger.debug(`Found and removed txgroupcycle for hash comparison in receipt with id: ${receiptId}`)
    }

    delete receiptCopy.signedReceipt.txGroupCycle
  }

  return receiptCopy
}

/**
 * Analyze cycles between local and remote
 */
async function analyzeCycles(
  maxCycleToCheck: number
): Promise<{ cyclesToHeal: any[]; missingCount: number; mismatchedCount: number }> {
  mainLogger.info(`Analyzing cycles from ${minCycle} to ${maxCycleToCheck}`)

  // Track counts for summary
  let missingCount = 0
  let mismatchedCount = 0
  const cyclesToHeal: any[] = []

  // Process in batches of MAX_CYCLES_PER_REQUEST
  for (let start = minCycle; start <= maxCycleToCheck; start += MAX_CYCLES_PER_REQUEST) {
    const end = Math.min(start + MAX_CYCLES_PER_REQUEST - 1, maxCycleToCheck)
    logProgress(start, maxCycleToCheck, 'Analyzing cycles')

    // Get remote cycles for this range
    const remoteCycles = await getCycleInfo(start, end)
    if (!remoteCycles || remoteCycles.length === 0) {
      mainLogger.warn(`No remote cycles found for range ${start}-${end}`)
      continue
    }

    // Get local cycles for this range
    const localCycles = await CycleDB.queryCycleRecordsBetween(start, end)
    const localCycleMap = new Map<number, any>()
    localCycles.forEach((cycle) => {
      localCycleMap.set(cycle.counter, cycle)
    })

    // Compare each remote cycle with local
    for (const remoteCycle of remoteCycles) {
      const counter = remoteCycle.counter
      const localCycle = localCycleMap.get(counter)

      // Calculate hash for comparison
      const remoteHash = Crypto.hash(StringUtils.safeStringify(remoteCycle))

      if (!localCycle) {
        // Missing cycle
        missingCount++
        missingData.cycles.push({ counter, hash: remoteHash, missing: true })

        // Add to healing list
        const cycleMarker = remoteCycle.marker
        const cycleRecord = StringUtils.safeStringify(remoteCycle)
        cyclesToHeal.push({
          counter: remoteCycle.counter,
          cycleMarker: cycleMarker,
          cycleRecord: cycleRecord,
        })
      } else {
        // Compare hashes
        const localHash = Crypto.hash(StringUtils.safeStringify(localCycle))
        if (localHash !== remoteHash) {
          mismatchedCount++
          missingData.cycles.push({ counter, hash: remoteHash, missing: false })

          // Add to healing list
          const cycleMarker = remoteCycle.marker
          const cycleRecord = StringUtils.safeStringify(remoteCycle)
          cyclesToHeal.push({
            counter: remoteCycle.counter,
            cycleMarker: cycleMarker,
            cycleRecord: cycleRecord,
          })
        }
      }
    }

    // Sleep between batches to avoid overwhelming the system
    if (Utils.sleep) {
      await Utils.sleep(sleepBetweenBatchesMs)
    } else {
      await new Promise((resolve) => setTimeout(resolve, sleepBetweenBatchesMs))
    }
  }

  mainLogger.info(`Cycle analysis complete. Missing: ${missingCount}, Mismatched: ${mismatchedCount}`)
  return { cyclesToHeal, missingCount, mismatchedCount }
}

/**
 * Heal cycles that were found to be missing or mismatched
 */
async function fetchRemoteCycleData(cycleNumbers: number[]): Promise<any[]> {
  const remoteCycles: any[] = []
  const BATCH_SIZE = MAX_CYCLES_PER_REQUEST

  // Process in batches to avoid overwhelming the remote archiver
  for (let i = 0; i < cycleNumbers.length; i += BATCH_SIZE) {
    const batchCycles = cycleNumbers.slice(i, i + BATCH_SIZE)
    if (batchCycles.length === 0) continue

    const minCycle = Math.min(...batchCycles)
    const maxCycle = Math.max(...batchCycles)

    try {
      const cycleInfo = await getCycleInfo(minCycle, maxCycle)
      if (cycleInfo && cycleInfo.length > 0) {
        // Filter to only get the cycles we want
        const relevantCycles = cycleInfo.filter((cycle) => batchCycles.includes(cycle.counter))
        remoteCycles.push(...relevantCycles)
      }
    } catch (error) {
      mainLogger.error(`Error fetching remote cycle data for range ${minCycle}-${maxCycle}:`, error)
    }

    await Utils.sleep(sleepBetweenBatchesMs)
  }

  return remoteCycles
}

/**
 * Fetch current receipt data from remote archiver for a list of receipt IDs
 */
async function fetchRemoteReceiptData(receiptIds: { id: string; cycle: number }[]): Promise<any[]> {
  const remoteReceipts: any[] = []
  const BATCH_SIZE = MAX_RECEIPTS_PER_REQUEST

  // Process in batches to avoid overwhelming the remote archiver
  for (let i = 0; i < receiptIds.length; i += BATCH_SIZE) {
    const batchReceipts = receiptIds.slice(i, i + BATCH_SIZE)
    if (batchReceipts.length === 0) continue

    try {
      // Format the txIdList as expected by the API
      const formattedTxIdList = batchReceipts.map((receipt) => [receipt.id, 0]) // Using 0 as timestamp

      // Find min and max cycle in this batch
      const minCycle = Math.min(...batchReceipts.map((r) => r.cycle))
      const maxCycle = Math.max(...batchReceipts.map((r) => r.cycle))

      mainLogger.info(
        `Fetching receipts batch ${i / BATCH_SIZE + 1}, IDs: [${batchReceipts.map((r) => r.id).join(', ')}]`
      )

      const response = await callArchiverApi('/receipt', {
        txIdList: formattedTxIdList,
        startCycle: minCycle,
        endCycle: maxCycle,
      })

      if (response && response.receipts) {
        // Verify we got all the receipts we asked for
        const receivedIds = new Set(
          response.receipts.map((r) => r.receiptId || r.id || r.txId || r?.tx?.txId || r?.appReceiptData?.data?.txId)
        )
        const missingIds = batchReceipts.filter((r) => !receivedIds.has(r.id))

        if (missingIds.length > 0) {
          mainLogger.warn(`Did not receive data for some receipts: [${missingIds.map((r) => r.id).join(', ')}]`)
        }

        remoteReceipts.push(...response.receipts)
        mainLogger.info(`Received ${response.receipts.length} receipts from remote archiver`)
      } else {
        mainLogger.warn(`No receipts returned for batch ${i / BATCH_SIZE + 1}`)
      }
    } catch (error) {
      mainLogger.error(`Error fetching remote receipt data for batch ${i / BATCH_SIZE + 1}:`, error)
    }

    await Utils.sleep(sleepBetweenBatchesMs)
  }

  return remoteReceipts
}

/**
 * Heal cycles that were found to be missing or mismatched
 */
async function healCycles(cyclesToHeal: { counter: number }[]): Promise<number> {
  let healedCount = 0

  if (cyclesToHeal.length === 0) {
    return healedCount
  }

  mainLogger.info(`Fetching current data for ${cyclesToHeal.length} cycles from remote archiver`)

  // Get current data from remote archiver
  const cycleNumbers = cyclesToHeal.map((cycle) => cycle.counter)
  const remoteCycles = await fetchRemoteCycleData(cycleNumbers)

  if (remoteCycles.length === 0) {
    mainLogger.error('No cycle data received from remote archiver')
    return healedCount
  }

  mainLogger.info(`Received ${remoteCycles.length} cycles from remote archiver`)
  mainLogger.info(`Healing ${remoteCycles.length} cycles`)

  // Insert cycles in batches
  const BATCH_INSERT_SIZE = 20
  for (let i = 0; i < remoteCycles.length; i += BATCH_INSERT_SIZE) {
    const batchCycles = remoteCycles.slice(i, i + BATCH_INSERT_SIZE)
    if (batchCycles.length === 0) continue

    try {
      // Format cycles for insertion - parse cycleRecord as JSON to match CycleData type
      const cyclesToInsert = batchCycles.map((cycle) => ({
        counter: cycle.counter,
        cycleMarker: cycle.marker,
        cycleRecord: JSON.parse(StringUtils.safeStringify(cycle)),
      }))

      await CycleDB.bulkInsertCycles(cyclesToInsert)
      mainLogger.info(
        `Successfully healed ${batchCycles.length} cycles in batch (${batchCycles[0].counter}-${batchCycles[batchCycles.length - 1].counter})`
      )
      healedCount += batchCycles.length
    } catch (error) {
      mainLogger.error(`Error batch healing cycles: ${error}`)

      // Try inserting one by one if batch insert fails
      mainLogger.info('Attempting to insert cycles one by one')
      for (const cycle of batchCycles) {
        try {
          await CycleDB.insertCycle({
            counter: cycle.counter,
            cycleMarker: cycle.marker,
            cycleRecord: JSON.parse(StringUtils.safeStringify(cycle)),
          })
          mainLogger.info(`Successfully healed cycle ${cycle.counter}`)
          healedCount++
        } catch (cycleError) {
          mainLogger.error(`Error healing cycle ${cycle.counter}: ${cycleError}`)
        }
      }
    }

    await Utils.sleep(sleepBetweenBatchesMs)
  }

  return healedCount
}

/**
 * Heal receipts that were found to be missing or mismatched
 */
async function healReceipts(receiptsToHeal: { id: string; cycle: number }[]): Promise<number> {
  let healedCount = 0

  if (receiptsToHeal.length === 0) {
    return healedCount
  }

  mainLogger.info(`Fetching current data for ${receiptsToHeal.length} receipts from remote archiver`)

  // Get current data from remote archiver
  const remoteReceipts = await fetchRemoteReceiptData(receiptsToHeal)

  if (remoteReceipts.length === 0) {
    mainLogger.error('No receipt data received from remote archiver')
    return healedCount
  }

  mainLogger.info(`Received ${remoteReceipts.length} receipts from remote archiver`)
  mainLogger.info(`Healing ${remoteReceipts.length} receipts`)

  // Process receipts in smaller batches
  const RECEIPT_BATCH_SIZE = receiptBatchSize
  const totalBatches = Math.ceil(remoteReceipts.length / RECEIPT_BATCH_SIZE)

  for (let i = 0; i < remoteReceipts.length; i += RECEIPT_BATCH_SIZE) {
    const batchNumber = Math.floor(i / RECEIPT_BATCH_SIZE) + 1
    const receiptBatch = remoteReceipts.slice(i, i + RECEIPT_BATCH_SIZE)

    try {
      mainLogger.info(`Processing batch ${batchNumber}/${totalBatches} with ${receiptBatch.length} receipts`)

      // Process receipts if removeTxGroupCycle flag is true
      const receiptsToStore = removeTxGroupCycle ? receiptBatch.map((receipt) => processReceipt(receipt)) : receiptBatch

      await Collector.storeReceiptData(receiptsToStore, 'archiver-heal', false)
      healedCount += receiptBatch.length

      mainLogger.info(`Successfully healed batch ${batchNumber}/${totalBatches} with ${receiptBatch.length} receipts`)
    } catch (error) {
      mainLogger.error(`Error healing receipts batch ${batchNumber}/${totalBatches}:`, error)
    }

    await Utils.sleep(sleepBetweenBatchesMs)
  }

  return healedCount
}

/**
 * Initialize database and verify table counts
 */
async function initializeAndVerifyDB(): Promise<void> {
  console.log('Initializing database connection')
  await dbstore.initializeDB(config)

  // Verify table counts
  console.log('Verifying table counts')

  // Get cycle count
  const cycleCount = await CycleDB.queryCyleCount()
  tableCounts['cycles'] = cycleCount
  console.log(`Cycle table count: ${cycleCount}`)

  // Get receipt count
  const receiptCount = await ReceiptDB.queryReceiptCount()
  tableCounts['receipts'] = receiptCount
  console.log(`Receipt table count: ${receiptCount}`)
}

function getUniqueFilename(baseFilename: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const extension = path.extname(baseFilename)
  const basename = path.basename(baseFilename, extension)
  return `${basename}-${timestamp}${extension}`
}

/**
 * Save results to JSON file
 */
function saveResultsToJson(): void {
  const uniqueJsonFile = getUniqueFilename(jsonLogFile)
  const results = {
    cycles: missingData.cycles,
    receipts: missingData.receipts,
    timestamp: Date.now(),
    summary: {
      totalCyclesChecked: maxCycle ? maxCycle + 1 - minCycle : 0,
      missingCycles: missingData.cycles.filter((c) => c.missing).length,
      mismatchedCycles: missingData.cycles.filter((c) => !c.missing).length,
      missingReceipts: missingData.receipts.filter((r) => r.missing).length,
      mismatchedReceipts: missingData.receipts.filter((r) => !r.missing).length,
      receiptsWithTxGroupCycle: txGroupCycleCounter,
      txGroupCycleRemoved: removeTxGroupCycle,
      totalRunTimeMs: Date.now() - startTime,
    },
  }

  // Save to the root directory with unique filename
  fs.writeFileSync(uniqueJsonFile, StringUtils.safeStringify(results))

  mainLogger.info(`Results saved to ${uniqueJsonFile}`)

  // Also create a detailed log summary with unique filename
  createDetailedLogSummary(uniqueJsonFile)
}

/**
 * Create a detailed log summary as requested
 */
function createDetailedLogSummary(jsonFilePath: string): void {
  const summaryLogFile = jsonFilePath.replace('.json', '-summary.log')
  const missingCycles = missingData.cycles.filter((c) => c.missing)
  const mismatchedCycles = missingData.cycles.filter((c) => !c.missing)
  const missingReceipts = missingData.receipts.filter((r) => r.missing)
  const mismatchedReceipts = missingData.receipts.filter((r) => !r.missing)

  // Group receipts by cycle for better reporting
  const receiptsByCycle = new Map<number, { missing: number; mismatched: number }>()

  for (const receipt of missingData.receipts) {
    if (!receiptsByCycle.has(receipt.cycle)) {
      receiptsByCycle.set(receipt.cycle, { missing: 0, mismatched: 0 })
    }

    if (receipt.missing) {
      receiptsByCycle.get(receipt.cycle)!.missing++
    } else {
      receiptsByCycle.get(receipt.cycle)!.mismatched++
    }
  }

  // Group cycles by missing/mismatched status
  const cyclesByCounts = new Map<number, { missing: number; mismatched: number }>()
  for (const cycle of missingData.cycles) {
    const counter = cycle.counter
    if (!cyclesByCounts.has(counter)) {
      cyclesByCounts.set(counter, { missing: 0, mismatched: 0 })
    }

    if (cycle.missing) {
      cyclesByCounts.get(counter)!.missing++
    } else {
      cyclesByCounts.get(counter)!.mismatched++
    }
  }

  // Create the summary content
  let summary = '===== MISSING/MISMATCHED DATA BASIC SUMMARY =====\n'
  summary += `Test Range: minCycle:${minCycle}   maxCycle:${maxCycle !== undefined ? maxCycle : 'MAX'}${cycleOffset > 0 ? ` (with offset:${cycleOffset})` : ''}

Cycles:  missing: ${missingCycles.length}  mismatched: ${mismatchedCycles.length} total: ${maxCycle !== undefined ? maxCycle + 1 - minCycle : tableCounts['cycles']}\n`
  summary += `Receipts: missing: ${missingReceipts.length}  mismatched: ${mismatchedReceipts.length} total: ${tableCounts['receipts'] || 0}\n`
  summary += `Receipts with txgroupcycle: ${txGroupCycleCounter}\n`
  if (removeTxGroupCycle) {
    summary += `txgroupcycle field removed: ${removeTxGroupCycle ? 'yes' : 'no'}\n`
  }
  summary += '\n'

  summary += '===== MISSING/MISMATCHED DATA BY COUNTS =====\n\n'

  // Add cycle issues by cycle
  for (const [cycle, counts] of cyclesByCounts.entries()) {
    const parts = []
    if (counts.missing > 0) parts.push(`missing-cycles:${counts.missing}`)
    if (counts.mismatched > 0) parts.push(`mismatched-cycles:${counts.mismatched}`)

    if (parts.length > 0) {
      summary += `cycle ${cycle}:  ${parts.join(' ')}\n`
    }
  }

  // Add receipt issues by cycle
  for (const [cycle, counts] of receiptsByCycle.entries()) {
    const parts = []
    if (counts.missing > 0) parts.push(`missing-receipts:${counts.missing}`)
    if (counts.mismatched > 0) parts.push(`mismatched-receipts:${counts.mismatched}`)

    if (parts.length > 0) {
      summary += `cycle ${cycle}:  ${parts.join(' ')}\n`
    }
  }

  summary += '\n===== MISSING DATA SUMMARY =====\n'

  // Add missing cycles - include all without trimming
  if (missingCycles.length > 0) {
    summary += 'cycle:\n'
    for (const cycle of missingCycles) {
      summary += `  Cycle:${cycle.counter} Hash:${cycle.hash}\n`
    }
  }

  // Add missing receipts - include all without trimming
  if (missingReceipts.length > 0) {
    summary += 'receipt:\n'
    for (const receipt of missingReceipts) {
      summary += `  Cycle:${receipt.cycle} ID:${receipt.id} Hash:${receipt.hash}\n`
    }
  }

  summary += '\n===== MISMATCHED DATA SUMMARY =====\n'

  // Add mismatched cycles - include all without trimming
  if (mismatchedCycles.length > 0) {
    summary += 'cycle:\n'
    for (const cycle of mismatchedCycles) {
      summary += `  Cycle:${cycle.counter} Hash:${cycle.hash}\n`
    }
  }

  // Add mismatched receipts - include all without trimming
  if (mismatchedReceipts.length > 0) {
    summary += 'receipt:\n'
    for (const receipt of mismatchedReceipts) {
      summary += `  Cycle:${receipt.cycle} ID:${receipt.id} Hash:${receipt.hash}\n`
    }
  }

  // Add API endpoint stats
  summary += '\n'

  // Write the summary to file in the root directory with unique filename
  fs.writeFileSync(summaryLogFile, summary)
  mainLogger.info(`Detailed summary saved to ${summaryLogFile}`)
}

/**
 * Print a summary of missing/mismatched data to the console
 */
function printMissingDataSummary() {
  const missingCycles = missingData.cycles.filter((c) => c.missing).length
  const mismatchedCycles = missingData.cycles.filter((c) => !c.missing).length
  const missingReceipts = missingData.receipts.filter((r) => r.missing).length
  const mismatchedReceipts = missingData.receipts.filter((r) => !r.missing).length

  console.log('\n===== MISSING/MISMATCHED DATA BASIC SUMMARY =====')
  console.log(
    `Test Range: minCycle:${minCycle}   maxCycle:${maxCycle !== undefined ? maxCycle : 'MAX'}${cycleOffset > 0 ? ` (with offset:${cycleOffset})` : ''}`
  )
  console.log('')
  console.log(
    `Cycles:  missing: ${missingCycles}  mismatched: ${mismatchedCycles} total: ${maxCycle !== undefined ? maxCycle + 1 - minCycle : tableCounts['cycles']}`
  )
  console.log(
    `Receipts: missing: ${missingReceipts}  mismatched: ${mismatchedReceipts} total: ${tableCounts['receipts'] || 0}`
  )
  console.log(`Receipts with txgroupcycle: ${txGroupCycleCounter} (unique: ${txGroupCycleCounter})`)
  if (removeTxGroupCycle) {
    console.log(`txgroupcycle field removed: ${removeTxGroupCycle ? 'yes' : 'no'}`)
  }
  console.log(`Only heal missing/mismatched receipts: ${disableReceiptOverride ? 'yes' : 'no'}`)

  // Group receipts by cycle for better reporting
  const receiptsByCycle = new Map<number, { missing: number; mismatched: number }>()

  for (const receipt of missingData.receipts) {
    if (!receiptsByCycle.has(receipt.cycle)) {
      receiptsByCycle.set(receipt.cycle, { missing: 0, mismatched: 0 })
    }

    if (receipt.missing) {
      receiptsByCycle.get(receipt.cycle)!.missing++
    } else {
      receiptsByCycle.get(receipt.cycle)!.mismatched++
    }
  }
}

/**
 * Read missing data from a JSON file
 */
async function readMissingDataFromJson(jsonFilePath: string): Promise<{
  cycles: { counter: number; hash: string; missing: boolean }[]
  receipts: { id: string; cycle: number; hash: string; missing: boolean }[]
}> {
  try {
    const fileContent = fs.readFileSync(jsonFilePath, 'utf8')
    const data = StringUtils.safeJsonParse(fileContent)
    return {
      cycles: data.cycles || [],
      receipts: data.receipts || [],
    }
  } catch (error) {
    mainLogger.error(`Error reading missing data from ${jsonFilePath}:`, error)
    throw new Error(`Failed to read missing data from ${jsonFilePath}. Please run analysis mode first.`)
  }
}

/**
 * Main function
 */
async function main() {
  console.log('Starting Archiver Healing Script')
  try {
    // Show help if requested
    if (showHelp) {
      displayHelp()
    }

    console.log('Initializing logger')
    initLogger()
    console.log('Initializing AJV schemas')
    initAjvSchemas()
    console.log('Initializing serialization')
    initializeSerialization()

    if (!mainLogger) {
      console.error('Failed to initialize mainLogger')
      return
    }

    console.log('Logging Archiver Healing Script Started')
    console.log(`Mode: ${healingMode ? 'Healing' : 'Analysis'}`)
    console.log(`Target Archiver: ${archiverIp}:${archiverPort}`)

    // Check if crypto keys are properly set
    if (!ARCHIVER_PUBLIC_KEY || !ARCHIVER_SECRET_KEY) {
      console.error(
        'ARCHIVER_PUBLIC_KEY or ARCHIVER_SECRET_KEY not set in config or environment. Cannot proceed with API calls.'
      )
      console.log('Please set these values in your environment or config file.')
      process.exit(1)
    }

    console.log('Initializing database and verifying counts')
    await initializeAndVerifyDB()

    console.log('Getting max cycle from remote archiver')
    let maxCycleToCheck = maxCycle
    if (maxCycleToCheck === undefined) {
      maxCycleToCheck = await getMaxCycleFromRemote()
      console.log(`Max cycle from remote archiver: ${maxCycleToCheck}`)
    }

    if (cycleOffset > 0) {
      const originalMaxCycle = maxCycleToCheck
      maxCycleToCheck = Math.max(minCycle, maxCycleToCheck - cycleOffset)
      console.log(
        `Applying offset of ${cycleOffset}, adjusting max cycle from ${originalMaxCycle} to ${maxCycleToCheck}`
      )
    }

    if (healingMode) {
      // HEALING MODE
      mainLogger.info('=== Starting Healing Mode ===')

      // Read missing data from JSON file
      const missingDataFromJson = await readMissingDataFromJson(jsonLogFile)

      // Update global missingData with data from JSON
      missingData.cycles = missingDataFromJson.cycles
      missingData.receipts = missingDataFromJson.receipts

      mainLogger.info(`Found ${missingData.cycles.length} cycles and ${missingData.receipts.length} receipts to heal`)

      // Prepare data for healing
      const cyclesToHeal = missingData.cycles.map((cycle) => ({
        counter: cycle.counter,
      }))

      const receiptsToHeal = missingData.receipts.map((receipt) => ({
        id: receipt.id,
        cycle: receipt.cycle,
      }))

      // Perform healing
      const healedCycles = await healCycles(cyclesToHeal)
      const healedReceipts = await healReceipts(receiptsToHeal)

      // Log healing results
      mainLogger.info('=== Healing Results ===')
      mainLogger.info(`Cycles healed: ${healedCycles}`)
      mainLogger.info(`Receipts healed: ${healedReceipts}`)

      // Get updated counts after healing
      mainLogger.info('=== Updated Database Table Counts ===')
      const updatedCycleCount = await CycleDB.queryCyleCount()
      const updatedReceiptCount = await ReceiptDB.queryReceiptCount()
      mainLogger.info(`Cycles: ${updatedCycleCount} (${updatedCycleCount - tableCounts['cycles']} added)`)
      mainLogger.info(`Receipts: ${updatedReceiptCount} (${updatedReceiptCount - tableCounts['receipts']} added)`)

      tableCounts['cycles_after_healing'] = updatedCycleCount
      tableCounts['receipts_after_healing'] = updatedReceiptCount
    } else {
      // ANALYSIS MODE
      mainLogger.info('=== Starting Analysis Mode ===')

      // Run analysis
      const { missingCount: missingCycles, mismatchedCount: mismatchedCycles } = await analyzeCycles(maxCycleToCheck)

      // Log analysis results
      mainLogger.info('=== Analysis Results ===')
      mainLogger.info(`Total cycles checked: ${maxCycleToCheck + 1 - minCycle}`)
      mainLogger.info(`Missing cycles: ${missingCycles}`)
      mainLogger.info(`Mismatched cycles: ${mismatchedCycles}`)
      mainLogger.info(`Receipts with txgroupcycle field: ${txGroupCycleCounter}`)
      if (removeTxGroupCycle) {
        mainLogger.info(`txgroupcycle field removed from ${txGroupCycleCounter} receipts`)
      }

      // Save analysis results to JSON
      saveResultsToJson()
      mainLogger.info(`Analysis results saved to ${jsonLogFile}. Use this file for healing mode.`)
    }

    // Print summary information to console
    printMissingDataSummary()

    // Log endpoint stats
    logEndpointStatsSummary()

    // Log total run time
    const totalRunTimeMs = Date.now() - startTime
    mainLogger.info(`Total run time: ${formatTime(totalRunTimeMs)}`)
    mainLogger.info('Archiver Healing Script Completed')

    await Utils.sleep(200)
    process.exit(0)
  } catch (error) {
    if (mainLogger) {
      mainLogger.error('Unhandled error in healing script:', error)
    } else {
      console.error('Error before logger initialization:', error)
    }
  } finally {
    if (mainLogger) {
      mainLogger.info('Archiver Healing Script Completed')
    }
    await Utils.sleep(200)
    process.exit(0)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
