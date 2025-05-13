import * as State from './State'
import * as Data from './Data/Data'
import * as CycleDB from './dbstore/cycles'
import * as ReceiptDB from './dbstore/receipts'
import * as AccountDB from './dbstore/accounts'
import * as TransactionDB from './dbstore/transactions'
import * as Utils from './Utils'
import { RequestDataType } from './API'
import * as Logger from './Logger'
import * as P2P from './P2P'
import * as Crypto from './Crypto'
import { config, overrideDefaultConfig } from './Config'
import * as fs from 'fs'
import * as path from 'path'
import { join } from 'path'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { startSaving } from './saveConsoleOutput'
import { initAjvSchemas } from './types/ajv/Helpers'
import { initializeSerialization } from './utils/serialization/SchemaHelpers'
import * as dbstore from './dbstore'
import { DataType as GossipDataType } from './Data/GossipData'

/*

Usage:

// Usage examples:
// 1. Analyze only (no healing):
//    ts-node src/healArchiver.ts
//
// 2. Analyze and heal with majority check:
//    ts-node src/healArchiver.ts --heal true
//
// 3. Heal using a specific input file:
//    ts-node src/healArchiver.ts --heal true --input path/to/missing-data.json
//
// 4. Analyze only and save results to default file:
//    ts-node src/healArchiver.ts --save true
//
// 5. Analyze only and save results to custom file:
//    ts-node src/healArchiver.ts --save true --output path/to/output.json
//
// 6. Use console output instead of logger file (default is to use logger file):
//    ts-node src/healArchiver.ts --use-logger false
//
// 7. Disable majority check (save all data without checking for majority):
//    ts-node src/healArchiver.ts --disable-majority-check true
//
// 8. Heal only specific data types:
//    ts-node src/healArchiver.ts --heal true --heal-cycles false --heal-receipts false --heal-accounts true --heal-transactions false
//
// 9. Only verify data without analysis or healing:
//    ts-node src/healArchiver.ts --verify-only true
//
// 10. Combine flags:
//    ts-node src/healArchiver.ts --heal true --use-logger false --disable-majority-check true --input path/to/missing-data.json

*/

// Define custom archivers
interface CustomArchiverConfig {
  ip: string
  port: number
  publicKey: string
}

// You can define your own archivers here instead of using State archivers
const customArchiversConfig: CustomArchiverConfig[] = [
  // Example format:
  // { ip: '127.0.0.1', port: 8080, publicKey: 'archiver-public-key-1' },
  // { ip: '192.168.1.5', port: 8080, publicKey: 'archiver-public-key-2' },
  {
    ip: '127.0.0.1',
    port: 4001,
    publicKey: 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94',
  },
  {
    ip: '127.0.0.1',
    port: 4002,
    publicKey: '9426b64e675cad739d69526bf7e27f3f304a8a03dca508a9180f01e9269ce447',
  },
  {
    ip: '127.0.0.1',
    port: 4004,
    publicKey: '7a95c68fa1a852e25e4f33e1dc5b1b8b142c4b52209ec3535ac059b4b4db3b4c',
  },
  {
    ip: '127.0.0.1',
    port: 4005,
    publicKey: 'fd24ef72d1e3ea49165df43e6f3b2737d5480ae4b7309cc11143af4ab35d28b2',
  },
]

// Configurable options
const healerConfig = {
  // Flag to control whether to use custom archivers or State archivers
  useCustomArchivers: customArchiversConfig.length > 0,

  // Flag to control whether to output logs to file or console
  useLoggerFile: true,

  // Flag to disable majority-based healing (will save all data without checking for majority)
  disableMajorityCheck: false,

  // Flag for verify-only mode
  verifyOnly: false,

  // Flags to control which data types to heal
  healDataTypes: {
    cycles: true,
    receipts: true,
    accounts: true,
    transactions: true,
  },

  // Batch sizes for different operations
  batchSizes: {
    general: 1000, // General batch size for most operations
    receipts: 200, // Batch size for receipt operations (smaller due to receipt size)
    accounts: 100, // Batch size for account operations
    transactions: 100, // Batch size for transaction operations
    healing: 100, // Batch size for healing operations (smaller to avoid overwhelming the DB)
    subBatchSize: 10, // Size of sub-batches when processing in smaller chunks
  },

  // Timeouts and delays
  timeouts: {
    requestTimeoutSeconds: 30, // Timeout for HTTP requests
    sleepBetweenBatchesMs: 1000, // Sleep time between processing large batches
    sleepBetweenSubBatchesMs: 200, // Sleep time between processing sub-batches
    sleepBetweenHealingOperationsMs: 500, // Sleep time between healing operations
  },

  // Parallel processing limits
  parallelProcessing: {
    maxParallelRequests: 5, // Maximum number of parallel requests
  },

  // File paths
  files: {
    missingDataFile: 'missing-archiver-data.json', // File to store missing data information
  },
}

// Flag to control whether to use custom archivers or State archivers
const useCustomArchivers = healerConfig.useCustomArchivers

// Flag to control whether to output logs to file or console
let useLoggerFile = healerConfig.useLoggerFile

console.log('useCustomArchivers: ', useCustomArchivers)
console.log('useLoggerFile: ', useLoggerFile)
console.log('disableMajorityCheck: ', healerConfig.disableMajorityCheck)
console.log('healDataTypes: ', healerConfig.healDataTypes)

// Configurable parameters
const BATCH_SIZE = healerConfig.batchSizes.general
const SLEEP_BETWEEN_BATCHES_MS = healerConfig.timeouts.sleepBetweenBatchesMs
const MAX_PARALLEL_REQUESTS = healerConfig.parallelProcessing.maxParallelRequests
const REQUEST_TIMEOUT_SECONDS = healerConfig.timeouts.requestTimeoutSeconds
const MISSING_DATA_FILE = healerConfig.files.missingDataFile
const MISSING_DATA_SUMMARY_FILE = 'missing-data-summary.log'
const configFile = resolve(__dirname, '../archiver-config.json')
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

// Logger will be initialized in the main function

// Data types we want to sync/heal
enum DataType {
  CYCLE = 'cycle',
  RECEIPT = 'receipt',
  ACCOUNT = 'account',
  TRANSACTION = 'transaction',
}

// Interfaces for tracking missing data
interface MissingCycle {
  counter: number
  majorityHash?: string
  cycleRecord?: string
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingReceipt {
  cycle: number
  id: string
  majorityHash?: string
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingAccount {
  id: string
  majorityHash?: string
  cycle?: number
  cycleNumber?: number
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingTransaction {
  cycle: number
  id: string
  majorityHash?: string
  cycleNumber?: number
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingData {
  cycles: MissingCycle[]
  receipts: MissingReceipt[]
  accounts: MissingAccount[]
  transactions: MissingTransaction[]
  timestamp: number
}

// Interfaces for summary data
interface MissingCycleSummary {
  counter: number
  count: number
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingReceiptSummary {
  id: string
  cycle: number
  count: number
  majorityArchivers?: string[]
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingAccountSummary {
  id: string
  count: number
  cycle?: number
  cycleNumber?: number
  majorityArchivers?: string[]
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

interface MissingTransactionSummary {
  id: string
  count: number
  cycle: number
  cycleNumber?: number
  majorityArchivers?: string[]
  isMissing: boolean // Add explicit flag for missing vs mismatched
}

// Interface for archiver total data
interface TotalDataCounts {
  totalCycles: number
  totalReceipts: number
  totalAccounts: number
  totalTransactions: number
  archiverPk: string
}

// Log progress with percentage
function logProgress(current: number, total: number, prefix: string) {
  const percentage = Math.floor((current / total) * 100)
  Logger.mainLogger.info(`${prefix}: ${current}/${total} (${percentage}%)`)
}

// === BEGIN: Endpoint Stats Tracking ===
const endpointStats: Record<string, { count: number; totalTimeMs: number; minTimeMs: number; maxTimeMs: number }> = {}

function recordEndpointStat(endpoint: string, durationMs: number) {
  if (!endpointStats[endpoint]) {
    endpointStats[endpoint] = { count: 0, totalTimeMs: 0, minTimeMs: Number.POSITIVE_INFINITY, maxTimeMs: 0 }
  }
  const stat = endpointStats[endpoint]
  stat.count++
  stat.totalTimeMs += durationMs
  if (durationMs < stat.minTimeMs) stat.minTimeMs = durationMs
  if (durationMs > stat.maxTimeMs) stat.maxTimeMs = durationMs
}

function logEndpointStatsSummary() {
  const lines = [
    '===== ENDPOINT REQUEST SUMMARY =====',
    'Endpoint         | Requests | Total Time (ms) | Avg Time (ms) | Min (ms) | Max (ms)',
    '-----------------|----------|-----------------|---------------|----------|----------',
  ]
  for (const endpoint in endpointStats) {
    const stat = endpointStats[endpoint]
    const avg = stat.count > 0 ? (stat.totalTimeMs / stat.count).toFixed(2) : '0.00'
    lines.push(
      `${endpoint.padEnd(16)}| ${stat.count.toString().padEnd(8)}| ${stat.totalTimeMs.toFixed(0).padEnd(15)}| ${avg.padEnd(13)}| ${stat.minTimeMs.toFixed(0).padEnd(8)}| ${stat.maxTimeMs.toFixed(0).padEnd(8)}`
    )
  }
  lines.push('======================================')
  const summary = lines.join('\n')
  Logger.mainLogger.info(summary)
  console.log(summary)
}

// Helper function to fetch data from a specific archiver
async function fetchFromArchiver(
  archiver: CustomArchiverConfig | State.ArchiverNodeInfo,
  endpoint: string,
  data: any
): Promise<any> {
  const start = Date.now()
  try {
    // Add support for different endpoint formats
    let formattedEndpoint = endpoint

    // Map RequestDataType to endpoint if needed
    if (endpoint === RequestDataType.CYCLE) {
      formattedEndpoint = '/cycleinfo'
    } else if (endpoint === RequestDataType.RECEIPT) {
      formattedEndpoint = '/receipt'
    } else if (endpoint === RequestDataType.ACCOUNT) {
      formattedEndpoint = '/account'
    } else if (endpoint === RequestDataType.TRANSACTION) {
      formattedEndpoint = '/transaction'
    } else if (endpoint === RequestDataType.TOTALDATA) {
      formattedEndpoint = '/totalData'
    }

    // Special handling for account endpoint
    if (endpoint === RequestDataType.ACCOUNT) {
      // If accountId is provided, we're fetching a specific account
      if (data.accountId) {
        Logger.mainLogger.debug(`Fetching specific account: ${data.accountId}`)
      }
      // If page is provided, we're fetching a page of accounts
      else if (data.page) {
        Logger.mainLogger.debug(`Fetching accounts page: ${data.page}`)
      }
      // If neither is provided, we're fetching the total count
      else {
        Logger.mainLogger.debug(`Fetching total account count`)
      }
    }

    // Prepare data with sender information
    const dataWithSender = {
      ...data,
      sender: config.ARCHIVER_PUBLIC_KEY,
    }

    // Sign the data using the archiver's secret key
    const signedData = Crypto.core.signObj(dataWithSender, config.ARCHIVER_SECRET_KEY, config.ARCHIVER_PUBLIC_KEY)

    // Send the request to the archiver
    const response = await P2P.postJson(
      `http://${archiver.ip}:${archiver.port}${formattedEndpoint}`,
      signedData,
      REQUEST_TIMEOUT_SECONDS
    )

    // Return the response if it exists
    if (response) {
      // For account requests, log the response structure to help with debugging
      if (endpoint === RequestDataType.ACCOUNT) {
        if (response && typeof response === 'object' && 'totalAccounts' in response) {
          Logger.mainLogger.debug(`Received totalAccounts: ${response.totalAccounts}`)
        }
        if (response && typeof response === 'object' && 'accounts' in response) {
          const accounts = response.accounts
          const accountsCount = Array.isArray(accounts) ? accounts.length : 1
          Logger.mainLogger.debug(`Received ${accountsCount} accounts`)
        }
      }
      return response
    }
    return null
  } catch (error) {
    Logger.mainLogger.debug(`Error fetching from archiver ${archiver.ip}:${archiver.port}${endpoint}: ${error.message}`)
    return null
  } finally {
    const duration = Date.now() - start
    recordEndpointStat(endpoint, duration)
  }
}

// Get total data counts from all active archivers
async function getTotalDataFromArchivers(): Promise<TotalDataCounts[]> {
  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers
  const promises = archivers.map(async (archiver) => {
    try {
      // console.log('Fetching total data from archiver: ', archiver, 'Endpoint: /totalData')

      // For totalData endpoint, we don't need to specify cycle parameters
      // It returns aggregate counts directly
      const response = await fetchFromArchiver(archiver, RequestDataType.TOTALDATA, {})

      if (response) {
        Logger.mainLogger.info(
          `Total data from archiver ${archiver.ip}:${archiver.port}:` +
            ` Cycles: ${response.totalCycles || 0},` +
            ` Receipts: ${response.totalReceipts || 0},` +
            ` Accounts: ${response.totalAccounts || 0},` +
            ` Transactions: ${response.totalTransactions || 0}`
        )

        return {
          totalCycles: response.totalCycles || 0,
          totalReceipts: response.totalReceipts || 0,
          totalAccounts: response.totalAccounts || 0,
          totalTransactions: response.totalTransactions || 0,
          archiverPk: archiver.publicKey,
        }
      }
    } catch (error) {
      Logger.mainLogger.debug(`Error getting total data from ${archiver.ip}:${archiver.port}: ${error.message}`)
    }
    return null
  })

  const results = await Promise.all(promises)
  const validResults = results.filter(Boolean) as TotalDataCounts[]

  // Log the results for debugging
  Logger.mainLogger.info(`Got total data from ${validResults.length} archivers`)
  for (const result of validResults) {
    Logger.mainLogger.info(
      `Archiver ${result.archiverPk}: Accounts: ${result.totalAccounts}, Cycles: ${result.totalCycles}`
    )
  }

  return validResults
}

// Get the max count for each data type from all archivers
async function getMaxCounts(): Promise<Record<DataType, number>> {
  const totals = await getTotalDataFromArchivers()

  // Get the maximum count for each data type
  const maxCounts = {
    [DataType.CYCLE]: Math.max(...totals.map((t) => t.totalCycles), 0),
    [DataType.RECEIPT]: Math.max(...totals.map((t) => t.totalReceipts), 0),
    [DataType.ACCOUNT]: Math.max(...totals.map((t) => t.totalAccounts), 0),
    [DataType.TRANSACTION]: Math.max(...totals.map((t) => t.totalTransactions), 0),
  }

  Logger.mainLogger.info(`Maximum data counts from archivers:`)
  Logger.mainLogger.info(`Cycles: ${maxCounts[DataType.CYCLE]}`)
  Logger.mainLogger.info(`Receipts: ${maxCounts[DataType.RECEIPT]}`)
  Logger.mainLogger.info(`Accounts: ${maxCounts[DataType.ACCOUNT]}`)
  Logger.mainLogger.info(`Transactions: ${maxCounts[DataType.TRANSACTION]}`)

  return maxCounts
}

// Get the majority value based on the provided hash function
async function getMajorityItem<T>(items: T[], hashFn: (item: T) => string): Promise<T | null> {
  // If majority check is disabled, return the first item if available
  if (healerConfig.disableMajorityCheck && items.length > 0) {
    Logger.mainLogger.debug(`Majority check disabled, returning first available item`)
    return items[0]
  }

  Logger.mainLogger.debug(`Finding majority item among ${items.length} items`)

  // Use a map to count occurrences by hash
  const tally: Record<string, { count: number; item: T; hash: string }> = {}

  for (const item of items) {
    const hash = hashFn(item)
    if (!tally[hash]) {
      tally[hash] = { count: 0, item, hash }
    }
    tally[hash].count++
  }

  // Log the distribution of hashes
  Logger.mainLogger.debug(`Hash distribution:`)
  Object.entries(tally).forEach(([hash, info]) => {
    Logger.mainLogger.debug(`  Hash ${hash.substring(0, 16)}...: ${info.count} occurrences`)
  })

  let maxCount = 0
  let majorityItem: T | null = null
  let majorityHash: string | null = null

  for (const hash in tally) {
    if (tally[hash].count > maxCount) {
      maxCount = tally[hash].count
      majorityItem = tally[hash].item
      majorityHash = tally[hash].hash
    }
  }

  if (majorityItem) {
    Logger.mainLogger.debug(`Found majority item with hash ${majorityHash} (${maxCount}/${items.length} votes)`)
    Logger.mainLogger.debug(
      `Majority item data sample: ${StringUtils.safeStringify(majorityItem).substring(0, 200)}...`
    )
  } else {
    Logger.mainLogger.debug(`No majority item found`)
  }

  return majorityItem
}

// Process batches in parallel with a limit
async function processBatchesInParallel<T>(
  tasks: Array<() => Promise<T>>,
  maxParallel: number = MAX_PARALLEL_REQUESTS
): Promise<T[]> {
  const results: T[] = []

  // Process in chunks of maxParallel
  for (let i = 0; i < tasks.length; i += maxParallel) {
    const chunk = tasks.slice(i, i + maxParallel)
    const chunkResults = await Promise.all(chunk.map((task) => task()))
    results.push(...chunkResults)

    // Add a small delay between chunks to prevent overwhelming the network
    if (i + maxParallel < tasks.length) {
      await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)
    }
  }

  return results
}

// Save missing data to JSON file
function saveMissingDataToJson(missingData: MissingData): void {
  try {
    fs.writeFileSync(MISSING_DATA_FILE, StringUtils.safeStringify(missingData))
    Logger.mainLogger.info(`Missing data saved to ${MISSING_DATA_FILE}`)
  } catch (error) {
    Logger.mainLogger.error(`Failed to save missing data: ${error.message}`)
  }
}

// Load missing data from JSON file
function loadMissingDataFromJson(): MissingData | null {
  try {
    if (fs.existsSync(MISSING_DATA_FILE)) {
      const data = fs.readFileSync(MISSING_DATA_FILE, 'utf8')
      return JSON.parse(data) as MissingData
    }
  } catch (error) {
    Logger.mainLogger.error(`Failed to load missing data: ${error.message}`)
  }
  return null
}

// Find all missing data across all database tables
async function findMissingData(minCycleToUse?: number, maxCycleToUse?: number): Promise<MissingData> {
  try {
    Logger.mainLogger.info('Starting new missing data analysis using primary key and hash comparison...')
    const archivers: (CustomArchiverConfig | State.ArchiverNodeInfo)[] = useCustomArchivers
      ? customArchiversConfig
      : State.otherArchivers
    const archiverCount = archivers.length
    const majorityThreshold = healerConfig.disableMajorityCheck ? 1 : Math.floor(archiverCount / 2) + 1

    // Cycles
    let missingCycles: MissingCycle[] = []
    let missingCyclesSummary: MissingCycleSummary[] = []
    if (healerConfig.healDataTypes.cycles) {
      Logger.mainLogger.info('Analyzing missing and corrupt cycles...')
      let localCycleSet = new Set<number>(),
        remoteCycleMap,
        localCycleHashMap = new Map<number, string>(),
        remoteCycleHashMap
      const CYCLE_BATCH_SIZE = 100
      let minCycle = typeof minCycleToUse === 'number' ? minCycleToUse : 0
      let maxCycle = typeof maxCycleToUse === 'number' ? maxCycleToUse : undefined
      if (typeof maxCycle === 'undefined') {
        const totalData = await getTotalDataFromArchivers()
        maxCycle = 0
        for (const t of totalData) {
          if (t.totalCycles > maxCycle) maxCycle = t.totalCycles
        }
      }
      // Fetch local cycles in batches
      for (let batchStart = minCycle; batchStart < maxCycle; batchStart += CYCLE_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + CYCLE_BATCH_SIZE - 1, maxCycle - 1)
        const localCycles = await CycleDB.queryCycleRecordsBetween(batchStart, batchEnd)
        for (const c of localCycles) {
          localCycleSet.add(c.counter)
          localCycleHashMap.set(c.counter, Crypto.hash(StringUtils.safeStringify(c)).toLowerCase())
        }
      }
      // Get remote cycles in range (batched)
      remoteCycleMap = new Map<number, number>()
      remoteCycleHashMap = new Map<number, string[]>()
      for (let batchStart = minCycle; batchStart < maxCycle; batchStart += CYCLE_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + CYCLE_BATCH_SIZE - 1, maxCycle - 1)
        for (let i = batchStart; i <= batchEnd; i++) remoteCycleMap.set(i, 0)
        for (const archiver of archivers) {
          const resp = await fetchFromArchiver(archiver, RequestDataType.CYCLE, {
            start: batchStart,
            end: batchEnd,
          })
          if (resp && resp.cycleInfo) {
            for (const c of resp.cycleInfo) {
              if (typeof c.counter === 'number') {
                remoteCycleMap.set(c.counter, (remoteCycleMap.get(c.counter) || 0) + 1)
                const hash = Crypto.hash(StringUtils.safeStringify(c)).toLowerCase()
                if (!remoteCycleHashMap.has(c.counter)) remoteCycleHashMap.set(c.counter, [])
                remoteCycleHashMap.get(c.counter)!.push(hash)
              }
            }
          }
        }
      }
      // Check for missing and corrupt cycles
      for (const [counter, count] of remoteCycleMap.entries()) {
        let majorityHash: string | undefined = undefined
        let isMissing = !localCycleSet.has(counter)
        let isCorrupt = false
        let localHash = localCycleHashMap.get(counter)
        let remoteHashes = remoteCycleHashMap.get(counter) || []
        // Find majority hash
        if (!healerConfig.disableMajorityCheck && remoteHashes.length > 0) {
          const hashCounts: { [hash: string]: number } = {}
          for (const h of remoteHashes) hashCounts[h] = (hashCounts[h] || 0) + 1
          let maxCount = 0
          for (const hash in hashCounts) {
            if (hashCounts[hash] > maxCount) {
              maxCount = hashCounts[hash]
              majorityHash = hash
            }
          }
        } else if (remoteHashes.length > 0) {
          majorityHash = remoteHashes[0]
        }
        // If present locally, check for corruption
        if (!isMissing && majorityHash && localHash && localHash !== majorityHash) {
          isCorrupt = true
        }
        if (isMissing || isCorrupt) {
          missingCycles.push({ counter, majorityHash, isMissing })
          missingCyclesSummary.push({ counter, count, isMissing })
        }
      }
      Logger.mainLogger.info(`Found ${missingCycles.length} missing or corrupt cycles`)
    }

    // Receipts
    let missingReceipts: MissingReceipt[] = []
    let missingReceiptsSummary: MissingReceiptSummary[] = []
    if (healerConfig.healDataTypes.receipts) {
      Logger.mainLogger.info('Analyzing missing and corrupt receipts...')
      const RECEIPT_BATCH_SIZE = 1000
      const [localReceiptSet, remoteReceiptMap]: [Set<string>, Map<string, { count: number; cycle: number }>] =
        await Promise.all([getAllLocalReceiptIds(), getAllRemoteReceiptIds(minCycleToUse, maxCycleToUse)])
      // Build local hash map in batches
      const localReceiptHashMap = new Map<string, string>()
      let localOffset = 0
      while (true) {
        const localReceipts = await ReceiptDB.queryReceipts(localOffset, RECEIPT_BATCH_SIZE)
        if (!localReceipts || localReceipts.length === 0) break
        for (const r of localReceipts) {
          if (r.receiptId) localReceiptHashMap.set(r.receiptId, Crypto.hash(StringUtils.safeStringify(r)).toLowerCase())
        }
        if (localReceipts.length < RECEIPT_BATCH_SIZE) break
        localOffset += RECEIPT_BATCH_SIZE
      }
      // For each remote receipt, check for missing or corrupt (batched remote fetch)
      for (const [id, info] of remoteReceiptMap.entries()) {
        let majorityHash: string | undefined = undefined
        let isMissing = !localReceiptSet.has(id)
        let isCorrupt = false
        let localHash = localReceiptHashMap.get(id)
        // Fetch all remote versions for hash comparison (batched)
        let remoteHashes: string[] = []
        for (let i = 0; i < archivers.length; i += 10) {
          // batch archiver requests
          const archiverBatch = archivers.slice(i, i + 10)
          const batchResults = await Promise.all(
            archiverBatch.map(async (archiver) => {
              const resp = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, { txIdList: [[id, 0]] })
              let hashes: string[] = []
              if (resp && resp.receipts) {
                for (const r of resp.receipts) {
                  hashes.push(Crypto.hash(StringUtils.safeStringify(r)).toLowerCase())
                }
              }
              return hashes
            })
          )
          for (const hashes of batchResults) remoteHashes.push(...hashes)
        }
        // Find majority hash
        if (!healerConfig.disableMajorityCheck && remoteHashes.length > 0) {
          const hashCounts: { [hash: string]: number } = {}
          for (const h of remoteHashes) hashCounts[h] = (hashCounts[h] || 0) + 1
          let maxCount = 0
          for (const hash in hashCounts) {
            if (hashCounts[hash] > maxCount) {
              maxCount = hashCounts[hash]
              majorityHash = hash
            }
          }
        } else if (remoteHashes.length > 0) {
          majorityHash = remoteHashes[0]
        }
        if (!isMissing && majorityHash && localHash && localHash !== majorityHash) {
          isCorrupt = true
        }
        if (isMissing || isCorrupt) {
          missingReceipts.push({ cycle: info.cycle, id, majorityHash, isMissing })
          missingReceiptsSummary.push({ id, count: info.count, cycle: info.cycle, isMissing })
        }
      }
      Logger.mainLogger.info(`Found ${missingReceipts.length} missing or corrupt receipts`)
    }

    // Accounts
    let missingAccounts: MissingAccount[] = []
    let missingAccountsSummary: MissingAccountSummary[] = []
    if (healerConfig.healDataTypes.accounts) {
      Logger.mainLogger.info('Analyzing missing and corrupt accounts...')
      const ACCOUNT_BATCH_SIZE = 1000

      // Get local account IDs and remote account data
      const localAccountSet = await getAllLocalAccountIds()
      const [remoteAccountMap, remoteAccountDetailsMap] = await getAllRemoteAccountIds()

      // Build local hash map in batches
      const localAccountHashMap = new Map<string, string>()
      let localOffset = 0
      while (true) {
        const localAccounts = await AccountDB.queryAccounts(localOffset, ACCOUNT_BATCH_SIZE)
        if (!localAccounts || localAccounts.length === 0) break
        for (const a of localAccounts) {
          if (a.accountId) localAccountHashMap.set(a.accountId, Crypto.hash(StringUtils.safeStringify(a)).toLowerCase())
        }
        if (localAccounts.length < ACCOUNT_BATCH_SIZE) break
        localOffset += ACCOUNT_BATCH_SIZE
      }

      for (const [id, info] of remoteAccountMap.entries()) {
        let isMissing = !localAccountSet.has(id)
        let isCorrupt = false
        let localHash = localAccountHashMap.get(id)

        // Get all remote versions for this account
        const accountVersions = remoteAccountDetailsMap.get(id) || []

        // Find the account with the latest timestamp
        let latestAccount = null
        let latestTimestamp = 0
        for (const account of accountVersions) {
          if (account.timestamp > latestTimestamp) {
            latestTimestamp = account.timestamp
            latestAccount = account
          }
        }

        // Find majority hash using the latest account version
        let majorityHash: string | undefined = undefined
        let majorityArchivers: string[] = []

        if (latestAccount) {
          majorityHash = Crypto.hash(StringUtils.safeStringify(latestAccount)).toLowerCase()

          // Check if local version is corrupt (exists but hash doesn't match)
          if (!isMissing && localHash && localHash !== majorityHash) {
            isCorrupt = true
          }
        }

        if (isMissing || isCorrupt) {
          missingAccounts.push({
            id,
            majorityHash,
            cycle: info.cycle,
            cycleNumber: info.cycleNumber,
            isMissing,
          })
          missingAccountsSummary.push({
            id,
            count: info.count,
            cycle: info.cycle,
            cycleNumber: info.cycleNumber,
            majorityArchivers,
            isMissing,
          })
        }
      }
      Logger.mainLogger.info(`Found ${missingAccounts.length} missing or corrupt accounts`)
    }

    // Transactions
    let missingTransactions: MissingTransaction[] = []
    let missingTransactionsSummary: MissingTransactionSummary[] = []
    if (healerConfig.healDataTypes.transactions) {
      Logger.mainLogger.info('Analyzing missing and corrupt transactions...')
      const TX_BATCH_SIZE = 1000
      const [localTxSet, remoteTxMap]: [
        Set<string>,
        Map<string, { count: number; cycle: number; cycleNumber?: number }>,
      ] = await Promise.all([getAllLocalTxIds(), getAllRemoteTxIds(minCycleToUse, maxCycleToUse)])
      // Build local hash map in batches
      const localTxHashMap = new Map<string, string>()
      let localOffset = 0
      while (true) {
        const localTxs = await TransactionDB.queryTransactions(localOffset, TX_BATCH_SIZE)
        if (!localTxs || localTxs.length === 0) break
        for (const t of localTxs) {
          if (t.txId) localTxHashMap.set(t.txId, Crypto.hash(StringUtils.safeStringify(t)).toLowerCase())
        }
        if (localTxs.length < TX_BATCH_SIZE) break
        localOffset += TX_BATCH_SIZE
      }
      for (const [id, info] of remoteTxMap.entries()) {
        let majorityHash: string | undefined = undefined
        let isMissing = !localTxSet.has(id)
        let isCorrupt = false
        let localHash = localTxHashMap.get(id)
        // Fetch all remote versions for hash comparison (batched)
        let remoteHashes: string[] = []
        for (let i = 0; i < archivers.length; i += 10) {
          const archiverBatch = archivers.slice(i, i + 10)
          const batchResults = await Promise.all(
            archiverBatch.map(async (archiver) => {
              const resp = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, { txId: id })
              let hashes: string[] = []
              if (resp && resp.transactions) {
                if (Array.isArray(resp.transactions)) {
                  for (const t of resp.transactions) {
                    hashes.push(Crypto.hash(StringUtils.safeStringify(t)).toLowerCase())
                  }
                } else {
                  hashes.push(Crypto.hash(StringUtils.safeStringify(resp.transactions)).toLowerCase())
                }
              }
              return hashes
            })
          )
          for (const hashes of batchResults) remoteHashes.push(...hashes)
        }
        // Find majority hash
        if (!healerConfig.disableMajorityCheck && remoteHashes.length > 0) {
          const hashCounts: { [hash: string]: number } = {}
          for (const h of remoteHashes) hashCounts[h] = (hashCounts[h] || 0) + 1
          let maxCount = 0
          for (const hash in hashCounts) {
            if (hashCounts[hash] > maxCount) {
              maxCount = hashCounts[hash]
              majorityHash = hash
            }
          }
        } else if (remoteHashes.length > 0) {
          majorityHash = remoteHashes[0]
        }
        if (!isMissing && majorityHash && localHash && localHash !== majorityHash) {
          isCorrupt = true
        }
        if (isMissing || isCorrupt) {
          missingTransactions.push({
            cycle: info.cycle,
            id,
            majorityHash,
            cycleNumber: info.cycleNumber,
            isMissing,
          })
          missingTransactionsSummary.push({
            id,
            count: info.count,
            cycle: info.cycle,
            cycleNumber: info.cycleNumber,
            isMissing,
          })
        }
      }
      Logger.mainLogger.info(`Found ${missingTransactions.length} missing or corrupt transactions`)
    }

    // Save summary to log file
    const summaryLines = [
      '===== MISSING/MISMATCHED DATA BASIC SUMMARY =====',
      `Test Range: minCycle:${minCycleToUse || 0}   maxCycle:${maxCycleToUse || 'unknown'}`,
      '',
      `Cycles:  missing: ${missingCycles.filter((c) => c.isMissing).length}  mismatched: ${missingCycles.filter((c) => !c.isMissing).length} total: ${missingCycles.length}`,
      `Receipts: missing: ${missingReceipts.filter((r) => r.isMissing).length}  mismatched: ${missingReceipts.filter((r) => !r.isMissing).length} total: ${missingReceipts.length}`,
      `Accounts: missing: ${missingAccounts.filter((a) => a.isMissing).length}  mismatched: ${missingAccounts.filter((a) => !a.isMissing).length} total: ${missingAccounts.length}`,
      `Transactions: missing: ${missingTransactions.filter((t) => t.isMissing).length}  mismatched: ${missingTransactions.filter((t) => !t.isMissing).length} total: ${missingTransactions.length}`,
      '',
      '===== MISSING/MISMATCHED DATA BY COUNTS =====',

      // Group by cycle and count missing items per cycle
      ...(() => {
        const cycleMap = new Map<
          number,
          {
            missingCycles: number
            mismatchedCycles: number
            missingReceipts: number
            mismatchedReceipts: number
            missingAccounts: number
            mismatchedAccounts: number
            missingTransactions: number
            mismatchedTransactions: number
          }
        >()

        // Count missing cycles
        for (const cycle of missingCycles) {
          const cycleNum = cycle.counter
          if (!cycleMap.has(cycleNum)) {
            cycleMap.set(cycleNum, {
              missingCycles: 0,
              mismatchedCycles: 0,
              missingReceipts: 0,
              mismatchedReceipts: 0,
              missingAccounts: 0,
              mismatchedAccounts: 0,
              missingTransactions: 0,
              mismatchedTransactions: 0,
            })
          }
          if (cycle.isMissing) {
            cycleMap.get(cycleNum)!.missingCycles++
          } else {
            cycleMap.get(cycleNum)!.mismatchedCycles++
          }
        }

        // Count missing receipts
        for (const receipt of missingReceipts) {
          const cycleNum = receipt.cycle
          if (!cycleMap.has(cycleNum)) {
            cycleMap.set(cycleNum, {
              missingCycles: 0,
              mismatchedCycles: 0,
              missingReceipts: 0,
              mismatchedReceipts: 0,
              missingAccounts: 0,
              mismatchedAccounts: 0,
              missingTransactions: 0,
              mismatchedTransactions: 0,
            })
          }
          if (receipt.isMissing) {
            cycleMap.get(cycleNum)!.missingReceipts++
          } else {
            cycleMap.get(cycleNum)!.mismatchedReceipts++
          }
        }

        // Count missing accounts
        for (const account of missingAccounts) {
          const cycleNum = account.cycleNumber || account.cycle || 0
          if (!cycleMap.has(cycleNum)) {
            cycleMap.set(cycleNum, {
              missingCycles: 0,
              mismatchedCycles: 0,
              missingReceipts: 0,
              mismatchedReceipts: 0,
              missingAccounts: 0,
              mismatchedAccounts: 0,
              missingTransactions: 0,
              mismatchedTransactions: 0,
            })
          }
          if (account.isMissing) {
            cycleMap.get(cycleNum)!.missingAccounts++
          } else {
            cycleMap.get(cycleNum)!.mismatchedAccounts++
          }
        }

        // Count missing transactions
        for (const tx of missingTransactions) {
          const cycleNum = tx.cycleNumber || tx.cycle
          if (!cycleMap.has(cycleNum)) {
            cycleMap.set(cycleNum, {
              missingCycles: 0,
              mismatchedCycles: 0,
              missingReceipts: 0,
              mismatchedReceipts: 0,
              missingAccounts: 0,
              mismatchedAccounts: 0,
              missingTransactions: 0,
              mismatchedTransactions: 0,
            })
          }
          if (tx.isMissing) {
            cycleMap.get(cycleNum)!.missingTransactions++
          } else {
            cycleMap.get(cycleNum)!.mismatchedTransactions++
          }
        }

        // Convert to array of lines
        return Array.from(cycleMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([cycle, counts]) => {
            const parts = []
            if (counts.missingCycles > 0) parts.push(`missing-cycles:${counts.missingCycles}`)
            if (counts.mismatchedCycles > 0) parts.push(`mismatched-cycles:${counts.mismatchedCycles}`)
            if (counts.missingReceipts > 0) parts.push(`missing-receipts:${counts.missingReceipts}`)
            if (counts.mismatchedReceipts > 0) parts.push(`mismatched-receipts:${counts.mismatchedReceipts}`)
            if (counts.missingAccounts > 0) parts.push(`missing-accounts:${counts.missingAccounts}`)
            if (counts.mismatchedAccounts > 0) parts.push(`mismatched-accounts:${counts.mismatchedAccounts}`)
            if (counts.missingTransactions > 0) parts.push(`missing-transactions:${counts.missingTransactions}`)
            if (counts.mismatchedTransactions > 0)
              parts.push(`mismatched-transactions:${counts.mismatchedTransactions}`)

            return `cycle ${cycle}:  ${parts.join(' ')}`
          })
      })(),
      '',
      '===== MISSING DATA SUMMARY =====',
      `Cycles:`,
      missingCycles.filter((c) => c.isMissing).length === 0
        ? '  No missing data found'
        : missingCyclesSummary
            .filter((c) => c.isMissing)
            .map((c) => `  counter: ${c.counter}, occurrences: ${c.count}`),
      `Receipts:`,
      missingReceipts.filter((r) => r.isMissing).length === 0
        ? '  No missing data found'
        : missingReceiptsSummary
            .filter((r) => r.isMissing)
            .map(
              (r) =>
                `  id: ${r.id}, cycle: ${r.cycle}, occurrences: ${r.count}` +
                (r.majorityArchivers && r.majorityArchivers.length > 0
                  ? `, majorityArchivers: [${r.majorityArchivers.join(', ')}]`
                  : '')
            ),
      `Accounts:`,
      missingAccounts.filter((a) => a.isMissing).length === 0
        ? '  No missing data found'
        : missingAccountsSummary
            .filter((a) => a.isMissing)
            .map(
              (a) =>
                `  id: ${a.id}, occurrences: ${a.count}, cycle: ${a.cycleNumber || 'unknown'}` +
                (a.majorityArchivers && a.majorityArchivers.length > 0
                  ? `, majorityArchivers: [${a.majorityArchivers.join(', ')}]`
                  : '')
            ),
      `Transactions:`,
      missingTransactions.filter((t) => t.isMissing).length === 0
        ? '  No missing data found'
        : missingTransactionsSummary
            .filter((t) => t.isMissing)
            .map(
              (t) =>
                `  id: ${t.id}, cycle: ${t.cycleNumber || 'unknown'}, occurrences: ${t.count}` +
                (t.majorityArchivers && t.majorityArchivers.length > 0
                  ? `, majorityArchivers: [${t.majorityArchivers.join(', ')}]`
                  : '')
            ),
      '',
      '===== MISMATCHED DATA SUMMARY =====',
      `Cycles:`,
      missingCycles.filter((c) => !c.isMissing).length === 0
        ? '  No Mismatch Found'
        : missingCyclesSummary
            .filter((c) => !c.isMissing)
            .map((c) => {
              const mismatchedCycle = missingCycles.find((mc) => mc.counter === c.counter && !mc.isMissing)
              return (
                `  counter: ${c.counter}, occurrences: ${c.count}` +
                (mismatchedCycle && mismatchedCycle.majorityHash ? ', hash mismatch' : '')
              )
            }),
      `Receipts:`,
      missingReceipts.filter((r) => !r.isMissing).length === 0
        ? '  No Mismatch Found'
        : missingReceiptsSummary
            .filter((r) => !r.isMissing)
            .map((r) => {
              const mismatchedReceipt = missingReceipts.find((mr) => mr.id === r.id && !mr.isMissing)
              return (
                `  id: ${r.id}, cycle: ${r.cycle}, occurrences: ${r.count}` +
                (mismatchedReceipt && mismatchedReceipt.majorityHash ? ', hash mismatch' : '')
              )
            }),
      `Accounts:`,
      missingAccounts.filter((a) => !a.isMissing).length === 0
        ? '  No Mismatch Found'
        : missingAccountsSummary
            .filter((a) => missingAccounts.find((ma) => ma.id === a.id && !ma.isMissing))
            .map((a) => {
              const mismatchedAccount = missingAccounts.find((ma) => ma.id === a.id && !ma.isMissing)
              return (
                `  id: ${a.id}, occurrences: ${a.count}, cycle: ${a.cycleNumber || 'unknown'}` +
                (mismatchedAccount && mismatchedAccount.majorityHash ? ', hash mismatch' : '')
              )
            }),
      `Transactions:`,
      missingTransactions.filter((t) => !t.isMissing).length === 0
        ? '  No Mismatch Found'
        : missingTransactionsSummary
            .filter((t) => missingTransactions.find((mt) => mt.id === t.id && !mt.isMissing))
            .map((t) => {
              const mismatchedTx = missingTransactions.find((mt) => mt.id === t.id && !mt.isMissing)
              return (
                `  id: ${t.id}, cycle: ${t.cycleNumber || 'unknown'}, occurrences: ${t.count}` +
                (mismatchedTx && mismatchedTx.majorityHash ? ', hash mismatch' : '')
              )
            }),
      '',
      '===== API ENDPOINT CALLS SUMMARY =====',
      ...(() => {
        const lines = [
          'Endpoint         | Requests | Total Time (ms) | Avg Time (ms) | Min (ms) | Max (ms)',
          '-----------------|----------|-----------------|---------------|----------|----------',
        ]

        for (const endpoint in endpointStats) {
          const stat = endpointStats[endpoint]
          const avg = stat.count > 0 ? (stat.totalTimeMs / stat.count).toFixed(2) : '0.00'
          lines.push(
            `${endpoint.padEnd(16)}| ${stat.count.toString().padEnd(8)}| ${stat.totalTimeMs.toFixed(0).padEnd(15)}| ${avg.padEnd(13)}| ${stat.minTimeMs.toFixed(0).padEnd(8)}| ${stat.maxTimeMs.toFixed(0).padEnd(8)}`
          )
        }

        return lines
      })(),
    ].flat()
    fs.writeFileSync(MISSING_DATA_SUMMARY_FILE, summaryLines.join('\n'))
    Logger.mainLogger.info(`Missing data summary saved to ${MISSING_DATA_SUMMARY_FILE}`)

    // Build missingData object only with enabled types
    const missingData: any = { timestamp: Date.now() }
    if (healerConfig.healDataTypes.cycles) missingData.cycles = missingCycles
    if (healerConfig.healDataTypes.receipts) missingData.receipts = missingReceipts
    if (healerConfig.healDataTypes.accounts) missingData.accounts = missingAccounts
    if (healerConfig.healDataTypes.transactions) missingData.transactions = missingTransactions

    Logger.mainLogger.info('Missing data analysis complete:')
    Logger.mainLogger.info(`- Missing cycles: ${missingData.cycles ? missingData.cycles.length : 0}`)
    Logger.mainLogger.info(`- Missing receipts: ${missingData.receipts ? missingData.receipts.length : 0}`)
    Logger.mainLogger.info(`- Missing accounts: ${missingData.accounts ? missingData.accounts.length : 0}`)
    Logger.mainLogger.info(`- Missing transactions: ${missingData.transactions ? missingData.transactions.length : 0}`)

    return missingData
  } catch (error) {
    Logger.mainLogger.error(`Error finding missing data: ${error.message}`)
    Logger.mainLogger.error(error.stack)
    // Return an empty missing data object rather than failing completely
    return {
      cycles: [],
      receipts: [],
      accounts: [],
      transactions: [],
      timestamp: Date.now(),
    }
  }
}

// Heal missing cycles using the missing data report
async function healMissingCycles(missingCycles: MissingCycle[]): Promise<void> {
  if (missingCycles.length === 0) {
    Logger.mainLogger.info('No cycles to heal')
    return
  }

  Logger.mainLogger.info(`Healing ${missingCycles.length} missing cycles...`)

  // Sort by counter for better logging
  const sortedCycles = [...missingCycles].sort((a, b) => a.counter - b.counter)

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process cycles in smaller batches to avoid overwhelming the network
  const batchSize = healerConfig.batchSizes.subBatchSize

  // Track cycles we successfully fetched data for
  const cyclesToInsert = []
  let successCount = 0
  let failCount = 0

  // Process cycles in batches
  for (let i = 0; i < sortedCycles.length; i += batchSize) {
    const batch = sortedCycles.slice(i, i + batchSize)
    Logger.mainLogger.info(
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(sortedCycles.length / batchSize)}: ${batch.length} cycles`
    )

    // Process each cycle individually
    for (const cycle of batch) {
      const cycleCounter = cycle.counter
      Logger.mainLogger.debug(`Fetching cycle ${cycleCounter} from archivers`)

      // Create tasks to query this specific cycle from each archiver
      const tasks = archivers.map((archiver) => {
        return async () => {
          try {
            // Query just this one cycle by setting start and end to the same value
            const response = await fetchFromArchiver(archiver, RequestDataType.CYCLE, {
              start: cycleCounter,
              end: cycleCounter,
            })

            if (response && response.cycleInfo && response.cycleInfo.length > 0) {
              Logger.mainLogger.debug(`Got cycle ${cycleCounter} from archiver ${archiver.ip}:${archiver.port}`)
              return response.cycleInfo
            }

            Logger.mainLogger.debug(`No cycle data for ${cycleCounter} from archiver ${archiver.ip}:${archiver.port}`)
            return []
          } catch (error) {
            Logger.mainLogger.error(
              `Error fetching cycle ${cycleCounter} from ${archiver.ip}:${archiver.port}: ${error.message}`
            )
            return []
          }
        }
      })

      const results = await processBatchesInParallel(tasks)
      const cycleData = results.flat()

      if (cycleData.length === 0) {
        Logger.mainLogger.warn(`No data found for cycle ${cycleCounter} from any archiver`)
        failCount++
        continue
      }

      Logger.mainLogger.info(`Found ${cycleData.length} versions of cycle ${cycleCounter}`)

      // Process this cycle using the majority hash
      if (cycle.majorityHash) {
        // Use the majority hash from the report
        const matchingCycle = cycleData.find((c) => (c.hash || StringUtils.safeStringify(c)) === cycle.majorityHash)

        if (matchingCycle) {
          // Don't reformat the cycle, just use it as is
          cyclesToInsert.push({
            counter: matchingCycle.counter,
            cycleMarker: matchingCycle.marker || `cycle-${matchingCycle.counter}`,
            cycleRecord: matchingCycle,
            isMissing: false,
          })
          Logger.mainLogger.debug(
            `Using exact hash match for cycle ${matchingCycle.counter}. Data: ${StringUtils.safeStringify(matchingCycle).substring(0, 200)}...`
          )
          successCount++
        } else {
          // If we can't find the exact hash match, use majority determination again
          const majorityCycle = await getMajorityItem(cycleData, (c) => c.hash || StringUtils.safeStringify(c))
          if (majorityCycle) {
            // Don't reformat the cycle, just use it as is
            cyclesToInsert.push({
              counter: majorityCycle.counter,
              cycleMarker: majorityCycle.marker || `cycle-${majorityCycle.counter}`,
              cycleRecord: majorityCycle,
              isMissing: false,
            })
            Logger.mainLogger.debug(
              `Using majority cycle for ${majorityCycle.counter}. Data: ${StringUtils.safeStringify(majorityCycle).substring(0, 200)}...`
            )
            successCount++
          } else {
            failCount++
          }
        }
      } else {
        // No majority hash in the report, determine it now
        const majorityCycle = await getMajorityItem(cycleData, (c) => c.hash || StringUtils.safeStringify(c))
        if (majorityCycle) {
          // Don't reformat the cycle, just use it as is
          cyclesToInsert.push({
            counter: majorityCycle.counter,
            cycleMarker: majorityCycle.marker || `cycle-${majorityCycle.counter}`,
            cycleRecord: majorityCycle,
            isMissing: false,
          })
          Logger.mainLogger.debug(
            `Using majority cycle for ${majorityCycle.counter}. Data: ${StringUtils.safeStringify(majorityCycle).substring(0, 200)}...`
          )
          successCount++
        } else {
          failCount++
        }
      }
    }

    // Add a small delay between batches to prevent overwhelming the network
    if (i + batchSize < sortedCycles.length) {
      await Utils.sleep(healerConfig.timeouts.sleepBetweenBatchesMs)
    }

    // Periodically insert cycles to avoid keeping too many in memory
    if (cyclesToInsert.length >= healerConfig.batchSizes.healing || i + batchSize >= sortedCycles.length) {
      if (cyclesToInsert.length > 0) {
        try {
          // Validate all cycles have the required fields before insertion
          const validCycles = cyclesToInsert.filter((cycle) => {
            // Check for required fields
            if (!cycle.cycleMarker) {
              Logger.mainLogger.warn(`Skipping cycle ${cycle.counter} due to missing cycleMarker`)
              return false
            }
            if (!cycle.cycleRecord) {
              Logger.mainLogger.warn(`Skipping cycle ${cycle.counter} due to missing cycleRecord`)
              return false
            }
            return true
          })

          if (validCycles.length !== cyclesToInsert.length) {
            Logger.mainLogger.warn(`Filtered out ${cyclesToInsert.length - validCycles.length} invalid cycles`)
          }

          if (validCycles.length > 0) {
            Logger.mainLogger.info(`Attempting to insert ${validCycles.length} cycles`)
            Logger.mainLogger.debug(
              `First cycle sample: ${StringUtils.safeStringify(validCycles[0]).substring(0, 200)}...`
            )
            try {
              await CycleDB.bulkInsertCycles(validCycles)
              Logger.mainLogger.info(`Successfully inserted ${validCycles.length} cycles`)
            } catch (err) {
              Logger.mainLogger.error(`Error in cycle insertion: ${err.message}`)
              Logger.mainLogger.error(`Error stack: ${err.stack}`)

              // If bulk insert fails, try individual inserts
              let individualSuccessCount = 0
              for (const cycle of validCycles) {
                try {
                  await CycleDB.insertCycle(cycle)
                  individualSuccessCount++
                } catch (innerError) {
                  Logger.mainLogger.error(`Failed to insert cycle ${cycle.counter}: ${innerError.message}`)
                }
              }
              Logger.mainLogger.info(
                `Successfully inserted ${individualSuccessCount}/${validCycles.length} cycles individually`
              )
            }
          } else {
            Logger.mainLogger.warn(`No valid cycles to insert after filtering`)
          }

          // Clear the array after insertion
          cyclesToInsert.length = 0
        } catch (error) {
          Logger.mainLogger.error(`Error processing cycle batch: ${error.message}`)
        }
      }
    }
  }

  Logger.mainLogger.info(
    `Completed healing of cycles. Successfully processed ${successCount} cycles, failed to process ${failCount} cycles.`
  )
}

// Heal missing receipts using the missing data report
async function healMissingReceipts(missingReceipts: MissingReceipt[]): Promise<void> {
  if (missingReceipts?.length === 0) {
    Logger.mainLogger.info('No receipts to heal')
    return
  }

  Logger.mainLogger.info(`Healing ${missingReceipts.length} missing receipts...`)

  // Group by cycle to optimize requests
  const receiptsByCycle = new Map<number, MissingReceipt[]>()

  for (const receipt of missingReceipts) {
    if (!receiptsByCycle.has(receipt.cycle)) {
      receiptsByCycle.set(receipt.cycle, [])
    }
    receiptsByCycle.get(receipt.cycle)!.push(receipt)
  }

  Logger.mainLogger.info(`Receipts span across ${receiptsByCycle.size} cycles`)

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process each cycle
  let processedCycles = 0
  for (const [cycle, receipts] of receiptsByCycle.entries()) {
    processedCycles++
    logProgress(processedCycles, receiptsByCycle.size, `Healing receipts for cycle`)

    // For large cycles, process in batches of IDs
    const batchSize = 50 // Keep smaller due to receipt size
    const receiptBatches: MissingReceipt[][] = []

    for (let i = 0; i < receipts.length; i += batchSize) {
      receiptBatches.push(receipts.slice(i, i + batchSize))
    }

    for (let i = 0; i < receiptBatches.length; i++) {
      const batch = receiptBatches[i]

      // Create a list of IDs to request
      const receiptIds = batch.map((r) => r.id)

      // Create tasks to fetch each receipt batch from each archiver
      const tasks = archivers.map((archiver) => {
        return async () => {
          // Different approach: fetch by ID list
          const response = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, {
            txIdList: receiptIds.map((id) => [id, 0]), // Format expected by API: [id, timestamp]
          })

          return response && response.receipts ? response.receipts : []
        }
      })

      const results = await processBatchesInParallel(tasks)
      const allReceipts = results.flat()

      if (allReceipts.length === 0) {
        Logger.mainLogger.warn(`No receipt data found for batch ${i + 1}/${receiptBatches.length} in cycle ${cycle}`)
        continue
      }

      // Group receipts by ID
      const receiptsByIdMap = new Map<string, any[]>()
      for (const receipt of allReceipts) {
        if (!receipt.receiptId) continue

        if (!receiptsByIdMap.has(receipt.receiptId)) {
          receiptsByIdMap.set(receipt.receiptId, [])
        }
        receiptsByIdMap.get(receipt.receiptId)!.push(receipt)
      }

      // Process receipts using the majority hash from missing data
      const receiptsToInsert = []

      for (const missing of batch) {
        const receipts = receiptsByIdMap.get(missing.id) || []

        if (receipts.length === 0) {
          Logger.mainLogger.warn(`No data found for receipt ${missing.id}`)
          continue
        }

        if (missing.majorityHash) {
          // Use the majority hash from the report
          const matchingReceipt = receipts.find(
            (r) => (r.hash || StringUtils.safeStringify(r)) === missing.majorityHash
          )

          if (matchingReceipt) {
            // Don't reformat the receipt, use it as is
            receiptsToInsert.push(matchingReceipt)
            Logger.mainLogger.debug(
              `Using exact hash match for receipt ${missing.id}. Data: ${StringUtils.safeStringify(matchingReceipt).substring(0, 200)}...`
            )
          } else {
            // If we can't find the exact hash match, use majority determination again
            const majorityReceipt = await getMajorityItem(receipts, (r) => r.hash || StringUtils.safeStringify(r))
            if (majorityReceipt) {
              // Don't reformat the receipt, use it as is
              receiptsToInsert.push(majorityReceipt)
              Logger.mainLogger.debug(
                `Using majority receipt for ${missing.id}. Data: ${StringUtils.safeStringify(majorityReceipt).substring(0, 200)}...`
              )
            }
          }
        } else {
          // No majority hash in the report, determine it now
          const majorityReceipt = await getMajorityItem(receipts, (r) => r.hash || StringUtils.safeStringify(r))
          if (majorityReceipt) {
            // Don't reformat the receipt, use it as is
            receiptsToInsert.push(majorityReceipt)
            Logger.mainLogger.debug(
              `Using majority receipt for ${missing.id}. Data: ${StringUtils.safeStringify(majorityReceipt).substring(0, 200)}...`
            )
          }
        }
      }

      // Bulk insert receipts
      if (receiptsToInsert.length > 0) {
        try {
          Logger.mainLogger.info(`Attempting to insert ${receiptsToInsert.length} receipts for cycle ${cycle}`)
          Logger.mainLogger.debug(
            `First receipt sample: ${StringUtils.safeStringify(receiptsToInsert[0]).substring(0, 200)}...`
          )
          try {
            const result = await ReceiptDB.bulkInsertReceipts(receiptsToInsert)
            Logger.mainLogger.info(
              `Successfully inserted ${receiptsToInsert.length} receipts for cycle ${cycle}. Result: ${StringUtils.safeStringify(result)}`
            )
          } catch (err) {
            Logger.mainLogger.error(`Error in receipt insertion: ${err.message}`)
            Logger.mainLogger.error(`Error stack: ${err.stack}`)
            throw err // Re-throw to be caught by the outer catch
          }
        } catch (error) {
          Logger.mainLogger.error(`Error bulk inserting receipts: ${error.message}`)

          // If bulk insert fails, try individual inserts
          let successCount = 0
          for (const receipt of receiptsToInsert) {
            try {
              await ReceiptDB.insertReceipt(receipt)
              successCount++
            } catch (innerError) {
              Logger.mainLogger.error(`Failed to insert receipt ${receipt.receiptId}: ${innerError.message}`)
            }
          }
          Logger.mainLogger.info(
            `Successfully inserted ${successCount}/${receiptsToInsert.length} receipts individually`
          )
        }
      }

      await Utils.sleep(SLEEP_BETWEEN_BATCHES_MS)
    }
  }

  Logger.mainLogger.info(`Completed healing of receipts`)
}

// Heal missing accounts using the missing data report
async function healMissingAccounts(missingAccounts: MissingAccount[]): Promise<void> {
  if (missingAccounts.length === 0) {
    Logger.mainLogger.info('No accounts to heal')
    return
  }

  Logger.mainLogger.info(`Healing ${missingAccounts.length} missing accounts...`)

  // Get all remote accounts data
  const [_, remoteAccountDetailsMap] = await getAllRemoteAccountIds()

  // Process accounts in batches to avoid overwhelming memory
  const accountsToInsert = []

  // Process missing accounts using the latest timestamp
  for (const missingAccount of missingAccounts) {
    // Get all versions of this account that we've already fetched
    const accountVersions = remoteAccountDetailsMap.get(missingAccount.id) || []

    if (accountVersions.length === 0) {
      Logger.mainLogger.warn(`No data found for account ${missingAccount.id}`)
      continue
    }

    // Find the account with the latest timestamp
    let latestAccount = accountVersions[0]
    let latestTimestamp = latestAccount.timestamp || 0

    // Compare all versions to find the one with the latest timestamp
    for (let i = 1; i < accountVersions.length; i++) {
      const account = accountVersions[i]
      const timestamp = account.timestamp || 0

      if (timestamp > latestTimestamp) {
        latestTimestamp = timestamp
        latestAccount = account
      }
    }

    // Use the account with the latest timestamp
    accountsToInsert.push(latestAccount)
    Logger.mainLogger.debug(
      `Using account with latest timestamp (${latestTimestamp}) for ${missingAccount.id}. Data: ${StringUtils.safeStringify(latestAccount).substring(0, 200)}...`
    )
  }

  // Insert accounts in smaller batches to avoid memory issues
  const insertBatchSize = healerConfig.batchSizes.healing
  for (let i = 0; i < accountsToInsert.length; i += insertBatchSize) {
    const batchToInsert = accountsToInsert.slice(i, i + insertBatchSize)

    if (batchToInsert.length === 0) {
      continue
    }

    try {
      Logger.mainLogger.info(
        `Inserting batch ${Math.floor(i / insertBatchSize) + 1}/${Math.ceil(accountsToInsert.length / insertBatchSize)}: ${batchToInsert.length} accounts`
      )
      try {
        const result = await AccountDB.bulkInsertAccounts(batchToInsert)
        Logger.mainLogger.info(
          `Successfully inserted ${batchToInsert.length} accounts. Result: ${StringUtils.safeStringify(result)}`
        )
      } catch (err) {
        Logger.mainLogger.error(`Error in batch account insertion: ${err.message}`)

        // If bulk insert fails, try individual inserts
        let successCount = 0
        for (const account of batchToInsert) {
          try {
            await AccountDB.insertAccount(account)
            successCount++
          } catch (innerError) {
            Logger.mainLogger.error(`Failed to insert account ${account.accountId}: ${innerError.message}`)
          }
        }
        Logger.mainLogger.info(`Successfully inserted ${successCount}/${batchToInsert.length} accounts individually`)
      }
    } catch (error) {
      Logger.mainLogger.error(`Error processing account batch: ${error.message}`)
    }

    await Utils.sleep(healerConfig.timeouts.sleepBetweenBatchesMs)
  }

  Logger.mainLogger.info(`Completed healing of accounts: inserted ${accountsToInsert.length} accounts`)
}

// Heal missing transactions using the missing data report
async function healMissingTransactions(missingTransactions: MissingTransaction[]): Promise<void> {
  if (missingTransactions.length === 0) {
    Logger.mainLogger.info('No transactions to heal')
    return
  }

  Logger.mainLogger.info(`Healing ${missingTransactions.length} missing transactions...`)

  // Group by cycle to optimize requests
  const transactionsByCycle = new Map<number, MissingTransaction[]>()

  for (const tx of missingTransactions) {
    if (!transactionsByCycle.has(tx.cycle)) {
      transactionsByCycle.set(tx.cycle, [])
    }
    transactionsByCycle.get(tx.cycle)!.push(tx)
  }

  Logger.mainLogger.info(`Transactions span across ${transactionsByCycle.size} cycles`)

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process each cycle
  let processedCycles = 0
  for (const [cycle, transactions] of transactionsByCycle.entries()) {
    processedCycles++
    logProgress(processedCycles, transactionsByCycle.size, `Healing transactions for cycle`)

    // Get all local transaction IDs for this cycle to avoid duplicates
    const localTxIds = new Set<string>()
    try {
      const localCount = await TransactionDB.queryTransactionCountBetweenCycles(cycle, cycle)
      const batchSize = healerConfig.batchSizes.transactions

      for (let page = 0; page < Math.ceil(localCount / batchSize); page++) {
        const skip = page * batchSize
        const txs = await TransactionDB.queryTransactionsBetweenCycles(skip, batchSize, cycle, cycle)
        for (const tx of txs) {
          localTxIds.add(tx.txId)
        }
      }
      Logger.mainLogger.debug(`Found ${localTxIds.size} existing transactions for cycle ${cycle}`)
    } catch (error) {
      Logger.mainLogger.warn(`Error fetching local transactions for cycle ${cycle}: ${error.message}`)
      // Continue with an empty set if there was an error
    }

    // For large cycles, process in batches of IDs
    const batchSize = healerConfig.batchSizes.healing // Use configurable batch size for healing operations
    const txBatches: MissingTransaction[][] = []

    for (let i = 0; i < transactions.length; i += batchSize) {
      txBatches.push(transactions.slice(i, i + batchSize))
    }

    for (let i = 0; i < txBatches.length; i++) {
      const batch = txBatches[i]

      // Create tasks to fetch each transaction batch from each archiver
      const tasks = archivers.map((archiver) => {
        return async () => {
          const txs = []

          // Request transactions in smaller batches of IDs at a time
          for (let j = 0; j < batch.length; j += healerConfig.batchSizes.subBatchSize) {
            const batchIds = batch.slice(j, j + healerConfig.batchSizes.subBatchSize)

            // Use a loop to fetch each transaction individually
            for (const tx of batchIds) {
              try {
                const response = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, {
                  txId: tx.id,
                })

                if (response && response.transactions) {
                  if (Array.isArray(response.transactions)) {
                    txs.push(...response.transactions)
                  } else {
                    txs.push(response.transactions)
                  }
                }
              } catch (error) {
                Logger.mainLogger.debug(
                  `Error fetching transaction ${tx.id} from ${archiver.ip}:${archiver.port}: ${error.message}`
                )
              }
            }

            // Add a small delay between batches to prevent overwhelming the network
            if (j + healerConfig.batchSizes.subBatchSize < batch.length) {
              await Utils.sleep(healerConfig.timeouts.sleepBetweenSubBatchesMs)
            }
          }

          return txs
        }
      })

      const results = await processBatchesInParallel(tasks)
      const allTransactions = results.flat()

      if (allTransactions.length === 0) {
        Logger.mainLogger.warn(`No transaction data found for batch ${i + 1}/${txBatches.length} in cycle ${cycle}`)
        continue
      }

      // Group transactions by ID
      const transactionsByIdMap = new Map<string, any[]>()
      for (const tx of allTransactions) {
        if (!tx.txId) continue

        // Skip if we already have this transaction locally
        if (localTxIds.has(tx.txId)) continue

        if (!transactionsByIdMap.has(tx.txId)) {
          transactionsByIdMap.set(tx.txId, [])
        }
        transactionsByIdMap.get(tx.txId)!.push(tx)
      }

      // Process transactions using the majority hash from missing data
      const transactionsToInsert = []

      for (const missing of batch) {
        const transactions = transactionsByIdMap.get(missing.id) || []

        if (transactions.length === 0) {
          Logger.mainLogger.warn(`No data found for transaction ${missing.id}`)
          continue
        }

        if (missing.majorityHash) {
          // Use the majority hash from the report
          const matchingTx = transactions.find(
            (tx) => (tx.hash || StringUtils.safeStringify(tx)) === missing.majorityHash
          )

          if (matchingTx) {
            // Don't reformat the transaction, use it as is
            transactionsToInsert.push(matchingTx)
            Logger.mainLogger.debug(
              `Using exact hash match for transaction ${missing.id}. Data: ${StringUtils.safeStringify(matchingTx).substring(0, 200)}...`
            )
          } else {
            // If we can't find the exact hash match, use majority determination again
            const majorityTx = await getMajorityItem(transactions, (tx) => tx.hash || StringUtils.safeStringify(tx))
            if (majorityTx) {
              // Don't reformat the transaction, use it as is
              transactionsToInsert.push(majorityTx)
              Logger.mainLogger.debug(
                `Using majority transaction for ${missing.id}. Data: ${StringUtils.safeStringify(majorityTx).substring(0, 200)}...`
              )
            }
          }
        } else {
          // No majority hash in the report, determine it now
          const majorityTx = await getMajorityItem(transactions, (tx) => tx.hash || StringUtils.safeStringify(tx))
          if (majorityTx) {
            // Don't reformat the transaction, use it as is
            transactionsToInsert.push(majorityTx)
            Logger.mainLogger.debug(
              `Using majority transaction for ${missing.id}. Data: ${StringUtils.safeStringify(majorityTx).substring(0, 200)}...`
            )
          }
        }
      }

      // Bulk insert transactions
      if (transactionsToInsert.length > 0) {
        try {
          Logger.mainLogger.info(`Attempting to insert ${transactionsToInsert.length} transactions for cycle ${cycle}`)
          Logger.mainLogger.debug(
            `First transaction sample: ${StringUtils.safeStringify(transactionsToInsert[0]).substring(0, 200)}...`
          )
          try {
            const result = await TransactionDB.bulkInsertTransactions(transactionsToInsert)
            Logger.mainLogger.info(
              `Successfully inserted ${transactionsToInsert.length} transactions for cycle ${cycle}. Result: ${StringUtils.safeStringify(result)}`
            )
          } catch (err) {
            Logger.mainLogger.error(`Error in transaction insertion: ${err.message}`)
            Logger.mainLogger.error(`Error stack: ${err.stack}`)
            throw err // Re-throw to be caught by the outer catch
          }
        } catch (error) {
          Logger.mainLogger.error(`Error bulk inserting transactions: ${error.message}`)

          // If bulk insert fails, try individual inserts
          let successCount = 0
          for (const tx of transactionsToInsert) {
            try {
              await TransactionDB.insertTransaction(tx)
              successCount++
            } catch (innerError) {
              Logger.mainLogger.error(`Failed to insert transaction ${tx.txId}: ${innerError.message}`)
            }
          }
          Logger.mainLogger.info(
            `Successfully inserted ${successCount}/${transactionsToInsert.length} transactions individually`
          )
        }
      }

      await Utils.sleep(SLEEP_BETWEEN_BATCHES_MS)
    }
  }

  Logger.mainLogger.info(`Completed healing of transactions`)
}

// New function to verify data without analysis or healing
async function verifyDataOnly(): Promise<void> {
  try {
    Logger.mainLogger.info('Starting data verification...')

    // Get maximum counts from all archivers
    const maxCounts = await getMaxCounts()

    // Get our local counts
    const localCycleCount = await CycleDB.queryCyleCount()
    const localReceiptCount = await ReceiptDB.queryReceiptCount()
    const localAccountCount = await AccountDB.queryAccountCount()
    const localTransactionCount = await TransactionDB.queryTransactionCount()

    // Calculate differences and percentages
    const cycleDiff = maxCounts[DataType.CYCLE] - localCycleCount
    const receiptDiff = maxCounts[DataType.RECEIPT] - localReceiptCount
    const accountDiff = maxCounts[DataType.ACCOUNT] - localAccountCount
    const transactionDiff = maxCounts[DataType.TRANSACTION] - localTransactionCount

    const cyclePercentage = maxCounts[DataType.CYCLE] > 0 ? (localCycleCount / maxCounts[DataType.CYCLE]) * 100 : 100
    const receiptPercentage =
      maxCounts[DataType.RECEIPT] > 0 ? (localReceiptCount / maxCounts[DataType.RECEIPT]) * 100 : 100
    const accountPercentage =
      maxCounts[DataType.ACCOUNT] > 0 ? (localAccountCount / maxCounts[DataType.ACCOUNT]) * 100 : 100
    const transactionPercentage =
      maxCounts[DataType.TRANSACTION] > 0 ? (localTransactionCount / maxCounts[DataType.TRANSACTION]) * 100 : 100

    // Create detailed report
    Logger.mainLogger.info('===== DATA VERIFICATION REPORT =====')
    Logger.mainLogger.info(`Cycles: ${localCycleCount}/${maxCounts[DataType.CYCLE]} (${cyclePercentage.toFixed(2)}%)`)
    Logger.mainLogger.info(`- Missing: ${cycleDiff > 0 ? cycleDiff : 0} cycles`)
    Logger.mainLogger.info(`- Status: ${cycleDiff <= 0 ? 'COMPLETE' : 'INCOMPLETE'}`)

    Logger.mainLogger.info(
      `Receipts: ${localReceiptCount}/${maxCounts[DataType.RECEIPT]} (${receiptPercentage.toFixed(2)}%)`
    )
    Logger.mainLogger.info(`- Missing: ${receiptDiff > 0 ? receiptDiff : 0} receipts`)
    Logger.mainLogger.info(`- Status: ${receiptDiff <= 0 ? 'COMPLETE' : 'INCOMPLETE'}`)

    Logger.mainLogger.info(
      `Accounts: ${localAccountCount}/${maxCounts[DataType.ACCOUNT]} (${accountPercentage.toFixed(2)}%)`
    )
    Logger.mainLogger.info(`- Missing: ${accountDiff > 0 ? accountDiff : 0} accounts`)
    Logger.mainLogger.info(`- Status: ${accountDiff <= 0 ? 'COMPLETE' : 'INCOMPLETE'}`)

    Logger.mainLogger.info(
      `Transactions: ${localTransactionCount}/${maxCounts[DataType.TRANSACTION]} (${transactionPercentage.toFixed(2)}%)`
    )
    Logger.mainLogger.info(`- Missing: ${transactionDiff > 0 ? transactionDiff : 0} transactions`)
    Logger.mainLogger.info(`- Status: ${transactionDiff <= 0 ? 'COMPLETE' : 'INCOMPLETE'}`)

    // Overall status
    const isComplete = cycleDiff <= 0 && receiptDiff <= 0 && accountDiff <= 0 && transactionDiff <= 0
    Logger.mainLogger.info('===================================')
    Logger.mainLogger.info(`OVERALL STATUS: ${isComplete ? 'COMPLETE' : 'INCOMPLETE'}`)
    Logger.mainLogger.info('===================================')

    // Provide recommendation if data is incomplete
    if (!isComplete) {
      Logger.mainLogger.info('RECOMMENDATION:')
      Logger.mainLogger.info('Run the healer with --heal true to fix missing data.')
    }

    // Make sure logs are flushed by adding a small delay before exit
    await new Promise((resolve) => setTimeout(resolve, 100))
  } catch (error) {
    Logger.mainLogger.error(`Error during data verification: ${error.message}`)
    Logger.mainLogger.error(error.stack)
  }
}

// Apply healing to all missing data
async function healAllMissingData(missingData: MissingData): Promise<void> {
  Logger.mainLogger.info(`Starting to heal missing data...`)

  // Heal in a specific order - cycles first, then other data
  // Only heal data types that are enabled in healerConfig.healDataTypes
  if (healerConfig.healDataTypes.cycles) {
    Logger.mainLogger.info(`Healing cycles...`)
    if (missingData?.cycles?.length > 0) {
      try {
        await healMissingCycles(missingData.cycles)
        Logger.mainLogger.info(`Successfully healed cycles`)
      } catch (error) {
        Logger.mainLogger.error(`Error healing cycles: ${error.message}`)
        Logger.mainLogger.error(`Continuing with other data types despite cycle healing errors`)
      }
    } else {
      console.log(`No cycles to heal`)
    }
  } else {
    Logger.mainLogger.info(`Skipping cycles healing as per configuration`)
  }

  if (healerConfig.healDataTypes.receipts) {
    Logger.mainLogger.info(`Healing receipts...`)
    if (missingData?.receipts?.length > 0) {
      try {
        await healMissingReceipts(missingData.receipts)
        Logger.mainLogger.info(`Successfully healed receipts`)
      } catch (error) {
        Logger.mainLogger.error(`Error healing receipts: ${error.message}`)
        Logger.mainLogger.error(`Continuing with other data types despite receipt healing errors`)
      }
    } else {
      console.log(`No receipts to heal`)
    }
  } else {
    Logger.mainLogger.info(`Skipping receipts healing as per configuration`)
  }

  if (healerConfig.healDataTypes.accounts) {
    Logger.mainLogger.info(`Healing accounts...`)
    if (missingData?.accounts?.length > 0) {
      try {
        await healMissingAccounts(missingData.accounts)
        Logger.mainLogger.info(`Successfully healed accounts`)
      } catch (error) {
        Logger.mainLogger.error(`Error healing accounts: ${error.message}`)
        Logger.mainLogger.error(`Continuing with other data types despite account healing errors`)
      }
    } else {
      console.log(`No accounts to heal`)
    }
  } else {
    Logger.mainLogger.info(`Skipping accounts healing as per configuration`)
  }

  if (healerConfig.healDataTypes.transactions) {
    Logger.mainLogger.info(`Healing transactions...`)
    if (missingData?.transactions?.length > 0) {
      try {
        await healMissingTransactions(missingData.transactions)
        Logger.mainLogger.info(`Successfully healed transactions`)
      } catch (error) {
        Logger.mainLogger.error(`Error healing transactions: ${error.message}`)
        Logger.mainLogger.error(`Continuing despite transaction healing errors`)
      }
    } else {
      console.log(`No transactions to heal`)
    }
  } else {
    Logger.mainLogger.info(`Skipping transactions healing as per configuration`)
  }

  Logger.mainLogger.info(`Initial healing pass complete.`)
}

// Initialize database connection
async function initializeDB(): Promise<void> {
  try {
    // Check if database is already initialized by testing if cycleDatabase exists
    if (dbstore.cycleDatabase && dbstore.accountDatabase && dbstore.receiptDatabase && dbstore.transactionDatabase) {
      try {
        // Try a simple query to verify the connection is actually working
        await CycleDB.queryCyleCount()
        Logger.mainLogger.info('Database already initialized by running archiver instance')
        return
      } catch (queryError) {
        // If query fails, the database connection might be initialized but not working properly
        Logger.mainLogger.warn(`Database exists but query failed: ${queryError.message}`)
        // Will proceed to re-initialize
      }
    }

    Logger.mainLogger.info('Initializing database...')
    await dbstore.initializeDB(config)
    Logger.mainLogger.info('Database initialized successfully')
  } catch (error) {
    Logger.mainLogger.error(`Error initializing database: ${error.message}`)
    throw error
  }
}

// Helper: Fetch all cycle counters from local DB
async function getAllLocalCycleCounters(): Promise<Set<number>> {
  const batchSize = 1000
  let skip = 0
  let allCounters = new Set<number>()
  while (true) {
    const cycles = await CycleDB.queryCycleRecordsBetween(skip, skip + batchSize - 1)
    if (!cycles || cycles.length === 0) break
    for (const c of cycles) {
      if (typeof c.counter === 'number') allCounters.add(c.counter)
    }
    if (cycles.length < batchSize) break
    skip += batchSize
  }
  return allCounters
}

// Helper: Fetch all receipt IDs from local DB
async function getAllLocalReceiptIds(): Promise<Set<string>> {
  const batchSize = 1000
  let skip = 0
  let allIds = new Set<string>()
  while (true) {
    const receipts = await ReceiptDB.queryReceipts(skip, batchSize)
    if (!receipts || receipts.length === 0) break
    for (const r of receipts) {
      if (r.receiptId) allIds.add(r.receiptId)
    }
    if (receipts.length < batchSize) break
    skip += batchSize
  }
  return allIds
}

// Helper: Fetch all account IDs from local DB
async function getAllLocalAccountIds(): Promise<Set<string>> {
  const batchSize = 1000
  let skip = 0
  let allIds = new Set<string>()
  while (true) {
    const accounts = await AccountDB.queryAccounts(skip, batchSize)
    if (!accounts || accounts.length === 0) break
    for (const a of accounts) {
      if (a.accountId) allIds.add(a.accountId)
    }
    if (accounts.length < batchSize) break
    skip += batchSize
  }
  return allIds
}

// Helper: Fetch all txIds from local DB
async function getAllLocalTxIds(): Promise<Set<string>> {
  const batchSize = 1000
  let skip = 0
  let allIds = new Set<string>()
  while (true) {
    const txs = await TransactionDB.queryTransactions(skip, batchSize)
    if (!txs || txs.length === 0) break
    for (const t of txs) {
      if (t.txId) allIds.add(t.txId)
    }
    if (txs.length < batchSize) break
    skip += batchSize
  }
  return allIds
}

// Helper: Fetch all cycle counters from all archivers
async function getAllRemoteCycleCounters(): Promise<Map<number, number>> {
  // Map<counter, count of archivers that have it>
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers
  const batchSize = 100
  let maxCounter = 0
  // First, get max from all archivers
  const totalData = await getTotalDataFromArchivers()
  for (const t of totalData) {
    if (t.totalCycles > maxCounter) maxCounter = t.totalCycles
  }
  const counterMap = new Map<number, number>()
  for (let start = 0; start < maxCounter; start += batchSize) {
    const end = Math.min(start + batchSize - 1, maxCounter - 1)
    const tasks = archivers.map((archiver) => async () => {
      const resp = await fetchFromArchiver(archiver, RequestDataType.CYCLE, { start, end })
      return resp && resp.cycleInfo ? resp.cycleInfo.map((c) => c.counter) : []
    })
    const results = await processBatchesInParallel(tasks)
    for (const arr of results) {
      for (const counter of arr) {
        if (typeof counter === 'number') counterMap.set(counter, (counterMap.get(counter) || 0) + 1)
      }
    }
  }
  return counterMap
}

// Helper: Fetch all receipt IDs from all archivers
async function getAllRemoteReceiptIds(
  minCycle = 0,
  maxCycle?: number
): Promise<Map<string, { count: number; cycle: number }>> {
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers
  if (typeof maxCycle !== 'number') {
    const totalData = await getTotalDataFromArchivers()
    maxCycle = 0
    for (const t of totalData) {
      if (t.totalCycles > maxCycle) maxCycle = t.totalCycles
    }
  }
  const idMap = new Map<string, { count: number; cycle: number }>()
  const batchSize = healerConfig.batchSizes.receipts
  const CYCLE_BATCH_SIZE = 1
  let totalReceipts = 0
  for (let batchStart = minCycle; batchStart < maxCycle; batchStart += CYCLE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + CYCLE_BATCH_SIZE - 1, maxCycle - 1)
    let maxReceiptCount = 0
    for (const archiver of archivers) {
      const resp = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, {
        startCycle: batchStart,
        endCycle: batchEnd,
        type: 'count',
      })
      if (resp && typeof resp.receipts === 'number') {
        if (resp.receipts > maxReceiptCount) maxReceiptCount = resp.receipts
        totalReceipts += resp.receipts
      }
    }

    if (!maxReceiptCount || maxReceiptCount === 0) continue
    const totalPages = Math.ceil(maxReceiptCount / batchSize)
    for (let page = 1; page <= totalPages; page++) {
      const tasks = archivers.map((archiver) => async () => {
        const resp = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, {
          startCycle: batchStart,
          endCycle: batchEnd,
          page,
        })
        if (resp && resp.receipts && Array.isArray(resp.receipts)) {
          return resp.receipts.map((r) => ({ id: r.receiptId, cycle: r.cycle }))
        }
        return []
      })
      const results = await processBatchesInParallel(tasks)
      for (const arr of results) {
        for (const { id, cycle } of arr) {
          if (id) {
            if (!idMap.has(id)) idMap.set(id, { count: 1, cycle })
            else {
              const entry = idMap.get(id)!
              entry.count++
              if (typeof entry.cycle !== 'number' && typeof cycle === 'number') entry.cycle = cycle
            }
          }
        }
      }
    }
  }
  return idMap
}

// Helper: Fetch all account IDs from all archivers
async function getAllRemoteAccountIds(): Promise<
  [Map<string, { count: number; cycle?: number; cycleNumber?: number }>, Map<string, any[]>]
> {
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers
  let maxCycle = 0
  const totalData = await getTotalDataFromArchivers()
  for (const t of totalData) {
    if (t.totalCycles > maxCycle) maxCycle = t.totalCycles
  }
  const idMap = new Map<string, { count: number; cycle?: number; cycleNumber?: number }>()
  const accountDetailsMap = new Map<string, any[]>() // Store all account versions
  const batchSize = healerConfig.batchSizes.accounts
  const MAX_CYCLE_RANGE = 100
  for (let cycleStart = 0; cycleStart < maxCycle; cycleStart += MAX_CYCLE_RANGE) {
    const cycleEnd = Math.min(cycleStart + MAX_CYCLE_RANGE - 1, maxCycle - 1)
    let page = 1
    let hasMore = true
    while (hasMore) {
      const tasks = archivers.map((archiver) => async () => {
        const resp = await fetchFromArchiver(archiver, RequestDataType.ACCOUNT, {
          page,
          startCycle: cycleStart,
          endCycle: cycleEnd,
        })
        if (resp && resp.accounts) {
          if (Array.isArray(resp.accounts)) {
            // Store all account details
            for (const account of resp.accounts) {
              if (account.accountId) {
                if (!accountDetailsMap.has(account.accountId)) {
                  accountDetailsMap.set(account.accountId, [])
                }
                accountDetailsMap.get(account.accountId)!.push(account)
              }
            }
            // Return both ID and cycle if available
            return resp.accounts.map((a) => ({ id: a.accountId, cycle: a.cycle, cycleNumber: a.cycleNumber }))
          } else if (resp.accounts.accountId) {
            // Store account details
            if (!accountDetailsMap.has(resp.accounts.accountId)) {
              accountDetailsMap.set(resp.accounts.accountId, [])
            }
            accountDetailsMap.get(resp.accounts.accountId)!.push(resp.accounts)

            return [{ id: resp.accounts.accountId, cycle: resp.accounts.cycle, cycleNumber: resp.accounts.cycleNumber }]
          }
        }
        return []
      })
      const results = await processBatchesInParallel(tasks)
      let foundAny = false
      for (const arr of results) {
        for (const item of arr) {
          if (item.id) {
            if (!idMap.has(item.id)) {
              idMap.set(item.id, { count: 1, cycle: item.cycle, cycleNumber: item.cycleNumber })
            } else {
              const entry = idMap.get(item.id)!
              entry.count++
              // If we don't have a cycle yet but this result does, use it
              if (typeof entry.cycle !== 'number' && typeof item.cycle === 'number') {
                entry.cycle = item.cycle
              }
              // If we don't have a cycleNumber yet but this result does, use it
              if (typeof entry.cycleNumber !== 'number' && typeof item.cycleNumber === 'number') {
                entry.cycleNumber = item.cycleNumber
              }
            }
            foundAny = true
          }
        }
      }
      if (!foundAny) hasMore = false
      else page++
    }
  }
  return [idMap, accountDetailsMap]
}

// Helper: Fetch all txIds from all archivers
async function getAllRemoteTxIds(
  minCycle = 0,
  maxCycle?: number
): Promise<Map<string, { count: number; cycle: number; cycleNumber?: number }>> {
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers
  if (typeof maxCycle !== 'number') {
    const totalData = await getTotalDataFromArchivers()
    maxCycle = 0
    for (const t of totalData) {
      if (t.totalCycles > maxCycle) maxCycle = t.totalCycles
    }
  }
  const idMap = new Map<string, { count: number; cycle: number; cycleNumber?: number }>()
  const batchSize = healerConfig.batchSizes.transactions
  const CYCLE_BATCH_SIZE = 100
  for (let batchStart = minCycle; batchStart < maxCycle; batchStart += CYCLE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + CYCLE_BATCH_SIZE - 1, maxCycle - 1)
    let maxTxCount = 0
    for (const archiver of archivers) {
      const resp = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, {
        startCycle: batchStart,
        endCycle: batchEnd,
        type: 'count',
      })
      if (resp && typeof resp.totalTransactions === 'number') {
        if (resp.totalTransactions > maxTxCount) maxTxCount = resp.totalTransactions
      }
    }
    if (!maxTxCount || maxTxCount === 0) continue
    const totalPages = Math.ceil(maxTxCount / batchSize)
    for (let page = 1; page <= totalPages; page++) {
      const tasks = archivers.map((archiver) => async () => {
        const resp = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, {
          startCycle: batchStart,
          endCycle: batchEnd,
          page,
        })
        if (resp && resp.transactions) {
          if (Array.isArray(resp.transactions))
            return resp.transactions.map((t) => ({ id: t.txId, cycle: t.cycle, cycleNumber: t.cycleNumber }))
          else if (resp.transactions.txId)
            return [
              {
                id: resp.transactions.txId,
                cycle: resp.transactions.cycle,
                cycleNumber: resp.transactions.cycleNumber,
              },
            ]
        }
        return []
      })
      const results = await processBatchesInParallel(tasks)
      for (const arr of results) {
        for (const { id, cycle, cycleNumber } of arr) {
          if (id) {
            if (!idMap.has(id)) idMap.set(id, { count: 1, cycle, cycleNumber })
            else {
              const entry = idMap.get(id)!
              entry.count++
              if (typeof entry.cycle !== 'number' && typeof cycle === 'number') entry.cycle = cycle
              if (typeof entry.cycleNumber !== 'number' && typeof cycleNumber === 'number')
                entry.cycleNumber = cycleNumber
            }
          }
        }
      }
    }
  }
  return idMap
}

async function main() {
  console.log('Starting archiver healing script')
  try {
    // Parse command line arguments
    const heal = process.argv.includes('--heal') && process.argv.indexOf('--heal') < process.argv.indexOf('true')

    // Verify-only flag
    const verifyOnlyArgIndex = process.argv.indexOf('--verify-only')
    const verifyOnlyArg =
      verifyOnlyArgIndex !== -1 && verifyOnlyArgIndex < process.argv.length - 1
        ? process.argv[verifyOnlyArgIndex + 1]
        : 'false'
    const verifyOnly = verifyOnlyArg.toLowerCase() === 'true'

    // Logger flag - default is true (use logger file), set to false to use console
    const useLoggerArgIndex = process.argv.indexOf('--use-logger')
    const useLoggerArg =
      useLoggerArgIndex !== -1 && useLoggerArgIndex < process.argv.length - 1
        ? process.argv[useLoggerArgIndex + 1]
        : 'true'
    const useLogger = useLoggerArg.toLowerCase() !== 'false'

    // Majority check flag - default is true (use majority check), set to false to disable
    const disableMajorityArgIndex = process.argv.indexOf('--disable-majority-check')
    const disableMajorityArg =
      disableMajorityArgIndex !== -1 && disableMajorityArgIndex < process.argv.length - 1
        ? process.argv[disableMajorityArgIndex + 1]
        : 'false'
    const disableMajority = disableMajorityArg.toLowerCase() === 'true'

    // Data type healing flags
    const healCyclesArgIndex = process.argv.indexOf('--heal-cycles')
    const healCyclesArg =
      healCyclesArgIndex !== -1 && healCyclesArgIndex < process.argv.length - 1
        ? process.argv[healCyclesArgIndex + 1]
        : 'true'
    const healCycles = healCyclesArg.toLowerCase() !== 'false'

    const healReceiptsArgIndex = process.argv.indexOf('--heal-receipts')
    const healReceiptsArg =
      healReceiptsArgIndex !== -1 && healReceiptsArgIndex < process.argv.length - 1
        ? process.argv[healReceiptsArgIndex + 1]
        : 'true'
    const healReceipts = healReceiptsArg.toLowerCase() !== 'false'

    const healAccountsArgIndex = process.argv.indexOf('--heal-accounts')
    const healAccountsArg =
      healAccountsArgIndex !== -1 && healAccountsArgIndex < process.argv.length - 1
        ? process.argv[healAccountsArgIndex + 1]
        : 'true'
    const healAccounts = healAccountsArg.toLowerCase() !== 'false'

    const healTransactionsArgIndex = process.argv.indexOf('--heal-transactions')
    const healTransactionsArg =
      healTransactionsArgIndex !== -1 && healTransactionsArgIndex < process.argv.length - 1
        ? process.argv[healTransactionsArgIndex + 1]
        : 'true'
    const healTransactions = healTransactionsArg.toLowerCase() !== 'false'

    // Update the global flags with the command line arguments
    useLoggerFile = useLogger
    healerConfig.disableMajorityCheck = disableMajority
    healerConfig.verifyOnly = verifyOnly
    healerConfig.healDataTypes = {
      cycles: healCycles,
      receipts: healReceipts,
      accounts: healAccounts,
      transactions: healTransactions,
    }

    const inputIndex = process.argv.indexOf('--input')
    const inputFile = inputIndex !== -1 && inputIndex < process.argv.length - 1 ? process.argv[inputIndex + 1] : null

    // Initialize logger based on the useLoggerFile flag
    if (useLoggerFile) {
      const logDir = `${config.ARCHIVER_LOGS}/healArchiver`
      const baseDir = '.'
      logsConfig.dir = logDir
      Logger.initLogger(baseDir, logsConfig)
      if (logsConfig.saveConsoleOutput) {
        startSaving(join(baseDir, logsConfig.dir))
      }
    } else {
      // For console output, just create a minimal logger setup
      // but redirect its output methods to console
      const minimalConfig = { ...logsConfig }
      minimalConfig.dir = './logs'
      minimalConfig.saveConsoleOutput = false

      // Initialize with minimal config
      Logger.initLogger('.', minimalConfig)

      // Override logger methods to use console directly
      Logger.mainLogger.debug = console.debug.bind(console)
      Logger.mainLogger.info = console.info.bind(console)
      Logger.mainLogger.warn = console.warn.bind(console)
      Logger.mainLogger.error = console.error.bind(console)
    }

    Logger.mainLogger.info(`Starting archiver healing script`)
    Logger.mainLogger.info(`- Heal mode: ${heal ? 'ENABLED' : 'DISABLED'}`)
    Logger.mainLogger.info(`- Verify-only mode: ${verifyOnly ? 'ENABLED' : 'DISABLED'}`)
    Logger.mainLogger.info(`- Logger mode: ${useLogger ? 'FILE' : 'CONSOLE'}`)
    Logger.mainLogger.info(`- Majority check: ${disableMajority ? 'DISABLED' : 'ENABLED'}`)
    Logger.mainLogger.info(`- Input file: ${inputFile || 'none (using default or analyzing)'}`)
    Logger.mainLogger.info(`- Using ${useCustomArchivers ? 'custom' : 'State'} archivers`)
    Logger.mainLogger.info(`- Data types to heal:`)
    Logger.mainLogger.info(`  - Cycles: ${healerConfig.healDataTypes.cycles ? 'YES' : 'NO'}`)
    Logger.mainLogger.info(`  - Receipts: ${healerConfig.healDataTypes.receipts ? 'YES' : 'NO'}`)
    Logger.mainLogger.info(`  - Accounts: ${healerConfig.healDataTypes.accounts ? 'YES' : 'NO'}`)
    Logger.mainLogger.info(`  - Transactions: ${healerConfig.healDataTypes.transactions ? 'YES' : 'NO'}`)

    try {
      // Initialize database before any database operations
      Logger.mainLogger.info('Initializing database connection...')
      await initializeDB()

      // Verify database connection by querying counts
      try {
        const cycleCount = await CycleDB.queryCyleCount()
        const receiptCount = await ReceiptDB.queryReceiptCount()
        const accountCount = await AccountDB.queryAccountCount()
        const txCount = await TransactionDB.queryTransactionCount()

        Logger.mainLogger.info('Database connection verified with current counts:')
        Logger.mainLogger.info(`- Cycles: ${cycleCount}`)
        Logger.mainLogger.info(`- Receipts: ${receiptCount}`)
        Logger.mainLogger.info(`- Accounts: ${accountCount}`)
        Logger.mainLogger.info(`- Transactions: ${txCount}`)
      } catch (countError) {
        Logger.mainLogger.warn(`Error querying database counts: ${countError.message}`)
        // Continue anyway since the database is initialized
      }
    } catch (dbError) {
      Logger.mainLogger.error(`Failed to initialize database. Cannot proceed: ${dbError.message}`)
      return
    }

    // Initialize state if we're not using custom archivers
    if (!useCustomArchivers) {
      try {
        Logger.mainLogger.info('Initializing State for archiver peer discovery...')
        await State.initFromConfig(require('./Config').config)
        Logger.mainLogger.info('State initialized successfully')
      } catch (stateError) {
        Logger.mainLogger.error(`Failed to initialize State: ${stateError.message}`)
        return
      }

      if (State.otherArchivers.length === 0) {
        Logger.mainLogger.error('No other archivers found in State. Cannot heal without peer archivers.')
        return
      }

      Logger.mainLogger.info(`Found ${State.otherArchivers.length} peer archivers from State`)
    } else {
      Logger.mainLogger.info(`Using ${customArchiversConfig.length} custom archivers`)

      if (customArchiversConfig.length === 0) {
        Logger.mainLogger.error('No custom archivers defined. Cannot heal without peer archivers.')
        return
      }
    }

    // If verify-only mode is enabled, just verify the data and exit
    if (verifyOnly) {
      Logger.mainLogger.info('Running in verify-only mode...')
      try {
        await verifyDataOnly()
        // Add slight delay to ensure logs are flushed before exit
        await Utils.sleep(500)
        Logger.mainLogger.info('Verification complete. Exiting.')
        console.log('Verification complete. Check the logs for details.')
        process.exit(0)
      } catch (error) {
        Logger.mainLogger.error(`Error in verification mode: ${error.message}`)
        process.exit(1)
      }
    }

    let missingData: MissingData

    // Determine the source of missing data information
    if (inputFile) {
      try {
        const data = fs.readFileSync(inputFile, 'utf8')
        missingData = JSON.parse(data) as MissingData
        Logger.mainLogger.info(`Loaded missing data from ${inputFile}`)
      } catch (error) {
        Logger.mainLogger.error(`Failed to load input file: ${error.message}`)
        return
      }
    } else if (heal && fs.existsSync(MISSING_DATA_FILE)) {
      try {
        const data = fs.readFileSync(MISSING_DATA_FILE, 'utf8')
        missingData = JSON.parse(data) as MissingData
        Logger.mainLogger.info(`Loaded missing data from ${MISSING_DATA_FILE}`)
      } catch (error) {
        Logger.mainLogger.error(`Failed to load missing data file: ${error.message}`)

        if (heal) {
          Logger.mainLogger.error(`Can't proceed with healing without missing data information.`)
          Logger.mainLogger.error(`Run without --heal true first to generate the missing data file.`)
          return
        }
      }
    }

    // If no missing data is loaded yet or not in heal mode, find the missing data
    if (!missingData || !heal) {
      Logger.mainLogger.info('Finding and analyzing missing data...')
      const minCycleArgIndex = process.argv.indexOf('--min-cycle')
      const maxCycleArgIndex = process.argv.indexOf('--max-cycle')
      const offsetArgIndex = process.argv.indexOf('--offset')
      let minCycleToUse: number | undefined = undefined
      let maxCycleToUse: number | undefined = undefined
      let offset = 0
      if (minCycleArgIndex !== -1 && minCycleArgIndex < process.argv.length - 1) {
        minCycleToUse = parseInt(process.argv[minCycleArgIndex + 1], 10)
      }
      if (maxCycleArgIndex !== -1 && maxCycleArgIndex < process.argv.length - 1) {
        maxCycleToUse = parseInt(process.argv[maxCycleArgIndex + 1], 10)
      }
      if (offsetArgIndex !== -1 && offsetArgIndex < process.argv.length - 1) {
        offset = parseInt(process.argv[offsetArgIndex + 1], 10)
      }
      // If not provided, get maxCycle from archivers and subtract offset
      if (typeof maxCycleToUse !== 'number') {
        const totalData = await getTotalDataFromArchivers()
        let maxCycleFromArchivers = 0
        for (const t of totalData) {
          if (t.totalCycles > maxCycleFromArchivers) maxCycleFromArchivers = t.totalCycles
        }
        maxCycleToUse = maxCycleFromArchivers - offset
      } else {
        maxCycleToUse -= offset
      }

      if (typeof minCycleToUse !== 'number') minCycleToUse = 0

      console.log('minCycleToUse: ', minCycleToUse)
      console.log('maxCycleToUse: ', maxCycleToUse)
      console.log('offset: ', offset)

      missingData = await findMissingData(minCycleToUse, maxCycleToUse)

      // Save the missing data to a file
      saveMissingDataToJson(missingData)

      if (!heal) {
        Logger.mainLogger.info(`Missing data analysis complete. See ${MISSING_DATA_FILE} for details.`)
        Logger.mainLogger.info(`Run with --heal true to apply the healing process.`)

        // Log endpoint stats summary at the end
        logEndpointStatsSummary()
        // Exit the process with success code
        process.exit(0)
      }
    }

    // Apply healing if requested
    if (heal) {
      Logger.mainLogger.info('Starting healing process based on missing data report...')

      // First healing pass - use missing data report
      try {
        Logger.mainLogger.info(
          `Starting healing with ${missingData.cycles?.length || 0} cycles, ${missingData.receipts?.length || 0} receipts, ${missingData.accounts?.length || 0} accounts, and ${missingData.transactions?.length || 0} transactions`
        )
        await healAllMissingData(missingData)
        Logger.mainLogger.info('Initial healing pass completed successfully')
      } catch (error) {
        Logger.mainLogger.error(`Error during healing process: ${error.message}`)
        Logger.mainLogger.error(`Continuing with verification despite healing errors`)
      }

      // Verify after healing to ensure all data was properly imported
      const isVerified = false //= await verifyDataIntegrity()   -> Commenting this out since maxCount doesn't necessarily tell us about missing data

      if (!isVerified) {
        Logger.mainLogger.warn('Some data is still missing after the initial healing pass.')
        Logger.mainLogger.info('Performing second analysis pass to find remaining missing data...')

        // Get the min and max cycle from the user cli
        const minCycleArgIndex = process.argv.indexOf('--min-cycle')
        const maxCycleArgIndex = process.argv.indexOf('--max-cycle')
        const offsetArgIndex = process.argv.indexOf('--offset')
        let minCycleToUse: number | undefined = undefined
        let maxCycleToUse: number | undefined = undefined
        let offset = 0
        if (minCycleArgIndex !== -1 && minCycleArgIndex < process.argv.length - 1) {
          minCycleToUse = parseInt(process.argv[minCycleArgIndex + 1], 10)
        }
        if (maxCycleArgIndex !== -1 && maxCycleArgIndex < process.argv.length - 1) {
          maxCycleToUse = parseInt(process.argv[maxCycleArgIndex + 1], 10)
        }
        if (offsetArgIndex !== -1 && offsetArgIndex < process.argv.length - 1) {
          offset = parseInt(process.argv[offsetArgIndex + 1], 10)
        }
        if (typeof minCycleToUse !== 'number') minCycleToUse = 0
        if (typeof maxCycleToUse !== 'number') {
          const totalData = await getTotalDataFromArchivers()
          let maxCycleFromArchivers = 0
          for (const t of totalData) {
            if (t.totalCycles > maxCycleFromArchivers) maxCycleFromArchivers = t.totalCycles
          }
          maxCycleToUse = maxCycleFromArchivers - offset
        } else {
          maxCycleToUse -= offset
        }

        console.log('minCycleToUse: ', minCycleToUse)
        console.log('maxCycleToUse: ', maxCycleToUse)
        console.log('offset: ', offset)
        // Find the still-missing data
        const remainingMissingData = await findMissingData(minCycleToUse, maxCycleToUse)

        // Check if there is still data to heal for enabled data types
        const needsMoreHealing =
          (healerConfig.healDataTypes.cycles && remainingMissingData.cycles.length > 0) ||
          (healerConfig.healDataTypes.receipts && remainingMissingData.receipts.length > 0) ||
          (healerConfig.healDataTypes.accounts && remainingMissingData.accounts.length > 0) ||
          (healerConfig.healDataTypes.transactions && remainingMissingData.transactions.length > 0)

        if (needsMoreHealing) {
          Logger.mainLogger.info('Found additional missing data in second pass. Healing...')
          await healAllMissingData(remainingMissingData)
        }
      }

      // Final data sync for any edge cases
      Logger.mainLogger.info('Performing final data sync with other archivers...')

      // Get the latest cycle count after healing
      const updatedCycleCount = await CycleDB.queryCyleCount()
      const updatedReceiptCount = await ReceiptDB.queryReceiptCount()
      const updatedAccountCount = await AccountDB.queryAccountCount()
      const updatedTxCount = await TransactionDB.queryTransactionCount()

      Logger.mainLogger.info('Final data counts:')
      Logger.mainLogger.info(`- Cycles: ${updatedCycleCount}`)
      Logger.mainLogger.info(`- Receipts: ${updatedReceiptCount}`)
      Logger.mainLogger.info(`- Accounts: ${updatedAccountCount}`)
      Logger.mainLogger.info(`- Transactions: ${updatedTxCount}`)

      // Use Data.syncCyclesAndTxsData to do a complete sync of all data
      // Only sync data types that are enabled
      try {
        Logger.mainLogger.info('Starting final data sync using native archiver sync mechanism...')

        if (healerConfig.healDataTypes.cycles || healerConfig.healDataTypes.receipts) {
          // Sync cycles and receipts if either is enabled
          Logger.mainLogger.info('Syncing cycles and receipts...')
          const syncCycles = healerConfig.healDataTypes.cycles ? updatedCycleCount : 0
          const syncReceipts = healerConfig.healDataTypes.receipts ? updatedReceiptCount : 0
          await Data.syncCyclesAndTxsData(syncCycles, syncReceipts, 0)
        } else {
          Logger.mainLogger.info('Skipping cycles and receipts sync as per configuration')
        }

        Logger.mainLogger.info('Data sync complete using native archiver sync mechanism.')
      } catch (error) {
        Logger.mainLogger.error(`Error during final data sync: ${error.message}`)
      }

      // Use Data.syncCyclesAndTxsDataBetweenCycles for cycle-specific sync if needed
      try {
        // Get maximum cycle from other archivers to ensure full sync
        const maxCounts = await getMaxCounts()
        const maxCycleCount = maxCounts[DataType.CYCLE]

        if (healerConfig.healDataTypes.cycles && maxCycleCount > updatedCycleCount) {
          Logger.mainLogger.info(
            `Performing additional cycle-specific sync from ${updatedCycleCount} to ${maxCycleCount}`
          )
          await Data.syncCyclesAndTxsDataBetweenCycles(updatedCycleCount, maxCycleCount)
        }
      } catch (error) {
        Logger.mainLogger.error(`Error during cycle-specific sync: ${error.message}`)
      }

      Logger.mainLogger.info('Healing process complete.')

      // Get one final count after all sync operations
      const finalCycleCount = await CycleDB.queryCyleCount()
      const finalReceiptCount = await ReceiptDB.queryReceiptCount()
      const finalAccountCount = await AccountDB.queryAccountCount()
      const finalTxCount = await TransactionDB.queryTransactionCount()

      Logger.mainLogger.info('Final data counts after all sync operations:')
      Logger.mainLogger.info(`- Cycles: ${finalCycleCount}`)
      Logger.mainLogger.info(`- Receipts: ${finalReceiptCount}`)
      Logger.mainLogger.info(`- Accounts: ${finalAccountCount}`)
      Logger.mainLogger.info(`- Transactions: ${finalTxCount}`)

      // Log endpoint stats summary at the end
      logEndpointStatsSummary()
      // Exit the process with success code
      process.exit(0)
    }
  } catch (error) {
    console.log('error: ', error)
    Logger.mainLogger.error(`Error in healing process: ${error.message}`)
    Logger.mainLogger.error(error.stack)

    // Log endpoint stats summary at the end
    logEndpointStatsSummary()
    // Exit the process with error code
    process.exit(1)
  }
}

if (require.main === module) main()
