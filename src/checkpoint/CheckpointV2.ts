import * as Logger from '../Logger'
import { config } from '../Config'
import * as Data from '../Data/Data'
import * as Cycles from '../Data/Cycles'
import { getLastUpdatedCycle, updateLastUpdatedCycle } from '../utils/cycleTracker'
import { processCyclesNeedingSync } from '../dbstore/checkpointStatus'

/**
 * Syncs missing or failed checkpoint data
 * @param maxCyclesToSync Maximum number of cycles to process in one batch
 */
export async function syncMissingCheckpoints(maxCyclesToSync: number = 100): Promise<void> {
  try {
    // Get the last updated cycle from tracker file
    const lastUpdatedCycle = await getLastUpdatedCycle()
    Logger.mainLogger.debug(`[syncMissingCheckpoints] Last updated cycle from tracker: ${lastUpdatedCycle}`)

    // Get the current network cycle count
    let currentCycle = -1
    try {
      // Try to get the latest cycle from other archivers
      const newestCycle = await Cycles.getNewestCycleFromArchivers()
      if (newestCycle && newestCycle.counter !== undefined) {
        currentCycle = newestCycle.counter
      }
    } catch (error) {
      Logger.mainLogger.warn('[syncMissingCheckpoints] Failed to get network cycle count:', error)
      return
    }

    if (currentCycle < 0) {
      Logger.mainLogger.warn('[syncMissingCheckpoints] Could not determine current network cycle')
      return
    }

    Logger.mainLogger.info(`[syncMissingCheckpoints] Processing cycles from ${lastUpdatedCycle} to ${currentCycle}`)

    // Track how many cycles we've processed in this run
    let processedCount = 0
    let syncedCount = 0

    // Process cycles in batches that need syncing
    await processCyclesNeedingSync(lastUpdatedCycle, currentCycle, maxCyclesToSync, async (cycle: number) => {
      processedCount++
      try {
        Logger.mainLogger.debug(`[syncMissingCheckpoints] Syncing data for cycle ${cycle}`)
        // Sync cycle data
        await Data.syncCycleData(cycle)
        // Sync receipt data
        await Data.syncReceiptsByCycle(cycle, cycle)
        // Update the tracker with the latest cycle we've processed
        updateLastUpdatedCycle(cycle)
        syncedCount++
      } catch (cycleError) {
        Logger.mainLogger.error(`[syncMissingCheckpoints] Error syncing cycle ${cycle}:`, cycleError)
      }
    })

    if (processedCount > 0) {
      Logger.mainLogger.info(
        `[syncMissingCheckpoints] Processed ${processedCount} cycles, successfully synced ${syncedCount}`
      )
    } else {
      Logger.mainLogger.debug('[syncMissingCheckpoints] No checkpoints need syncing')
    }
  } catch (error) {
    Logger.mainLogger.error('[syncMissingCheckpoints] Error syncing missing checkpoints:', error)
  }
}

/**
 * Schedules periodic syncing of missing checkpoints
 */
export function scheduleMissingCheckpointSync(): void {
  const syncInterval = config.checkpointSyncInterval || 1 * 60 * 1000 // Default to 1 minute
  let syncActive = true // Flag to track if syncing should continue

  async function syncCheckpoints() {
    try {
      if (!syncActive) {
        Logger.mainLogger.info(
          '[syncCheckpoints] Checkpoint sync has been stopped as stored cycle count matches network cycle count'
        )
        return // Exit the sync loop if syncing is no longer needed
      }

      // Get the current stored cycle count
      const storedCycleCount = Cycles.getCurrentCycleCounter()

      // Get the network cycle count
      let networkCycleCount = -1
      try {
        // Try to get the latest cycle from other archivers
        const newestCycle = await Cycles.getNewestCycleFromArchivers()
        if (newestCycle && newestCycle.counter !== undefined) {
          networkCycleCount = newestCycle.counter
        }
      } catch (error) {
        Logger.mainLogger.warn('[syncCheckpoints] Failed to get network cycle count, will continue syncing:', error)
      }

      // If we have valid cycle counts and they match, stop syncing
      if (storedCycleCount >= 0 && networkCycleCount >= 0 && storedCycleCount >= networkCycleCount) {
        Logger.mainLogger.info(
          `[syncCheckpoints] Stopping checkpoint sync as stored cycle count (${storedCycleCount}) matches or exceeds network cycle count (${networkCycleCount})`
        )
        syncActive = false
        return
      }

      // Otherwise, continue with the sync
      await syncMissingCheckpoints()
    } catch (error) {
      Logger.mainLogger.error('[syncCheckpoints] Error in scheduled checkpoint sync:', error)
    }

    // Schedule the next sync if still active
    if (syncActive) {
      setTimeout(syncCheckpoints, Number(syncInterval))
    }
  }

  // Start the sync loop
  syncCheckpoints()
}
