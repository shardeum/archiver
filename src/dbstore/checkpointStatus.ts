import * as db from './sqlite3storage'
import { checkpointStatusDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'

export enum CheckpointStatusType {
  CYCLE = 'cycle',
  RECEIPT = 'receipt',
  ORIGINAL_TX = 'original_tx',
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
    }

    // Get the current status (if it exists)
    const currentStatus = await getCheckpointStatus(cycle)

    // If current status exists, copy all its values
    if (currentStatus) {
      newStatus.cycleStatus = currentStatus.cycleStatus
      newStatus.receiptStatus = currentStatus.receiptStatus
      newStatus.originalTxStatus = currentStatus.originalTxStatus
    }

    // Get the field name to update based on the status field type
    const fieldToUpdate = fieldMapping[statusField]

    // Update the specific field (using type assertion for TypeScript)
    ;(newStatus as Record<string, any>)[fieldToUpdate] = value

    // Calculate the unified status
    if (currentStatus) {
      let sql = `UPDATE checkpoint_status SET ${fieldToUpdate} = ? WHERE cycle = ?`
      await db.run(checkpointStatusDatabase, sql, [value, newStatus.cycle])
      const status = await getCheckpointStatus(newStatus.cycle)
      sql = `UPDATE checkpoint_status SET unifiedStatus = ? WHERE cycle = ?`
      await db.run(checkpointStatusDatabase, sql, [
        status?.cycleStatus && status?.receiptStatus && status?.originalTxStatus,
        newStatus.cycle,
      ])
    } else {
      const sql = `
      INSERT INTO checkpoint_status 
      (cycle, unifiedStatus, cycleStatus, receiptStatus, originalTxStatus, created_at) 
      VALUES (?, ?, ?, ?, ?, ?)
    `
      await db.run(checkpointStatusDatabase, sql, [
        newStatus.cycle,
        newStatus.unifiedStatus,
        newStatus.cycleStatus,
        newStatus.receiptStatus,
        newStatus.originalTxStatus,
        newStatus.created_at,
      ])
    }
    if (config.VERBOSE) {
      Logger.mainLogger.debug(`Updated checkpoint status for cycle ${cycle}, ${statusField} to ${value}`)
    }
  } catch (err) {
    Logger.mainLogger.error('Error updating checkpoint status field:', err)
    throw err
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
  statusField: CheckpointStatusType,
  value: boolean,
  startCycle?: number,
  endCycle?: number,
  cycles?: number[]
): Promise<void> {
  try {
    if (startCycle !== undefined && endCycle !== undefined && cycles !== undefined) {
      throw new Error('Only one of startCycle, endCycle, or cycles should be provided')
    }
    let existingRows: CheckpointStatus[] = []
    let existingMap = new Map<number, CheckpointStatus>()

    // Handle range-based updates
    if (startCycle !== undefined && endCycle !== undefined) {
      if (endCycle < startCycle) {
        throw new Error(`Invalid range: endCycle (${endCycle}) < startCycle (${startCycle})`)
      }
      existingRows = await getCheckpointStatusForRange(startCycle, endCycle)

      // Convert to a map for quick lookup by cycle number
      for (const row of existingRows) {
        existingMap.set(row.cycle, row)
      }

      // Create entries for missing cycles in the range
      for (let cycle = startCycle; cycle <= endCycle; cycle++) {
        if (!existingMap.has(cycle)) {
          existingMap.set(cycle, {
            cycle,
            unifiedStatus: false,
            cycleStatus: false,
            receiptStatus: false,
            originalTxStatus: false,
            created_at: Date.now(),
          })
        }
      }
    }

    // Handle specific cycles
    if (cycles && cycles.length > 0) {
      const cyclesStatus = new Map<number, CheckpointStatus>()
      await Promise.allSettled(
        cycles.map(async (cycle) => {
          const status = await getCheckpointStatus(cycle)
          if (status) {
            cyclesStatus.set(cycle, status)
          } else {
            cyclesStatus.set(cycle, {
              cycle,
              unifiedStatus: false,
              cycleStatus: false,
              receiptStatus: false,
              originalTxStatus: false,
              created_at: Date.now(),
            })
          }
        })
      )
      existingMap = cyclesStatus
    }

    // Build the new/updated list of statuses in memory
    const toUpsertList: CheckpointStatus[] = []
    for (let cycle of existingMap.keys()) {
      // Get the current status (should always exist at this point)
      let currentStatus = existingMap.get(cycle)!

      // Update the desired field using the fieldMapping
      const fieldToUpdate = fieldMapping[statusField]
      // Update the specific field (using type assertion for TypeScript)
      ;(currentStatus as Record<string, any>)[fieldToUpdate] = value

      // Recompute the unifiedStatus
      currentStatus.unifiedStatus =
        currentStatus.cycleStatus && currentStatus.receiptStatus && currentStatus.originalTxStatus
      currentStatus.created_at = Date.now()
      toUpsertList.push(currentStatus)
    }

    // Perform a bulk upsert in one shot
    if (toUpsertList.length > 0) {
      await bulkUpsertCheckpointStatus(toUpsertList)
    }

    if (config.VERBOSE) {
      if (startCycle !== undefined && endCycle !== undefined) {
        Logger.mainLogger.debug(
          `Bulk updated field "${statusField}" to ${value} for cycles [${startCycle}..${endCycle}]`
        )
      } else if (cycles) {
        Logger.mainLogger.debug(
          `Bulk updated field "${statusField}" to ${value} for specific cycles: ${cycles.join(', ')}`
        )
      }
    }
  } catch (err) {
    Logger.mainLogger.error('Error in bulkUpdateCheckpointStatusField:', err)
    throw err
  }
}

async function bulkUpsertCheckpointStatus(statusList: CheckpointStatus[]): Promise<void> {
  if (statusList.length === 0) return

  // We are constructing multiple placeholders for a single multi-row insert
  const placeholders: string[] = []
  const values: any[] = []

  for (const s of statusList) {
    placeholders.push('(?, ?, ?, ?, ?, ?)')
    values.push(s.cycle, s.unifiedStatus, s.cycleStatus, s.receiptStatus, s.originalTxStatus, s.created_at)
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
  `

  try {
    await db.run(checkpointStatusDatabase, sql, values)
  } catch (err) {
    Logger.mainLogger.error('Error in bulkUpsertCheckpointStatus:', err)
    throw err
  }

  if (config.VERBOSE) {
    Logger.mainLogger.debug(`Bulk upserted ${statusList.length} checkpoint status rows.`)
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
async function getCheckpointStatusForRange(startCycle: number, endCycle: number): Promise<CheckpointStatus[]> {
  const sql = `
    SELECT *
    FROM checkpoint_status
    WHERE cycle BETWEEN ? AND ?
    ORDER BY cycle
  `
  const rows = await db.all(checkpointStatusDatabase, sql, [startCycle, endCycle])
  return rows as CheckpointStatus[]
}

/**
 * Gets all checkpoint statuses with a specific unified status
 * @param unified Whether to get checkpoints with unified status true or false
 */
export async function getCheckpointStatusesByUnifiedStatus(unified: boolean, minCycle: number = 0): Promise<CheckpointStatus[]> {
  try {
    const sql = `
      SELECT * FROM checkpoint_status
      WHERE unifiedStatus = ?
      ${minCycle > 0 ? 'AND cycle >= ?' : ''}
    `

    const params = unified ? [1] : [0]
    if (minCycle > 0) {
      params.push(minCycle)
    }

    const rows = await db.all(checkpointStatusDatabase, sql, params)

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

    const result = await db.get(checkpointStatusDatabase, sql, [false])

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
 * Finds cycles that need syncing based on their unified status
 * @param lastUpdatedCycle The last updated cycle to start checking from
 * @param currentCycle The current network cycle
 * @param batchSize Number of cycles to process at once
 * @param callback Function to call for each cycle that needs syncing
 */
export async function processCyclesNeedingSync(
  lastUpdatedCycle: number,
  currentCycle: number,
  batchSize: number = 100,
  callback: (cycle: number) => Promise<void>
): Promise<void> {
  try {
    // Process in batches to avoid loading too many cycles in memory
    for (let startCycle = lastUpdatedCycle; startCycle <= currentCycle; startCycle += batchSize) {
      const endCycle = Math.min(startCycle + batchSize - 1, currentCycle)
      
      // First, check which cycles in this range have status records
      const sql = `
        SELECT cycle, unifiedStatus 
        FROM checkpoint_status 
        WHERE cycle >= ? AND cycle <= ? 
        ORDER BY cycle ASC
      `
      const existingStatuses = await db.all(checkpointStatusDatabase, sql, [startCycle, endCycle])
      
      // Create a map for quick lookup
      const statusMap = new Map<number, boolean>()
      existingStatuses.forEach((row: any) => {
        statusMap.set(row.cycle, row.unifiedStatus === 1)
      })
      
      // Process each cycle in the range
      for (let cycle = startCycle; cycle <= endCycle; cycle++) {
        // If no status exists or unified status is false, this cycle needs syncing
        if (!statusMap.has(cycle) || statusMap.get(cycle) === false) {
          await callback(cycle)
          Logger.mainLogger.debug(`[processCyclesNeedingSync] cycle ${cycle} has unifiedStatus false.. syncing`)
        }
      }
    }
  } catch (err) {
    Logger.mainLogger.error('[processCyclesNeedingSync] Error processing cycles that need syncing:', err)
    throw err
  }
}

export async function isBucketVerified(bucketID: number, endBucketID?: number): Promise<boolean> {
  if (endBucketID !== undefined && endBucketID < bucketID) {
    return false // Invalid range
  }

  if (endBucketID !== undefined) {
    // Check a range of buckets
    const sql = `
      SELECT cycle, unifiedStatus
      FROM checkpoint_status
      WHERE cycle >= ? AND cycle <= ?
    `

    const results = await db.all(checkpointStatusDatabase, sql, [bucketID, endBucketID])

    // If no results or fewer results than expected, return false
    if (!results || results.length === 0 || results.length < endBucketID - bucketID + 1) {
      return false
    }

    // Check if all buckets in the range have unifiedStatus = true/1
    return results.every((row: any) => row.unifiedStatus === true || row.unifiedStatus === 1)
  } else {
    // Check a single bucket
    const sql = `
      SELECT unifiedStatus
      FROM checkpoint_status
      WHERE cycle = ?
    `
    const result = (await db.get(checkpointStatusDatabase, sql, [bucketID])) as { unifiedStatus: number | boolean }

    if (!result) {
      return false
    }

    return result.unifiedStatus === true || result.unifiedStatus === 1
  }
}
