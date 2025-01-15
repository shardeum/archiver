import * as sqlite3 from 'sqlite3';
import * as Logger from '../../Logger';
import { registerPreparedStatements} from './preparedStmtManager';


let preparedStatements: Map<string, sqlite3.Statement> = new Map();

export const initialize = (db: sqlite3.Database): void => {
  preparedStatements.set(
    'insertAccount',
    db.prepare(
      `INSERT OR REPLACE INTO accounts 
       (accountId, data, timestamp, hash, cycleNumber, isGlobal) 
       VALUES (?, ?, ?, ?, ?, ?)`
    )
  );

  preparedStatements.set(
    'updateAccount',
    db.prepare(
      `UPDATE accounts 
       SET cycleNumber = ?, timestamp = ?, data = ?, hash = ? 
       WHERE accountId = ?`
    )
  );

  preparedStatements.set(
    'queryAccountByAccountId',
    db.prepare(`SELECT * FROM accounts WHERE accountId = ?`)
  );

  preparedStatements.set(
    'queryLatestAccounts',
    db.prepare(
      `SELECT * FROM accounts 
       ORDER BY cycleNumber DESC, timestamp DESC 
       LIMIT ?`
    )
  );

  preparedStatements.set(
    'queryAccounts',
    db.prepare(
      `SELECT * FROM accounts 
       ORDER BY cycleNumber ASC, timestamp ASC 
       LIMIT ? OFFSET ?`
    )
  );

  preparedStatements.set(
    'queryAccountCount',
    db.prepare(`SELECT COUNT(*) as count FROM accounts`)
  );

  preparedStatements.set(
    'queryAccountCountBetweenCycles',
    db.prepare(`SELECT COUNT(*) FROM accounts WHERE cycleNumber BETWEEN ? AND ?`)
  );
  
  preparedStatements.set(
    'fetchAccountsByRangeWithOffset',
    db.prepare(
      `SELECT * FROM accounts 
       WHERE accountId BETWEEN ? AND ? 
       AND timestamp BETWEEN ? AND ? 
       ORDER BY timestamp ASC, accountId ASC 
       LIMIT ? OFFSET ?`
    )
  );

  preparedStatements.set(
    'fetchAccountsByRangeWithOffset',
    db.prepare(
      `SELECT * FROM accounts 
       WHERE accountId BETWEEN ? AND ? 
       AND timestamp BETWEEN ? AND ? 
       AND accountId >= ? 
       ORDER BY timestamp ASC, accountId ASC 
       LIMIT ?`
    )
  );
  
  preparedStatements.set(
    'fetchAccountsByList',
    db.prepare(
      `SELECT * FROM accounts 
       WHERE accountId IN (?)`
    )
  );
  
};

export const getPreparedStmt = (name: string): sqlite3.Statement => {
  const stmt = preparedStatements.get(name);
  if (!stmt) {
    throw new Error(`Prepared statement not found: ${name}`);
  }
  return stmt;
};

export const finalize = async (): Promise<void> => {
  const finalizePromises = [];

  preparedStatements.forEach((stmt, key) => {
    if (stmt) {
      finalizePromises.push(
        new Promise<void>((resolve, reject) => {
          stmt.finalize((err) => {
            if (err) {
              Logger.mainLogger.error(`Error finalizing statement ${key}:`, err);
              reject(err);
            } else {
              Logger.mainLogger.debug(`Successfully finalized statement ${key}`);
              resolve();
            }
          });
        })
      );
    }
  });

  await Promise.all(finalizePromises);
};

registerPreparedStatements(initialize, finalize);
