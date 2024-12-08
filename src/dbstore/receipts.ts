import { Signature } from '@shardus/crypto-utils'
import { P2P } from '@shardus/types'
import * as db from './sqlite3storage'
import { receiptDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString , SerializeToJsonString} from '../utils/serialization'
import { AccountsCopy } from '../dbstore/accounts'

// const superjson =  require('superjson')
export type Proposal = {
  applied: boolean
  cant_preApply: boolean
  accountIDs: string[]
  beforeStateHashes: string[]
  afterStateHashes: string[]
  appReceiptDataHash: string
  txid: string
}

export type SignedReceipt = {
  proposal: Proposal
  proposalHash: string // Redundant, may go
  signaturePack: Signature[]
  voteOffsets: number[]
  sign?: Signature
}

/**
 * ArchiverReceipt is the full data (shardusReceipt + appReceiptData + accounts ) of a tx that is sent to the archiver
 */
export interface ArchiverReceipt {
  tx: {
    originalTxData: object
    txId: string
    timestamp: number
  }
  cycle: number
  signedReceipt: SignedReceipt | P2P.GlobalAccountsTypes.GlobalTxReceipt
  afterStates?: AccountsCopy[]
  beforeStates?: AccountsCopy[]
  appReceiptData:object & { accountId?: string; data: object; [key: string]: any }
  executionShardKey: string
  globalModification: boolean
}

export type AppliedVote = {
  txid: string
  transaction_result: boolean
  account_id: string[]
  //if we add hash state before then we could prove a dishonest apply vote
  //have to consider software version
  account_state_hash_after: string[]
  account_state_hash_before: string[]
  cant_apply: boolean // indicates that the preapply could not give a pass or fail
  node_id: string // record the node that is making this vote.. todo could look this up from the sig later
  sign: Signature
  // hash of app data
  app_data_hash: string
}

/**
 * a space efficent version of the receipt
 *
 * use TellSignedVoteHash to send just signatures of the vote hash (votes must have a deterministic sort now)
 * never have to send or request votes individually, should be able to rely on existing receipt send/request
 * for nodes that match what is required.
 */
// export type AppliedReceipt2 = {
//   txid: string
//   result: boolean
//   //single copy of vote
//   appliedVote: AppliedVote
//   confirmOrChallenge: ConfirmOrChallengeMessage
//   //all signatures for this vote
//   signatures: [Signature] //Could have all signatures or best N.  (lowest signature value?)
//   // hash of app data
//   app_data_hash: string
// }

export type ConfirmOrChallengeMessage = {
  message: string
  nodeId: string
  appliedVote: AppliedVote
  sign: Signature
}
export interface Receipt extends ArchiverReceipt {
  receiptId: string
  timestamp: number
  applyTimestamp: number
}

type DbReceipt = Receipt & {
  tx: string
  beforeStates: string
  afterStates: string
  appReceiptData: string
  signedReceipt: string
}

export interface ReceiptCount {
  cycle: number
  receiptCount: number
}

type DbReceiptCount = ReceiptCount & {
  'COUNT(*)': number
}

export async function insertReceipt(receipt: Receipt): Promise<void> {
  try {
    // Define the columns to match the database schema
    const columns = [
      'receiptId',
      'tx',
      'cycle',
      'applyTimestamp',
      'timestamp',
      'signedReceipt',
      'afterStates',
      'beforeStates',
      'appReceiptData',
      'executionShardKey',
      'globalModification',
    ];

    // Create placeholders for the values
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const sql = `INSERT OR REPLACE INTO receipts (${columns.join(', ')}) VALUES ${placeholders}`;

    // Map the receipt object to match the columns
    const values = columns.map((column) =>
      typeof receipt[column] === 'object'
        ? SerializeToJsonString(receipt[column]) // Serialize objects to JSON strings
        : receipt[column]
    );

    // Execute the query directly
    await db.run(receiptDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Receipt', receipt.receiptId);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert Receipt or it is already stored in the database',
      receipt.receiptId
    );
  }
}

export async function bulkInsertReceipts(receipts: Receipt[]): Promise<void> {

  try {

    // Define the table columns based on schema
    const columns = [
      'receiptId',
      'tx',
      'cycle',
      'applyTimestamp',
      'timestamp',
      'signedReceipt',
      'afterStates',
      'beforeStates',
      'appReceiptData',
      'executionShardKey',
      'globalModification',
    ];

    // Construct the SQL query with placeholders
    const placeholders = receipts.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO receipts (${columns.join(', ')}) VALUES ${placeholders}`;

    // Flatten the `receipts` array into a single list of values
    const values = receipts.flatMap((receipt) =>
      columns.map((column) =>
        typeof receipt[column] === 'object'
          ? SerializeToJsonString(receipt[column]) // Serialize objects to JSON
          : receipt[column]
      )
    );

    // Execute the query in a single call
    await db.run(receiptDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Receipts', receipts.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert Receipts', receipts.length);
  }
}




export async function queryReceiptByReceiptId(receiptId: string, timestamp = 0): Promise<Receipt> {
  try {
    const sql = `SELECT * FROM receipts WHERE receiptId=?` + (timestamp ? ` AND timestamp=?` : '')
    const value = timestamp ? [receiptId, timestamp] : [receiptId]
    const receipt = (await db.get(receiptDatabase, sql, value)) as DbReceipt
    if (receipt) deserializeDbReceipt(receipt)
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt receiptId', receipt)
    }
    return receipt
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryLatestReceipts(count: number): Promise<Receipt[]> {
  if (!Number.isInteger(count)) {
    Logger.mainLogger.error('queryLatestReceipts - Invalid count value')
    return null
  }
  try {
    const sql = `SELECT * FROM receipts ORDER BY cycle DESC, timestamp DESC LIMIT ${count ? count : 100}`
    const receipts = (await db.all(receiptDatabase, sql)) as DbReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DbReceipt) => {
        deserializeDbReceipt(receipt)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt latest', receipts)
    }
    return receipts
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryReceipts(skip = 0, limit = 10000): Promise<Receipt[]> {
  let receipts: Receipt[] = []
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryReceipts - Invalid skip or limit')
    return receipts
  }
  try {
    const sql = `SELECT * FROM receipts ORDER BY cycle ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    receipts = (await db.all(receiptDatabase, sql)) as DbReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DbReceipt) => {
        deserializeDbReceipt(receipt)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt receipts', receipts ? receipts.length : receipts, 'skip', skip)
  }
  return receipts
}

export async function queryReceiptCount(): Promise<number> {
  let receipts
  try {
    const sql = `SELECT COUNT(*) FROM receipts`
    receipts = await db.get(receiptDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count', receipts)
  }
  if (receipts) receipts = receipts['COUNT(*)']
  else receipts = 0
  return receipts
}

export async function queryReceiptCountByCycles(start: number, end: number): Promise<ReceiptCount[]> {
  let receiptsCount: ReceiptCount[]
  let dbReceiptsCount: DbReceiptCount[]
  try {
    const sql = `SELECT cycle, COUNT(*) FROM receipts GROUP BY cycle HAVING cycle BETWEEN ? AND ? ORDER BY cycle ASC`
    dbReceiptsCount = (await db.all(receiptDatabase, sql, [start, end])) as DbReceiptCount[]
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count by cycle', dbReceiptsCount)
  }
  if (dbReceiptsCount.length > 0) {
    receiptsCount = dbReceiptsCount.map((dbReceipt) => {
      return {
        cycle: dbReceipt.cycle,
        receiptCount: dbReceipt['COUNT(*)'],
      }
    })
  }
  return receiptsCount
}

export async function queryReceiptCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  let receipts
  try {
    const sql = `SELECT COUNT(*) FROM receipts WHERE cycle BETWEEN ? AND ?`
    receipts = await db.get(receiptDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Receipt count between cycles', receipts)
  }
  if (receipts) receipts = receipts['COUNT(*)']
  else receipts = 0
  return receipts
}

export async function queryReceiptsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Receipt[]> {
  let receipts: Receipt[] = []
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryReceiptsBetweenCycles - Invalid skip or limit')
    return receipts
  }
  try {
    const sql = `SELECT * FROM receipts WHERE cycle BETWEEN ? AND ? ORDER BY cycle ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    receipts = (await db.all(receiptDatabase, sql, [startCycleNumber, endCycleNumber])) as DbReceipt[]
    if (receipts.length > 0) {
      receipts.forEach((receipt: DbReceipt) => {
        deserializeDbReceipt(receipt)
      })
    }
  } catch (e) {
    console.log(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Receipt receipts between cycles',
      receipts ? receipts.length : receipts,
      'skip',
      skip
    )
  }
  return receipts
}

function deserializeDbReceipt(receipt: DbReceipt): void {
  if (receipt.tx) receipt.tx = DeSerializeFromJsonString(receipt.tx)
  if (receipt.beforeStates) receipt.beforeStates = DeSerializeFromJsonString(receipt.beforeStates)
  if (receipt.afterStates) receipt.afterStates = DeSerializeFromJsonString(receipt.afterStates)
  if (receipt.appReceiptData) receipt.appReceiptData = DeSerializeFromJsonString(receipt.appReceiptData)
  if (receipt.signedReceipt) receipt.signedReceipt = DeSerializeFromJsonString(receipt.signedReceipt)
  // globalModification is stored as 0 or 1 in the database, convert it to boolean
  receipt.globalModification = (receipt.globalModification as unknown as number) === 1
}
