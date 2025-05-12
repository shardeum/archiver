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

const localIP = '127.0.0.1'
// You can define your own archivers here instead of using State archivers
const customArchiversConfig: CustomArchiverConfig[] = [
  // Example format:
  // { ip: '127.0.0.1', port: 8080, publicKey: 'archiver-public-key-1' },
  // { ip: '192.168.1.5', port: 8080, publicKey: 'archiver-public-key-2' },
  {
    ip: '127.0.0.1',
    port: 4000,
    publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3',
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

  // Flag to ignore count discrepancies
  ignoreCounts: false,

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
    transactions: 200, // Batch size for transaction operations
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
}

interface MissingReceipt {
  cycle: number
  id: string
  majorityHash?: string
}

interface MissingAccount {
  id: string
  majorityHash?: string
}

interface MissingTransaction {
  cycle: number
  id: string
  majorityHash?: string
}

interface MissingData {
  cycles: MissingCycle[]
  receipts: MissingReceipt[]
  accounts: MissingAccount[]
  transactions: MissingTransaction[]
  timestamp: number
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

// Helper function to fetch data from a specific archiver
async function fetchFromArchiver(
  archiver: CustomArchiverConfig | State.ArchiverNodeInfo,
  endpoint: string,
  data: any
): Promise<any> {
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
  }
}

// Get total data counts from all active archivers
async function getTotalDataFromArchivers(): Promise<TotalDataCounts[]> {
  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  console.log(`Using ${useCustomArchivers ? 'custom' : 'State'} archivers: `, archivers)

  const promises = archivers.map(async (archiver) => {
    try {
      console.log('Fetching total data from archiver: ', archiver, 'Endpoint: /totalData')

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

// Find missing cycles and analyze them without healing
async function findMissingCycles(start: number, end: number): Promise<MissingCycle[]> {
  Logger.mainLogger.info(`Analyzing cycles from ${start} to ${end}...`)

  // Get local cycles to identify gaps
  const localCycles = await CycleDB.queryCycleRecordsBetween(start, end)
  const localCycleIds = new Set(localCycles.map((c) => c.counter))

  // Create a list of all cycle IDs that should exist
  const allCycleIds = Array.from({ length: end - start + 1 }, (_, i) => start + i)

  // Find missing cycles
  const missingCycleIds = allCycleIds.filter((id) => !localCycleIds.has(id))

  if (missingCycleIds.length === 0) {
    Logger.mainLogger.info(`No missing cycles detected between ${start} and ${end}`)
    return []
  }

  Logger.mainLogger.info(`Found ${missingCycleIds.length} missing cycles. Analyzing...`)

  // Process in batches to avoid overwhelming the network
  const batches: number[][] = []
  for (let i = 0; i < missingCycleIds.length; i += BATCH_SIZE) {
    batches.push(missingCycleIds.slice(i, i + BATCH_SIZE))
  }

  let processedBatches = 0
  const missingCycles: MissingCycle[] = []

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  for (const batch of batches) {
    processedBatches++
    logProgress(processedBatches, batches.length, `Analyzing cycle batch`)

    // For each batch, create tasks to fetch from different archivers
    const tasks = archivers.map((archiver) => {
      return async () => {
        const batchStart = Math.min(...batch)
        const batchEnd = Math.max(...batch)

        const response = await fetchFromArchiver(archiver, RequestDataType.CYCLE, {
          start: batchStart,
          end: batchEnd,
        })

        return response && response.cycleInfo ? response.cycleInfo : []
      }
    })

    // Process archiver tasks in parallel
    const results = await processBatchesInParallel(tasks, Math.min(archivers.length, MAX_PARALLEL_REQUESTS))
    const allCycles = results.flat()

    if (allCycles.length === 0) {
      Logger.mainLogger.warn(`No cycle data found for batch ${Math.min(...batch)} to ${Math.max(...batch)}`)

      // Still record these cycles as missing, even though we couldn't get data
      for (const cycleId of batch) {
        missingCycles.push({ counter: cycleId })
      }
      continue
    }

    // Group cycles by counter
    const cyclesByCounter = new Map<number, any[]>()
    for (const cycle of allCycles) {
      if (!cycle.counter && cycle.counter !== 0) continue

      if (!cyclesByCounter.has(cycle.counter)) {
        cyclesByCounter.set(cycle.counter, [])
      }
      cyclesByCounter.get(cycle.counter)!.push(cycle)
    }

    // Analyze each missing cycle
    for (const cycleId of batch) {
      const cycles = cyclesByCounter.get(cycleId) || []

      if (cycles.length > 1) {
        // Perform majority analysis
        const hashes = cycles.map((c) => c.hash || StringUtils.safeStringify(c))
        const majorityHash = await getMajorityItem(hashes, (h) => h)

        missingCycles.push({
          counter: cycleId,
          majorityHash: majorityHash || undefined,
        })

        Logger.mainLogger.debug(
          `Cycle ${cycleId}: ${cycles.length} versions found, majority hash: ${majorityHash || 'none'}`
        )
      } else if (cycles.length === 1) {
        // Only one version found
        missingCycles.push({
          counter: cycleId,
          majorityHash: cycles[0].hash || StringUtils.safeStringify(cycles[0]),
        })

        Logger.mainLogger.debug(`Cycle ${cycleId}: Only one version found`)
      } else {
        // No data found for this cycle
        missingCycles.push({ counter: cycleId })
        Logger.mainLogger.debug(`Cycle ${cycleId}: No data found`)
      }
    }

    await Utils.sleep(SLEEP_BETWEEN_BATCHES_MS)
  }

  Logger.mainLogger.info(
    `Completed analysis of cycles from ${start} to ${end}. Found ${missingCycles.length} missing cycles.`
  )
  return missingCycles
}

// Helper function to find majority hash
async function getMajorityHash(hashes: string[]): Promise<string | null> {
  // If majority check is disabled, return the first hash if available
  if (healerConfig.disableMajorityCheck && hashes.length > 0) {
    Logger.mainLogger.debug(`Majority check disabled, returning first available hash`)
    return hashes[0]
  }

  Logger.mainLogger.debug(`Finding majority hash among ${hashes.length} hashes`)

  const tally: Record<string, number> = {}
  for (const hash of hashes) {
    tally[hash] = (tally[hash] || 0) + 1
  }

  // Log the distribution of hashes
  Logger.mainLogger.debug(`Hash distribution:`)
  Object.entries(tally).forEach(([hash, count]) => {
    Logger.mainLogger.debug(`  Hash ${hash.substring(0, 16)}...: ${count} occurrences`)
  })

  let maxCount = 0
  let majorityHash: string | null = null

  for (const [hash, count] of Object.entries(tally)) {
    if (count > maxCount) {
      maxCount = count
      majorityHash = hash
    }
  }

  if (majorityHash) {
    Logger.mainLogger.debug(
      `Found majority hash ${majorityHash.substring(0, 16)}... (${maxCount}/${hashes.length} votes)`
    )
  } else {
    Logger.mainLogger.debug(`No majority hash found`)
  }

  return majorityHash
}

// Find missing receipts and analyze them without healing
async function findMissingReceipts(start: number, end: number): Promise<MissingReceipt[]> {
  Logger.mainLogger.info(`Analyzing receipts for cycles ${start} to ${end}...`)

  // Get counts of receipts for each cycle
  const localReceiptCounts = await ReceiptDB.queryReceiptCountByCycles(start, end)

  // Check if localReceiptCounts is undefined or empty
  const localReceiptMap = new Map(
    Array.isArray(localReceiptCounts) && localReceiptCounts.length > 0
      ? localReceiptCounts.map((r) => [r.cycle, r.receiptCount])
      : []
  )

  const missingReceipts: MissingReceipt[] = []

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process one cycle at a time to avoid overwhelming memory
  for (let cycle = start; cycle <= end; cycle++) {
    const localCount = localReceiptMap.get(cycle) || 0

    // Fetch receipt count from other archivers
    const tasks = archivers.map((archiver) => {
      return async () => {
        const response = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, {
          startCycle: cycle,
          endCycle: cycle,
          type: 'count',
        })

        return response && typeof response.receipts === 'number' ? response.receipts : 0
      }
    })

    const receiptCounts = await processBatchesInParallel(tasks)
    const maxReceiptCount = Math.max(0, ...receiptCounts)

    if (healerConfig.ignoreCounts === false && localCount >= maxReceiptCount) {
      // We have all receipts for this cycle
      continue
    }

    Logger.mainLogger.info(`Cycle ${cycle}: Local receipt count ${localCount}, max available ${maxReceiptCount}`)

    // Get all receipts for this cycle to analyze what's missing
    const batchSize = healerConfig.batchSizes.receipts // Use configurable batch size for receipts

    // First get local receipt IDs
    let localReceiptIds = new Set<string>()

    for (let page = 1; page <= Math.ceil(localCount / batchSize); page++) {
      const skip = (page - 1) * batchSize
      const localReceipts = await ReceiptDB.queryReceiptsBetweenCycles(skip, batchSize, cycle, cycle)
      localReceiptIds = new Set([...localReceiptIds, ...localReceipts.map((r) => r.receiptId)])
    }

    // Now get network receipts for this cycle
    for (let page = 1; page <= Math.ceil(maxReceiptCount / batchSize); page++) {
      const tasks = archivers.map((archiver) => {
        return async () => {
          const response = await fetchFromArchiver(archiver, RequestDataType.RECEIPT, {
            startCycle: cycle,
            endCycle: cycle,
            page: page,
          })

          return response && response.receipts ? response.receipts : []
        }
      })

      const results = await processBatchesInParallel(tasks)
      const allReceipts = results.flat()

      if (allReceipts.length === 0) {
        continue
      }

      // Group receipts by ID
      const receiptsByIdMap = new Map<string, any[]>()
      for (const receipt of allReceipts) {
        if (!receipt.receiptId) continue

        // Skip if we already have this receipt
        if (localReceiptIds.has(receipt.receiptId)) continue

        if (!receiptsByIdMap.has(receipt.receiptId)) {
          receiptsByIdMap.set(receipt.receiptId, [])
        }
        receiptsByIdMap.get(receipt.receiptId)!.push(receipt)
      }

      // Analyze each missing receipt
      for (const [receiptId, receipts] of receiptsByIdMap.entries()) {
        if (receipts.length > 1) {
          // Perform majority analysis
          const hashes = receipts.map((r) => r.hash || StringUtils.safeStringify(r))
          const majorityHash = await getMajorityItem(hashes, (h) => h)

          missingReceipts.push({
            cycle,
            id: receiptId,
            majorityHash: majorityHash || undefined,
          })

          Logger.mainLogger.debug(
            `Receipt ${receiptId} in cycle ${cycle}: ${receipts.length} versions found, majority hash: ${majorityHash || 'none'}`
          )
        } else if (receipts.length === 1) {
          // Only one version found
          missingReceipts.push({
            cycle,
            id: receiptId,
            majorityHash: receipts[0].hash || StringUtils.safeStringify(receipts[0]),
          })

          Logger.mainLogger.debug(`Receipt ${receiptId} in cycle ${cycle}: Only one version found`)
        }
      }

      await Utils.sleep(SLEEP_BETWEEN_BATCHES_MS)
    }
  }

  Logger.mainLogger.info(`Completed analysis of receipts. Found ${missingReceipts.length} missing receipts.`)
  return missingReceipts
}

// Find missing accounts and analyze them without healing
async function findMissingAccounts(): Promise<MissingAccount[]> {
  Logger.mainLogger.info(`Analyzing accounts...`)

  // Get local account count and IDs
  const localAccountCount = await AccountDB.queryAccountCount()

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Get the max cycle count to use for fetching accounts
  const maxCycleCount = await CycleDB.queryCyleCount()
  Logger.mainLogger.info(`Using max cycle count: ${maxCycleCount} for account fetching`)

  // Fetch total accounts from other archivers
  // We'll use the totalData endpoint first to get the total count
  const totalDataResults = await getTotalDataFromArchivers()
  const maxAccountCount = Math.max(0, ...totalDataResults.map((t) => t.totalAccounts))

  Logger.mainLogger.info(`Local account count: ${localAccountCount}, max available from totalData: ${maxAccountCount}`)

  // If we have no accounts or fewer accounts than the network, proceed with fetching
  if (maxAccountCount === 0) {
    Logger.mainLogger.info(`No accounts found on the network according to totalData endpoint`)
    return []
  }

  if (localAccountCount >= maxAccountCount) {
    Logger.mainLogger.info(`Local account count (${localAccountCount}) is up-to-date with network`)
    return []
  }

  // Get all local account IDs
  let localAccountIds = new Set<string>()
  const batchSize = healerConfig.batchSizes.accounts // Use configurable batch size for accounts

  for (let page = 0; page < Math.ceil(localAccountCount / batchSize); page++) {
    const skip = page * batchSize
    const accounts = await AccountDB.queryAccounts(skip, batchSize)
    localAccountIds = new Set([...localAccountIds, ...accounts.map((a) => a.accountId)])
  }

  Logger.mainLogger.info(`Retrieved ${localAccountIds.size} local account IDs`)

  const missingAccounts: MissingAccount[] = []

  // Now we'll try to fetch accounts directly using the account endpoint
  // We need to iterate through all cycles to get all accounts
  Logger.mainLogger.info(`Fetching accounts for cycles 0 to ${maxCycleCount - 1}`)

  // We'll use a different approach - fetch accounts for each cycle separately
  // This is more reliable than trying to fetch all accounts at once
  for (let cycleStart = 0; cycleStart < maxCycleCount; cycleStart += healerConfig.batchSizes.general) {
    const cycleEnd = Math.min(cycleStart + healerConfig.batchSizes.general - 1, maxCycleCount - 1)
    Logger.mainLogger.info(`Fetching accounts for cycle range ${cycleStart} to ${cycleEnd}`)

    // Break the cycle range into smaller chunks to avoid exceeding
    // the MAX_BETWEEN_CYCLES_PER_REQUEST limit (100 cycles)
    const MAX_CYCLE_RANGE = 100
    for (let chunkStart = cycleStart; chunkStart <= cycleEnd; chunkStart += MAX_CYCLE_RANGE) {
      const chunkEnd = Math.min(chunkStart + MAX_CYCLE_RANGE - 1, cycleEnd)
      Logger.mainLogger.info(`Processing cycle chunk ${chunkStart} to ${chunkEnd}`)

      // For each cycle range, fetch accounts in pages
      let page = 1
      let hasMoreAccounts = true

      while (hasMoreAccounts) {
        Logger.mainLogger.info(`Fetching accounts page ${page} for cycle range ${chunkStart}-${chunkEnd}`)

        const tasks = archivers.map((archiver) => {
          return async () => {
            try {
              // Use the correct pagination parameters for the account endpoint
              const response = await fetchFromArchiver(archiver, RequestDataType.ACCOUNT, {
                page: page,
                startCycle: chunkStart,
                endCycle: chunkEnd,
              })
              if (response && response.accounts && Array.isArray(response.accounts) && response.accounts.length > 0) {
                Logger.mainLogger.info(
                  `Got ${response.accounts.length} accounts from archiver ${archiver.ip}:${archiver.port}`
                )
                Logger.mainLogger.debug(
                  `First account sample: ${StringUtils.safeStringify(response.accounts[0]).substring(0, 200)}...`
                )
                return response.accounts
              } else if (response && response.accounts && !Array.isArray(response.accounts)) {
                Logger.mainLogger.info(`Got 1 account from archiver ${archiver.ip}:${archiver.port}`)
                Logger.mainLogger.debug(
                  `Account data: ${StringUtils.safeStringify(response.accounts).substring(0, 200)}...`
                )
                return [response.accounts]
              } else {
                Logger.mainLogger.debug(`No accounts returned from archiver ${archiver.ip}:${archiver.port}`)
                return []
              }
            } catch (error) {
              Logger.mainLogger.error(`Error fetching accounts from ${archiver.ip}:${archiver.port}: ${error.message}`)
              return []
            }
          }
        })

        const results = await processBatchesInParallel(tasks)
        const allAccounts = results.flat()

        if (allAccounts.length === 0) {
          Logger.mainLogger.info(`No more accounts found for cycle range ${chunkStart}-${chunkEnd}, page ${page}`)
          hasMoreAccounts = false
          continue
        }

        Logger.mainLogger.info(
          `Found ${allAccounts.length} accounts for cycle range ${chunkStart}-${chunkEnd}, page ${page}`
        )

        // Group accounts by ID
        const accountsByIdMap = new Map<string, any[]>()
        for (const account of allAccounts) {
          if (!account.accountId) continue

          // Skip if we already have this account
          if (localAccountIds.has(account.accountId)) continue

          if (!accountsByIdMap.has(account.accountId)) {
            accountsByIdMap.set(account.accountId, [])
          }
          accountsByIdMap.get(account.accountId)!.push(account)
        }

        // Analyze each missing account
        for (const [accountId, accounts] of accountsByIdMap.entries()) {
          if (accounts.length > 1) {
            // Perform majority analysis
            const hashes = accounts.map((a) => a.hash || StringUtils.safeStringify(a))
            const majorityHash = await getMajorityHash(hashes)

            missingAccounts.push({
              id: accountId,
              majorityHash: majorityHash || undefined,
            })

            Logger.mainLogger.debug(
              `Account ${accountId}: ${accounts.length} versions found, majority hash: ${majorityHash || 'none'}`
            )
          } else if (accounts.length === 1) {
            // Only one version found
            missingAccounts.push({
              id: accountId,
              majorityHash: accounts[0].hash || StringUtils.safeStringify(accounts[0]),
            })

            Logger.mainLogger.debug(`Account ${accountId}: Only one version found`)
          }
        }

        // If we got fewer accounts than the batch size, we're done with this cycle range
        if (allAccounts.length < batchSize) {
          hasMoreAccounts = false
        } else {
          page++
        }

        await Utils.sleep(healerConfig.timeouts.sleepBetweenBatchesMs)
      }
    }
  }

  Logger.mainLogger.info(`Completed analysis of accounts. Found ${missingAccounts.length} missing accounts.`)
  return missingAccounts
}

// Find missing transactions and analyze them without healing
async function findMissingTransactions(start: number, end: number): Promise<MissingTransaction[]> {
  Logger.mainLogger.info(`Analyzing transactions for cycles ${start} to ${end}...`)

  const missingTransactions: MissingTransaction[] = []

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process one cycle at a time to avoid overwhelming memory
  for (let cycle = start; cycle <= end; cycle++) {
    // First, check transaction count for this cycle
    const localCount = await TransactionDB.queryTransactionCountBetweenCycles(cycle, cycle)

    // Fetch transaction count from other archivers
    const tasks = archivers.map((archiver) => {
      return async () => {
        const response = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, {
          startCycle: cycle,
          endCycle: cycle,
        })

        return response && response.totalTransactions ? response.totalTransactions : 0
      }
    })

    const txCounts = await processBatchesInParallel(tasks)
    const maxTxCount = Math.max(0, ...txCounts)

    if (localCount >= maxTxCount) {
      // We have all transactions for this cycle
      continue
    }

    Logger.mainLogger.info(`Cycle ${cycle}: Local transaction count ${localCount}, max available ${maxTxCount}`)

    // Get all local transaction IDs for this cycle
    const localTxIds = new Set<string>()
    const batchSize = healerConfig.batchSizes.transactions // Use configurable batch size for transactions

    for (let page = 0; page < Math.ceil(localCount / batchSize); page++) {
      const skip = page * batchSize
      const txs = await TransactionDB.queryTransactionsBetweenCycles(skip, batchSize, cycle, cycle)
      for (const tx of txs) {
        localTxIds.add(tx.txId)
      }
    }

    // Now get network transactions for this cycle
    for (let page = 1; page <= Math.ceil(maxTxCount / batchSize); page++) {
      const skip = (page - 1) * batchSize

      // Skip if we likely have all transactions in this range
      if (skip < localCount) {
        continue
      }

      const tasks = archivers.map((archiver) => {
        return async () => {
          const response = await fetchFromArchiver(archiver, RequestDataType.TRANSACTION, {
            startCycle: cycle,
            endCycle: cycle,
            page: page,
          })

          return response && response.transactions ? response.transactions : []
        }
      })

      const results = await processBatchesInParallel(tasks)
      const allTransactions = results.flat()

      if (allTransactions.length === 0) {
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

      // Analyze each missing transaction
      for (const [txId, transactions] of transactionsByIdMap.entries()) {
        if (transactions.length > 1) {
          // Perform majority analysis
          const hashes = transactions.map((tx) => tx.hash || StringUtils.safeStringify(tx))
          const majorityHash = await getMajorityHash(hashes)

          missingTransactions.push({
            cycle,
            id: txId,
            majorityHash: majorityHash || undefined,
          })

          Logger.mainLogger.debug(
            `Transaction ${txId} in cycle ${cycle}: ${transactions.length} versions found, majority hash: ${majorityHash || 'none'}`
          )
        } else if (transactions.length === 1) {
          // Only one version found
          missingTransactions.push({
            cycle,
            id: txId,
            majorityHash: transactions[0].hash || StringUtils.safeStringify(transactions[0]),
          })

          Logger.mainLogger.debug(`Transaction ${txId} in cycle ${cycle}: Only one version found`)
        }
      }

      await Utils.sleep(healerConfig.timeouts.sleepBetweenBatchesMs)
    }
  }

  Logger.mainLogger.info(
    `Completed analysis of transactions. Found ${missingTransactions.length} missing transactions.`
  )
  return missingTransactions
}

// Find all missing data across all database tables
async function findMissingData(): Promise<MissingData> {
  try {
    // Get maximum counts from all archivers to determine what to analyze
    const maxCounts = await getMaxCounts()

    // Get our local counts
    const localCycleCount = await CycleDB.queryCyleCount()
    const localReceiptCount = await ReceiptDB.queryReceiptCount()
    const localAccountCount = await AccountDB.queryAccountCount()
    const localTransactionCount = await TransactionDB.queryTransactionCount()

    Logger.mainLogger.info(`Local data counts:`)
    Logger.mainLogger.info(`Cycles: ${localCycleCount}/${maxCounts[DataType.CYCLE]}`)
    Logger.mainLogger.info(`Receipts: ${localReceiptCount}/${maxCounts[DataType.RECEIPT]}`)
    Logger.mainLogger.info(`Accounts: ${localAccountCount}/${maxCounts[DataType.ACCOUNT]}`)
    Logger.mainLogger.info(`Transactions: ${localTransactionCount}/${maxCounts[DataType.TRANSACTION]}`)

    const missingData: MissingData = {
      cycles: [],
      receipts: [],
      accounts: [],
      transactions: [],
      timestamp: Date.now(),
    }

    await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

    // Find missing cycles
    if (localCycleCount < maxCounts[DataType.CYCLE]) {
      missingData.cycles = await findMissingCycles(0, maxCounts[DataType.CYCLE] - 1)
    } else {
      Logger.mainLogger.info(`Cycle data is up-to-date`)
    }

    await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

    Logger.mainLogger.info(`========== healerConfig.ignoreCounts: ${healerConfig.ignoreCounts}`)

    // Find missing receipts
    if (healerConfig.ignoreCounts === true || localReceiptCount < maxCounts[DataType.RECEIPT]) {
      // For receipts, use the max cycle count (either local or network)
      const maxCycleCount = Math.max(localCycleCount, maxCounts[DataType.CYCLE])
      missingData.receipts = await findMissingReceipts(0, maxCycleCount - 1)
      
      //TODO need to support min/max cycle range input so we can do partial work
      //
      //missingData.receipts = await findMissingReceipts(15590, 15600)
    } else {
      Logger.mainLogger.info(`Receipt data is up-to-date`)
    }

    await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

    // Find missing accounts
    if (maxCounts[DataType.ACCOUNT] === 0) {
      Logger.mainLogger.info(`No accounts found on the network`)
    } else if (localAccountCount < maxCounts[DataType.ACCOUNT]) {
      Logger.mainLogger.info(
        `Finding missing accounts: local ${localAccountCount}, network ${maxCounts[DataType.ACCOUNT]}`
      )
      missingData.accounts = await findMissingAccounts()
    } else {
      Logger.mainLogger.info(`Account data is up-to-date`)
    }

    await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

    // Find missing transactions
    if (localTransactionCount < maxCounts[DataType.TRANSACTION]) {
      // For transactions, use the max cycle count (either local or network)
      const maxCycleCount = Math.max(localCycleCount, maxCounts[DataType.CYCLE])
      missingData.transactions = await findMissingTransactions(0, maxCycleCount - 1)
    } else {
      Logger.mainLogger.info(`Transaction data is up-to-date`)
    }

    // Log summary of missing data
    Logger.mainLogger.info(`Missing data analysis complete:`)
    Logger.mainLogger.info(`- Missing cycles: ${missingData.cycles.length}`)
    Logger.mainLogger.info(`- Missing receipts: ${missingData.receipts.length}`)
    Logger.mainLogger.info(`- Missing accounts: ${missingData.accounts.length}`)
    Logger.mainLogger.info(`- Missing transactions: ${missingData.transactions.length}`)

    return missingData
  } catch (error) {
    console.log(error)
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

  // Group cycles by counter ranges to optimize requests
  const ranges: { start: number; end: number }[] = []
  let currentRange: { start: number; end: number } | null = null

  // Sort by counter
  const sortedCycles = [...missingCycles].sort((a, b) => a.counter - b.counter)

  for (const cycle of sortedCycles) {
    if (!currentRange) {
      currentRange = { start: cycle.counter, end: cycle.counter }
    } else if (cycle.counter === currentRange.end + 1) {
      // Extend current range
      currentRange.end = cycle.counter
    } else {
      // Start a new range
      ranges.push(currentRange)
      currentRange = { start: cycle.counter, end: cycle.counter }
    }
  }

  if (currentRange) {
    ranges.push(currentRange)
  }

  Logger.mainLogger.info(`Optimized ${missingCycles.length} cycles into ${ranges.length} range requests`)

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process each range
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]
    Logger.mainLogger.info(`Healing cycle range ${i + 1}/${ranges.length}: ${range.start} to ${range.end}`)

    // Create a task to fetch each range from each archiver
    const tasks = archivers.map((archiver) => {
      return async () => {
        const response = await fetchFromArchiver(archiver, RequestDataType.CYCLE, {
          start: range.start,
          end: range.end,
        })

        return response && response.cycleInfo ? response.cycleInfo : []
      }
    })

    const results = await processBatchesInParallel(tasks)
    const allCycles = results.flat()

    if (allCycles.length === 0) {
      Logger.mainLogger.warn(`No cycle data found for range ${range.start} to ${range.end}`)
      continue
    }

    // Group cycles by counter
    const cyclesByCounter = new Map<number, any[]>()
    for (const cycle of allCycles) {
      if (!cycle.counter && cycle.counter !== 0) continue

      if (!cyclesByCounter.has(cycle.counter)) {
        cyclesByCounter.set(cycle.counter, [])
      }
      cyclesByCounter.get(cycle.counter)!.push(cycle)
    }

    // Process cycles using the majority hash from missing data
    const cyclesToInsert = []

    for (const missing of missingCycles) {
      if (missing.counter < range.start || missing.counter > range.end) {
        continue
      }

      const cycles = cyclesByCounter.get(missing.counter) || []

      if (cycles.length === 0) {
        Logger.mainLogger.warn(`No data found for cycle ${missing.counter}`)
        continue
      }

      if (missing.majorityHash) {
        // Use the majority hash from the report
        const matchingCycle = cycles.find((c) => (c.hash || StringUtils.safeStringify(c)) === missing.majorityHash)

        if (matchingCycle) {
          // Don't reformat the cycle, just use it as is
          cyclesToInsert.push({
            counter: matchingCycle.counter,
            cycleMarker: matchingCycle.marker || `cycle-${matchingCycle.counter}`,
            cycleRecord: matchingCycle,
          })
          Logger.mainLogger.debug(
            `Using exact hash match for cycle ${matchingCycle.counter}. Data: ${StringUtils.safeStringify(matchingCycle).substring(0, 200)}...`
          )
        } else {
          // If we can't find the exact hash match, use majority determination again
          const majorityCycle = await getMajorityItem(cycles, (c) => c.hash || StringUtils.safeStringify(c))
          if (majorityCycle) {
            // Don't reformat the cycle, just use it as is
            cyclesToInsert.push({
              counter: majorityCycle.counter,
              cycleMarker: majorityCycle.marker || `cycle-${majorityCycle.counter}`,
              cycleRecord: majorityCycle,
            })
            Logger.mainLogger.debug(
              `Using majority cycle for ${majorityCycle.counter}. Data: ${StringUtils.safeStringify(majorityCycle).substring(0, 200)}...`
            )
          }
        }
      } else {
        // No majority hash in the report, determine it now
        const majorityCycle = await getMajorityItem(cycles, (c) => c.hash || StringUtils.safeStringify(c))
        if (majorityCycle) {
          // Don't reformat the cycle, just use it as is
          cyclesToInsert.push({
            counter: majorityCycle.counter,
            cycleMarker: majorityCycle.marker,
            cycleRecord: majorityCycle,
          })
          Logger.mainLogger.debug(
            `Using majority cycle for ${majorityCycle.counter}. Data: ${StringUtils.safeStringify(majorityCycle).substring(0, 200)}...`
          )
        }
      }
    }

    // Bulk insert cycles
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
            throw err // Re-throw to be caught by the outer catch
          }
        } else {
          Logger.mainLogger.warn(`No valid cycles to insert after filtering`)
        }
      } catch (error) {
        Logger.mainLogger.error(`Error bulk inserting cycles: ${error.message}`)

        // If bulk insert fails, try individual inserts
        let successCount = 0
        for (const cycle of cyclesToInsert) {
          try {
            await CycleDB.insertCycle(cycle)
            successCount++
          } catch (innerError) {
            Logger.mainLogger.error(`Failed to insert cycle ${cycle.counter}: ${innerError.message}`)
          }
        }
        Logger.mainLogger.info(`Successfully inserted ${successCount}/${cyclesToInsert.length} cycles individually`)
      }
    }

    await Utils.sleep(SLEEP_BETWEEN_BATCHES_MS)
  }

  Logger.mainLogger.info(`Completed healing of cycles`)
}

// Heal missing receipts using the missing data report
async function healMissingReceipts(missingReceipts: MissingReceipt[]): Promise<void> {
  if (missingReceipts.length === 0) {
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

  // Get the max cycle count to use for fetching accounts
  const maxCycleCount = await CycleDB.queryCyleCount()
  Logger.mainLogger.info(`Using max cycle count: ${maxCycleCount} for account healing`)

  // Create a set of all account IDs we need to heal for faster lookups
  const allMissingAccountIds = new Set(missingAccounts.map((a) => a.id))

  // Create a map to track accounts that we've found
  const foundAccounts = new Map<string, any[]>()

  // Break the cycle range into smaller chunks to avoid exceeding
  // the MAX_BETWEEN_CYCLES_PER_REQUEST limit (100 cycles)
  const MAX_CYCLE_RANGE = 100

  // Use either custom archivers or State archivers
  const archivers = useCustomArchivers ? customArchiversConfig : State.otherArchivers

  // Process each cycle range
  for (let cycleStart = 0; cycleStart < maxCycleCount; cycleStart += MAX_CYCLE_RANGE) {
    const cycleEnd = Math.min(cycleStart + MAX_CYCLE_RANGE - 1, maxCycleCount - 1)
    Logger.mainLogger.info(`Fetching accounts for cycle range ${cycleStart}-${cycleEnd}`)

    // For each cycle range, fetch accounts in pages
    let page = 1
    let hasMoreAccounts = true

    while (hasMoreAccounts) {
      // Only continue if we haven't found all accounts yet
      if (foundAccounts.size >= allMissingAccountIds.size) {
        Logger.mainLogger.info(`Found all ${allMissingAccountIds.size} missing accounts, stopping the search`)
        hasMoreAccounts = false
        break
      }

      Logger.mainLogger.info(`Fetching accounts page ${page} for cycle range ${cycleStart}-${cycleEnd}`)

      const tasks = archivers.map((archiver) => {
        return async () => {
          try {
            // Use the correct pagination parameters for the account endpoint
            const response = await fetchFromArchiver(archiver, RequestDataType.ACCOUNT, {
              page: page,
              startCycle: cycleStart,
              endCycle: cycleEnd,
            })

            if (response && response.accounts && Array.isArray(response.accounts) && response.accounts.length > 0) {
              Logger.mainLogger.info(
                `Got ${response.accounts.length} accounts from archiver ${archiver.ip}:${archiver.port}`
              )
              return response.accounts
            } else if (response && response.accounts && !Array.isArray(response.accounts)) {
              Logger.mainLogger.info(`Got 1 account from archiver ${archiver.ip}:${archiver.port}`)
              return [response.accounts]
            } else {
              Logger.mainLogger.debug(`No accounts returned from archiver ${archiver.ip}:${archiver.port}`)
              return []
            }
          } catch (error) {
            Logger.mainLogger.error(`Error fetching accounts from ${archiver.ip}:${archiver.port}: ${error.message}`)
            return []
          }
        }
      })

      const results = await processBatchesInParallel(tasks)
      const allAccounts = results.flat()

      if (allAccounts.length === 0) {
        Logger.mainLogger.info(`No more accounts found for cycle range ${cycleStart}-${cycleEnd}, page ${page}`)
        hasMoreAccounts = false
        continue
      }

      Logger.mainLogger.info(
        `Found ${allAccounts.length} accounts for cycle range ${cycleStart}-${cycleEnd}, page ${page}`
      )

      // Process the accounts from this page
      for (const account of allAccounts) {
        if (!account.accountId) {
          continue
        }

        // Only process accounts that are in our missing list
        if (allMissingAccountIds.has(account.accountId)) {
          // Add to our found accounts map
          if (!foundAccounts.has(account.accountId)) {
            foundAccounts.set(account.accountId, [])
          }
          foundAccounts.get(account.accountId)!.push(account)
        }
      }

      // If we got fewer accounts than the general batch size, we're done with this cycle range
      if (allAccounts.length < healerConfig.batchSizes.general) {
        hasMoreAccounts = false
      } else {
        page++
      }

      await Utils.sleep(healerConfig.timeouts.sleepBetweenBatchesMs)
    }
  }

  Logger.mainLogger.info(`Found data for ${foundAccounts.size}/${allMissingAccountIds.size} missing accounts`)

  // Process accounts in batches to avoid overwhelming memory
  const accountsToInsert = []

  // Process missing accounts using the majority hash
  for (const missingAccount of missingAccounts) {
    const accounts = foundAccounts.get(missingAccount.id) || []

    if (accounts.length === 0) {
      Logger.mainLogger.warn(`No data found for account ${missingAccount.id}`)
      continue
    }

    if (missingAccount.majorityHash) {
      // Use the majority hash from the report
      const matchingAccount = accounts.find(
        (a) => (a.hash || StringUtils.safeStringify(a)) === missingAccount.majorityHash
      )

      if (matchingAccount) {
        // Don't reformat the account, use it as is
        accountsToInsert.push(matchingAccount)
        Logger.mainLogger.debug(
          `Using exact hash match for account ${missingAccount.id}. Data: ${StringUtils.safeStringify(matchingAccount).substring(0, 200)}...`
        )
      } else {
        // If we can't find the exact hash match, use majority determination again
        const majorityAccount = await getMajorityItem(accounts, (a) => a.hash || StringUtils.safeStringify(a))
        if (majorityAccount) {
          // Don't reformat the account, use it as is
          accountsToInsert.push(majorityAccount)
          Logger.mainLogger.debug(
            `Using majority account for ${missingAccount.id}. Data: ${StringUtils.safeStringify(majorityAccount).substring(0, 200)}...`
          )
        }
      }
    } else {
      // No majority hash in the report, determine it now
      const majorityAccount = await getMajorityItem(accounts, (a) => a.hash || StringUtils.safeStringify(a))
      if (majorityAccount) {
        // Don't reformat the account, use it as is
        accountsToInsert.push(majorityAccount)
        Logger.mainLogger.debug(
          `Using majority account for ${missingAccount.id}. Data: ${StringUtils.safeStringify(majorityAccount).substring(0, 200)}...`
        )
      }
    }
  }

  // Insert accounts in smaller batches to avoid memory issues
  const batchSize = healerConfig.batchSizes.healing
  for (let i = 0; i < accountsToInsert.length; i += batchSize) {
    const batchToInsert = accountsToInsert.slice(i, i + batchSize)

    if (batchToInsert.length === 0) {
      continue
    }

    try {
      Logger.mainLogger.info(
        `Inserting batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(accountsToInsert.length / batchSize)}: ${batchToInsert.length} accounts`
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

// Verify data integrity after healing
async function verifyDataIntegrity(): Promise<boolean> {
  Logger.mainLogger.info('Performing final data integrity verification...')

  // Get counts from archivers
  const maxCounts = await getMaxCounts()

  // Get local counts
  const localCycleCount = await CycleDB.queryCyleCount()
  const localReceiptCount = await ReceiptDB.queryReceiptCount()
  const localAccountCount = await AccountDB.queryAccountCount()
  const localTransactionCount = await TransactionDB.queryTransactionCount()

  const verificationResults = {
    cycles: !healerConfig.healDataTypes.cycles || localCycleCount >= maxCounts[DataType.CYCLE],
    receipts: !healerConfig.healDataTypes.receipts || localReceiptCount >= maxCounts[DataType.RECEIPT],
    accounts: !healerConfig.healDataTypes.accounts || localAccountCount >= maxCounts[DataType.ACCOUNT],
    transactions: !healerConfig.healDataTypes.transactions || localTransactionCount >= maxCounts[DataType.TRANSACTION],
  }

  Logger.mainLogger.info('Verification results:')
  Logger.mainLogger.info(
    `- Cycles: ${verificationResults.cycles ? 'PASS' : 'FAIL'} ${!healerConfig.healDataTypes.cycles ? '(SKIPPED)' : ''} (${localCycleCount}/${maxCounts[DataType.CYCLE]})`
  )
  Logger.mainLogger.info(
    `- Receipts: ${verificationResults.receipts ? 'PASS' : 'FAIL'} ${!healerConfig.healDataTypes.receipts ? '(SKIPPED)' : ''} (${localReceiptCount}/${maxCounts[DataType.RECEIPT]})`
  )
  Logger.mainLogger.info(
    `- Accounts: ${verificationResults.accounts ? 'PASS' : 'FAIL'} ${!healerConfig.healDataTypes.accounts ? '(SKIPPED)' : ''} (${localAccountCount}/${maxCounts[DataType.ACCOUNT]})`
  )
  Logger.mainLogger.info(
    `- Transactions: ${verificationResults.transactions ? 'PASS' : 'FAIL'} ${!healerConfig.healDataTypes.transactions ? '(SKIPPED)' : ''} (${localTransactionCount}/${maxCounts[DataType.TRANSACTION]})`
  )

  return Object.values(verificationResults).every((result) => result === true)
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
    await healMissingCycles(missingData.cycles)
  } else {
    Logger.mainLogger.info(`Skipping cycles healing as per configuration`)
  }

  if (healerConfig.healDataTypes.receipts) {
    Logger.mainLogger.info(`Healing receipts...`)
    await healMissingReceipts(missingData.receipts)
  } else {
    Logger.mainLogger.info(`Skipping receipts healing as per configuration`)
  }

  if (healerConfig.healDataTypes.accounts) {
    Logger.mainLogger.info(`Healing accounts...`)
    await healMissingAccounts(missingData.accounts)
  } else {
    Logger.mainLogger.info(`Skipping accounts healing as per configuration`)
  }

  if (healerConfig.healDataTypes.transactions) {
    Logger.mainLogger.info(`Healing transactions...`)
    await healMissingTransactions(missingData.transactions)
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

    // Ignore counts flag - default is false (do not ignore), set to true to ignore
    const ignoreCountsArgIndex = process.argv.indexOf('--ignore-counts')
    const ignoreCountsArg =
      ignoreCountsArgIndex !== -1 && ignoreCountsArgIndex < process.argv.length - 1
        ? process.argv[ignoreCountsArgIndex + 1]
        : 'false'
    const ignoreCounts = ignoreCountsArg.toLowerCase() === 'true'

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
    healerConfig.ignoreCounts = ignoreCounts
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
    Logger.mainLogger.info(`- Ignore counts: ${ignoreCounts ? 'ENABLED' : 'DISABLED'}`)
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
      missingData = await findMissingData()

      // Save the missing data to a file
      saveMissingDataToJson(missingData)

      if (!heal) {
        Logger.mainLogger.info(`Missing data analysis complete. See ${MISSING_DATA_FILE} for details.`)
        Logger.mainLogger.info(`Run with --heal true to apply the healing process.`)

        await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

        // Exit the process with success code
        process.exit(0)
      }
    }

    // Apply healing if requested
    if (heal) {
      Logger.mainLogger.info('Starting healing process based on missing data report...')

      // First healing pass - use missing data report
      await healAllMissingData(missingData)

      // Verify after healing to ensure all data was properly imported
      const isVerified = await verifyDataIntegrity()

      if (!isVerified) {
        Logger.mainLogger.warn('Some data is still missing after the initial healing pass.')
        Logger.mainLogger.info('Performing second analysis pass to find remaining missing data...')

        // Find the still-missing data
        const remainingMissingData = await findMissingData()

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

      await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

      // Exit the process with success code
      process.exit(0)
    }
  } catch (error) {
    console.log('error: ', error)
    Logger.mainLogger.error(`Error in healing process: ${error.message}`)
    Logger.mainLogger.error(error.stack)

    await Utils.sleep(healerConfig.timeouts.sleepBetweenHealingOperationsMs)

    // Exit the process with error code
    process.exit(1)
  }
}

if (require.main === module) main()
