// import { Signature } from 'shardus-crypto-types'
import * as db from './sqlite3storage'
import { originalTxDataDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'
import { getPreparedStmt } from './prepared-statements/preparedStmtManager'

export interface OriginalTxData {
  txId: string
  timestamp: number
  cycle: number
  originalTxData: object // eslint-disable-line @typescript-eslint/no-explicit-any
  // sign: Signature
}

type DbOriginalTxData = OriginalTxData & {
  originalTxData: string
  // sign: string
}

export interface OriginalTxDataCount {
  cycle: number
  originalTxDataCount: number
}

type DbOriginalTxDataCount = OriginalTxDataCount & {
  'COUNT(*)': number
}

export async function insertOriginalTxData(originalTxData: OriginalTxData): Promise<void> {
  try {
    const stmt = getPreparedStmt('insertOriginalTxData');
    const values = [
      originalTxData.txId,
      originalTxData.timestamp,
      originalTxData.cycle,
      SerializeToJsonString(originalTxData.originalTxData),
    ];
    
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted OriginalTxData', originalTxData.txId);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert OriginalTxData or it is already stored in the database',
      originalTxData.txId
    );
  }
}

export async function bulkInsertOriginalTxsData(originalTxsData: OriginalTxData[]): Promise<void> {

  try {
    
    // Define the table columns
    const columns = ['txId', 'timestamp', 'cycle', 'originalTxData'];

    // Construct the SQL query for bulk insertion with all placeholders
    const placeholders = originalTxsData.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO originalTxsData (${columns.join(', ')}) VALUES ${placeholders}`;

    // Flatten the `originalTxsData` array into a single list of values
    const values = originalTxsData.flatMap((txData) =>
      columns.map((column) =>
        typeof txData[column] === 'object'
          ? SerializeToJsonString(txData[column]) // Serialize objects to JSON
          : txData[column]
      )
    );

    // Execute the single query for all originalTxsData
    await db.run(originalTxDataDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted OriginalTxsData', originalTxsData.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert OriginalTxsData', originalTxsData.length);
  }
}

export async function queryOriginalTxDataCount(startCycle?: number, endCycle?: number): Promise<number> {
  try {
    let stmt;
    const values: number[] = [];

    if (startCycle !== undefined && endCycle !== undefined) {
      stmt = getPreparedStmt('queryOriginalTxDataCountBetweenCycles');
      values.push(startCycle, endCycle);
    } else {
      stmt = getPreparedStmt('queryOriginalTxDataCount');
    }

    const result = await new Promise<{ 'COUNT(*)': number }>((resolve, reject) => {
      stmt.get(values, (err, row) => {
        if (err) reject(err);
        else resolve(row as { 'COUNT(*)': number });
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('OriginalTxData count', result);
    }

    return result ? result['COUNT(*)'] || 0 : 0;
  } catch (e) {
    Logger.mainLogger.error(e);
    return 0;
  }
}

export async function queryOriginalTxsData(
  skip = 0,
  limit = 10,
  startCycle?: number,
  endCycle?: number
): Promise<OriginalTxData[]> {
  let originalTxsData: DbOriginalTxData[] = [];

  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryOriginalTxsData - Invalid skip or limit');
    return originalTxsData;
  }

  try {
    let stmt;
    const values: number[] = [limit, skip];

    if (startCycle !== undefined && endCycle !== undefined) {
      stmt = getPreparedStmt('queryOriginalTxsDataByCycles');
      values.unshift(startCycle, endCycle); // Add startCycle and endCycle to the values
    } else {
      stmt = getPreparedStmt('queryOriginalTxsData');
    }

    originalTxsData = await new Promise<DbOriginalTxData[]>((resolve, reject) => {
      stmt.all(values, (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbOriginalTxData[]);
      });
    });

    originalTxsData.forEach((originalTxData: DbOriginalTxData) => {
      if (originalTxData.originalTxData) {
        originalTxData.originalTxData = DeSerializeFromJsonString(originalTxData.originalTxData);
      }
    });
  } catch (e) {
    Logger.mainLogger.error(e);
  }

  if (config.VERBOSE) {
    Logger.mainLogger.debug('OriginalTxData originalTxsData', originalTxsData);
  }

  return originalTxsData;
}

export async function queryOriginalTxDataByTxId(
  txId: string,
  timestamp = 0
): Promise<OriginalTxData | null> {
  try {
    let stmt;
    const values: (string | number)[] = [txId];

    if (timestamp) {
      stmt = getPreparedStmt('queryOriginalTxDataByTxIdWithTimestamp');
      values.push(timestamp);
    } else {
      stmt = getPreparedStmt('queryOriginalTxDataByTxId');
    }

    const originalTxData = await new Promise<DbOriginalTxData | null>((resolve, reject) => {
      stmt.get(values, (err, row) => {
        if (err) reject(err);
        else resolve(row as DbOriginalTxData | null);
      });
    });

    if (originalTxData) {
      if (originalTxData.originalTxData) {
        originalTxData.originalTxData = DeSerializeFromJsonString(originalTxData.originalTxData);
      }
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('OriginalTxData txId', originalTxData);
    }

    return originalTxData as OriginalTxData | null;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}


export async function queryOriginalTxDataCountByCycles(
  start: number,
  end: number
): Promise<OriginalTxDataCount[]> {
  const originalTxsDataCount: OriginalTxDataCount[] = [];
  try {
    const stmt = getPreparedStmt('queryOriginalTxDataCountByCycles');

    const dbOriginalTxsDataCount = await new Promise<DbOriginalTxDataCount[]>((resolve, reject) => {
      stmt.all([start, end], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbOriginalTxDataCount[]);
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('OriginalTxData count by cycle', dbOriginalTxsDataCount);
    }

    if (dbOriginalTxsDataCount.length > 0) {
      for (const dbRecord of dbOriginalTxsDataCount) {
        originalTxsDataCount.push({
          cycle: dbRecord.cycle,
          originalTxDataCount: dbRecord['COUNT(*)'], // Preserve original logic
        });
      }
    }
  } catch (e) {
    Logger.mainLogger.error(e);
  }

  return originalTxsDataCount;
}

export async function queryLatestOriginalTxs(count: number): Promise<OriginalTxData[] | null> {
  if (!Number.isInteger(count)) {
    Logger.mainLogger.error('queryLatestOriginalTxs - Invalid count value');
    return null;
  }

  try {
    const stmt = getPreparedStmt('queryLatestOriginalTxs');
    const originalTxsData = await new Promise<DbOriginalTxData[]>((resolve, reject) => {
      stmt.all([count], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbOriginalTxData[]);
      });
    });

    if (originalTxsData.length > 0) {
      originalTxsData.forEach((tx: DbOriginalTxData) => {
        if (tx.originalTxData) {
          tx.originalTxData = DeSerializeFromJsonString(tx.originalTxData);
        }
      });
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Latest Original-Tx: ', originalTxsData);
    }

    return originalTxsData;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}
