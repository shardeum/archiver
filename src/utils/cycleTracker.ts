import * as fs from 'fs'
import * as path from 'path'
import * as Logger from '../Logger'
import { getCheckpointStatusesByUnifiedStatus } from '../dbstore/checkpointStatus'
import { config } from '../Config'

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
    let data: string

    try {
      data = fs.readFileSync(CYCLE_TRACKER_FILE, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const trackerData: CycleTrackerData = {
          lastUpdatedCycle: 0,
          lastUpdatedTimestamp: 0,
        }

        try {
          const fd = fs.openSync(
            CYCLE_TRACKER_FILE,
            fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
            0o600
          )
          fs.writeFileSync(fd, JSON.stringify(trackerData, null, 2), 'utf8')
          fs.closeSync(fd)
          return 0
        } catch (createError) {
          if ((createError as NodeJS.ErrnoException).code === 'EEXIST') {
            data = fs.readFileSync(CYCLE_TRACKER_FILE, 'utf8')
          } else {
            throw createError
          }
        }
      } else {
        throw error
      }
    }

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
        lastUpdatedTimestamp: Date.now(),
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
    // Get the last updated cycle from the tracker file
    const lastUpdatedCycle = getLastUpdatedCycle()
    
    // Get checkpoint statuses with unified status = true and cycle >= lastUpdatedCycle
    const unifiedStatuses = await getCheckpointStatusesByUnifiedStatus(true, lastUpdatedCycle)

    if (!unifiedStatuses || unifiedStatuses.length === 0) {
      Logger.mainLogger.warn(`No unified cycle statuses found greater than or equal to cycle ${lastUpdatedCycle}`)
      
      // If no cycles found, use max(lastUpdatedCycle - LATEST_CYCLES_TO_SKIP, 0) as fallback
      if (lastUpdatedCycle > 0) {
        const LATEST_CYCLES_TO_SKIP =
          Math.ceil(config.checkpoint.bucketConfig.GiveUpAge / config.checkpoint.bucketConfig.cycleAge) + 1
        
        const fallbackCycle = Math.max(lastUpdatedCycle - LATEST_CYCLES_TO_SKIP, 0)
        Logger.mainLogger.info(`Using fallback cycle: ${fallbackCycle} (lastUpdatedCycle: ${lastUpdatedCycle} - LATEST_CYCLES_TO_SKIP: ${LATEST_CYCLES_TO_SKIP})`)
        return fallbackCycle
      }
      return 0
    }

    // Sort by cycle in descending order
    const sortedStatuses = unifiedStatuses.sort((a, b) => b.cycle - a.cycle)

    // Skip the latest 21 cycles (if available) and get the next unified cycle
    const LATEST_CYCLES_TO_SKIP =
      Math.ceil(config.checkpoint.bucketConfig.GiveUpAge / config.checkpoint.bucketConfig.cycleAge) + 1

    if (sortedStatuses.length <= LATEST_CYCLES_TO_SKIP) {
      // If we have fewer than or equal to 21 unified cycles, we can't get a cycle before the latest 21
      Logger.mainLogger.warn(
        `Not enough unified cycles available (${sortedStatuses.length}). Need more than ${LATEST_CYCLES_TO_SKIP} cycles.`
      )
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
