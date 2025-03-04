import * as db from './sqlite3storage'
import { cycleDatabase } from '.'
import { P2P } from '@shardeum-foundation/lib-types'
import * as Logger from '../Logger'
import { config } from '../Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../utils/serialization'
import { Cycle, DbCycle } from './types'
import { getPreparedStmt } from './prepared-statements/preparedStmtManager'


export async function insertCycle(cycle: Cycle): Promise<void> {
  try {
    const stmt = getPreparedStmt('insertCycle');
    const values = [
      cycle.cycleMarker,
      cycle.counter,
      cycle.cycleRecord && SerializeToJsonString(cycle.cycleRecord),
    ];
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        'Successfully inserted Cycle',
        cycle.counter,
        cycle.cycleMarker
      );
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error(
      'Unable to insert cycle or it is already stored in the database',
      cycle.counter,
      cycle.cycleMarker
    );
  }
}


export async function bulkInsertCycles(cycles: Cycle[]): Promise<void> {

  try {
    // Define the table columns based on schema
    const columns = ['cycleMarker', 'counter', 'cycleRecord'];

    // Construct the SQL query for bulk insertion with all placeholders
    const placeholders = cycles.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    const sql = `INSERT OR REPLACE INTO cycles (${columns.join(', ')}) VALUES ${placeholders}`;

    // Flatten the `cycles` array into a single list of values
    const values = cycles.flatMap((cycle) =>
      columns.map((column) =>
        typeof cycle[column] === 'object'
          ? SerializeToJsonString(cycle[column]) // Serialize objects to JSON
          : cycle[column]
      )
    );

    // Execute the single query for all cycles
    await db.run(cycleDatabase, sql, values);

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Successfully inserted Cycles', cycles.length);
    }
  } catch (err) {
    Logger.mainLogger.error(err);
    Logger.mainLogger.error('Unable to bulk insert Cycles', cycles.length);
  }
}

export async function updateCycle(marker: string, cycle: Cycle): Promise<void> {
  try {
    const stmt = getPreparedStmt('updateCycle');
    const values = [
      cycle.counter,
      SerializeToJsonString(cycle.cycleRecord),
      marker,
    ];
    await new Promise<void>((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Updated cycle for counter', cycle.counter, marker);
    }
  } catch (e) {
    Logger.mainLogger.error(e);
    Logger.mainLogger.error('Unable to update Cycle', marker);
  }
}

export async function queryCycleByMarker(marker: string): Promise<Cycle | null> {
  try {
    const stmt = getPreparedStmt('queryCycleByMarker');
    const dbCycle = await new Promise<DbCycle>((resolve, reject) => {
      stmt.get([marker], (err, row) => {
        if (err) reject(err);
        else resolve(row as DbCycle);
      });
    });

    if (dbCycle) {
      const cycle: Cycle = {
        counter: dbCycle.counter,
        cycleRecord: DeSerializeFromJsonString(dbCycle.cycleRecord),
        cycleMarker: dbCycle.cycleMarker,
      };

      if (config.VERBOSE) {
        Logger.mainLogger.debug('cycle marker', cycle);
      }
      return cycle;
    }
    return null;
  } catch (e) {
    Logger.mainLogger.error(e);
    return null;
  }
}


export async function queryLatestCycleRecords(count: number): Promise<P2P.CycleCreatorTypes.CycleData[]> {
  if (!Number.isInteger(count) || count <= 0) {
    Logger.mainLogger.error('queryLatestCycleRecords - Invalid count value');
    return [];
  }
  try {
    const stmt = getPreparedStmt('queryLatestCycleRecords');
    const dbCycles = await new Promise<DbCycle[]>((resolve, reject) => {
      stmt.all([count], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbCycle[]);
      });
    });

    const cycleRecords: P2P.CycleCreatorTypes.CycleData[] = dbCycles.map((cycle) =>
      DeSerializeFromJsonString(cycle.cycleRecord)
    );

    if (config.VERBOSE) {
      Logger.mainLogger.debug('cycle latest', cycleRecords);
    }
    return cycleRecords;
  } catch (e) {
    Logger.mainLogger.error(e);
    return [];
  }
}


export async function queryCycleRecordsBetween(
  start: number,
  end: number
): Promise<P2P.CycleCreatorTypes.CycleData[]> {
  try {
    const stmt = getPreparedStmt('queryCycleRecordsBetween');
    const dbCycles = await new Promise<DbCycle[]>((resolve, reject) => {
      stmt.all([start, end], (err, rows) => {
        if (err) reject(err);
        else resolve(rows as DbCycle[]);
      });
    });

    const cycleRecords: P2P.CycleCreatorTypes.CycleData[] = dbCycles.map((cycle) =>
      DeSerializeFromJsonString(cycle.cycleRecord)
    );

    if (config.VERBOSE) {
      Logger.mainLogger.debug('cycle between', cycleRecords);
    }
    return cycleRecords;
  } catch (e) {
    Logger.mainLogger.error(e);
    return [];
  }
}

export async function queryCycleCount(): Promise<number> {
  try {
    const stmt = getPreparedStmt('queryCycleCount');
    const result = await new Promise<{ count: number }>((resolve, reject) => {
      stmt.get([], (err, row) => {
        if (err) reject(err);
        else resolve(row as { count: number });
      });
    });

    const count = result?.count || 0;

    if (config.VERBOSE) {
      Logger.mainLogger.debug('Cycle count', count);
    }

    return count;
  } catch (e) {
    Logger.mainLogger.error(e);
    return 0;
  }
}