import { Cycle } from '../dbstore/types'
import {
  CheckpointBucket,
  CheckpointBucketManager,
  CheckpointData,
  CheckpointRadixDigest,
  CheckpointRadixEntry,
  RadixDigestTally,
  DataPersistenceCallbacks,
  CheckpointType,
} from './CheckpointData'
import * as Crypto from '../Crypto'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import * as Logger from '../Logger'
import * as db from '../dbstore/sqlite3storage'
import { SerializeToJsonString } from '../utils/serialization'
import { cycleDatabase } from '../dbstore'

//Represents a single piece of cycle data
export class CycleCheckpointData extends CheckpointData<Cycle> {
  constructor(cycle: Cycle) {
    const cycleHash = Crypto.hash(StringUtils.safeStringify(cycle)).toLowerCase()

    super(
      cycleHash.substring(0, 2), // address (first 2 chars)
      cycle.cycleRecord.start, // timestamp from cycleRecord
      cycleHash, // hash
      0, // class type 0 for cycle
      cycle // data
    )
  }
}

export function calculateBucketID(cycle: Cycle): string {
  if (!cycle || cycle.counter === undefined) {
    Logger.mainLogger.error('Invalid cycle data')
    throw new Error('Invalid cycle data')
  }

  return cycle.counter.toString()
}

//Represents a single radix entry in a bucket
export class CycleCheckpointRadixEntry extends CheckpointRadixEntry<Cycle> {
  constructor(radix: string) {
    super(radix)
  }
}

//Represents a single radix entry in a bucket
export class CycleCheckpointRadixDigest extends CheckpointRadixDigest {
  constructor(radix: string, hash: string, itemCount: number) {
    super(radix, hash, itemCount)
  }
}

//Represents a single bucket in the system
export class CycleCheckpointBucket extends CheckpointBucket<Cycle> {
  constructor(
    startTime: number,
    endTime: number,
    bucketID: string,
    validateData: (data: CheckpointData<Cycle>) => Promise<boolean>,
    updateData: (data: CheckpointData<Cycle>) => Promise<void>
  ) {
    super(startTime, endTime, bucketID, validateData, updateData, CheckpointType.Cycle)
  }

  async update(currentTime: number): Promise<void> {
    // Call parent update first
    super.update(currentTime)
  }
}

//Manages all buckets, routes incoming data to the correct bucket, and does periodic updates
class CycleCheckpointManager extends CheckpointBucketManager<Cycle> {
  private static instance: CycleCheckpointManager

  private constructor() {
    const persistenceCallbacks: DataPersistenceCallbacks<Cycle> = {
      validateData,
      updateData,
    }
    super(persistenceCallbacks, CheckpointType.Cycle)
  }

  public static getInstance(): CycleCheckpointManager {
    if (!CycleCheckpointManager.instance) {
      CycleCheckpointManager.instance = new CycleCheckpointManager()
    }
    return CycleCheckpointManager.instance
  }
}

//Represents a tally of all radix entries in the system
export class CycleRadixDigestTally extends RadixDigestTally {
  constructor(radix: string) {
    super(radix)
  }
}

// Define the validateData function
async function validateData(data: CheckpointData<Cycle>): Promise<boolean> {
  const cycle = data.d
  // Basic validation checks
  if (!cycle || (cycle.counter === undefined) || !cycle.cycleMarker || !cycle.cycleRecord) {
    Logger.mainLogger.error('Missing required cycle fields')
    return false
  }

  // Validate cycle record fields
  if (!cycle.cycleRecord.start || (cycle.cycleRecord.counter === undefined)) {
    Logger.mainLogger.error('Invalid cycle record fields')
    return false
  }

  // Verify timestamp matches cycle record start time
  if (data.t !== cycle.cycleRecord.start) {
    Logger.mainLogger.error('[CycleValidation] Timestamp mismatch with cycle record')
    return false
  }

  // Verify address matches hash of cycle counter
  const expectedAddress = Crypto.hash(StringUtils.safeStringify(cycle)).toLowerCase().substring(0, 2)

  if (data.a !== expectedAddress) {
    Logger.mainLogger.error('Address mismatch')
    return false
  }

  // Verify hash matches data
  const calculatedHash = Crypto.hash(StringUtils.safeStringify(cycle)).toLowerCase()

  if (calculatedHash !== data.h) {
    Logger.mainLogger.error('Hash mismatch')
    return false
  }

  return true
}

// Define the updateData function
async function updateData(data: CheckpointData<Cycle>): Promise<void> {
  try {
    // Insert/Update into checkpoint_data table
    const columns = ['cycleMarker', 'counter', 'cycleRecord']
    const cycle = data.d
    const sql = `INSERT OR REPLACE INTO cycles (${columns.join(', ')}) VALUES (?, ?, ?)`

    // Map the `cycle` object to match the columns
    const values = [
      cycle.cycleMarker,
      cycle.counter,
      typeof cycle.cycleRecord === 'object'
        ? SerializeToJsonString(cycle.cycleRecord) // Serialize objects to JSON
        : cycle.cycleRecord,
    ]

    // Execute the query directly (single-row insert)
    await db.run(cycleDatabase, sql, values)
  } catch (err) {
    Logger.mainLogger.error('Failed to store cycle checkpoint data:', err)
    throw err
  }
}

// Export the singleton instance
export const cycleCheckpointManager = CycleCheckpointManager.getInstance()