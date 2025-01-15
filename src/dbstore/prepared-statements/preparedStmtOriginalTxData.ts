import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';


export const initialize = (db: sqlite3.Database): void => {

    addPreparedStatement(
    'insertOriginalTxData',
        db.prepare(
            `INSERT OR REPLACE INTO originalTxsData 
            (txId, timestamp, cycle, originalTxData) 
            VALUES (?, ?, ?, ?)`
        )
    );

    addPreparedStatement(
    'queryOriginalTxDataCount',
        db.prepare(`SELECT COUNT(*) FROM originalTxsData`)
    );
    
    addPreparedStatement(
    'queryOriginalTxDataCountBetweenCycles',
        db.prepare(`SELECT COUNT(*) FROM originalTxsData WHERE cycle BETWEEN ? AND ?`)
    );

    addPreparedStatement(
    'queryOriginalTxsData',
        db.prepare(
          `SELECT * FROM originalTxsData ORDER BY cycle ASC, timestamp ASC LIMIT ? OFFSET ?`
        )
    );
      
    addPreparedStatement(
    'queryOriginalTxsDataByCycles',
        db.prepare(
            `SELECT * FROM originalTxsData WHERE cycle BETWEEN ? AND ? ORDER BY cycle ASC, timestamp ASC LIMIT ? OFFSET ?`
        )
    );

    addPreparedStatement(
    'queryOriginalTxDataByTxId',
        db.prepare(`SELECT * FROM originalTxsData WHERE txId = ?`)
    );
      
    addPreparedStatement(
    'queryOriginalTxDataByTxIdWithTimestamp',
        db.prepare(`SELECT * FROM originalTxsData WHERE txId = ? AND timestamp = ?`)
    );

    addPreparedStatement(
    'queryOriginalTxDataCountByCycles',
        db.prepare(`
            SELECT cycle, COUNT(*) 
            FROM originalTxsData 
            GROUP BY cycle 
            HAVING cycle BETWEEN ? AND ? 
            ORDER BY cycle ASC
        `)
    );

    addPreparedStatement(
    'queryLatestOriginalTxs',
        db.prepare(`
          SELECT * FROM originalTxsData 
          ORDER BY cycle DESC, timestamp DESC 
          LIMIT ?
        `)
      );
};
