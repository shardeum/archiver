import * as Logger from '../Logger'
import { config } from '../Config'
import * as Data from '../Data/Data'
import * as Cycles from '../Data/Cycles'
import { getCheckpointStatus, getCheckpointSyncRange } from '../dbstore/checkpointStatus'

/**
 * Syncs missing or failed checkpoint data
 * @param maxCyclesToSync Maximum number of cycles to sync in one go
 */
export async function syncMissingCheckpoints(maxCyclesToSync: number = 10): Promise<void> {
  try {
    // Get the range of cycles that need syncing
    const syncRange = await getCheckpointSyncRange()
    if (!syncRange) {
      Logger.mainLogger.debug('No checkpoints need syncing')
      return
    }

    const { minCycle, maxCycle } = syncRange
    if (config.VERBOSE) {
      Logger.mainLogger.info(`Syncing checkpoints from cycle ${minCycle} to ${maxCycle}`)
    }

    // Limit the number of cycles to sync at once
    const endCycle = Math.min(minCycle + maxCyclesToSync - 1, maxCycle)

    // Process each cycle in the sync range
    for (let cycle = minCycle; cycle <= endCycle; cycle++) {
      // Check if we need to sync cycle data
      const cycleStatus = await getCheckpointStatus(cycle)
      const needsSync = !cycleStatus || cycleStatus.cycleStatus === false || cycleStatus.unifiedStatus === false
      if (needsSync) {
        // Sync cycle data
        await Data.syncCycleData(cycle)
        // Sync receipt data
        await Data.syncReceiptsByCycle(cycle, cycle)
      }
    }
  } catch (error) {
    Logger.mainLogger.error('Error syncing missing checkpoints:', error)
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
        Logger.mainLogger.info('Checkpoint sync has been stopped as stored cycle count matches network cycle count')
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
        Logger.mainLogger.warn('Failed to get network cycle count, will continue syncing:', error)
      }

      // If we have valid cycle counts and they match, stop syncing
      if (storedCycleCount >= 0 && networkCycleCount >= 0 && storedCycleCount >= networkCycleCount) {
        Logger.mainLogger.info(
          `Stopping checkpoint sync as stored cycle count (${storedCycleCount}) matches or exceeds network cycle count (${networkCycleCount})`
        )
        syncActive = false
        return
      }

      // Otherwise, continue with the sync
      await syncMissingCheckpoints()
    } catch (error) {
      Logger.mainLogger.error('Error in scheduled checkpoint sync:', error)
    }

    // Schedule the next sync if still active
    if (syncActive) {
      setTimeout(syncCheckpoints, Number(syncInterval))
    }
  }

  // Start the sync loop
  syncCheckpoints()
}
