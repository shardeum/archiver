import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';


export const initialize = (db: sqlite3.Database): void => {
  addPreparedStatement(
    'insertReceipt',
    db.prepare(
      `INSERT OR REPLACE INTO receipts 
        (receiptId, tx, cycle, applyTimestamp, timestamp, signedReceipt, afterStates, beforeStates, appReceiptData, executionShardKey, globalModification) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
  );


  addPreparedStatement(
    'queryReceiptById',
    db.prepare(`SELECT * FROM receipts WHERE receiptId=?`)
  );

  addPreparedStatement(
    'queryReceiptByIdAndTimestamp',
    db.prepare(`SELECT * FROM receipts WHERE receiptId=? AND timestamp=?`)
  );


  addPreparedStatement(
    'queryLatestReceipts',
    db.prepare(
      `SELECT * FROM receipts ORDER BY cycle DESC, timestamp DESC LIMIT ?`
    )
  );

  addPreparedStatement(
    'queryReceipts',
    db.prepare(
      `SELECT * FROM receipts ORDER BY cycle ASC, timestamp ASC LIMIT ? OFFSET ?`
    )
  );

  addPreparedStatement(
    'queryReceiptCount',
    db.prepare(
      `SELECT COUNT(*) as count FROM receipts`
    )
  );

  addPreparedStatement(
    'queryReceiptCountByCycles',
    db.prepare(
      `SELECT cycle, COUNT(*) FROM receipts 
        GROUP BY cycle 
        HAVING cycle BETWEEN ? AND ? 
        ORDER BY cycle ASC`
    )
  );

  addPreparedStatement(
    'queryReceiptCountBetweenCycles',
    db.prepare(
      `SELECT COUNT(*) FROM receipts 
        WHERE cycle BETWEEN ? AND ?`
    )
  );

  addPreparedStatement(
    'queryReceiptsBetweenCycles',
    db.prepare(
      `SELECT * FROM receipts 
        WHERE cycle BETWEEN ? AND ? 
        ORDER BY cycle ASC, timestamp ASC 
        LIMIT ? OFFSET ?`
    )
  );
};
