import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';


export const initialize = (db: sqlite3.Database): void => {


    addPreparedStatement(
    'insertTransaction',
        db.prepare(
          `INSERT OR REPLACE INTO transactions 
           (txId, appReceiptId, timestamp, cycleNumber, data, originalTxData) 
           VALUES (?, ?, ?, ?, ?, ?)`
        )
    );

    addPreparedStatement(
    'queryTransactionByTxId',
        db.prepare(`SELECT * FROM transactions WHERE txId = ?`)
    );

    addPreparedStatement(
    'queryLatestTransactions',
        db.prepare(
          `SELECT * FROM transactions 
           ORDER BY cycleNumber DESC, timestamp DESC 
           LIMIT ?`
        )
    );

    addPreparedStatement(
    'queryTransactions',
        db.prepare(
          `SELECT * FROM transactions 
           ORDER BY cycleNumber ASC, timestamp ASC 
           LIMIT ? OFFSET ?`
        )
    );
      
    addPreparedStatement(
    'queryTransactionCount',
        db.prepare(
          `SELECT COUNT(*) FROM transactions`
        )
    );

    addPreparedStatement(
    'queryTransactionCountBetweenCycles',
        db.prepare(
          `SELECT COUNT(*) FROM transactions WHERE cycleNumber BETWEEN ? AND ?`
        )
    );

    addPreparedStatement(
    'queryTransactionsBetweenCycles',
        db.prepare(
          `SELECT * FROM transactions 
           WHERE cycleNumber BETWEEN ? AND ? 
           ORDER BY cycleNumber ASC, timestamp ASC 
           LIMIT ? OFFSET ?`
        )
    );

};
