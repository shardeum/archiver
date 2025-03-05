import * as db from './sqlite3storage'
import { checkpointStatusDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'

export enum CheckpointStatusType {
  CYCLE = 'cycle',
  RECEIPT = 'receipt',
  ORIGINAL_TX = 'original_tx',
}

export enum CheckpointSyncStatus {
  PENDING = 'pending',
  SYNCING = 'syncing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface CheckpointStatus {
  cycle: number
  unifiedStatus: boolean
  cycleStatus: boolean
  receiptStatus: boolean
  originalTxStatus: boolean
  created_at: number
}

// Map enum values directly to field names
export const fieldMapping: Record<CheckpointStatusType, keyof CheckpointStatus> = {
  [CheckpointStatusType.CYCLE]: 'cycleStatus',
  [CheckpointStatusType.RECEIPT]: 'receiptStatus',
  [CheckpointStatusType.ORIGINAL_TX]: 'originalTxStatus',
}

/**
 * Inserts or updates a checkpoint status record
 * @param status The checkpoint status to insert or update
 */
export async function upsertCheckpointStatus(status: CheckpointStatus): Promise<void> {
  try {
    const sql = `
      INSERT OR REPLACE INTO checkpoint_status 
      (cycle, unifiedStatus, cycleStatus, receiptStatus, originalTxStatus, created_at) 
      VALUES (?, ?, ?, ?, ?, ?)
    `

    // Calculate unifiedStatus based on the other three statuses
    const unifiedStatus = status.cycleStatus && status.receiptStatus && status.originalTxStatus

    await db.run(checkpointStatusDatabase, sql, [
      status.cycle,
      unifiedStatus,
      status.cycleStatus,
      status.receiptStatus,
      status.originalTxStatus,
      status.created_at,
    ])

    if (config.VERBOSE) {
      Logger.mainLogger.debug(
        `Successfully upserted checkpoint status for cycle ${status.cycle}, unifiedStatus ${status.unifiedStatus}`
      )
    }
  } catch (err) {
    Logger.mainLogger.error('Error upserting checkpoint status:', err)
    throw err
  }
}

/**
 * Updates a specific status field for a checkpoint
 * @param cycle The cycle number
 * @param statusField The status field to update ('cycleStatus', 'receiptStatus', or 'originalTxStatus')
 * @param value The boolean value to set
 */
export async function updateCheckpointStatusField(
  cycle: number,
  statusField: CheckpointStatusType,
  value: boolean
): Promise<void> {
  try {
   
    // Create a new status object with default values
    const newStatus: CheckpointStatus = {
      cycle,
      unifiedStatus: false,
      cycleStatus: false,
      receiptStatus: false,
      originalTxStatus: false,
      created_at: Date.now(),
    };
    
    // Get the current status (if it exists)
    const currentStatus = await getCheckpointStatus(cycle);
    
    // If current status exists, copy all its values
    if (currentStatus) {
      newStatus.cycleStatus = currentStatus.cycleStatus;
      newStatus.receiptStatus = currentStatus.receiptStatus;
      newStatus.originalTxStatus = currentStatus.originalTxStatus;
    }
    
    // Get the field name to update based on the status field type
    const fieldToUpdate = fieldMapping[statusField];
    
    // Update the specific field (using type assertion for TypeScript)
    (newStatus as Record<string, any>)[fieldToUpdate] = value;
    
    // Calculate the unified status
    newStatus.unifiedStatus = 
      newStatus.cycleStatus && newStatus.receiptStatus && newStatus.originalTxStatus;
    
    // Use the existing upsert function to save the changes
    await upsertCheckpointStatus(newStatus);
    
    if (config.VERBOSE) {
      Logger.mainLogger.debug(`Updated checkpoint status for cycle ${cycle}, ${statusField} to ${value}`);
    }
  } catch (err) {
    Logger.mainLogger.error('Error updating checkpoint status field:', err);
    throw err;
  }
}

/**
 * Bulk updates a specific status field (e.g., ORIGINAL_TX) for all cycles in [startCycle, endCycle].
 * This approach:
 *   - Grabs existing rows in one SELECT (so we know other status fields).
 *   - Updates/creates rows in memory.
 *   - Uses one multi-row upsert to write them back.
 */
export async function bulkUpdateCheckpointStatusField(
  startCycle: number,
  endCycle: number,
  statusField: CheckpointStatusType,
  value: boolean
): Promise<void> {
  if (endCycle < startCycle) {
    throw new Error(`Invalid range: endCycle (${endCycle}) < startCycle (${startCycle})`);
  }

  // 1) Fetch existing records for [startCycle, endCycle] in one query
  const existingRows = await getCheckpointStatusForRange(startCycle, endCycle);
  // Convert to a map for quick lookup by cycle number
  const existingMap = new Map<number, CheckpointStatus>();
  for (const row of existingRows) {
    existingMap.set(row.cycle, row);
  }

  // 2) Build the new/updated list of statuses in memory
  const toUpsertList: CheckpointStatus[] = [];
  for (let cycle = startCycle; cycle <= endCycle; cycle++) {
    // If it doesn't exist, create a default
    let currentStatus = existingMap.get(cycle);
    if (!currentStatus) {
      currentStatus = {
        cycle,
        unifiedStatus: false,
        cycleStatus: false,
        receiptStatus: false,
        originalTxStatus: false,
        created_at: Date.now(),
      };
    }

    // Update the desired field using the fieldMapping
    const fieldToUpdate = fieldMapping[statusField];
    // Update the specific field (using type assertion for TypeScript)
    (currentStatus as Record<string, any>)[fieldToUpdate] = value;
    
    // Recompute the unifiedStatus
    currentStatus.unifiedStatus =
      currentStatus.cycleStatus &&
      currentStatus.receiptStatus &&
      currentStatus.originalTxStatus;
    currentStatus.created_at = Date.now();
    toUpsertList.push(currentStatus);
  }

  // 3) Perform a bulk upsert in one shot
  //    - If your DB has constraints on # of parameters (SQLite ~999), chunk as needed
  await bulkUpsertCheckpointStatus(toUpsertList);

  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      `Bulk updated field "${statusField}" to ${value} for cycles [${startCycle}..${endCycle}]`
    );
  }
}


async function bulkUpsertCheckpointStatus(statusList: CheckpointStatus[]): Promise<void> {
  if (statusList.length === 0) return;

  // We are constructing multiple placeholders for a single multi-row insert
  const placeholders: string[] = [];
  const values: any[] = [];

  for (const s of statusList) {
    placeholders.push('(?, ?, ?, ?, ?, ?)');
    values.push(
      s.cycle,
      s.unifiedStatus ? 1 : 0,
      s.cycleStatus ? 1 : 0,
      s.receiptStatus ? 1 : 0,
      s.originalTxStatus ? 1 : 0,
      s.created_at
    );
  }

  // Upsert by 'cycle' using ON CONFLICT DO UPDATE
  const sql = `
    INSERT INTO checkpoint_status (
      cycle,
      unifiedStatus,
      cycleStatus,
      receiptStatus,
      originalTxStatus,
      created_at
    )
    VALUES ${placeholders.join(', ')}
    ON CONFLICT(cycle) DO UPDATE SET
      unifiedStatus=excluded.unifiedStatus,
      cycleStatus=excluded.cycleStatus,
      receiptStatus=excluded.receiptStatus,
      originalTxStatus=excluded.originalTxStatus,
      created_at=excluded.created_at
  `;

  try {
    await db.run(checkpointStatusDatabase, sql, values);
  } catch (err) {
    Logger.mainLogger.error('Error in bulkUpsertCheckpointStatus:', err);
    throw err;
  }

  if (config.VERBOSE) {
    Logger.mainLogger.debug(
      `Bulk upserted ${statusList.length} checkpoint status rows.`
    );
  }
}


/**
 * Gets a checkpoint status by cycle
 * @param cycle The cycle number
 */
export async function getCheckpointStatus(cycle: number): Promise<CheckpointStatus | null> {
  try {
    const sql = `
      SELECT * FROM checkpoint_status
      WHERE cycle = ?
    `

    const row = await db.get(checkpointStatusDatabase, sql, [cycle])

    if (!row) {
      return null
    }

    // Add type assertion to fix TypeScript errors
    const typedRow = row as {
      cycle: number
      unifiedStatus: number | boolean
      cycleStatus: number | boolean
      receiptStatus: number | boolean
      originalTxStatus: number | boolean
      created_at: number
    }

    return {
      cycle: typedRow.cycle,
      unifiedStatus: Boolean(typedRow.unifiedStatus),
      cycleStatus: Boolean(typedRow.cycleStatus),
      receiptStatus: Boolean(typedRow.receiptStatus),
      originalTxStatus: Boolean(typedRow.originalTxStatus),
      created_at: typedRow.created_at,
    }
  } catch (error) {
    Logger.mainLogger.error(`Error getting checkpoint status: ${error}`)
    throw error
  }
}

/**
 * Gets all checkpoint statuses for a range of cycles
 * @param startCycle The start cycle number
 * @param endCycle The end cycle number
 */
async function getCheckpointStatusForRange(
  startCycle: number,
  endCycle: number
): Promise<CheckpointStatus[]> {
  const sql = `
    SELECT *
    FROM checkpoint_status
    WHERE cycle BETWEEN ? AND ?
    ORDER BY cycle
  `;
  const rows = await db.all(checkpointStatusDatabase, sql, [
    startCycle,
    endCycle,
  ]);
  return rows as CheckpointStatus[];
}


/**
 * Gets all checkpoint statuses with a specific unified status
 * @param unified Whether to get checkpoints with unified status true or false
 */
export async function getCheckpointStatusesByUnifiedStatus(unified: boolean): Promise<CheckpointStatus[]> {
  try {
    const sql = `
      SELECT * FROM checkpoint_status
      WHERE unifiedStatus = ?
      ORDER BY cycle ASC
    `

    const rows = await db.all(checkpointStatusDatabase, sql, [unified ? 1 : 0])

    return rows.map((row) => {
      // Add type assertion to fix TypeScript errors
      const typedRow = row as {
        cycle: number
        unifiedStatus: number | boolean
        cycleStatus: number | boolean
        receiptStatus: number | boolean
        originalTxStatus: number | boolean
        created_at: number
      }

      return {
        cycle: typedRow.cycle,
        unifiedStatus: Boolean(typedRow.unifiedStatus),
        cycleStatus: Boolean(typedRow.cycleStatus),
        receiptStatus: Boolean(typedRow.receiptStatus),
        originalTxStatus: Boolean(typedRow.originalTxStatus),
        created_at: typedRow.created_at,
      }
    })
  } catch (error) {
    Logger.mainLogger.error(`Error getting checkpoint statuses by unified status: ${error}`)
    throw error
  }
}

/**
 * Gets all failed checkpoint statuses for a specific type
 * @param type The checkpoint type
 * @returns Array of failed checkpoint statuses
 */
// export async function getFailedCheckpointStatuses(type: CheckpointStatusType): Promise<CheckpointStatus[]> {
//   try {
//     const sql = `
//       SELECT * FROM checkpoint_status
//       WHERE type = ? AND status = ?
//       ORDER BY cycle ASC
//     `

//     const results = await db.all(checkpointStatusDatabase, sql, [type, CheckpointSyncStatus.FAILED])

//     return results.map((result) => {
//       // Add type assertion to fix TypeScript errors
//       const typedResult = result as {
//         cycle: number
//         unifiedStatus: boolean
//         cycleStatus: boolean
//         receiptStatus: boolean
//         originalTxStatus: boolean
//         created_at: number
//       }

//       return {
//         cycle: typedResult.cycle,
//         unifiedStatus: typedResult.unifiedStatus,
//         cycleStatus: typedResult.cycleStatus,
//         receiptStatus: typedResult.receiptStatus,
//         originalTxStatus: typedResult.originalTxStatus,
//         created_at: typedResult.created_at,
//       }
//     })
//   } catch (err) {
//     Logger.mainLogger.error('Error getting failed checkpoint statuses:', err)
//     throw err
//   }
// }

/**
 * Gets the oldest pending or failed checkpoint status
 * @returns The oldest pending or failed checkpoint status or null if none found
 */
export async function getOldestPendingOrFailedCheckpointStatus(): Promise<CheckpointStatus | null> {
  try {
    const sql = `
      SELECT * FROM checkpoint_status
      WHERE unifiedStatus = ?
      ORDER BY cycle ASC
      LIMIT 1
    `

    const result = await db.get(checkpointStatusDatabase, sql, [
      CheckpointSyncStatus.PENDING,
      CheckpointSyncStatus.FAILED,
    ])

    if (!result) {
      return null
    }

    // Add type assertion to fix TypeScript errors
    const typedResult = result as {
      cycle: number
      unifiedStatus: boolean
      cycleStatus: boolean
      receiptStatus: boolean
      originalTxStatus: boolean
      created_at: number
    }

    return {
      cycle: typedResult.cycle,
      unifiedStatus: typedResult.unifiedStatus,
      cycleStatus: typedResult.cycleStatus,
      receiptStatus: typedResult.receiptStatus,
      originalTxStatus: typedResult.originalTxStatus,
      created_at: typedResult.created_at,
    }
  } catch (err) {
    Logger.mainLogger.error('Error getting oldest pending or failed checkpoint status:', err)
    throw err
  }
}

/**
 * Gets the range of cycles that need syncing
 * @returns Object with min and max cycle numbers that need syncing
 */
export async function getCheckpointSyncRange(): Promise<{ minCycle: number; maxCycle: number } | null> {
  try {
    const sql = `
      SELECT MIN(cycle) as minCycle, MAX(cycle) as maxCycle
      FROM checkpoint_status
      WHERE unifiedStatus in (?, ?)
    `

    const result = await db.get(checkpointStatusDatabase, sql, [
      CheckpointSyncStatus.PENDING,
      CheckpointSyncStatus.FAILED,
    ])

    // Add type assertion to fix TypeScript errors
    const typedResult = result as {
      minCycle: number | null
      maxCycle: number | null
    }

    if (!typedResult || typedResult.minCycle === null || typedResult.maxCycle === null) {
      return null
    }

    return {
      minCycle: typedResult.minCycle,
      maxCycle: typedResult.maxCycle,
    }
  } catch (err) {
    Logger.mainLogger.error('Error getting checkpoint sync range:', err)
    throw err
  }
}

export async function isBucketVerified(bucketID: number): Promise<boolean> {
  const sql = `
    SELECT unifiedStatus
    FROM checkpoint_status
    WHERE cycle = ?
    `

  const result = await db.get(checkpointStatusDatabase, sql, [bucketID])

  if (!result) {
    return false
  }

  return true
}
