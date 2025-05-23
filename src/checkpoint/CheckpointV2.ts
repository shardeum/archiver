import * as Logger from '../Logger'
import { config } from '../Config'
import * as Data from '../Data/Data'
import * as Cycles from '../Data/Cycles'
import { getCheckpointStatus, getCheckpointSyncRange } from '../dbstore/checkpointStatus'

import { getLastUpdatedCycle, updateLastUpdatedCycle } from '../utils/cycleTracker'

/**
 * Syncs missing or failed checkpoint data
 * @param maxCyclesToSync Maximum number of cycles to sync in one go
 */
export async function syncMissingCheckpoints(maxCyclesToSync: number = 10): Promise<void> {
  try {
    // Get all cycles that need syncing (have unified status = false)
    const cyclesToSync = await getCheckpointSyncRange()
    if (!cyclesToSync || cyclesToSync.length === 0) {
      Logger.mainLogger.debug('No checkpoints need syncing')
      return
    }

    if (config.VERBOSE) {
      Logger.mainLogger.info(`Found ${cyclesToSync.length} cycles that need syncing`)
    }

    // Get the last updated cycle from tracker file
    const lastUpdatedCycle = getLastUpdatedCycle()
    Logger.mainLogger.debug(`[syncMissingCheckpoints] Last updated cycle from tracker: ${lastUpdatedCycle}`)
    
    // Process all cycles in batches of maxCyclesToSync
    for (let i = 0; i < cyclesToSync.length; i += maxCyclesToSync) {
      // Get the next batch of cycles to process
      const batchCycles = cyclesToSync.slice(i, i + maxCyclesToSync)
      Logger.mainLogger.debug(`[syncMissingCheckpoints] Processing batch of ${batchCycles.length} cycles (${i+1}-${i+batchCycles.length} of ${cyclesToSync.length})`)
      
      // Process each cycle in the current batch
      for (const cycle of batchCycles) {
        try {
          // Check if we need to sync cycle data
          const cycleStatus = await getCheckpointStatus(cycle)
          const needsSync = !cycleStatus || cycleStatus.cycleStatus === false || cycleStatus.unifiedStatus === false
          
          if (needsSync) {
            Logger.mainLogger.debug(`[syncMissingCheckpoints] Syncing data for cycle ${cycle}`)
            // Sync cycle data
            await Data.syncCycleData(cycle)
            // Sync receipt data
            await Data.syncReceiptsByCycle(cycle, cycle)
            
            // Update the tracker with the latest cycle we've processed
            updateLastUpdatedCycle(cycle)
          }
        } catch (cycleError) {
          Logger.mainLogger.error(`[syncMissingCheckpoints] Error syncing cycle ${cycle}:`, cycleError)
        }
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
