import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';

/**
 * Initialize prepared statements for the `accounts` table.
 */
export const initialize = (db: sqlite3.Database): void => {
  addPreparedStatement(
    'insertAccount',
    db.prepare(
      `INSERT OR REPLACE INTO accounts 
       (accountId, data, timestamp, hash, cycleNumber, isGlobal) 
       VALUES (?, ?, ?, ?, ?, ?)`
    )
  );

  addPreparedStatement(
    'updateAccount',
    db.prepare(
      `UPDATE accounts 
       SET cycleNumber = ?, timestamp = ?, data = ?, hash = ? 
       WHERE accountId = ?`
    )
  );

  addPreparedStatement(
    'queryAccountByAccountId',
    db.prepare(`SELECT * FROM accounts WHERE accountId = ?`)
  );

  addPreparedStatement(
    'queryLatestAccounts',
    db.prepare(
      `SELECT * FROM accounts 
       ORDER BY cycleNumber DESC, timestamp DESC 
       LIMIT ?`
    )
  );

  addPreparedStatement(
    'queryAccounts',
    db.prepare(
      `SELECT * FROM accounts 
       ORDER BY cycleNumber ASC, timestamp ASC 
       LIMIT ? OFFSET ?`
    )
  );

  addPreparedStatement(
    'queryAccountCount',
    db.prepare(`SELECT COUNT(*) as count FROM accounts`)
  );

  addPreparedStatement(
    'queryAccountCountBetweenCycles',
    db.prepare(`SELECT COUNT(*) FROM accounts WHERE cycleNumber BETWEEN ? AND ?`)
  );

  addPreparedStatement(
    'fetchAccountsByRangeWithAccountOffset',
    db.prepare(
      `SELECT * FROM accounts 
       WHERE accountId BETWEEN ? AND ? 
       AND timestamp BETWEEN ? AND ? 
       AND accountId >= ? 
       ORDER BY timestamp ASC, accountId ASC 
       LIMIT ?`
    )
  );

  addPreparedStatement(
    'fetchAccountsByRangeWithoutAccountOffset',
    db.prepare(
      `SELECT * FROM accounts 
       WHERE accountId BETWEEN ? AND ? 
       AND timestamp BETWEEN ? AND ? 
       ORDER BY timestamp ASC, accountId ASC 
       LIMIT ? OFFSET ?`
    )
  );

};