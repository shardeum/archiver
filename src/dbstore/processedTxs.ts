import * as db from './sqlite3storage'
import { processedTxDatabase } from './'
import * as Logger from '../Logger'
import { config } from '../Config'
import { getPreparedStmt } from './prepared-statements/preparedStmtManager'

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
    const stmt = getPreparedStmt('insertProcessedTx');
    const values = [
      processedTx.txId,
      processedTx.cycle,
      processedTx.txTimestamp,
      processedTx.applyTimestamp,
    ];

    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

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

export async function queryProcessedTxByTxId(txId: string): Promise<ProcessedTransaction | null> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryProcessedTxByTxId');

    // Execute the prepared statement
    const processedTx = await new Promise<ProcessedTransaction | null>((resolve, reject) => {
      stmt.get([txId], (err, row) => {
        if (err) reject(err);
        else resolve(row as ProcessedTransaction | null);
      });
    });

    // Log if verbose mode is enabled
    if (config.VERBOSE) {
      Logger.mainLogger.debug('ProcessedTransaction txId', processedTx);
    }

    return processedTx;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}

export async function queryProcessedTxsByCycleNumber(
  cycleNumber: number
): Promise<ProcessedTransaction[] | null> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryProcessedTxsByCycleNumber');

    // Execute the prepared statement
    const processedTxs = await new Promise<ProcessedTransaction[]>((resolve, reject) => {
      stmt.all([cycleNumber], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as ProcessedTransaction[]);
      });
    });

    // Log if verbose mode is enabled
    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        `ProcessedTransactions for cycle: ${cycleNumber}, count: ${processedTxs.length}`
      );
    }

    return processedTxs;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}

export async function querySortedTxsBetweenCycleRange(
  startCycle: number,
  endCycle: number
): Promise<string[] | null> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('querySortedTxsBetweenCycleRange');

    // Execute the prepared statement
    const txIdsArray = await new Promise<{ txId: string }[]>((resolve, reject) => {
      stmt.all([startCycle, endCycle], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as { txId: string }[]);
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        `txIds between ${startCycle} and ${endCycle} are ${txIdsArray ? txIdsArray.length : 0}`
      );
    }

    if (!txIdsArray || txIdsArray.length === 0) {
      return [];
    }

    // Extract and sort transaction IDs
    const txIds = txIdsArray.map((tx) => tx.txId);
    txIds.sort();
    return txIds;
  } catch (e) {
    Logger.mainLogger.error('Error in querySortedTxsBetweenCycleRange:', e);
    return null;
  }
}