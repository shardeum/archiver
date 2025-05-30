import { P2P as P2PTypes } from '@shardus/types'
import * as Logger from '../Logger'
import * as NodeList from '../NodeList'
import * as State from '../State'
import * as Cycles from './Cycles'
import * as Utils from '../Utils'
import * as CycleDB from '../dbstore/cycles'
import * as ReceiptDB from '../dbstore/receipts'
import * as OriginalTxDB from '../dbstore/originalTxsData'
import * as AccountDB from '../dbstore/accounts'
import * as P2P from '../P2P'
import { config } from '../Config'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { ArchiverLogging } from '../profiler/archiverLogging'
import { 
  ChangeSquasher, 
  parse, 
  applyNodeListChange, 
  activeNodeCount, 
  totalNodeCount
} from './CycleParser'
import { validateCycle } from './Cycles'
import {
  ArchiverCycleResponse,
  ArchiverReceiptResponse,
  ArchiverOriginalTxResponse,
  ArchiverTotalDataResponse,
  ArchiverAccountResponse,
  RequestDataType,
  ArchiverWithRetries,
  StoredReceiptObject
} from './types'
import { queryFromArchivers } from '../API'
import { fetchCycleRecords, getNewestCycleFromArchivers, getCurrentCycleCounter } from './Cycles'
import { getTotalDataFromArchivers } from './missingFunctions'

const QUERY_TIMEOUT_MAX = 30 // 30seconds
const MAX_CYCLES_PER_REQUEST = config.REQUEST_LIMIT.MAX_CYCLES_PER_REQUEST
const MAX_RECEIPTS_PER_REQUEST = config.REQUEST_LIMIT.MAX_RECEIPTS_PER_REQUEST
const MAX_ORIGINAL_TXS_PER_REQUEST = config.REQUEST_LIMIT.MAX_ORIGINAL_TXS_PER_REQUEST
const MAX_BETWEEN_CYCLES_PER_REQUEST = config.REQUEST_LIMIT.MAX_BETWEEN_CYCLES_PER_REQUEST
const MAX_ACCOUNTS_PER_REQUEST = config.REQUEST_LIMIT.MAX_ACCOUNTS_PER_REQUEST
const GENESIS_ACCOUNTS_CYCLE_RANGE = {
  startCycle: 0,
  endCycle: 5,
}
import { validateCycleData } from './Cycles'
import { syncV2 } from '../sync-v2'
import { getLastUpdatedCycle, updateLastUpdatedCycle } from '../utils/cycleTracker'
import { getCurrentConsensusRadius } from './networkConfig'
import { Result } from 'neverthrow'

// Placeholder function declarations that will be implemented by Data.ts
export async function storeReceiptData(
  receipts: any[],
  senderInfo: string,
  validate: boolean,
  saveOnlyGossipData: boolean,
  gossipReceipt: boolean
): Promise<void | StoredReceiptObject> {
  // Implementation in Data.ts
}

export async function storeOriginalTxData(
  originalTxs: any[],
  senderInfo: string,
  saveOnlyGossipData: boolean
): Promise<void> {
  // Implementation in Data.ts
}

export async function storeAccountData(data: { accounts?: any[]; receipts?: any[] }): Promise<void> {
  // Implementation in Data.ts
}

export async function storeCycleData(cycles: P2PTypes.CycleCreatorTypes.CycleData[]): Promise<void> {
  // Implementation in Data.ts
}

export async function processCycles(cycles: P2PTypes.CycleCreatorTypes.CycleData[]): Promise<void> {
  // Implementation in Data.ts
}

export async function syncGenesisAccountsFromConsensor(
  totalGenesisAccounts = 0,
  firstConsensor: NodeList.ConsensusNodeInfo
): Promise<void> {
  if (totalGenesisAccounts <= 0) return
  let startAccount = 0
  let totalDownloadedAccounts = 0
  while (startAccount <= totalGenesisAccounts) {
    Logger.mainLogger.debug(`Downloading accounts from ${startAccount}`)
    const response = (await P2P.getJson(
      `http://${firstConsensor.ip}:${firstConsensor.port}/genesis_accounts?start=${startAccount}`,
      QUERY_TIMEOUT_MAX
    )) as ArchiverAccountResponse
    if (response && response.accounts) {
      if (response.accounts.length < MAX_ACCOUNTS_PER_REQUEST) {
        Logger.mainLogger.debug('Download completed for accounts')
      }
      Logger.mainLogger.debug(`Downloaded accounts`, response.accounts.length)
      await storeAccountData({ accounts: response.accounts })
      totalDownloadedAccounts += response.accounts.length
      startAccount += MAX_ACCOUNTS_PER_REQUEST
    } else {
      Logger.mainLogger.debug('Genesis Accounts Query', 'Invalid download response')
    }
  }
  Logger.mainLogger.debug(`Total downloaded accounts`, totalDownloadedAccounts)
  Logger.mainLogger.debug('Sync genesis accounts completed!')
}

export async function syncGenesisTransactionsFromConsensor(
  totalGenesisTransactions = 0,
  firstConsensor: NodeList.ConsensusNodeInfo
): Promise<void> {
  if (totalGenesisTransactions <= 0) return
  let startTransaction = 0
  let endTransaction = startTransaction + MAX_ACCOUNTS_PER_REQUEST
  let page = 1
  let complete = false
  while (!complete) {
    Logger.mainLogger.debug(`Downloading transactions from ${startTransaction} to ${endTransaction}`)
    const response = (await P2P.getJson(
      `http://${firstConsensor.ip}:${firstConsensor.port}/genesis_transactions?start=${startTransaction}&end=${endTransaction}&page=${page}`,
      QUERY_TIMEOUT_MAX
    )) as ArchiverAccountResponse
    if (response && response.transactions) {
      if (response.transactions.length < MAX_ACCOUNTS_PER_REQUEST) {
        complete = true
        Logger.mainLogger.debug('Download completed for transactions')
      }
      Logger.mainLogger.debug(`Downloaded transactions`, response.transactions.length)
      await storeAccountData({ receipts: response.transactions })
      startTransaction = endTransaction + 1
      endTransaction += MAX_ACCOUNTS_PER_REQUEST
      page++
    } else {
      Logger.mainLogger.debug('Genesis Transactions Query', 'Invalid download response')
    }
  }
  Logger.mainLogger.debug('Sync genesis transactions completed!')
}

export async function buildNodeListFromStoredCycle(
  lastStoredCycle: P2PTypes.CycleCreatorTypes.CycleData
): Promise<void> {
  Logger.mainLogger.debug('lastStoredCycle', lastStoredCycle)
  Logger.mainLogger.debug('buildNodeListFromStoredCycle:')
  Logger.mainLogger.debug(`Syncing till cycle ${lastStoredCycle.counter}...`)
  const cyclesToGet = 2 * Math.floor(Math.sqrt(lastStoredCycle.active)) + 2
  Logger.mainLogger.debug(`Cycles to get is ${cyclesToGet}`)

  const CycleChain = []
  const squasher = new ChangeSquasher()

  CycleChain.unshift(lastStoredCycle)
  squasher.addChange(parse(CycleChain[0]))

  do {
    let end: number = CycleChain[0].counter - 1
    let start: number = end - cyclesToGet
    if (start < 0) start = 0
    if (end < start) end = start
    Logger.mainLogger.debug(`Getting cycles ${start} - ${end}...`)
    const prevCycles = await CycleDB.queryCycleRecordsBetween(start, end)

    if (prevCycles.length < 1) throw new Error('Got empty previous cycles')

    prevCycles.sort((a, b) => (a.counter > b.counter ? -1 : 1))

    let prepended = 0
    for (const prevCycle of prevCycles) {
      CycleChain.unshift(prevCycle)
      squasher.addChange(parse(prevCycle))
      prepended++

      if (
        squasher.final.updated.length >= activeNodeCount(lastStoredCycle) &&
        squasher.final.added.length >= totalNodeCount(lastStoredCycle)
      ) {
        break
      }
    }

    Logger.mainLogger.debug(
      `Got ${squasher.final.updated.length} active nodes, need ${activeNodeCount(lastStoredCycle)}`
    )
    Logger.mainLogger.debug(`Got ${squasher.final.added.length} total nodes, need ${totalNodeCount(lastStoredCycle)}`)
    if (squasher.final.added.length < totalNodeCount(lastStoredCycle))
      Logger.mainLogger.debug('Short on nodes. Need to get more cycles. Cycle:' + lastStoredCycle.counter)

    if (prepended < 1) throw new Error('Unable to prepend any previous cycles')
  } while (
    squasher.final.updated.length < activeNodeCount(lastStoredCycle) ||
    squasher.final.added.length < totalNodeCount(lastStoredCycle)
  )

  applyNodeListChange(squasher.final)
  Logger.mainLogger.debug('NodeList after sync', NodeList.getActiveList())
  Cycles.setCurrentCycleCounter(lastStoredCycle.counter)
  Cycles.setCurrentCycleMarker(lastStoredCycle.marker)
  Cycles.setCurrentCycleDuration(lastStoredCycle.duration)
  Logger.mainLogger.debug('Latest cycle after sync', lastStoredCycle.counter)
}

export async function syncCyclesAndNodeList(lastStoredCycleCount = 0): Promise<void> {
  Logger.mainLogger.debug('Getting newest cycle...')
  const cycleToSyncTo = await getNewestCycleFromArchivers()
  Logger.mainLogger.debug('cycleToSyncTo', cycleToSyncTo)
  Logger.mainLogger.debug(`Syncing till cycle ${cycleToSyncTo.counter}...`)

  const cyclesToGet = 2 * Math.floor(Math.sqrt(cycleToSyncTo.active)) + 2
  Logger.mainLogger.debug(`Cycles to get is ${cyclesToGet}`)

  const CycleChain = []
  const squasher = new ChangeSquasher()

  CycleChain.unshift(cycleToSyncTo)
  squasher.addChange(parse(CycleChain[0]))

  do {
    let end: number = CycleChain[0].counter - 1
    let start: number = end - cyclesToGet
    if (start < 0) start = 0
    if (end < start) end = start
    Logger.mainLogger.debug(`Getting cycles ${start} - ${end}...`)
    const prevCycles = await fetchCycleRecords(start, end)

    if (prevCycles.length < 1) throw new Error('Got empty previous cycles')

    prevCycles.sort((a, b) => (a.counter > b.counter ? -1 : 1))

    let prepended = 0
    for (const prevCycle of prevCycles) {
      if (validateCycle(prevCycle, CycleChain[0]) === false) {
        Logger.mainLogger.error(`Record ${prevCycle.counter} failed validation`)
        break
      }
      CycleChain.unshift(prevCycle)
      squasher.addChange(parse(prevCycle))
      prepended++

      if (
        squasher.final.updated.length >= activeNodeCount(cycleToSyncTo) &&
        squasher.final.added.length >= totalNodeCount(cycleToSyncTo)
      ) {
        break
      }
    }

    Logger.mainLogger.debug(`Got ${squasher.final.updated.length} active nodes, need ${activeNodeCount(cycleToSyncTo)}`)
    Logger.mainLogger.debug(`Got ${squasher.final.added.length} total nodes, need ${totalNodeCount(cycleToSyncTo)}`)
    if (squasher.final.added.length < totalNodeCount(cycleToSyncTo))
      Logger.mainLogger.debug('Short on nodes. Need to get more cycles. Cycle:' + cycleToSyncTo.counter)

    if (prepended < 1) throw new Error('Unable to prepend any previous cycles')
  } while (
    squasher.final.updated.length < activeNodeCount(cycleToSyncTo) ||
    squasher.final.added.length < totalNodeCount(cycleToSyncTo)
  )

  applyNodeListChange(squasher.final)
  Logger.mainLogger.debug('NodeList after sync', NodeList.getActiveList())

  for (let i = 0; i < CycleChain.length; i++) {
    const record = CycleChain[i]
    Cycles.CycleChain.set(record.counter, { ...record })
    if (i === CycleChain.length - 1) await storeCycleData(CycleChain)
    Cycles.setCurrentCycleCounter(record.counter)
    Cycles.setCurrentCycleMarker(record.marker)
  }
  Logger.mainLogger.debug('Cycle chain is synced. Size of CycleChain', Cycles.CycleChain.size)

  let endCycle = CycleChain[0].counter - 1
  Logger.mainLogger.debug('endCycle counter', endCycle, 'lastStoredCycleCount', lastStoredCycleCount)
  if (endCycle > lastStoredCycleCount) {
    Logger.mainLogger.debug(`Downloading old cycles from cycles ${lastStoredCycleCount} to cycle ${endCycle}!`)
  }
  let savedCycleRecord = CycleChain[0]
  while (endCycle > lastStoredCycleCount) {
    let nextEnd: number = endCycle - MAX_CYCLES_PER_REQUEST
    if (nextEnd < 0) nextEnd = 0
    Logger.mainLogger.debug(`Getting cycles ${nextEnd} - ${endCycle} ...`)
    const prevCycles = await fetchCycleRecords(nextEnd, endCycle)

    if (!prevCycles || prevCycles.length < 1) throw new Error('Got empty previous cycles')
    prevCycles.sort((a, b) => (a.counter > b.counter ? -1 : 1))

    const combineCycles = []
    for (const prevCycle of prevCycles) {
      if (validateCycle(prevCycle, savedCycleRecord) === false) {
        Logger.mainLogger.error(`Record ${prevCycle.counter} failed validation`)
        Logger.mainLogger.debug('fail', prevCycle, savedCycleRecord)
        break
      }
      savedCycleRecord = prevCycle
      combineCycles.push(prevCycle)
    }
    await storeCycleData(combineCycles)
    endCycle = nextEnd - 1
  }
}

export async function syncCyclesAndNodeListV2(
  activeArchivers: State.ArchiverNodeInfo[],
  lastStoredCycleCount = 0
): Promise<boolean> {
  Logger.mainLogger.debug('Syncing validators and latest cycle...')
  const syncResult = await syncV2(activeArchivers)
  let cycleToSyncTo: P2PTypes.CycleCreatorTypes.CycleData
  if (syncResult.isOk()) {
    cycleToSyncTo = syncResult.value
  } else {
    throw syncResult.error
  }

  Logger.mainLogger.debug('cycleToSyncTo', cycleToSyncTo)
  Logger.mainLogger.debug(`Syncing till cycle ${cycleToSyncTo.counter}...`)

  await processCycles([cycleToSyncTo])

  await downloadOldCycles(cycleToSyncTo, lastStoredCycleCount)

  return true
}

export async function syncCyclesBetweenCycles(lastStoredCycle = 0, cycleToSyncTo = 0): Promise<boolean> {
  const MAX_RETRIES = 3
  let retryCount = 0

  let startCycle = lastStoredCycle
  let endCycle = startCycle + MAX_CYCLES_PER_REQUEST

  while (cycleToSyncTo > startCycle) {
    if (endCycle > cycleToSyncTo) endCycle = cycleToSyncTo
    Logger.mainLogger.debug(`Downloading cycles from ${startCycle} to ${endCycle}`)

    let success = false
    retryCount = 0

    while (!success && retryCount < MAX_RETRIES) {
      const res = (await queryFromArchivers(
        RequestDataType.CYCLE,
        {
          start: startCycle,
          end: endCycle,
        },
        QUERY_TIMEOUT_MAX
      )) as ArchiverCycleResponse

      if (res && res.cycleInfo) {
        const cycles = res.cycleInfo as P2PTypes.CycleCreatorTypes.CycleData[]
        Logger.mainLogger.debug(`Downloaded cycles`, cycles.length)

        let validCyclesCount = 0
        for (const cycle of cycles) {
          if (!validateCycleData(cycle)) {
            Logger.mainLogger.debug('Found invalid cycle data')
            continue
          }
          await processCycles([cycle])
          validCyclesCount++
        }

        success = true

        if (cycles.length < MAX_CYCLES_PER_REQUEST || validCyclesCount === 0) {
          startCycle += Math.max(cycles.length, 1)
          endCycle = startCycle + MAX_CYCLES_PER_REQUEST
          if (startCycle >= cycleToSyncTo) {
            Logger.mainLogger.debug('Sync cycles completed!')
            return true
          }
          break
        }
      } else {
        Logger.mainLogger.debug(`Invalid cycle download response, attempt ${retryCount + 1} of ${MAX_RETRIES}`)
        retryCount++
        if (retryCount >= MAX_RETRIES) {
          Logger.mainLogger.error('Max retries reached for cycle download')
          return false
        }
      }
    }

    if (success) {
      startCycle = endCycle + 1
      endCycle += MAX_CYCLES_PER_REQUEST
    }
  }

  return true
}

export async function syncReceipts(): Promise<void> {
  const MAX_RETRIES = 3
  let retryCount = 0

  const lastUpdatedCycle = getLastUpdatedCycle()
  Logger.mainLogger.debug(`[syncReceipts] Last updated cycle from tracker: ${lastUpdatedCycle}`)

  let startCycle = 0
  if (lastUpdatedCycle > 0) {
    Logger.mainLogger.info(`[syncReceipts] Starting receipt sync from last updated cycle: ${lastUpdatedCycle}`)
    startCycle = Math.max(lastUpdatedCycle - config.checkpoint.syncCycleBuffer, 0)
    await syncReceiptsByCycle(startCycle)
    return
  }

  let response: ArchiverTotalDataResponse = await getTotalDataFromArchivers()
  if (!response || response.totalReceipts < 0) {
    return
  }

  let { totalReceipts } = response
  if (totalReceipts < 1) return

  let complete = false
  let start = 0
  let end = start + MAX_RECEIPTS_PER_REQUEST

  while (!complete) {
    if (end >= totalReceipts) {
      response = await getTotalDataFromArchivers()
      if (response && response.totalReceipts > 0) {
        if (response.totalReceipts > totalReceipts) totalReceipts = response.totalReceipts
        Logger.mainLogger.debug('totalReceiptsToSync', totalReceipts)
      }
    }

    Logger.mainLogger.debug(`Downloading receipts from ${start} to ${end}`)
    let success = false
    retryCount = 0

    while (!success && retryCount < MAX_RETRIES) {
      const res = (await queryFromArchivers(
        RequestDataType.RECEIPT,
        {
          start: start,
          end: end,
        },
        QUERY_TIMEOUT_MAX
      )) as ArchiverReceiptResponse

      if (res && res.receipts) {
        const downloadedReceipts = res.receipts as ReceiptDB.Receipt[]
        Logger.mainLogger.debug(`Downloaded receipts`, downloadedReceipts.length)
        await storeReceiptData(downloadedReceipts, '', false, false, true)
        success = true

        if (downloadedReceipts.length < MAX_RECEIPTS_PER_REQUEST) {
          start += downloadedReceipts.length
          end = start + MAX_RECEIPTS_PER_REQUEST
          response = await getTotalDataFromArchivers()
          if (response && response.totalReceipts > 0) {
            if (response.totalReceipts > totalReceipts) totalReceipts = response.totalReceipts
            if (start >= totalReceipts) {
              complete = true
              Logger.mainLogger.debug('Download receipts completed')
            }
          }
        }
      } else {
        Logger.mainLogger.debug(`Invalid download response, attempt ${retryCount + 1} of ${MAX_RETRIES}`)
        retryCount++
        if (retryCount >= MAX_RETRIES) {
          Logger.mainLogger.error('Max retries reached for receipt download')
          start = end + 1
          end += MAX_RECEIPTS_PER_REQUEST
          if (start >= totalReceipts) {
            complete = true
          }
        }
      }
    }

    if (success) {
      start = end + 1
      end += MAX_RECEIPTS_PER_REQUEST
    }
  }

  Logger.mainLogger.debug('Sync receipts data completed!')
}

class ArchiverSelector {
  private archivers: ArchiverWithRetries[]
  private currentIndex: number = 0
  private readonly maxRetries: number = 3

  constructor() {
    this.archivers = State.otherArchivers.map((archiver) => ({
      archiver,
      retriesLeft: this.maxRetries,
    }))
    Utils.shuffleArray(this.archivers)
  }

  getCurrentArchiver(): State.ArchiverNodeInfo | null {
    if (this.currentIndex >= this.archivers.length) {
      return null
    }
    return this.archivers[this.currentIndex].archiver
  }

  markCurrentArchiverFailed(): State.ArchiverNodeInfo | null {
    if (this.currentIndex >= this.archivers.length) {
      return null
    }

    this.archivers[this.currentIndex].retriesLeft--

    if (this.archivers[this.currentIndex].retriesLeft <= 0) {
      this.currentIndex++
    }

    return this.getCurrentArchiver()
  }

  hasMoreArchivers(): boolean {
    return this.currentIndex < this.archivers.length
  }
}

export async function syncReceiptsByCycle(lastStoredReceiptCycle = 0, cycleToSyncTo = 0): Promise<boolean> {
  if (lastStoredReceiptCycle === 0) {
    const trackedCycle = getLastUpdatedCycle()
    if (trackedCycle > 0) {
      Logger.mainLogger.info(`[syncReceiptsByCycle] Using last updated cycle from tracker: ${trackedCycle}`)
      lastStoredReceiptCycle = Math.max(trackedCycle - config.checkpoint.syncCycleBuffer, 0)
    }
  }

  let totalCycles = cycleToSyncTo
  let totalReceipts = 0
  if (cycleToSyncTo === 0) {
    const response: ArchiverTotalDataResponse = await getTotalDataFromArchivers()
    if (!response || response.totalReceipts < 0) {
      return false
    }
    totalCycles = response.totalCycles
    totalReceipts = response.totalReceipts
  }
  let startCycle = lastStoredReceiptCycle
  let endCycle = startCycle + MAX_BETWEEN_CYCLES_PER_REQUEST
  let receiptsCountToSyncBetweenCycles = 0
  let savedReceiptsCountBetweenCycles = 0
  let totalSavedReceiptsCount = 0
  let archiverSelector = new ArchiverSelector()

  while (true) {
    if (endCycle > totalCycles) {
      endCycle = totalCycles
      totalSavedReceiptsCount = await ReceiptDB.queryReceiptCount()
    }
    if (cycleToSyncTo > 0) {
      if (startCycle > cycleToSyncTo) {
        Logger.mainLogger.debug(`Sync receipts data completed!`)
        return true
      }
      if (endCycle > cycleToSyncTo) endCycle = cycleToSyncTo
    }
    Logger.mainLogger.debug(`Downloading receipts between cycles ${startCycle} to ${endCycle}`)
    
    const currentArchiver = archiverSelector.getCurrentArchiver()
    if (!currentArchiver) {
      Logger.mainLogger.error('No more archivers available for syncing receipts')
      return false
    }

    const res = (await P2P.getJson(
      `http://${currentArchiver.ip}:${currentArchiver.port}/receipt?startCycle=${startCycle}&endCycle=${endCycle}&type=tally`,
      QUERY_TIMEOUT_MAX
    )) as ArchiverReceiptResponse

    if (res && res.receipts) {
      const downloadedReceiptsByCycles = res.receipts as ReceiptDB.ReceiptCount[]
      for (const receiptData of downloadedReceiptsByCycles) {
        receiptsCountToSyncBetweenCycles += receiptData.receiptCount
      }
      Logger.mainLogger.debug(
        `Total receipts to sync between cycles ${startCycle} to ${endCycle}`,
        receiptsCountToSyncBetweenCycles
      )
      startCycle = endCycle + 1
      endCycle += MAX_BETWEEN_CYCLES_PER_REQUEST
    } else {
      Logger.mainLogger.error(
        `Failed to download receipts tally between cycles ${startCycle} to ${endCycle} from archiver ${currentArchiver.ip}:${currentArchiver.port}`
      )
      archiverSelector.markCurrentArchiverFailed()
      if (!archiverSelector.hasMoreArchivers()) {
        Logger.mainLogger.error('All archivers failed for syncing receipts')
        return false
      }
      continue
    }

    Logger.mainLogger.debug(
      `Downloading receipts between cycles ${lastStoredReceiptCycle} to ${startCycle - 1}`,
      receiptsCountToSyncBetweenCycles
    )
    
    const MAX_RETRIES = 3
    let start = 0
    let end = start + MAX_RECEIPTS_PER_REQUEST
    let hasMoreReceiptsToDownload = receiptsCountToSyncBetweenCycles > 0

    while (hasMoreReceiptsToDownload) {
      let success = false
      let retryCount = 0

      while (!success && retryCount < MAX_RETRIES) {
        Logger.mainLogger.debug(`Downloading receipts from index ${start} to ${end}`)
        const res2 = (await P2P.getJson(
          `http://${currentArchiver.ip}:${currentArchiver.port}/receipt?startCycle=${lastStoredReceiptCycle}&endCycle=${
            startCycle - 1
          }&start=${start}&end=${end}`,
          QUERY_TIMEOUT_MAX
        )) as ArchiverReceiptResponse

        if (res2 && res2.receipts) {
          const downloadedReceipts = res2.receipts as ReceiptDB.Receipt[]
          Logger.mainLogger.debug(`Downloaded receipts`, downloadedReceipts.length)
          const storageResult = await storeReceiptData(downloadedReceipts, '', false, false, true) as StoredReceiptObject
          savedReceiptsCountBetweenCycles += storageResult.receipts.length
          success = true

          if (downloadedReceipts.length === 0 || downloadedReceipts.length < MAX_RECEIPTS_PER_REQUEST) {
            updateLastUpdatedCycle(startCycle - 1)
            Logger.mainLogger.debug(`[syncReceiptsByCycle] Updated cycle tracker to cycle ${startCycle - 1}`)
            hasMoreReceiptsToDownload = false
            receiptsCountToSyncBetweenCycles = 0
            savedReceiptsCountBetweenCycles = 0
            break
          }
        } else {
          Logger.mainLogger.debug(`Invalid download response, attempt ${retryCount + 1} of ${MAX_RETRIES}`)
          retryCount++
          if (retryCount >= MAX_RETRIES) {
            Logger.mainLogger.error('Max retries reached for receipt download')
            archiverSelector.markCurrentArchiverFailed()
            if (!archiverSelector.hasMoreArchivers()) {
              Logger.mainLogger.error('All archivers failed for syncing receipts')
              return false
            }
          }
        }
      }
      if (success) {
        start = end + 1
        end += MAX_RECEIPTS_PER_REQUEST
      }
    }

    if (cycleToSyncTo === 0 && totalSavedReceiptsCount >= totalReceipts) {
      Logger.mainLogger.debug('Sync receipts data by cycle completed!')
      return true
    }
  }
}

export async function syncCyclesAndTxsData(lastStoredCycle = 0, cycleToSyncTo = 0): Promise<void> {
  let response: ArchiverTotalDataResponse = await getTotalDataFromArchivers()
  if (!response || response.totalCycles < 0) {
    return
  }

  let { totalCycles, totalReceipts } = response
  if (totalCycles < 1) return

  let completeForCycle = false
  let startCycle = lastStoredCycle
  let endCycle = startCycle + MAX_CYCLES_PER_REQUEST
  const MAX_RETRIES = 3
  let retryCount = 0

  while (!completeForCycle || startCycle < endCycle) {
    if (endCycle >= totalCycles) {
      endCycle = totalCycles
      completeForCycle = true
      response = await getTotalDataFromArchivers()
      if (response && response.totalCycles > 0) {
        if (response.totalCycles > totalCycles) totalCycles = response.totalCycles
        if (response.totalReceipts > totalReceipts) totalReceipts = response.totalReceipts
        Logger.mainLogger.debug('totalCyclesToSync', totalCycles, 'totalReceiptsToSync', totalReceipts)
      }
    }

    if (!completeForCycle) {
      Logger.mainLogger.debug(`Downloading cycles from ${startCycle} to ${endCycle}`)
      let success = false
      retryCount = 0

      while (!success && retryCount < MAX_RETRIES) {
        const res = (await queryFromArchivers(
          RequestDataType.CYCLE,
          {
            start: startCycle,
            end: endCycle,
          },
          QUERY_TIMEOUT_MAX
        )) as ArchiverCycleResponse
        if (res && res.cycleInfo) {
          const cycles = res.cycleInfo
          Logger.mainLogger.debug(`Downloaded cycles`, cycles.length)
          for (const cycle of cycles) {
            if (!validateCycleData(cycle)) {
              Logger.mainLogger.debug('Found invalid cycle data')
              continue
            }
            await processCycles([cycle])
          }
          success = true

          const highestCycle = cycles.reduce((max, cycle) => Math.max(max, cycle.counter), 0)
          if (highestCycle > 0) {
            updateLastUpdatedCycle(highestCycle)
            Logger.mainLogger.debug(`[syncCyclesAndTxsData] Updated cycle tracker to cycle ${highestCycle}`)
          }

          if (cycles.length < MAX_CYCLES_PER_REQUEST) {
            startCycle += cycles.length + 1
            endCycle += cycles.length + MAX_CYCLES_PER_REQUEST
          }
        } else {
          Logger.mainLogger.debug(`Invalid cycle download response, attempt ${retryCount + 1} of ${MAX_RETRIES}`)
          retryCount++
          if (retryCount >= MAX_RETRIES) {
            Logger.mainLogger.error('Max retries reached for cycle download')
          }
        }
      }
      if (success) {
        startCycle = endCycle + 1
        endCycle += MAX_CYCLES_PER_REQUEST
      }
    }
  }
  Logger.mainLogger.debug('Sync Cycle, Receipt & Original-Tx data completed!')
}

export const syncCyclesAndTxsDataBetweenCycles = async (lastStoredCycle = 0, cycleToSyncTo = 0): Promise<void> => {
  Logger.mainLogger.debug(`Syncing cycles and txs data between cycles ${lastStoredCycle} and ${cycleToSyncTo}`)
  await syncCyclesBetweenCycles(lastStoredCycle, cycleToSyncTo)
  await syncReceiptsByCycle(lastStoredCycle, cycleToSyncTo)
}

async function downloadOldCycles(
  cycleToSyncTo: P2PTypes.CycleCreatorTypes.CycleData,
  lastStoredCycleCount: number
): Promise<void> {
  let endCycle = cycleToSyncTo.counter - 1
  Logger.mainLogger.debug('endCycle counter', endCycle, 'lastStoredCycleCount', lastStoredCycleCount)
  if (endCycle > lastStoredCycleCount) {
    Logger.mainLogger.debug(`Downloading old cycles from cycles ${lastStoredCycleCount} to cycle ${endCycle}!`)
  }

  let savedCycleRecord = cycleToSyncTo
  const MAX_RETRY_COUNT = 3
  let retryCount = 0
  while (endCycle > lastStoredCycleCount) {
    let startCycle: number = endCycle - MAX_CYCLES_PER_REQUEST
    if (startCycle < 0) startCycle = 0
    if (startCycle < lastStoredCycleCount) startCycle = lastStoredCycleCount
    Logger.mainLogger.debug(`Getting cycles ${startCycle} - ${endCycle} ...`)
    const res = (await queryFromArchivers(
      RequestDataType.CYCLE,
      {
        start: startCycle,
        end: endCycle,
      },
      QUERY_TIMEOUT_MAX
    )) as ArchiverCycleResponse
    if (!res || !res.cycleInfo || !Array.isArray(res.cycleInfo) || res.cycleInfo.length === 0) {
      Logger.mainLogger.error(`Can't fetch data from cycle ${startCycle} to cycle ${endCycle}  from archivers`)
      if (retryCount < MAX_RETRY_COUNT) {
        retryCount++
        continue
      } else {
        endCycle = startCycle - 1
        retryCount = 0
      }
    }

    const prevCycles = res.cycleInfo as P2PTypes.CycleCreatorTypes.CycleData[]
    if (prevCycles) prevCycles.sort((a, b) => (a.counter > b.counter ? -1 : 1))

    const combineCycles: P2PTypes.CycleCreatorTypes.CycleData[] = []
    for (const prevCycle of prevCycles) {
      if (validateCycle(prevCycle, savedCycleRecord) === false) {
        Logger.mainLogger.error(`Record ${prevCycle.counter} failed validation`)
        Logger.mainLogger.debug('fail', prevCycle, savedCycleRecord)
      }
      savedCycleRecord = prevCycle
      combineCycles.push(prevCycle)
    }
    await storeCycleData(combineCycles)
    endCycle = startCycle - 1
  }
}