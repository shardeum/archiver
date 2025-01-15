import * as sqlite3 from 'sqlite3';
import { addPreparedStatement } from './preparedStmtManager';


export const initialize = (db: sqlite3.Database): void => {
  // Insert or replace a single cycle
  addPreparedStatement(
    'insertCycle',
    db.prepare(
      `INSERT OR REPLACE INTO cycles (cycleMarker, counter, cycleRecord) 
       VALUES (?, ?, ?)`
    )
  );

  // Update a cycle by its marker
  addPreparedStatement(
    'updateCycle',
    db.prepare(
      `UPDATE cycles 
       SET counter = ?, cycleRecord = ? 
       WHERE cycleMarker = ?`
    )
  );

  // Query a cycle by its marker
  addPreparedStatement(
    'queryCycleByMarker',
    db.prepare(
      `SELECT * FROM cycles 
       WHERE cycleMarker = ? 
       LIMIT 1`
    )
  );

  // Query the latest cycle records
  addPreparedStatement(
    'queryLatestCycleRecords',
    db.prepare(
      `SELECT * FROM cycles 
       ORDER BY counter DESC 
       LIMIT ?`
    )
  );

  // Query cycle records between two counters
  addPreparedStatement(
    'queryCycleRecordsBetween',
    db.prepare(
      `SELECT * FROM cycles 
       WHERE counter BETWEEN ? AND ? 
       ORDER BY counter ASC`
    )
  );

  // Query the total count of cycles
  addPreparedStatement(
    'queryCycleCount',
    db.prepare(
      `SELECT COUNT(*) as count 
       FROM cycles`
    )
  );
};
