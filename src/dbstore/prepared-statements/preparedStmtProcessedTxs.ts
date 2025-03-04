import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';


export const initialize = (db: sqlite3.Database): void => {


    addPreparedStatement(
    'insertProcessedTx',
        db.prepare(`
          INSERT INTO processedTxs (txId, cycle, txTimestamp, applyTimestamp) 
          VALUES (?, ?, ?, ?)
          ON CONFLICT (txId) DO UPDATE SET 
            cycle = excluded.cycle, 
            txTimestamp = excluded.txTimestamp, 
            applyTimestamp = excluded.applyTimestamp
        `)
    );
    
    addPreparedStatement(
    'queryProcessedTxByTxId',
        db.prepare(`SELECT * FROM processedTxs WHERE txId = ?`)
    );


    addPreparedStatement(
    'queryProcessedTxsByCycleNumber',
        db.prepare(`SELECT * FROM processedTxs WHERE cycle = ?`)
    );

    addPreparedStatement(
    'querySortedTxsBetweenCycleRange',
        db.prepare(`SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?`)
    );

};
