import * as db from '../dbstore/sqlite3storage'
import {
  CheckpointBucketManager,
  CheckpointData,
  CheckpointRadixEntry,
  CheckpointRadixDigest,
  CheckpointBucket,
  CheckpointType,
  DataPersistenceCallbacks,
} from './CheckpointData'
import * as Crypto from '../Crypto'
import { OriginalTxData } from '../dbstore/originalTxsData'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { originalTxDataDatabase } from '../dbstore'
import * as Logger from '../Logger'
import { SerializeToJsonString } from '../utils/serialization'
import { validateOriginalTxDataSchema } from '../Data/Collector'
import { config } from '../Config'
import { calculateDataSize } from './Utils'

export class OriginalTxCheckpointData extends CheckpointData<OriginalTxData> {
  constructor(data: OriginalTxData) {
    const originalTxHash = Crypto.hash(StringUtils.safeStringify(data)).toLowerCase()

    super(
      originalTxHash.substring(0, 2), // address (first 2 chars)
      data.timestamp, // timestamp
      originalTxHash, // hash
      CheckpointType.OriginalTx, // class_type 1 for originalTx
      data // data
    )
  }
}

export function calculateBucketID(originalTx: OriginalTxData): string {
  if (!originalTx || originalTx.txId === undefined) {
    Logger.mainLogger.error('Invalid originalTx data')
    throw new Error('Invalid originalTx data')
  }
  return originalTx.cycle.toString()
}

//Represents a single radix entry in a bucket
export class OriginalTxCheckpointRadixEntry extends CheckpointRadixEntry<OriginalTxData> {
  constructor(radix: string) {
    super(radix)
  }
}

//Represents a single radix entry in a bucket
export class OriginalTxCheckpointRadixDigest extends CheckpointRadixDigest {
  constructor(radix: string, hash: string, itemCount: number) {
    super(radix, hash, itemCount)
  }
}

export class OriginalTxCheckpointBucket extends CheckpointBucket<OriginalTxData> {
  constructor(
    startTime: number,
    endTime: number,
    bucketID: string,
    validateData: (data: CheckpointData<OriginalTxData>) => Promise<boolean>,
    updateData: (data: CheckpointData<OriginalTxData>) => Promise<void>
  ) {
    super(startTime, endTime, bucketID, validateData, updateData, CheckpointType.OriginalTx)
  }
  async update(currentTime: number): Promise<void> {
    // Call parent update first
    super.update(currentTime)
  }
}

class OriginalTxCheckpointManager extends CheckpointBucketManager<OriginalTxData> {
  private static instance: OriginalTxCheckpointManager

  private constructor() {
    const persistenceCallbacks: DataPersistenceCallbacks<OriginalTxData> = {
      validateData,
      updateData,
    }
    super(persistenceCallbacks, CheckpointType.OriginalTx)
  }

  public static getInstance(): OriginalTxCheckpointManager {
    if (!OriginalTxCheckpointManager.instance) {
      OriginalTxCheckpointManager.instance = new OriginalTxCheckpointManager()
    }
    return OriginalTxCheckpointManager.instance
  }
}

// Define the updateData function
async function updateData(data: CheckpointData<OriginalTxData>): Promise<void> {
  try {
    // Insert/Update into originalTxsData table
    const columns = ['txId', 'timestamp', 'cycle', 'originalTxData']
    const originalTx = data.d
    const sql = `INSERT OR REPLACE INTO originalTxsData (${columns.join(', ')}) VALUES (?, ?, ?, ?)`

    // Map the `originalTx` object to match the columns
    const values = [
      originalTx.txId,
      data.t,
      originalTx.cycle,
      typeof originalTx.originalTxData === 'object'
        ? SerializeToJsonString(originalTx.originalTxData) // Serialize objects to JSON
        : originalTx.originalTxData,
    ]

    // Calculate the size of the data being written (in UTF-8 bytes)
    const dataSize = calculateDataSize(values)
    if (config.VERBOSE) {
      Logger.mainLogger.info(
        `Size of data being written to originalTxsData table for cycle ${originalTx.cycle}: ${dataSize} bytes`
      )
    }
    // Execute the query directly (single-row insert)
    await db.run(originalTxDataDatabase, sql, values)
  } catch (err) {
    Logger.mainLogger.error('Failed to store originalTx checkpoint data:', err)
    throw err
  }
}

// Define the validateData function
async function validateData(data: CheckpointData<OriginalTxData>): Promise<boolean> {
  // Reuse existing validation logic
  return validateOriginalTxDataSchema(data.d)
}

// Export the singleton instance
export const originalTxCheckpointManager = OriginalTxCheckpointManager.getInstance()
