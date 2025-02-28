import * as db from './sqlite3storage'
import { checkpointStatusDatabase } from '.'
import * as Logger from '../Logger'
import { config } from '../Config'
import { SerializeToJsonString, DeSerializeFromJsonString } from '../utils/serialization'

export enum CheckpointStatusType {
    CYCLE = 'cycle',
    RECEIPT = 'receipt',
    ORIGINAL_TX = 'original_tx'
}

export enum CheckpointSyncStatus {
    PENDING = 'pending',
    SYNCING = 'syncing',
    COMPLETED = 'completed',
    FAILED = 'failed'
}

export interface CheckpointStatus {
    cycle: number
    type: CheckpointStatusType
    status: CheckpointSyncStatus
    timestamp: number
    totalArchivers: number
    matchedArchivers: number
    failedRadixes?: string[]
    lastSyncAttempt?: number
    syncAttempts?: number
}

/**
 * Inserts or updates a checkpoint status record
 * @param status The checkpoint status to insert or update
 */
export async function upsertCheckpointStatus(status: CheckpointStatus): Promise<void> {
    try {
        const sql = `
      INSERT OR REPLACE INTO checkpoint_status 
      (cycle, type, status, timestamp, totalArchivers, matchedArchivers, failedRadixes, lastSyncAttempt, syncAttempts) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `

        const failedRadixesJson = status.failedRadixes ? SerializeToJsonString(status.failedRadixes) : null

        await db.run(checkpointStatusDatabase, sql, [
            status.cycle,
            status.type,
            status.status,
            status.timestamp,
            status.totalArchivers,
            status.matchedArchivers,
            failedRadixesJson,
            status.lastSyncAttempt || null,
            status.syncAttempts || 0
        ])

        if (config.VERBOSE) {
            Logger.mainLogger.debug(
                `Successfully upserted checkpoint status for cycle ${status.cycle}, type ${status.type}, status ${status.status}`
            )
        }
    } catch (err) {
        Logger.mainLogger.error('Error upserting checkpoint status:', err)
        throw err
    }
}

/**
 * Updates the status of a checkpoint
 * @param cycle The cycle number
 * @param type The checkpoint type
 * @param status The new status
 * @param lastSyncAttempt Optional timestamp of the last sync attempt
 */
export async function updateCheckpointStatus(
    cycle: number,
    type: CheckpointStatusType,
    status: CheckpointSyncStatus,
    lastSyncAttempt?: number
): Promise<void> {
    try {
        let sql = `
      UPDATE checkpoint_status 
      SET status = ?, lastSyncAttempt = ?, syncAttempts = syncAttempts + 1
      WHERE cycle = ? AND type = ?
    `

        await db.run(checkpointStatusDatabase, sql, [
            status,
            lastSyncAttempt || Date.now(),
            cycle,
            type
        ])

        if (config.VERBOSE) {
            Logger.mainLogger.debug(
                `Updated checkpoint status for cycle ${cycle}, type ${type} to ${status}`
            )
        }
    } catch (err) {
        Logger.mainLogger.error('Error updating checkpoint status:', err)
        throw err
    }
}

/**
 * Gets checkpoint status for a specific cycle and type
 * @param cycle The cycle number
 * @param type The checkpoint type
 * @returns The checkpoint status or null if not found
 */
export async function getCheckpointStatus(
    cycle: number,
    type: CheckpointStatusType
): Promise<CheckpointStatus | null> {
    try {
        const sql = `
      SELECT *
      FROM checkpoint_status
      WHERE cycle = ? AND type = ?
    `

        const result = await db.get(checkpointStatusDatabase, sql, [cycle, type])

        if (!result) {
            return null
        }

        // Add type assertion to fix TypeScript errors
        const typedResult = result as {
            cycle: number;
            type: string;
            status: string;
            timestamp: number;
            totalArchivers: number;
            matchedArchivers: number;
            failedRadixes: string | null;
            lastSyncAttempt: number | null;
            syncAttempts: number | null;
        };

        return {
            cycle: typedResult.cycle,
            type: typedResult.type as CheckpointStatusType,
            status: typedResult.status as CheckpointSyncStatus,
            timestamp: typedResult.timestamp,
            totalArchivers: typedResult.totalArchivers,
            matchedArchivers: typedResult.matchedArchivers,
            failedRadixes: typedResult.failedRadixes ? DeSerializeFromJsonString(typedResult.failedRadixes) : undefined,
            lastSyncAttempt: typedResult.lastSyncAttempt ?? undefined,
            syncAttempts: typedResult.syncAttempts ?? undefined
        }
    } catch (err) {
        Logger.mainLogger.error('Error getting checkpoint status:', err)
        throw err
    }
}

/**
 * Gets all checkpoint statuses with a specific status
 * @param status The status to filter by
 * @returns Array of checkpoint statuses
 */
export async function getCheckpointStatusesByStatus(
    status: CheckpointSyncStatus
): Promise<CheckpointStatus[]> {
    try {
        const sql = `
      SELECT * FROM checkpoint_status
      WHERE status = ?
      ORDER BY cycle ASC
    `

        const results = await db.all(checkpointStatusDatabase, sql, [status])

        return results.map(result => {
            // Add type assertion to fix TypeScript errors
            const typedResult = result as {
                cycle: number;
                type: string;
                status: string;
                timestamp: number;
                totalArchivers: number;
                matchedArchivers: number;
                failedRadixes: string | null;
                lastSyncAttempt: number | null;
                syncAttempts: number | null;
            };

            return {
                cycle: typedResult.cycle,
                type: typedResult.type as CheckpointStatusType,
                status: typedResult.status as CheckpointSyncStatus,
                timestamp: typedResult.timestamp,
                totalArchivers: typedResult.totalArchivers,
                matchedArchivers: typedResult.matchedArchivers,
                failedRadixes: typedResult.failedRadixes ? DeSerializeFromJsonString(typedResult.failedRadixes) : undefined,
                lastSyncAttempt: typedResult.lastSyncAttempt ?? undefined,
                syncAttempts: typedResult.syncAttempts ?? undefined
            };
        });
    } catch (err) {
        Logger.mainLogger.error('Error getting checkpoint statuses by status:', err)
        throw err
    }
}

/**
 * Gets all failed checkpoint statuses for a specific type
 * @param type The checkpoint type
 * @returns Array of failed checkpoint statuses
 */
export async function getFailedCheckpointStatuses(
    type: CheckpointStatusType
): Promise<CheckpointStatus[]> {
    try {
        const sql = `
      SELECT * FROM checkpoint_status
      WHERE type = ? AND status = ?
      ORDER BY cycle ASC
    `

        const results = await db.all(checkpointStatusDatabase, sql, [type, CheckpointSyncStatus.FAILED])

        return results.map(result => {
            // Add type assertion to fix TypeScript errors
            const typedResult = result as {
                cycle: number;
                type: string;
                status: string;
                timestamp: number;
                totalArchivers: number;
                matchedArchivers: number;
                failedRadixes: string | null;
                lastSyncAttempt: number | null;
                syncAttempts: number | null;
            };

            return {
                cycle: typedResult.cycle,
                type: typedResult.type as CheckpointStatusType,
                status: typedResult.status as CheckpointSyncStatus,
                timestamp: typedResult.timestamp,
                totalArchivers: typedResult.totalArchivers,
                matchedArchivers: typedResult.matchedArchivers,
                failedRadixes: typedResult.failedRadixes ? DeSerializeFromJsonString(typedResult.failedRadixes) : undefined,
                lastSyncAttempt: typedResult.lastSyncAttempt ?? undefined,
                syncAttempts: typedResult.syncAttempts ?? undefined
            };
        });
    } catch (err) {
        Logger.mainLogger.error('Error getting failed checkpoint statuses:', err)
        throw err
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
      WHERE status IN (?, ?)
      ORDER BY cycle ASC
      LIMIT 1
    `

        const result = await db.get(checkpointStatusDatabase, sql, [
            CheckpointSyncStatus.PENDING,
            CheckpointSyncStatus.FAILED
        ])

        if (!result) {
            return null
        }

        // Add type assertion to fix TypeScript errors
        const typedResult = result as {
            cycle: number;
            type: string;
            status: string;
            timestamp: number;
            totalArchivers: number;
            matchedArchivers: number;
            failedRadixes: string | null;
            lastSyncAttempt: number | null;
            syncAttempts: number | null;
        };

        return {
            cycle: typedResult.cycle,
            type: typedResult.type as CheckpointStatusType,
            status: typedResult.status as CheckpointSyncStatus,
            timestamp: typedResult.timestamp,
            totalArchivers: typedResult.totalArchivers,
            matchedArchivers: typedResult.matchedArchivers,
            failedRadixes: typedResult.failedRadixes ? DeSerializeFromJsonString(typedResult.failedRadixes) : undefined,
            lastSyncAttempt: typedResult.lastSyncAttempt ?? undefined,
            syncAttempts: typedResult.syncAttempts ?? undefined
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
      WHERE status IN (?, ?)
    `

        const result = await db.get(checkpointStatusDatabase, sql, [
            CheckpointSyncStatus.PENDING,
            CheckpointSyncStatus.FAILED
        ])

        // Add type assertion to fix TypeScript errors
        const typedResult = result as {
            minCycle: number | null;
            maxCycle: number | null;
        };

        if (!typedResult || typedResult.minCycle === null || typedResult.maxCycle === null) {
            return null
        }

        return {
            minCycle: typedResult.minCycle,
            maxCycle: typedResult.maxCycle
        }
    } catch (err) {
        Logger.mainLogger.error('Error getting checkpoint sync range:', err)
        throw err
    }
} 