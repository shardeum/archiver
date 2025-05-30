import { EventEmitter } from 'events'
import * as Crypto from '../Crypto'
import * as NodeList from '../NodeList'
import * as Cycles from './Cycles'
import * as State from '../State'
import * as P2P from '../P2P'
import * as Utils from '../Utils'
import { config } from '../Config'
import { P2P as P2PTypes } from '@shardus/types'
import * as Logger from '../Logger'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import * as CycleDB from '../dbstore/cycles'
import * as ReceiptDB from '../dbstore/receipts'
import * as OriginalTxDB from '../dbstore/originalTxsData'
import * as StateMetaData from '../archivedCycle/StateMetaData'
import { queryFromArchivers, RequestDataType } from '../API'
import { robustQuery } from '../Utils'
import { ArchiverLogging } from '../profiler/archiverLogging'

// Import all split modules
import {
  DataRequestTypes,
  DataRequest,
  DataResponse,
  StoredReceiptObject,
  CountResponse,
  ArchiverAccountResponse,
  ArchiverCycleResponse,
  ArchiverReceiptResponse,
  ArchiverOriginalTxResponse,
  ArchiverReceiptCountResponse,
  ArchiverOriginalTxsCountResponse,
  ArchiverTotalDataResponse,
  RequestDataCountType,
  DataSender,
  CompareResponse,
  ArchiverWithRetries,
  subscriptionCycleData,
  Signer,
  ValidatorColletor,
  ValidatorCycle,
  CombinedAccountsData
} from './types'
export * from './types'

import {
  getTotalDataFromArchivers,
  createDataRequest,
  syncGenesisAccountsFromArchiver,
  syncGenesisTransactionsFromArchiver,
  calcIncomingTimes,
  clearDataSenders as clearDataSendersImpl,
  sendLeaveRequest,
  joinNetwork,
  submitJoin,
  checkJoinStatus,
  sendActiveRequest,
  checkActiveStatus,
  getCycleDuration,
  nodesPerConsensusGroup,
  nodesPerEdge
} from './missingFunctions'
export {
  getTotalDataFromArchivers,
  createDataRequest,
  syncGenesisAccountsFromArchiver,
  syncGenesisTransactionsFromArchiver,
  calcIncomingTimes,
  sendLeaveRequest,
  joinNetwork,
  submitJoin,
  checkJoinStatus,
  sendActiveRequest,
  checkActiveStatus,
  getCycleDuration,
  nodesPerConsensusGroup,
  nodesPerEdge
}

import {
  socketClients,
  validationTracker,
  ValidationTracker,
  unsubscribeDataSender,
  initSocketClient,
  forwardGenesisAccounts,
  setForwardGenesisAccounts
} from './socketClient'
export { socketClients, validationTracker, ValidationTracker, unsubscribeDataSender, initSocketClient }

import { sendDataRequest } from './dataRequests'
export { sendDataRequest }

import { clearCombinedAccountsData } from './accountData'
export { clearCombinedAccountsData }

import {
  collectCycleData as collectCycleDataRaw,
  scoreCert,
  syncCycleData
} from './cycleData'
export { scoreCert, syncCycleData }

// Export collectCycleData with dataSenders injected
export function collectCycleData(
  cycleData: subscriptionCycleData[] | P2PTypes.CycleCreatorTypes.CycleData[],
  senderInfo: string,
  source: string
): void {
  return collectCycleDataRaw(cycleData, senderInfo, source, dataSenders)
}

import {
  syncFromNetworkConfig,
  getConsensusRadius,
  getCurrentConsensusRadius,
  setCurrentConsensusRadius
} from './networkConfig'
export { getConsensusRadius, getCurrentConsensusRadius }

import {
  createContactTimeout,
  addDataSender,
  replaceDataSenderMain as replaceDataSender,
  subscribeNodeForDataTransfer,
  createDataTransferConnection,
  createNodesGroupByConsensusRadius,
  subscribeConsensorsByConsensusRadius,
  subscribeNodeFromThisSubset
} from './nodeSubscription'
export {
  createContactTimeout,
  addDataSender,
  replaceDataSender,
  subscribeNodeForDataTransfer,
  createDataTransferConnection,
  createNodesGroupByConsensusRadius,
  subscribeConsensorsByConsensusRadius,
  subscribeNodeFromThisSubset
}

import {
  syncGenesisAccountsFromConsensor,
  syncGenesisTransactionsFromConsensor,
  buildNodeListFromStoredCycle,
  syncCyclesAndNodeList,
  syncCyclesAndNodeListV2,
  syncCyclesBetweenCycles,
  syncReceipts,
  syncReceiptsByCycle,
  syncCyclesAndTxsData,
  syncCyclesAndTxsDataBetweenCycles
} from './dataSync'
export {
  syncGenesisAccountsFromConsensor,
  syncGenesisTransactionsFromConsensor,
  buildNodeListFromStoredCycle,
  syncCyclesAndNodeList,
  syncCyclesAndNodeListV2,
  syncCyclesBetweenCycles,
  syncReceipts,
  syncReceiptsByCycle,
  syncCyclesAndTxsData,
  syncCyclesAndTxsDataBetweenCycles
}

import {
  compareWithOldOriginalTxsData,
  compareWithOldReceiptsData,
  compareWithOldCyclesData
} from './dataComparison'
export {
  compareWithOldOriginalTxsData,
  compareWithOldReceiptsData,
  compareWithOldCyclesData
}

// Re-export constants and global variables
export const QUERY_TIMEOUT_MAX = 30 // 30seconds
export const {
  MAX_ACCOUNTS_PER_REQUEST,
  MAX_RECEIPTS_PER_REQUEST,
  MAX_ORIGINAL_TXS_PER_REQUEST,
  MAX_CYCLES_PER_REQUEST,
  MAX_BETWEEN_CYCLES_PER_REQUEST,
} = config.REQUEST_LIMIT

export const GENESIS_ACCOUNTS_CYCLE_RANGE = {
  startCycle: 0,
  endCycle: 5,
}

export const dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], DataSender> = new Map()
export const emitter = new EventEmitter()

// Re-export functions from original Data.ts that need to be kept
export { getCurrentCycleCounter } from './Cycles'
export { queryFromArchivers, RequestDataType } from '../API'
export { robustQuery } from '../Utils'
export { fetchCycleRecords, getNewestCycleFromArchivers } from './Cycles'

// Functions that need to be implemented here because they're used by multiple modules
import {
  storeReceiptData as storeReceiptDataImpl,
  storeOriginalTxData as storeOriginalTxDataImpl,
  storeAccountData as storeAccountDataImpl,
  storeCycleData as storeCycleDataImpl,
  storingAccountData
} from './Collector'

// Re-export storingAccountData flag
export { storingAccountData }

export async function storeReceiptData(
  receipts: any[],
  senderInfo: string,
  validate: boolean,
  saveOnlyGossipData: boolean,
  gossipReceipt: boolean
): Promise<void | StoredReceiptObject> {
  return storeReceiptDataImpl(receipts, senderInfo, validate, saveOnlyGossipData, gossipReceipt)
}

export async function storeOriginalTxData(
  originalTxs: any[],
  senderInfo: string,
  saveOnlyGossipData: boolean
): Promise<void> {
  return storeOriginalTxDataImpl(originalTxs, senderInfo, saveOnlyGossipData)
}

export async function storeAccountData(data: { accounts?: any[]; receipts?: any[] }): Promise<void> {
  return storeAccountDataImpl(data)
}

export async function storeCycleData(cycles: P2PTypes.CycleCreatorTypes.CycleData[]): Promise<void> {
  return storeCycleDataImpl(cycles)
}

import { processCycles as processCyclesImpl } from './Cycles'
export async function processCycles(cycles: P2PTypes.CycleCreatorTypes.CycleData[]): Promise<void> {
  return processCyclesImpl(cycles)
}

// Update socket client initialization to use the global dataSenders
export function initSocketClientWithDataSenders(node: NodeList.ConsensusNodeInfo): void {
  initSocketClient(node, dataSenders, createContactTimeout)
}

export async function unsubscribeDataSenderWithDataSenders(publicKey: NodeList.ConsensusNodeInfo['publicKey']): Promise<void> {
  unsubscribeDataSender(publicKey, dataSenders)
}

export async function replaceDataSenderWithDataSenders(publicKey: NodeList.ConsensusNodeInfo['publicKey']): Promise<void> {
  return replaceDataSender(publicKey, dataSenders)
}

export async function subscribeNodeForDataTransferWithDataSenders(): Promise<void> {
  return subscribeNodeForDataTransfer(dataSenders)
}

export async function createDataTransferConnectionWithDataSenders(newSenderInfo: NodeList.ConsensusNodeInfo): Promise<boolean> {
  return createDataTransferConnection(newSenderInfo, dataSenders)
}

export async function subscribeConsensorsByConsensusRadiusWithDataSenders(): Promise<void> {
  return subscribeConsensorsByConsensusRadius(dataSenders)
}

export async function subscribeNodeFromThisSubsetWithDataSenders(
  nodeList: NodeList.ConsensusNodeInfo[],
  roundIndex: number
): Promise<void> {
  return subscribeNodeFromThisSubset(nodeList, roundIndex, dataSenders)
}

export function addDataSenderWithDataSenders(sender: DataSender): void {
  addDataSender(sender, dataSenders)
}

// Add clearDataSenders wrapper
let subsetNodesMapByConsensusRadius: Map<number, NodeList.ConsensusNodeInfo[]> = new Map()
export async function clearDataSenders(): Promise<void> {
  await clearDataSendersImpl(dataSenders, socketClients, subsetNodesMapByConsensusRadius, unsubscribeDataSenderWithDataSenders)
}