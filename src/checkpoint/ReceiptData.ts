import {
  CheckpointBucketManager,
  CheckpointData,
  CheckpointRadixEntry,
  CheckpointRadixDigest,
  CheckpointType,
  DataPersistenceCallbacks,
  CheckpointBucket,
  RadixDigestTally,
} from './CheckpointData'
import { Receipt as ReceiptType, ArchiverReceipt, SignedReceipt, insertReceipt } from '../dbstore/receipts'
import * as Logger from '../Logger'
import * as Crypto from '../Crypto'
import { verifyAppReceiptData } from '../shardeum/verifyAppReceiptData'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

export class ReceiptCheckpointData extends CheckpointData<ReceiptType> {
  constructor(receipt: ReceiptType) {
    const receiptHash = Crypto.hash(StringUtils.safeStringify(receipt)).toLowerCase()

    super(
      receiptHash.substring(0, 2), // address (first 2 chars)
      receipt.tx.timestamp, // timestamp
      receiptHash, // hash
      CheckpointType.Receipt, // class type 2 for receipts
      receipt // data
    )
  }
}

export function calculateBucketID(receipt: ReceiptType): string {
  if (!receipt || receipt.tx.timestamp === undefined) {
    Logger.mainLogger.error('Invalid receipt data')
    throw new Error('Invalid receipt data')
  }
  return receipt.cycle.toString()
}

//Represents a single radix entry in a bucket
export class ReceiptCheckpointRadixEntry extends CheckpointRadixEntry<ReceiptType> {
  constructor(radix: string) {
    super(radix)
  }
}

//Represents a single radix entry in a bucket
export class ReceiptCheckpointRadixDigest extends CheckpointRadixDigest {
  constructor(radix: string, hash: string, itemCount: number) {
    super(radix, hash, itemCount)
  }
}

//Represents a single bucket in the system
export class ReceiptCheckpointBucket extends CheckpointBucket<ReceiptType> {
  constructor(
    startTime: number,
    endTime: number,
    bucketID: string,
    validateData: (data: CheckpointData<ReceiptType>) => Promise<boolean>,
    updateData: (data: CheckpointData<ReceiptType>) => Promise<void>
  ) {
    super(startTime, endTime, bucketID, validateData, updateData, CheckpointType.Receipt)
  }

  async update(currentTime: number): Promise<void> {
    // Call parent update first
    super.update(currentTime)
  }
}

class ReceiptCheckpointManager extends CheckpointBucketManager<ReceiptType> {
  private static instance: ReceiptCheckpointManager

  private constructor() {
    const persistenceCallbacks: DataPersistenceCallbacks<ReceiptType | ArchiverReceipt> = {
      validateData: validateData,
      updateData: updateData,
    }
    super(persistenceCallbacks, CheckpointType.Receipt)
  }

  public static getInstance(): ReceiptCheckpointManager {
    if (!ReceiptCheckpointManager.instance) {
      ReceiptCheckpointManager.instance = new ReceiptCheckpointManager()
    }
    return ReceiptCheckpointManager.instance
  }
}

//Represents a tally of all radix entries in the system
export class ReceiptRadixDigestTally extends RadixDigestTally {
  constructor(radix: string) {
    super(radix)
  }
}

async function validateData(data: CheckpointData<ReceiptType>): Promise<boolean> {
  try {
    const verifyHash = Crypto.hash(StringUtils.safeStringify(data.d)).toLowerCase()

    if (verifyHash !== data.h) {
      return false
    }

    const appValidation = await verifyAppReceiptData(data.d, null, [], [])
    return appValidation.valid
  } catch (err) {
    Logger.mainLogger.error('ValidateData failed:', err)
    return false
  }
}

async function updateData(data: CheckpointData<ReceiptType>): Promise<void> {
  try {
    // Insert/Update into checkpoint_data table
    const receipt = data.d
    // Avg entry size is about 41000 bytes
    await storeReceiptData([receipt], '', false, false, false)
  } catch (err) {
    Logger.mainLogger.error('Failed to store receipt checkpoint data:', err)
    throw err
  }
}

// Export the singleton instance
export const receiptCheckpointManager = ReceiptCheckpointManager.getInstance()
