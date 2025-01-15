import * as db from './sqlite3storage'
import { accountDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'
import { getPreparedStmt } from './prepared-statements/preparedStmtAccounts';

/** Same as type AccountsCopy in the shardus core */
export type AccountsCopy = {
  accountId: string
  data: any // eslint-disable-line @typescript-eslint/no-explicit-any
  timestamp: number
  hash: string
  cycleNumber?: number
  isGlobal: boolean
}

type DbAccountCopy = AccountsCopy & {
  data: string
}

export async function insertAccount(account: AccountsCopy): Promise<void> {
  try {
    // Get the prepared statement for inserting an account
    const stmt = getPreparedStmt('insertAccount');

    // Map the `account` object to the required values for the prepared statement
    const values = [
      account.accountId,
      SerializeToJsonString(account.data), // Serialize `data` to JSON
      account.timestamp,
      account.hash,
      account.cycleNumber ?? null, // Fallback to `null` if undefined
      account.isGlobal,
    ];

    // Execute the prepared statement
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Log success if verbose mode is enabled
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Account', { accountId: account.accountId, values });
    }
  } catch (err) {
    // Log the error and rethrow it for upstream handling
    Logger.mainLogger.error('Failed to insert account', { account, error: err });
    throw new Error(`Failed to insert account with ID ${account.accountId}`);
  }
}



export async function bulkInsertAccounts(accounts: AccountsCopy[]): Promise<void> {

  try {

    // Define the table columns based on schema
    const columns = ['accountId', 'data', 'timestamp', 'hash', 'cycleNumber', 'isGlobal'];

    // Construct the SQL query for bulk insertion with all placeholders
    const placeholders = accounts.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO accounts (${columns.join(', ')}) VALUES ${placeholders}`;

    // Flatten the `accounts` array into a single list of values
    const values = accounts.flatMap((account) =>
      columns.map((column) =>
        typeof account[column] === 'object'
          ? SerializeToJsonString(account[column]) // Serialize objects to JSON
          : account[column]
      )
    );

    // Execute the single query for all accounts
    await db.run(accountDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Accounts', accounts.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert Accounts', accounts.length);
  }
}

export async function updateAccount(account: AccountsCopy): Promise<void> {
  try {
    // Get the prepared statement
    const stmt = getPreparedStmt('updateAccount');

    // Define the values to match the placeholders in the prepared statement
    const values = [
      account.cycleNumber ?? null, // Default to null if undefined
      account.timestamp,
      SerializeToJsonString(account.data),
      account.hash,
      account.accountId,
    ];

    // Execute the prepared statement
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Log success
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully updated Account', { accountId: account.accountId, values });
    }
  } catch (err) {
    // Log the error and rethrow for upstream handling
    Logger.mainLogger.error('Failed to update account', { account, error: err });
    throw new Error(`Failed to update account with ID ${account.accountId}`);
  }
}

export async function queryAccountByAccountId(accountId: string): Promise<AccountsCopy | null> {
  try {
    // Get the prepared statement for querying by accountId
    const stmt = getPreparedStmt('queryAccountByAccountId');

    // Execute the prepared statement
    const dbAccount = await new Promise<DbAccountCopy | null>((resolve, reject) => {
      stmt.get([accountId], (err, row) => {
        if (err) {
          Logger.mainLogger.error('Error running queryAccountByAccountId statement', { accountId, error: err });
          reject(err);
        } else {
          resolve(row as DbAccountCopy|| null); // Resolve `null` if no row is found
        }
      });
    });

    // Deserialize the `data` field if the account exists
    const account: AccountsCopy | null = dbAccount
      ? { ...dbAccount, data: DeSerializeFromJsonString(dbAccount.data) }
      : null;

    // Log the result if verbose mode is enabled
    if (config.VERBOSE) {
      Logger.mainLogger.debug('Queried Account by accountId', { accountId, account });
    }

    return account;
  } catch (err) {
    // Log the error and return null
    Logger.mainLogger.error('Failed to query account by accountId', { accountId, error: err });
    return null;
  }
}

export async function queryLatestAccounts(count: number): Promise<AccountsCopy[] | null> {
  try {
    const effectiveCount = Number.isInteger(count) && count > 0 ? count : 100;

    // Retrieve the prepared statement
    const stmt = getPreparedStmt('queryLatestAccounts');

    // Execute the query with the effectiveCount
    const dbAccounts = await new Promise<DbAccountCopy[]>((resolve, reject) => {
      stmt.all([effectiveCount], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as DbAccountCopy[]);
        }
      });
    });

    const accounts: AccountsCopy[] = [];
    if (dbAccounts.length > 0) {
      for (const dbAccount of dbAccounts) {
        accounts.push({ ...dbAccount, data: DeSerializeFromJsonString(dbAccount.data) });
      }
    }

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Account latest', accounts);
    }

    return accounts;
  } catch (e) {
    Logger.mainLogger.error('Error in queryLatestAccounts:', e);
    return null;
  }
}

export async function queryAccounts(skip = 0, limit = 10000): Promise<AccountsCopy[]> {
  const accounts: AccountsCopy[] = [];

  // Validate skip and limit values
  if (!Number.isInteger(skip) || !Number.isInteger(limit) || skip < 0 || limit <= 0) {
    Logger.mainLogger.error('queryAccounts - Invalid skip or limit value');
    return accounts;
  }

  try {
    // Retrieve the prepared statement
    const stmt = getPreparedStmt('queryAccounts');

    // Execute the query with parameters
    const dbAccounts = await new Promise<DbAccountCopy[]>((resolve, reject) => {
      stmt.all([limit, skip], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as DbAccountCopy[]);
        }
      });
    });

    // Deserialize data and push to accounts array
    for (const dbAccount of dbAccounts) {
      accounts.push({ ...dbAccount, data: DeSerializeFromJsonString(dbAccount.data) });
    }
  } catch (e) {
    Logger.mainLogger.error('Error in queryAccounts:', e);
  }

  // Log the result count if verbose logging is enabled
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account accounts', accounts.length, 'skip', skip, 'limit', limit);
  }

  return accounts;
}

export async function queryAccountCount(): Promise<number> {
  let accounts;

  try {
    // Retrieve the prepared statement
    const stmt = getPreparedStmt('queryAccountCount');

    // Execute the query and retrieve the result
    accounts = await new Promise<any>((resolve, reject) => {
      stmt.get([], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  } catch (e) {
    Logger.mainLogger.error('Error in queryAccountCount:', e);
  }

  // Log the raw result if verbose logging is enabled
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account count', accounts);
  }

  // Extract the count from the result
  if (accounts) accounts = accounts['COUNT(*)'];
  else accounts = 0;

  return accounts;
}

export async function queryAccountCountBetweenCycles(
  startCycleNumber: number,
  endCycleNumber: number
): Promise<number> {
  let accounts
  try {
    const sql = `SELECT COUNT(*) FROM accounts WHERE cycleNumber BETWEEN ? AND ?`
    accounts = await db.get(accountDatabase, sql, [startCycleNumber, endCycleNumber])
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Account count between cycles', accounts)
  }
  if (accounts) accounts = accounts['COUNT(*)']
  else accounts = 0
  return accounts
}

export async function queryAccountsBetweenCycles(
  skip = 0,
  limit = 10000,
  startCycleNumber: number,
  endCycleNumber: number
): Promise<AccountsCopy[]> {
  let dbAccounts: DbAccountCopy[]
  const accounts: AccountsCopy[] = []
  if (!Number.isInteger(skip) || !Number.isInteger(limit)) {
    Logger.mainLogger.error('queryAccountsBetweenCycles - Invalid skip or limit value')
    return accounts
  }
  try {
    const sql = `SELECT * FROM accounts WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT ${limit} OFFSET ${skip}`
    dbAccounts = (await db.all(accountDatabase, sql, [startCycleNumber, endCycleNumber])) as DbAccountCopy[]
    if (dbAccounts.length > 0) {
      for (const dbAccount of dbAccounts) {
        accounts.push({ ...dbAccount, data: DeSerializeFromJsonString(dbAccount.data) })
      }
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      'Account accounts between cycles',
      accounts ? accounts.length : accounts,
      'skip',
      skip
    )
  }
  return accounts
}

export async function fetchAccountsBySqlQuery(sql: string, value: string[]): Promise<AccountsCopy[]> {
  const accounts: AccountsCopy[] = []
  try {
    const dbAccounts = (await db.all(accountDatabase, sql, value)) as DbAccountCopy[]
    if (dbAccounts.length > 0) {
      for (const dbAccount of dbAccounts) {
        accounts.push({ ...dbAccount, data: DeSerializeFromJsonString(dbAccount.data) })
      }
    }
  } catch (e) {
    Logger.mainLogger.error(e)
  }
  if (config.VERBOSE) {
    Logger.mainLogger.debug('fetchAccountsBySqlQuery', accounts ? accounts.length : accounts)
  }
  return accounts
}
