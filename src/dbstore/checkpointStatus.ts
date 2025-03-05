import * as db from './sqlite3storage'
import { checkpointStatusDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { SerializeToJsonString, DeSerializeFromJsonString } from '../utils/serialization'

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
    // First, get the current status
    const currentStatus = await getCheckpointStatus(cycle)

    if (!currentStatus) {
      // Create a new status with default values
      const newStatus: CheckpointStatus = {
        cycle,
        unifiedStatus: false,
        cycleStatus: statusField === CheckpointStatusType.CYCLE ? value : false,
        receiptStatus: statusField === CheckpointStatusType.RECEIPT ? value : false,
        originalTxStatus: statusField === CheckpointStatusType.ORIGINAL_TX ? value : false,
        created_at: Date.now(),
      }
      await upsertCheckpointStatus(newStatus)
      return
    }

    // Update the specific field
    currentStatus[statusField] = value

    // Calculate the unified status
    const unifiedStatus =
      currentStatus.cycleStatus && currentStatus.receiptStatus && currentStatus.originalTxStatus

    const sql = `
      UPDATE checkpoint_status
      SET ${statusField} = ?, unifiedStatus = ?, created_at = ?
      WHERE cycle = ?
    `

    await db.run(checkpointStatusDatabase, sql, [value, unifiedStatus, Date.now(), cycle])

    if (config.VERBOSE) {
      Logger.mainLogger.debug(`Updated checkpoint status for cycle ${cycle}, ${statusField} to ${value}`)
    }
  } catch (err) {
    Logger.mainLogger.error('Error updating checkpoint status field:', err)
    throw err
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
      WHERE unifiedStatus in
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
    SELECT 
    CASE 
      WHEN COUNT(*) = SUM(CASE WHEN status = ? THEN 1 ELSE 0 END)
      THEN 'true'
      ELSE 'false'
    END AS all_completed
    FROM checkpoint_status
    WHERE cycle = ?
    `

  const result = await db.get(checkpointStatusDatabase, sql, [CheckpointSyncStatus.COMPLETED, bucketID])

  if (!result) {
    return false
  }

  return true
}
