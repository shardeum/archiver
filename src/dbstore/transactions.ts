// import { Signature } from 'shardus-crypto-types'
import * as db from './sqlite3storage'
import { transactionDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'
import { getPreparedStmt } from './prepared-statements/preparedStmtManager'
/**
 * Transaction is for storing dapp receipt (eg. evm receipt in shardeum)
 * If there is no dapp receipt, we can skip storing in transactions table and use receipts table
 */
export interface Transaction {
  txId: string
  appReceiptId?: string // Dapp receipt id (eg. txhash of evm receipt in shardeum)
  timestamp: number
  cycleNumber: number
  data: unknown & { txId?: string; appReceiptId?: string }
  originalTxData: object
}

type DbTransaction = Transaction & {
  data: string
  originalTxData: string
  // sign: string
}

export async function insertTransaction(transaction: Transaction): Promise<void> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('insertTransaction');

    // Map the `transaction` object to match the columns
    const values = [
      transaction.txId,
      transaction.appReceiptId,
      transaction.timestamp,
      transaction.cycleNumber,
      SerializeToJsonString(transaction.data),
      SerializeToJsonString(transaction.originalTxData),
    ];

    // Execute the prepared statement
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Transaction', transaction.txId);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert Transaction or it is already stored in the database',
      transaction.txId
    );
  }
}


export async function bulkInsertTransactions(transactions: Transaction[]): Promise<void> {

  try {

    // Define the table columns based on schema
    const columns = ['txId', 'appReceiptId', 'timestamp', 'cycleNumber', 'data', 'originalTxData'];

    // Construct the SQL query for bulk insertion with all placeholders
    const placeholders = transactions.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO transactions (${columns.join(', ')}) VALUES ${placeholders}`;

    // Flatten the `transactions` array into a single list of values
    const values = transactions.flatMap((transaction) =>
      columns.map((column) =>
        typeof transaction[column] === 'object'
          ? SerializeToJsonString(transaction[column]) // Serialize objects to JSON
          : transaction[column]
      )
    );

    // Execute the single query for all transactions
    await db.run(transactionDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Transactions', transactions.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert Transactions', transactions.length);
  }
}

export async function queryTransactionByTxId(txId: string): Promise<Transaction> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryTransactionByTxId');

    // Execute the prepared statement
    const transaction = await new Promise<DbTransaction>((resolve, reject) => {
      stmt.get([txId], (err, row) => {
        if (err) reject(err);
        else resolve(row as DbTransaction);
      });
    });

    // Deserialize JSON fields if the transaction exists
    if (transaction) {
      if (transaction.data) {
        transaction.data = DeSerializeFromJsonString(transaction.data);
      }
      if (transaction.originalTxData) {
        transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData);
      }
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction txId', transaction);
    }

    return transaction;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}


export async function queryLatestTransactions(count: number): Promise<Transaction[] | null> {
  if (!Number.isInteger(count) || count <= 0) {
    Logger.mainLogger.error('queryLatestTransactions - Invalid count value');
    return null;
  }

  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryLatestTransactions');

    // Execute the prepared statement
    const transactions = await new Promise<DbTransaction[]>((resolve, reject) => {
      stmt.all([count], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbTransaction[]);
      });
    });

    // Deserialize JSON fields for each transaction
    if (transactions.length > 0) {
      transactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) {
          transaction.data = DeSerializeFromJsonString(transaction.data);
        }
        if (transaction.originalTxData) {
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData);
        }
      });
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction latest', transactions);
    }

    return transactions;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}


export async function queryTransactions(skip = 0, limit = 10000): Promise<Transaction[] | null> {
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryTransactions - Invalid skip or limit');
    return null;
  }

  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryTransactions');

    // Execute the prepared statement
    const transactions = await new Promise<DbTransaction[]>((resolve, reject) => {
      stmt.all([limit, skip], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbTransaction[]);
      });
    });

    // Deserialize JSON fields for each transaction
    if (transactions.length > 0) {
      transactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) {
          transaction.data = DeSerializeFromJsonString(transaction.data);
        }
        if (transaction.originalTxData) {
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData);
        }
      });
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        'Transaction transactions',
        transactions ? transactions.length : transactions,
        'skip',
        skip
      );
    }

    return transactions;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}

export async function queryTransactionCount(): Promise<number> {
  let transactions;
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryTransactionCount');

    // Execute the prepared statement
    transactions = await new Promise<{ 'COUNT(*)': number }>((resolve, reject) => {
      stmt.get([], (err, row) => {
        if (err) reject(err);
        else resolve(row as { 'COUNT(*)': number });
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction count', transactions);
    }
  } catch (e) {
    Logger.mainLogger.error(e);
  }

  // Preserve the original logic for accessing 'COUNT(*)'
  return transactions ? transactions['COUNT(*)'] : 0;
}

export async function queryTransactionCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryTransactionCountBetweenCycles');

    // Execute the prepared statement
    const transactions = await new Promise<{ 'COUNT(*)': number }>((resolve, reject) => {
      stmt.get([startCycleNumber, endCycleNumber], (err, row) => {
        if (err) reject(err);
        else resolve(row as { 'COUNT(*)': number });
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction count between cycles', transactions);
    }

    // Preserve original logic for accessing 'COUNT(*)'
    return transactions ? transactions['COUNT(*)'] : 0;
  } catch (e) {
    Logger.mainLogger.error(e);
    return 0; // Return 0 in case of an error
  }
}

export async function queryTransactionsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Transaction[]> {
  let transactions: Transaction[] = [];

  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryTransactionsBetweenCycles - Invalid skip or limit value');
    return null;
  }

  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('queryTransactionsBetweenCycles');

    // Execute the prepared statement
    const dbTransactions = await new Promise<DbTransaction[]>((resolve, reject) => {
      stmt.all([startCycleNumber, endCycleNumber, limit, skip], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbTransaction[]);
      });
    });

    if (dbTransactions.length > 0) {
      dbTransactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data);
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData);
      });
      transactions = dbTransactions;
    }
  } catch (e) {
    Logger.mainLogger.error(e);
  }

  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Transaction transactions between cycles',
      transactions ? transactions.length : transactions,
      'skip',
      skip
    );
  }

  return transactions;
}
