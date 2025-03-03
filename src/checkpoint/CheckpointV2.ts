import * as Logger from '../Logger'
import { config } from '../Config'
import * as State from '../State'
import * as Data from '../Data/Data'
import * as Cycles from '../Data/Cycles'
import {
    CheckpointStatus,
    CheckpointStatusType,
    CheckpointSyncStatus,
    upsertCheckpointStatus,
    updateCheckpointStatus,
    getCheckpointStatus,
    getCheckpointSyncRange
} from '../dbstore/checkpointStatus'
import { CheckpointBucket, CheckpointType } from './CheckpointData'
import { cycleCheckpointManager } from './CycleData'
import { receiptCheckpointManager } from './ReceiptData'
import { originalTxCheckpointManager } from './OriginalTxsData'

/**
 * Converts CheckpointType to CheckpointStatusType
 * @param checkpointType The CheckpointType to convert
 * @returns The corresponding CheckpointStatusType
 */
function mapCheckpointTypeToStatusType(checkpointType: CheckpointType): CheckpointStatusType {
    switch (checkpointType) {
        case CheckpointType.Cycle:
            return CheckpointStatusType.CYCLE
        case CheckpointType.Receipt:
            return CheckpointStatusType.RECEIPT
        case CheckpointType.OriginalTx:
            return CheckpointStatusType.ORIGINAL_TX
        default:
            throw new Error(`Unknown checkpoint type: ${checkpointType}`)
    }
}

/**
 * Records the status of a checkpoint bucket when it ages out
 * @param bucket The checkpoint bucket that is aging out
 * @param checkpointType The type of checkpoint
 */
export async function recordCheckpointStatus(
    bucket: CheckpointBucket<any>,
    checkpointType: CheckpointType
): Promise<void> {
    try {
        const cycle = parseInt(bucket.bucketID, 10)
        if (isNaN(cycle)) {
            Logger.mainLogger.error(`Could not parse cycle number from bucket ID: ${bucket.bucketID}`)
            return
        }

        // Calculate if we have majority consensus
        const totalArchivers = State.activeArchivers.length
        const requiredMajority = Math.floor(totalArchivers / 2) + 1

        // Check each radix entry for consensus
        const failedRadixes: string[] = []
        let matchedArchivers = 0

        // Count how many radixes have majority consensus
        let radixesWithMajority = 0

        for (const [radix, entry] of bucket.peerRadixDigests.entries()) {
            let maxVotes = 0
            let totalVotes = 0

            // Find the hash with the most votes
            for (const [hash, votes] of entry.hashTally.entries()) {
                totalVotes += votes
                if (votes > maxVotes) {
                    maxVotes = votes
                }
            }

            // If we have majority consensus for this radix
            if (maxVotes >= requiredMajority) {
                radixesWithMajority++
            } else {
                failedRadixes.push(radix)
            }
        }

        // Calculate the percentage of archivers that agree with us
        // This is a rough estimate based on the number of radixes with majority consensus
        const consensusPercentage = bucket.radixEntries.size > 0
            ? radixesWithMajority / bucket.radixEntries.size
            : 0

        // Estimate the number of archivers that agree with us
        matchedArchivers = Math.floor(consensusPercentage * totalArchivers)

        // Determine the status based on consensus
        const status = matchedArchivers >= requiredMajority
            ? CheckpointSyncStatus.COMPLETED
            : CheckpointSyncStatus.FAILED

        // Record the checkpoint status
        const checkpointStatus: CheckpointStatus = {
            cycle,
            type: mapCheckpointTypeToStatusType(checkpointType),
            status,
            timestamp: Date.now(),
            totalArchivers,
            matchedArchivers,
            failedRadixes: failedRadixes.length > 0 ? failedRadixes : undefined
        }

        await upsertCheckpointStatus(checkpointStatus)
    } catch (error) {
        Logger.mainLogger.error('Error recording checkpoint status:', error)
    }
}

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
        Logger.mainLogger.info(`Syncing checkpoints from cycle ${minCycle} to ${maxCycle}`)

        // Limit the number of cycles to sync at once
        const endCycle = Math.min(minCycle + maxCyclesToSync - 1, maxCycle)

        // Get the oldest pending or failed checkpoint
        for (let cycle = minCycle; cycle <= endCycle; cycle++) {
            // Check if we need to sync cycle data
            const cycleStatus = await getCheckpointStatus(cycle, CheckpointStatusType.CYCLE)
            if (!cycleStatus || cycleStatus.status === CheckpointSyncStatus.PENDING || cycleStatus.status === CheckpointSyncStatus.FAILED) {
                await updateCheckpointStatus(cycle, CheckpointStatusType.CYCLE, CheckpointSyncStatus.SYNCING)

                try {
                    // Sync cycle data
                    Logger.mainLogger.info(`Syncing cycle data for cycle ${cycle}`)
                    await Data.syncCycleData(cycle)

                    // Mark as completed
                    await updateCheckpointStatus(cycle, CheckpointStatusType.CYCLE, CheckpointSyncStatus.COMPLETED)
                } catch (error) {
                    Logger.mainLogger.error(`Error syncing cycle data for cycle ${cycle}:`, error)
                    await updateCheckpointStatus(cycle, CheckpointStatusType.CYCLE, CheckpointSyncStatus.FAILED)
                }
            }

            // Check if we need to sync receipt data
            const receiptStatus = await getCheckpointStatus(cycle, CheckpointStatusType.RECEIPT)
            if (!receiptStatus || receiptStatus.status === CheckpointSyncStatus.PENDING || receiptStatus.status === CheckpointSyncStatus.FAILED) {
                await updateCheckpointStatus(cycle, CheckpointStatusType.RECEIPT, CheckpointSyncStatus.SYNCING)

                try {
                    // Sync receipt data
                    Logger.mainLogger.info(`Syncing receipt data for cycle ${cycle}`)
                    await Data.syncReceiptsByCycle(cycle, cycle)

                    // Mark as completed
                    await updateCheckpointStatus(cycle, CheckpointStatusType.RECEIPT, CheckpointSyncStatus.COMPLETED)
                } catch (error) {
                    Logger.mainLogger.error(`Error syncing receipt data for cycle ${cycle}:`, error)
                    await updateCheckpointStatus(cycle, CheckpointStatusType.RECEIPT, CheckpointSyncStatus.FAILED)
                }
            }

            // Check if we need to sync original tx data
            const originalTxStatus = await getCheckpointStatus(cycle, CheckpointStatusType.ORIGINAL_TX)
            if (!originalTxStatus || originalTxStatus.status === CheckpointSyncStatus.PENDING || originalTxStatus.status === CheckpointSyncStatus.FAILED) {
                await updateCheckpointStatus(cycle, CheckpointStatusType.ORIGINAL_TX, CheckpointSyncStatus.SYNCING)

                try {
                    // Sync original tx data
                    Logger.mainLogger.info(`Syncing original tx data for cycle ${cycle}`)
                    await Data.syncOriginalTxsByCycle(cycle, cycle)

                    // Mark as completed
                    await updateCheckpointStatus(cycle, CheckpointStatusType.ORIGINAL_TX, CheckpointSyncStatus.COMPLETED)
                } catch (error) {
                    Logger.mainLogger.error(`Error syncing original tx data for cycle ${cycle}:`, error)
                    await updateCheckpointStatus(cycle, CheckpointStatusType.ORIGINAL_TX, CheckpointSyncStatus.FAILED)
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
                Logger.mainLogger.info(`Stopping checkpoint sync as stored cycle count (${storedCycleCount}) matches or exceeds network cycle count (${networkCycleCount})`)
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

/**
 * Initializes the checkpoint V2 system
 */
export function initCheckpointV2(): void {
    // Patch the CheckpointBucketManager.update method to record checkpoint status
    const originalUpdate = cycleCheckpointManager.update

    cycleCheckpointManager.update = async function () {
        const currentTime = Math.floor(Date.now() / 1000)
        const toRemove: string[] = []

        // Process buckets that are aging out
        for (const [id, bucket] of this.checkpointBuckets.entries()) {
            if (currentTime > bucket.GiveUpAge) {
                // Record the checkpoint status before removing
                await recordCheckpointStatus(bucket, this.checkpointType)
                toRemove.push(id)
            }
        }

        // Call the original update method
        await originalUpdate.call(this)
    }

    // Do the same for receipt and original tx checkpoint managers
    const originalReceiptUpdate = receiptCheckpointManager.update
    receiptCheckpointManager.update = async function () {
        const currentTime = Math.floor(Date.now() / 1000)
        const toRemove: string[] = []

        for (const [id, bucket] of this.checkpointBuckets.entries()) {
            if (currentTime > bucket.GiveUpAge) {
                await recordCheckpointStatus(bucket, this.checkpointType)
                toRemove.push(id)
            }
        }

        await originalReceiptUpdate.call(this)
    }

    const originalOriginalTxUpdate = originalTxCheckpointManager.update
    originalTxCheckpointManager.update = async function () {
        const currentTime = Math.floor(Date.now() / 1000)
        const toRemove: string[] = []

        for (const [id, bucket] of this.checkpointBuckets.entries()) {
            if (currentTime > bucket.GiveUpAge) {
                await recordCheckpointStatus(bucket, this.checkpointType)
                toRemove.push(id)
            }
        }

        await originalOriginalTxUpdate.call(this)
    }

    // Schedule periodic syncing of missing checkpoints
    scheduleMissingCheckpointSync()
} 