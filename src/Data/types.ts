import { P2P as P2PTypes } from '@shardus/types'
import { Socket as SocketIOSocket } from 'socket.io-client'
import * as NodeList from '../NodeList'
import * as ReceiptDB from '../dbstore/receipts'
import * as OriginalTxDB from '../dbstore/originalTxsData'
import * as State from '../State'

export interface CombinedAccountsData {
  accounts: any[]
  receipts: ReceiptDB.Receipt[]
}

export interface ValidatorColletor {
  nodeId: string
  signedMessage: {
    cycleRecord: {
      counter: number
      mode: string
      archiversAtShutdown?: string[]
    }
  }
}

export interface ValidatorCycle {
  node: string
  cycle: P2PTypes.CycleCreatorTypes.CycleData
}

export interface Signer {
  owner: string
  sig: string
}

export interface DataRequestTypes {
  SUBSCRIBE: 'SUBSCRIBE'
  UNSUBSCRIBE: 'UNSUBSCRIBE'
}

export const DataRequestTypes: DataRequestTypes = {
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
}

export interface subscriptionCycleData extends P2PTypes.CycleCreatorTypes.CycleData {
  certificates?: P2PTypes.CycleCreatorTypes.CycleCert[]
}

export interface DataRequest<T extends P2PTypes.SnapshotTypes.ValidTypes> {
  type: P2PTypes.SnapshotTypes.TypeName<T>
  lastData: P2PTypes.SnapshotTypes.TypeIndex<T>
}

export interface DataResponse<T> {
  publicKey?: NodeList.ConsensusNodeInfo['publicKey']
  recipient: NodeList.ConsensusNodeInfo['publicKey']
  responses: { [name: string]: T }
}

export interface StoredReceiptObject {
  receipts: ReceiptDB.Receipt[]
  success: boolean
}

export interface CountResponse {
  receipts?: ArchiverReceiptCountResponse
  originalTxs?: ArchiverOriginalTxsCountResponse
  cycles?: number
  accounts?: number
}

export interface ArchiverAccountResponse {
  accounts: any[]
  transactions?: any[]
  receipts?: any[]
  totalAccounts?: number
}

export interface ArchiverCycleResponse {
  cycleInfo: P2PTypes.CycleCreatorTypes.CycleData[]
}

export interface ArchiverReceiptResponse {
  receipts: ReceiptDB.Receipt[] | ReceiptDB.ReceiptCount[]
}

export interface ArchiverOriginalTxResponse {
  originalTxs: OriginalTxDB.OriginalTxData[] | OriginalTxDB.OriginalTxDataCount[]
}

export interface ArchiverReceiptCountResponse {
  countByCycles: { cycle: number; count: number }[]
  startCycle: number
  endCycle: number
}

export interface ArchiverOriginalTxsCountResponse {
  countByCycles: { cycle: number; count: number }[]
  startCycle: number
  endCycle: number
}

export interface ArchiverTotalDataResponse {
  totalReceipts: number
  totalCycles: number
  totalAccounts: number
  totalOriginalTxs: number
}

// Re-export RequestDataType from API.ts to avoid duplication
export { RequestDataType } from '../API'

export interface RequestDataCountType {
  type: 'tally'
}

export interface DataSender {
  nodeInfo: NodeList.ConsensusNodeInfo
  types: (keyof typeof P2PTypes.SnapshotTypes.TypeNames)[]
  contactTimeout?: NodeJS.Timeout | null
  replaceTimeout?: NodeJS.Timeout | null
}

export interface CompareResponse {
  success: boolean
  matchedCycle: number
}

export interface ArchiverWithRetries {
  archiver: State.ArchiverNodeInfo
  retriesLeft: number
}