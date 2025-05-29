import * as fs from 'fs'
import * as path from 'path'
import * as Logger from '../Logger'
import { getCheckpointStatusesByUnifiedStatus, getOldestPendingOrFailedCheckpointStatus, getSpecificUnifiedCycle } from '../dbstore/checkpointStatus'
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
export async function getLastUpdatedCycle(): Promise<number> {
  try {
    let data: string

    try {
      data = fs.readFileSync(CYCLE_TRACKER_FILE, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // If file doesn't exist, try to get the oldest pending or failed checkpoint status
        try {
          const oldestPendingOrFailedStatus = await getOldestPendingOrFailedCheckpointStatus()
          if (oldestPendingOrFailedStatus) {
            Logger.mainLogger.info(`No cycle tracker file found. Using oldest pending/failed checkpoint cycle: ${oldestPendingOrFailedStatus.cycle}`)
            
            // Create the tracker file with the oldest pending/failed cycle
            const trackerData: CycleTrackerData = {
              lastUpdatedCycle: oldestPendingOrFailedStatus.cycle,
              lastUpdatedTimestamp: Date.now(),
            }
            
            try {
              const fd = fs.openSync(
                CYCLE_TRACKER_FILE,
                fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
                0o600
              )
              fs.writeFileSync(fd, JSON.stringify(trackerData, null, 2), 'utf8')
              fs.closeSync(fd)
              return oldestPendingOrFailedStatus.cycle
            } catch (createError) {
              if ((createError as NodeJS.ErrnoException).code === 'EEXIST') {
                data = fs.readFileSync(CYCLE_TRACKER_FILE, 'utf8')
              } else {
                throw createError
              }
            }
          } else {
            // No pending/failed status found, create file with cycle 0
            Logger.mainLogger.info('No cycle tracker file and no pending/failed checkpoint statuses found. Starting from cycle 0.')
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
          }
        } catch (statusError) {
          Logger.mainLogger.error('Error getting oldest pending/failed checkpoint status:', statusError)
          
          // Create file with cycle 0 as fallback
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
export async function updateLastUpdatedCycle(cycle: number): Promise<void> {
  const lastUpdatedCycle = await getLastUpdatedCycle()
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
    const lastUpdatedCycle = await getLastUpdatedCycle()
    
    // Calculate how many cycles to skip
    const LATEST_CYCLES_TO_SKIP =
      Math.ceil(config.checkpoint.bucketConfig.GiveUpAge / config.checkpoint.bucketConfig.cycleAge) + 1
    
    // Get the specific unified cycle directly from the database
    // This will get the (LATEST_CYCLES_TO_SKIP)th unified cycle
    const specificCycle = await getSpecificUnifiedCycle(lastUpdatedCycle, LATEST_CYCLES_TO_SKIP)
    
    if (specificCycle !== null) {
      Logger.mainLogger.debug(`Found unified cycle ${specificCycle} after skipping ${LATEST_CYCLES_TO_SKIP} cycles`)
      return specificCycle
    }
    
    Logger.mainLogger.warn(`No unified cycle found after skipping ${LATEST_CYCLES_TO_SKIP} cycles from ${lastUpdatedCycle}`)
    
    // If no cycles found, use max(lastUpdatedCycle - LATEST_CYCLES_TO_SKIP, 0) as fallback
    if (lastUpdatedCycle > 0) {
      const fallbackCycle = Math.max(lastUpdatedCycle - LATEST_CYCLES_TO_SKIP, 0)
      Logger.mainLogger.info(`Using fallback cycle: ${fallbackCycle} (lastUpdatedCycle: ${lastUpdatedCycle} - LATEST_CYCLES_TO_SKIP: ${LATEST_CYCLES_TO_SKIP})`)
      return fallbackCycle
    }
    
    return 0
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
