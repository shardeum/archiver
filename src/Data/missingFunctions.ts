import { P2P as P2PTypes } from '@shardeus-foundation/lib-types'
import * as Crypto from '../Crypto'
import * as NodeList from '../NodeList'
import * as State from '../State'
import * as P2P from '../P2P'
import * as Utils from '../Utils'
import * as Logger from '../Logger'
import { config } from '../Config'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { queryFromArchivers } from '../API'
import { 
  ArchiverTotalDataResponse, 
  RequestDataType,
  ArchiverAccountResponse,
  DataRequest,
  DataRequestTypes,
  ArchiverReceiptCountResponse
} from './types'
import { Utils as StringUtils } from '@shardeus-foundation/lib-types'
import * as AccountDB from '../dbstore/accounts'
import { storeAccountData } from './dataSync'

const QUERY_TIMEOUT_MAX = 30 // 30seconds
const MAX_ACCOUNTS_PER_REQUEST = config.REQUEST_LIMIT.MAX_ACCOUNTS_PER_REQUEST
const GENESIS_ACCOUNTS_CYCLE_RANGE = {
  startCycle: 0,
  endCycle: 5,
}

interface IncomingTimes {
  quarterDuration: number
  startQ1: number
  startQ2: number
  startQ3: number
  startQ4: number
  end: number
}

interface JoinStatus {
  isJoined: boolean
}

export async function getTotalDataFromArchivers(): Promise<ArchiverTotalDataResponse | null> {
  const res = (await queryFromArchivers(
    RequestDataType.TOTALDATA,
    {},
    QUERY_TIMEOUT_MAX
  )) as ArchiverTotalDataResponse | null
  // @ts-ignore
  if (!res || (res.success !== undefined && res.success === false)) {
    return null
  }
  return res
}

export function createDataRequest<T extends P2PTypes.SnapshotTypes.ValidTypes>(
  type: P2PTypes.SnapshotTypes.TypeName<T>,
  lastData: P2PTypes.SnapshotTypes.TypeIndex<T>,
  recipientPk: string
): DataRequest<T> & Crypto.TaggedMessage {
  return Crypto.tag<DataRequest<T>>(
    {
      type,
      lastData,
    },
    recipientPk
  )
}

export async function syncGenesisAccountsFromArchiver(): Promise<void> {
  let complete = false
  let startAccount = 0
  let endAccount = startAccount + MAX_ACCOUNTS_PER_REQUEST
  let totalGenesisAccounts = 0
  
  const res = (await queryFromArchivers(
    RequestDataType.ACCOUNT,
    { startCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.startCycle, endCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.endCycle },
    QUERY_TIMEOUT_MAX
  )) as ArchiverAccountResponse
  if (config.VERBOSE) Logger.mainLogger.error('Genesis Total Accounts Response', StringUtils.safeStringify(res))
  
  totalGenesisAccounts = res.totalAccounts
  if (totalGenesisAccounts === 0) return
  
  while (!complete) {
    if (endAccount >= totalGenesisAccounts) {
      endAccount = totalGenesisAccounts
      complete = true
    }
    Logger.mainLogger.debug(`Downloading accounts from ${startAccount} to ${endAccount}`)
    const response = (await queryFromArchivers(
      RequestDataType.ACCOUNT,
      {
        startCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.startCycle,
        endCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.endCycle,
        start: startAccount,
        end: endAccount,
      },
      QUERY_TIMEOUT_MAX
    )) as ArchiverAccountResponse
    
    if (response && response.accounts) {
      Logger.mainLogger.debug(`Downloaded accounts`, response.accounts.length)
      await storeAccountData({ accounts: response.accounts })
      if (response.accounts.length < MAX_ACCOUNTS_PER_REQUEST) {
        complete = true
        Logger.mainLogger.debug('Download completed for accounts')
      }
    } else {
      Logger.mainLogger.debug('Genesis Accounts Query', 'Invalid download response')
    }
    startAccount = endAccount + 1
    endAccount += MAX_ACCOUNTS_PER_REQUEST
  }
  Logger.mainLogger.debug('Sync genesis accounts completed!')
}

export async function syncGenesisTransactionsFromArchiver(): Promise<void> {
  let complete = false
  let startTransaction = 0
  let endTransaction = startTransaction + MAX_ACCOUNTS_PER_REQUEST
  let totalGenesisTransactions = 0
  
  const res = (await queryFromArchivers(
    RequestDataType.RECEIPT,
    {
      startCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.startCycle,
      endCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.endCycle,
      type: 'count',
    },
    QUERY_TIMEOUT_MAX
  )) as ArchiverReceiptCountResponse
  if (config.VERBOSE) Logger.mainLogger.error('Genesis Total Transactions Response', StringUtils.safeStringify(res))
  
  totalGenesisTransactions = res.receipts
  if (totalGenesisTransactions === 0) return
  
  while (!complete) {
    if (endTransaction >= totalGenesisTransactions) {
      endTransaction = totalGenesisTransactions
      complete = true
    }
    Logger.mainLogger.debug(`Downloading transactions from ${startTransaction} to ${endTransaction}`)
    const response = (await queryFromArchivers(
      RequestDataType.RECEIPT,
      {
        startCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.startCycle,
        endCycle: GENESIS_ACCOUNTS_CYCLE_RANGE.endCycle,
        start: startTransaction,
        end: endTransaction,
      },
      QUERY_TIMEOUT_MAX
    )) as ArchiverAccountResponse
    
    if (response && response.transactions) {
      Logger.mainLogger.debug(`Downloaded transactions`, response.transactions.length)
      await storeAccountData({ receipts: response.transactions })
      if (response.transactions.length < MAX_ACCOUNTS_PER_REQUEST) {
        complete = true
        Logger.mainLogger.debug('Download completed for transactions')
      }
    } else {
      Logger.mainLogger.debug('Genesis Transactions Query', 'Invalid download response')
    }
    startTransaction = endTransaction + 1
    endTransaction += MAX_ACCOUNTS_PER_REQUEST
  }
  Logger.mainLogger.debug('Sync genesis transactions completed!')
}

export function calcIncomingTimes(record: P2PTypes.CycleCreatorTypes.CycleRecord): IncomingTimes {
  const SECOND = 1000
  const cycleDuration = record.duration * SECOND
  const quarterDuration = cycleDuration / 4
  const start = record.start * SECOND + cycleDuration
  const startQ1 = start
  const startQ2 = start + quarterDuration
  const startQ3 = start + quarterDuration * 2
  const startQ4 = start + quarterDuration * 3
  const end = start + cycleDuration
  return {
    quarterDuration,
    startQ1,
    startQ2,
    startQ3,
    startQ4,
    end,
  }
}

export const clearDataSenders = async (
  dataSenders: Map<NodeList.ConsensusNodeInfo['publicKey'], any>,
  socketClients: Map<string, any>,
  subsetNodesMapByConsensusRadius: Map<number, NodeList.ConsensusNodeInfo[]>,
  unsubscribeDataSender: (publicKey: string) => Promise<void>
): Promise<void> => {
  for (const [publicKey] of dataSenders) {
    await unsubscribeDataSender(publicKey)
  }
  await Utils.sleep(2000) // Wait for 2s to make sure all dataSenders are unsubscribed
  dataSenders.clear()
  socketClients.clear()
  subsetNodesMapByConsensusRadius.clear()
}

export async function sendLeaveRequest(nodes: NodeList.ConsensusNodeInfo[]): Promise<void> {
  const REQUEST_DATA_TIMEOUT_SECOND = 2 // 2s timeout
  for (const node of nodes) {
    const leaveRequest = {
      publicKey: State.getNodeInfo().publicKey,
      nodeInfo: State.getNodeInfo(),
    }
    const taggedLeaveRequest = Crypto.tag(leaveRequest, node.publicKey)
    Logger.mainLogger.info(`Sending leave request to node ${node.ip}:${node.port}`)
    const response = await P2P.postJson(
      `http://${node.ip}:${node.port}/archiverleave`,
      taggedLeaveRequest,
      REQUEST_DATA_TIMEOUT_SECOND
    )
    Logger.mainLogger.debug('/archiverleave response', response, node.ip + ':' + node.port)
  }
}

export async function joinNetwork(nodeList: NodeList.ConsensusNodeInfo[], isFirstTime: boolean): Promise<boolean> {
  Logger.mainLogger.debug('Joining network...')
  const submitResponse = await submitJoin(nodeList, isFirstTime)
  if (!submitResponse) return false
  const isJoined = await checkJoinStatus(nodeList)
  return isJoined
}

export async function submitJoin(
  nodeList: NodeList.ConsensusNodeInfo[],
  isFirstTime: boolean
): Promise<boolean> {
  const REQUEST_JOIN_TIMEOUT_SECOND = 10 // 10s timeout
  const joinRequest = {
    publicKey: State.getNodeInfo().publicKey,
    nodeInfo: State.getNodeInfo(),
    isFirstTime,
  }
  
  for (const node of nodeList) {
    const taggedJoinRequest = Crypto.tag(joinRequest, node.publicKey)
    Logger.mainLogger.info(`Sending join request to node ${node.ip}:${node.port}`)
    try {
      const response = await P2P.postJson(
        `http://${node.ip}:${node.port}/archiverjoin`,
        taggedJoinRequest,
        REQUEST_JOIN_TIMEOUT_SECOND
      )
      Logger.mainLogger.debug('/archiverjoin response', response, node.ip + ':' + node.port)
      if (response && response.success) return true
    } catch (error) {
      Logger.mainLogger.error(`Failed to send join request to ${node.ip}:${node.port}:`, error)
    }
  }
  return false
}

export async function checkJoinStatus(activeNodes: NodeList.ConsensusNodeInfo[]): Promise<boolean> {
  const CHECK_JOIN_TIMEOUT_SECOND = 10 // 10s timeout
  let isJoined = false
  
  for (const node of activeNodes) {
    try {
      const response = await P2P.getJson(
        `http://${node.ip}:${node.port}/joinedarchiver?publicKey=${State.getNodeInfo().publicKey}`,
        CHECK_JOIN_TIMEOUT_SECOND
      ) as JoinStatus
      
      if (response && response.isJoined) {
        isJoined = true
        break
      }
    } catch (error) {
      Logger.mainLogger.error(`Failed to check join status with ${node.ip}:${node.port}:`, error)
    }
  }
  
  return isJoined
}

export async function sendActiveRequest(): Promise<void> {
  const REQUEST_ACTIVE_TIMEOUT_SECOND = 2 // 2s timeout
  const activeRequest = {
    publicKey: State.getNodeInfo().publicKey,
    nodeInfo: State.getNodeInfo(),
  }
  
  const activeNodes = NodeList.getActiveNodeList()
  for (const node of activeNodes) {
    const taggedActiveRequest = Crypto.tag(activeRequest, node.publicKey)
    Logger.mainLogger.info(`Sending active request to node ${node.ip}:${node.port}`)
    try {
      const response = await P2P.postJson(
        `http://${node.ip}:${node.port}/archiveractive`,
        taggedActiveRequest,
        REQUEST_ACTIVE_TIMEOUT_SECOND
      )
      Logger.mainLogger.debug('/archiveractive response', response, node.ip + ':' + node.port)
    } catch (error) {
      Logger.mainLogger.error(`Failed to send active request to ${node.ip}:${node.port}:`, error)
    }
  }
}

export async function checkActiveStatus(): Promise<boolean> {
  const CHECK_ACTIVE_TIMEOUT_SECOND = 10 // 10s timeout
  const activeNodes = NodeList.getActiveNodeList()
  
  for (const node of activeNodes) {
    try {
      const response = await P2P.getJson(
        `http://${node.ip}:${node.port}/activearchiver?publicKey=${State.getNodeInfo().publicKey}`,
        CHECK_ACTIVE_TIMEOUT_SECOND
      ) as { isActive: boolean }
      
      if (response && response.isActive) {
        return true
      }
    } catch (error) {
      Logger.mainLogger.error(`Failed to check active status with ${node.ip}:${node.port}:`, error)
    }
  }
  
  return false
}

export async function getCycleDuration(): Promise<number> {
  const GET_CYCLE_TIMEOUT_SECOND = 5 // 5s timeout
  const activeNodes = NodeList.getActiveNodeList()
  
  for (const node of activeNodes) {
    try {
      const response = await P2P.getJson(
        `http://${node.ip}:${node.port}/cycleduration`,
        GET_CYCLE_TIMEOUT_SECOND
      ) as { cycleDuration: number }
      
      if (response && response.cycleDuration) {
        return response.cycleDuration
      }
    } catch (error) {
      Logger.mainLogger.error(`Failed to get cycle duration from ${node.ip}:${node.port}:`, error)
    }
  }
  
  // Default cycle duration
  return 60
}

// Export nodesPerConsensusGroup and nodesPerEdge
export let nodesPerConsensusGroup = 0
export let nodesPerEdge = 0