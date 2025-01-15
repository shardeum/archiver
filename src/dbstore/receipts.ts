import { Signature } from '@shardeum-foundation/lib-crypto-utils'
import { P2P } from '@shardeum-foundation/lib-types'
import * as db from './sqlite3storage'
import { receiptDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString , SerializeToJsonString} from '../utils/serialization'
import { AccountsCopy } from '../dbstore/accounts'
import { getPreparedStmt } from './prepared-statements/preparedStmtManager';

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
    const stmt = getPreparedStmt('insertReceipt');
    const values = [
      receipt.receiptId,
      SerializeToJsonString(receipt.tx),
      receipt.cycle,
      receipt.applyTimestamp,
      receipt.timestamp,
      SerializeToJsonString(receipt.signedReceipt),
      SerializeToJsonString(receipt.afterStates),
      SerializeToJsonString(receipt.beforeStates),
      SerializeToJsonString(receipt.appReceiptData),
      receipt.executionShardKey,
      receipt.globalModification,
    ];
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Receipt', receipt.receiptId);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert Receipt in the Database',
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
    const stmt = timestamp
      ? getPreparedStmt('queryReceiptByIdAndTimestamp')
      : getPreparedStmt('queryReceiptById');
    const values = timestamp ? [receiptId, timestamp] : [receiptId];
    const receipt = await new Promise<DbReceipt>((resolve, reject) => {
      stmt.get(values, (err, row) => {
        if (err) reject(err);
        else resolve(row as DbReceipt);
      });
    });

    if (receipt) deserializeDbReceipt(receipt);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt receiptId', receipt);
    }

    return receipt;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}


export async function queryLatestReceipts(count: number): Promise<Receipt[]> {
  if (!Number.isInteger(count) || count <= 0) {
    Logger.mainLogger.error('queryLatestReceipts - Invalid count value');
    return [];
  }
  try {
    const stmt = getPreparedStmt('queryLatestReceipts');
    const receipts = await new Promise<DbReceipt[]>((resolve, reject) => {
      stmt.all([count], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbReceipt[]);
      });
    });

    if (receipts.length > 0) {
      receipts.forEach((receipt: DbReceipt) => deserializeDbReceipt(receipt));
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt latest', receipts);
    }

    return receipts;
  } catch (e) {
    Logger.mainLogger.error(e);
    return [];
  }
}


export async function queryReceipts(skip = 0, limit = 10000): Promise<Receipt[]> {
  if (!Number.isInteger(skip) || !Number.isInteger(limit) || skip < 0 || limit <= 0) {
    Logger.mainLogger.error('queryReceipts - Invalid skip or limit');
    return [];
  }

  try {
    const stmt = getPreparedStmt('queryReceipts');
    const receipts = await new Promise<DbReceipt[]>((resolve, reject) => {
      stmt.all([limit, skip], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbReceipt[]);
      });
    });

    if (receipts.length > 0) {
      receipts.forEach((receipt: DbReceipt) => deserializeDbReceipt(receipt));
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt receipts', receipts.length, 'skip', skip);
    }

    return receipts;
  } catch (e) {
    Logger.mainLogger.error(e);
    return [];
  }
}


export async function queryReceiptCount(): Promise<number> {
  try {
    const stmt = getPreparedStmt('queryReceiptCount');
    const result = await new Promise<{ count: number }>((resolve, reject) => {
      stmt.get([], (err, row) => {
        if (err) reject(err);
        else resolve(row as { count: number });
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt count', result);
    }

    return result?.count || 0;
  } catch (e) {
    Logger.mainLogger.error(e);
    return 0;
  }
}

export async function queryReceiptCountByCycles(start: number, end: number): Promise<ReceiptCount[]> {
  try {
    const stmt = getPreparedStmt('queryReceiptCountByCycles');
    const dbReceiptsCount = await new Promise<DbReceiptCount[]>((resolve, reject) => {
      stmt.all([start, end], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbReceiptCount[]);
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt count by cycle', dbReceiptsCount);
    }

    // Map the database rows into the `ReceiptCount` structure
    return dbReceiptsCount.map((dbReceipt) => ({
      cycle: dbReceipt.cycle,
      receiptCount: dbReceipt['COUNT(*)'], // Access the count field
    }));
  } catch (e) {
    Logger.mainLogger.error(e);
    return [];
  }
}

export async function queryReceiptCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  try {
    const stmt = getPreparedStmt('queryReceiptCountBetweenCycles');
    const result = await new Promise<{ 'COUNT(*)': number }>((resolve, reject) => {
      stmt.get([startCycleNumber, endCycleNumber], (err, row) => {
        if (err) reject(err);
        else resolve(row as { 'COUNT(*)': number });
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Receipt count between cycles', result);
    }

    return result ? result['COUNT(*)'] : 0; // Access 'COUNT(*)' explicitly
  } catch (e) {
    Logger.mainLogger.error(e);
    return 0; // Return 0 in case of an error
  }
}


export async function queryReceiptsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Receipt[]> {
  const receipts: Receipt[] = [];
  
  // Validate input
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryReceiptsBetweenCycles - Invalid skip or limit');
    return receipts;
  }

  try {
    const stmt = getPreparedStmt('queryReceiptsBetweenCycles');
    const dbReceipts = await new Promise<DbReceipt[]>((resolve, reject) => {
      stmt.all([startCycleNumber, endCycleNumber, limit, skip], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbReceipt[]);
      });
    });

    if (dbReceipts.length > 0) {
      dbReceipts.forEach((receipt: DbReceipt) => {
        deserializeDbReceipt(receipt);
        receipts.push(receipt as Receipt);
      });
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        'Receipt receipts between cycles',
        receipts.length,
        'skip',
        skip
      );
    }
  } catch (e) {
    Logger.mainLogger.error(e);
  }

  return receipts;
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