import * as P2PTypes from '@shardus/types'
import * as Logger from '../Logger'
import * as CycleDB from '../dbstore/cycles'
import * as ReceiptDB from '../dbstore/receipts'
import * as OriginalTxDB from '../dbstore/originalTxsData'
import * as StringUtils from '@shardus/types/build/src/utils/StringifyReduce'
import { config } from '../Config'
import {
  CompareResponse,
  ArchiverCycleResponse,
  ArchiverReceiptResponse,
  ArchiverOriginalTxResponse,
  RequestDataType
} from './types'
import { queryFromArchivers } from '../API'

const QUERY_TIMEOUT_MAX = 30 // 30seconds

export async function compareWithOldOriginalTxsData(lastStoredOriginalTxCycle = 0): Promise<CompareResponse> {
  const numberOfCyclesTocompare = 10
  let success = false
  let matchedCycle = 0
  const endCycle = lastStoredOriginalTxCycle
  const startCycle = endCycle - numberOfCyclesTocompare > 0 ? endCycle - numberOfCyclesTocompare : 0
  const response = (await queryFromArchivers(
    RequestDataType.ORIGINALTX,
    {
      startCycle,
      endCycle,
      type: 'tally',
    },
    QUERY_TIMEOUT_MAX
  )) as ArchiverOriginalTxResponse

  if (!response || !response.originalTxs) {
    Logger.mainLogger.error(`Can't fetch original tx data from cycle ${startCycle} to cycle ${endCycle} from archivers`)
    return { success, matchedCycle }
  }
  const downloadedOriginalTxsByCycles = response.originalTxs as OriginalTxDB.OriginalTxDataCount[]

  const oldOriginalTxCountByCycle = await OriginalTxDB.queryOriginalTxDataCountByCycles(startCycle, endCycle)

  for (let i = 0; i < downloadedOriginalTxsByCycles.length; i++) {
    const downloadedOriginalTx = downloadedOriginalTxsByCycles[i]
    const oldOriginalTx = oldOriginalTxCountByCycle[i]
    Logger.mainLogger.debug(downloadedOriginalTx, oldOriginalTx)
    if (
      !downloadedOriginalTx ||
      !oldOriginalTx ||
      downloadedOriginalTx.cycle !== oldOriginalTx.cycle ||
      downloadedOriginalTx.originalTxDataCount !== oldOriginalTx.originalTxDataCount
    ) {
      return {
        success,
        matchedCycle,
      }
    }
    success = true
    matchedCycle = downloadedOriginalTx.cycle
  }
  success = true
  return { success, matchedCycle }
}

export async function compareWithOldReceiptsData(lastStoredReceiptCycle = 0): Promise<CompareResponse> {
  const numberOfCyclesTocompare = 10
  let success = false
  let matchedCycle = 0
  const endCycle = lastStoredReceiptCycle
  const startCycle = endCycle - numberOfCyclesTocompare > 0 ? endCycle - numberOfCyclesTocompare : 0
  const response = (await queryFromArchivers(
    RequestDataType.RECEIPT,
    {
      startCycle,
      endCycle,
      type: 'tally',
    },
    QUERY_TIMEOUT_MAX
  )) as ArchiverReceiptResponse

  if (!response || !response.receipts) {
    Logger.mainLogger.error(`Can't fetch receipts data from cycle ${startCycle} to cycle ${endCycle}  from archivers`)
    return { success, matchedCycle }
  }
  const downloadedReceiptCountByCycles = response.receipts as ReceiptDB.ReceiptCount[]

  const oldReceiptCountByCycle = await ReceiptDB.queryReceiptCountByCycles(startCycle, endCycle)
  for (let i = 0; i < downloadedReceiptCountByCycles.length; i++) {
    const downloadedReceipt = downloadedReceiptCountByCycles[i]
    const oldReceipt = oldReceiptCountByCycle[i]
    Logger.mainLogger.debug(downloadedReceipt, oldReceipt)
    if (
      !downloadedReceipt ||
      !oldReceipt ||
      downloadedReceipt.cycle !== oldReceipt.cycle ||
      downloadedReceipt.receiptCount !== oldReceipt.receiptCount
    ) {
      return {
        success,
        matchedCycle,
      }
    }
    success = true
    matchedCycle = downloadedReceipt.cycle
  }
  success = true
  return { success, matchedCycle }
}

export async function compareWithOldCyclesData(lastCycleCounter = 0): Promise<CompareResponse> {
  try {
    const numberOfCyclesTocompare = 10
    const start = lastCycleCounter - numberOfCyclesTocompare
    const end = lastCycleCounter
    const response = (await queryFromArchivers(
      RequestDataType.CYCLE,
      {
        start,
        end,
      },
      QUERY_TIMEOUT_MAX
    )) as ArchiverCycleResponse
    if (!response && !response.cycleInfo) {
      throw Error(`Can't fetch data from cycle ${start} to cycle ${end}  from archivers`)
    }
    const downloadedCycles = response.cycleInfo
    const oldCycles = await CycleDB.queryCycleRecordsBetween(start, end)
    let success = false
    let matchedCycle = 0
    for (let i = 0; i < downloadedCycles.length; i++) {
      const downloadedCycle = downloadedCycles[i]
      const oldCycle = oldCycles[i]
      if (
        !downloadedCycle ||
        !oldCycle ||
        StringUtils.safeStringify(downloadedCycle) !== StringUtils.safeStringify(oldCycle)
      ) {
        if (config.VERBOSE) {
          Logger.mainLogger.error('Mismatched cycle Number', downloadedCycle.counter, oldCycle.counter)
        }
        return {
          success,
          matchedCycle,
        }
      }
      success = true
      matchedCycle = downloadedCycle.counter
    }
    return { success, matchedCycle }
  } catch (error) {
    Logger.mainLogger.error('compareWithOldCyclesData error: ' + error)
    return { success: false, matchedCycle: 0 }
  }
}