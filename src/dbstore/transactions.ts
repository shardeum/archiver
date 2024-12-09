// import { Signature } from 'shardus-crypto-types'
import * as db from './sqlite3storage'
import { transactionDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'

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
    // Define the table columns based on schema
    const columns = ['txId', 'appReceiptId', 'timestamp', 'cycleNumber', 'data', 'originalTxData'];

    // Construct the SQL query with placeholders
    const placeholders = `(${columns.map(() => '?').join(', ')})`;
    const sql = `INSERT OR REPLACE INTO transactions (${columns.join(', ')}) VALUES ${placeholders}`;

    // Map the `transaction` object to match the columns
    const values = columns.map((column) =>
      typeof transaction[column] === 'object'
        ? SerializeToJsonString(transaction[column]) // Serialize objects to JSON
        : transaction[column]
    );

    // Execute the query directly
    await db.run(transactionDatabase, sql, values);

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
    const sql = `SELECT * FROM transactions WHERE txId=?`
    const transaction = (await db.get(transactionDatabase, sql, [txId])) as DbTransaction // TODO: confirm structure of object from db
    if (transaction) {
      if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
      if (transaction.originalTxData)
        transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction txId', transaction)
    }
    return transaction
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryTransactionByAccountId(accountId: string): Promise<Transaction> {
  try {
    const sql = `SELECT * FROM transactions WHERE accountId=?`
    const transaction = (await db.get(transactionDatabase, sql, [accountId])) as DbTransaction // TODO: confirm structure of object from db
    if (transaction) {
      if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
      if (transaction.originalTxData)
        transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction accountId', transaction)
    }
    return transaction
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryLatestTransactions(count: number): Promise<Transaction[]> {
  if (!Number.isInteger(count)) {
    Logger.mainLogger.error('queryLatestTransactions - Invalid count value')
    return null
  }
  try {
    const sql = `SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT ${
      count ? count : 100
    }`
    const transactions = (await db.all(transactionDatabase, sql)) as DbTransaction[] // TODO: confirm structure of object from db
    if (transactions.length > 0) {
      transactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Transaction latest', transactions)
    }
    return transactions
  } catch (e) {
    Logger.mainLogger.error(e)
    return null
  }
}

export async function queryTransactions(skip = 0, limit = 10000): Promise<Transaction[]> {
  let transactions
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryTransactions - Invalid skip or limit')
    return null
  }
  try {
    const sql = `SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    transactions = (await db.all(transactionDatabase, sql)) as DbTransaction[] // TODO: confirm structure of object from db
    if (transactions.length > 0) {
      transactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Transaction transactions',
      transactions ? transactions.length : transactions,
      'skip',
      skip
    )
  }
  return transactions
}

export async function queryTransactionCount(): Promise<number> {
  let transactions
  try {
    const sql = `SELECT COUNT(*) FROM transactions`
    transactions = await db.get(transactionDatabase, sql, [])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Transaction count', transactions)
  }
  if (transactions) transactions = transactions['COUNT(*)']
  else transactions = 0
  return transactions
}

export async function queryTransactionCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  let transactions
  try {
    const sql = `SELECT COUNT(*) FROM transactions WHERE cycleNumber BETWEEN ? AND ?`
    transactions = await db.get(transactionDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Transaction count between cycles', transactions)
  }
  if (transactions) transactions = transactions['COUNT(*)']
  else transactions = 0
  return transactions
}

export async function queryTransactionsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<Transaction[]> {
  let transactions
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryTransactionsBetweenCycles - Invalid skip or limit value')
    return null
  }
  try {
    const sql = `SELECT * FROM transactions WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    transactions = (await db.all(transactionDatabase, sql, [
      startCycleNumber,
      endCycleNumber,
    ])) as DbTransaction[] // TODO: confirm structure of object from db
    if (transactions.length > 0) {
      transactions.forEach((transaction: DbTransaction) => {
        if (transaction.data) transaction.data = DeSerializeFromJsonString(transaction.data)
        if (transaction.originalTxData)
          transaction.originalTxData = DeSerializeFromJsonString(transaction.originalTxData)
      })
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Transaction transactions between cycles',
      transactions ? transactions.length : transactions,
      'skip',
      skip
    )
  }
  return transactions
}
