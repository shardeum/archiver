import * as db from './sqlite3storage'
import { processedTxDatabase } from './'
import * as Logger from '../Logger'
import { config } from '../Config'

// const superjson =  require('superjson')
/**
 * ProcessedTransaction stores transactions which have a receipt
 */
export interface ProcessedTransaction {
  txId: string
  cycle: number
  txTimestamp: number
  applyTimestamp: number
}

export async function insertProcessedTx(processedTx: ProcessedTransaction): Promise<void> {

  try {

    // Define the table columns based on schema
    const columns = ['txId', 'cycle', 'txTimestamp', 'applyTimestamp'];

    // Construct the SQL query with placeholders
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const sql = `
      INSERT INTO processedTxs (${columns.join(', ')}) VALUES ${placeholders}
      ON CONFLICT (txId) DO UPDATE SET 
      cycle = excluded.cycle, 
      txTimestamp = excluded.txTimestamp, 
      applyTimestamp = excluded.applyTimestamp
    `;

    // Map the `processedTx` object to match the columns
    const values = columns.map((column) => processedTx[column]);

    // Execute the query directly (single-row insert/update)
    await db.run(processedTxDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted ProcessedTransaction', processedTx.txId);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert ProcessedTransaction or it is already stored in the database',
      processedTx.txId
    );
  }
}



export async function bulkInsertProcessedTxs(processedTxs: ProcessedTransaction[]): Promise<void> {

  try {

    // Define the table columns based on schema
    const columns = ['txId', 'cycle', 'txTimestamp', 'applyTimestamp'];

    // Construct the SQL query for bulk insertion
    const placeholders = processedTxs.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `
      INSERT INTO processedTxs (${columns.join(', ')}) VALUES ${placeholders}
      ON CONFLICT (txId) DO UPDATE SET 
      cycle = excluded.cycle, 
      txTimestamp = excluded.txTimestamp, 
      applyTimestamp = excluded.applyTimestamp
    `;

    // Flatten the `processedTxs` array into a single list of values
    const values = processedTxs.flatMap((tx) => 
      columns.map((column) => tx[column])
    );

    // Execute the single query
    await db.run(processedTxDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted ProcessedTransactions', processedTxs.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert ProcessedTransactions', processedTxs.length);
  }
}



export async function queryProcessedTxByTxId(txId: string): Promise<ProcessedTransaction> {
  try {
    const sql = `SELECT * FROM processedTxs WHERE txId=?`
    const processedTx = (await db.get(processedTxDatabase, sql, [txId])) as ProcessedTransaction
    if (config.VERBOSE) {
      Logger.mainLogger.debug('ProcessedTransaction txId', processedTx)
    }
    return processedTx
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryProcessedTxsByCycleNumber(cycleNumber: number): Promise<ProcessedTransaction[]> {
  try {
    const sql = `SELECT * FROM processedTxs WHERE cycle=?`
    const processedTxs = (await db.all(processedTxDatabase, sql, [cycleNumber])) as ProcessedTransaction[]
    if (config.VERBOSE) {
      Logger.mainLogger.debug(`ProcessedTransactions for cycle: ${cycleNumber} ${processedTxs.length}`)
    }
    return processedTxs
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function querySortedTxsBetweenCycleRange(
  startCycle: number,
  endCycle: number
): Promise<string[]> {
  try {
    const sql = `SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?`
    const txIdsArray = (await db.all(processedTxDatabase, sql, [startCycle, endCycle])) as { txId: string }[]
    if (config.VERBOSE) {
      Logger.mainLogger.debug(`txIds between ${startCycle} and ${endCycle} are ${txIdsArray ? txIdsArray.length : 0}`)
    }

    if (!txIdsArray) {
      return []
    }

    const txIds = txIdsArray.map((tx) => tx.txId)
    txIds.sort()
    return txIds
  } catch (e) {
    Logger.mainLogger.error('error in querySortedTxsBetweenCycleRange: ', e)
    return null
  }
}
