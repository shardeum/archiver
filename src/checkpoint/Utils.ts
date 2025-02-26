import * as Logger from '../Logger'
import { CheckpointType, CheckpointBucketManager } from './CheckpointData'
import { cycleCheckpointManager } from './CycleData'
import { originalTxCheckpointManager } from './OriginalTxsData'
import { receiptCheckpointManager } from './ReceiptData'

// Map of checkpoint types to their respective managers.
const checkpointManagers: Record<CheckpointType, CheckpointBucketManager<any>> = {
  [CheckpointType.Cycle]: cycleCheckpointManager,
  [CheckpointType.OriginalTx]: originalTxCheckpointManager,
  [CheckpointType.Receipt]: receiptCheckpointManager,
}

/**
 * Retrieves the checkpoint manager for the specified checkpoint type.
 * @param checkpointType - The type of checkpoint for which to retrieve the manager.
 * @returns The corresponding CheckpointBucketManager or undefined if not found.
 */
export const getCheckpointManager = (
  checkpointType: CheckpointType
): CheckpointBucketManager<any> | undefined => {
  try {
    return checkpointManagers[checkpointType]
  } catch (error) {
    Logger.mainLogger.error('Error getting checkpoint manager:', error)
    return undefined
  }
}

export const calculateDataSize = (values: any[]): number => {
  return values.reduce<number>((total, value) => {
    // If value is a string, return its byte length; otherwise, convert to string first
    const stringValue = typeof value === 'string' ? value : String(value)
    return total + Buffer.byteLength(stringValue, 'utf8')
  }, 0)
}
