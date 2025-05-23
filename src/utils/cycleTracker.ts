import * as fs from 'fs'
import * as path from 'path'
import * as Logger from '../Logger'
import { getCheckpointStatusesByUnifiedStatus } from '../dbstore/checkpointStatus'

interface CycleTrackerData {
  lastUpdatedCycle: number
  lastUpdatedTimestamp: number
}

const CYCLE_TRACKER_FILE = path.join(process.cwd(), 'cycle-tracker.json')

/**
 * Gets the last updated cycle from the tracker file
 * @returns The last updated cycle number, or 0 if not found
 */
export function getLastUpdatedCycle(): number {
  try {
    // If the file does not exist, create it with default values
    if (!fs.existsSync(CYCLE_TRACKER_FILE)) {
      const trackerData: CycleTrackerData = {
        lastUpdatedCycle: 0,
        lastUpdatedTimestamp: 0
      }

      fs.writeFileSync(CYCLE_TRACKER_FILE, JSON.stringify(trackerData, null, 2), 'utf8')
    }

    const data = fs.readFileSync(CYCLE_TRACKER_FILE, 'utf8')
    const trackerData: CycleTrackerData = JSON.parse(data)
    return trackerData.lastUpdatedCycle
  } catch (error) {
    Logger.mainLogger.error('Error reading cycle tracker file:', error)
    return 0
  }
}

/**
 * Updates the last updated cycle in the tracker file
 * @param cycle The cycle number to update
 */
export function updateLastUpdatedCycle(cycle: number): void {
  const lastUpdatedCycle = getLastUpdatedCycle()
  if (cycle > lastUpdatedCycle) {
    try {
      const trackerData: CycleTrackerData = {
        lastUpdatedCycle: cycle,
        lastUpdatedTimestamp: Date.now()
      }

      fs.writeFileSync(CYCLE_TRACKER_FILE, JSON.stringify(trackerData, null, 2), 'utf8')
      Logger.mainLogger.debug(`Updated cycle tracker to cycle ${cycle}`)
    } catch (error) {
      Logger.mainLogger.error('Error updating cycle tracker file:', error)
    }
  }
}

/**
 * Gets the latest unified cycle counter value from the checkpoint status database
 * excluding the latest 21 cycles since the checkpoint system works on those
 * @returns The latest unified cycle number before the latest 21 cycles, or 0 if not found
 */
async function getLatestUnifiedCycle(): Promise<number> {
  try {
    // Get all checkpoint statuses with unified status = true
    const unifiedStatuses = await getCheckpointStatusesByUnifiedStatus(true)
    
    if (!unifiedStatuses || unifiedStatuses.length === 0) {
      Logger.mainLogger.warn('No unified cycle statuses found')
      return 0
    }
    
    // Sort by cycle in descending order
    const sortedStatuses = unifiedStatuses.sort((a, b) => b.cycle - a.cycle)
    
    // Skip the latest 21 cycles (if available) and get the next unified cycle
    const LATEST_CYCLES_TO_SKIP = 21
    
    if (sortedStatuses.length <= LATEST_CYCLES_TO_SKIP) {
      // If we have fewer than or equal to 21 unified cycles, we can't get a cycle before the latest 21
      Logger.mainLogger.warn(`Not enough unified cycles available (${sortedStatuses.length}). Need more than ${LATEST_CYCLES_TO_SKIP} cycles.`)
      return 0
    }
    
    // Return the cycle number at index 21 (which is the 22nd item, after skipping 21 items)
    return sortedStatuses[LATEST_CYCLES_TO_SKIP].cycle
  } catch (error) {
    Logger.mainLogger.error('Error getting latest unified cycle:', error)
    return 0
  }
}

/**
 * Updates the cycle tracker with the latest unified cycle counter value
 * This is called during shutdown to ensure we have the latest cycle information
 */
export async function updateCycleTrackerOnShutdown(): Promise<void> {
  try {
    // Get the latest unified cycle counter value
    const latestUnifiedCycle = await getLatestUnifiedCycle()
    
    if (latestUnifiedCycle > 0) {
      Logger.mainLogger.info(`Updating cycle tracker with latest unified cycle: ${latestUnifiedCycle}`)
      updateLastUpdatedCycle(latestUnifiedCycle)
    } else {
      Logger.mainLogger.warn('No valid unified cycle found during shutdown')
    }
  } catch (error) {
    Logger.mainLogger.error('Error updating cycle tracker during shutdown:', error)
  }
}