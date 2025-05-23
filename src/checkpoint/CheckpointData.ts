import * as fs from 'fs'
import * as Logger from '../Logger'
import { postJson } from '../P2P'
import { config } from '../Config'
import * as Crypto from '../Crypto'
import * as State from '../State'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { CheckpointStatusType, updateCheckpointStatusField } from '../dbstore/checkpointStatus'
import { nestedCountersInstance } from '../profiler/nestedCounters'

export enum CheckpointType {
  Cycle = 0,
  OriginalTx = 1,
  Receipt = 2,
}
type BucketHashes = {
  cycleHash?: string | undefined
  receiptHash?: string | undefined
  originalTxHash?: string | undefined
}

export type CheckpointStatusResponse = Record<
  number,
  {
    cycleHash: string
    receiptHash: string
    originalTxHash: string
  }
>

/**
 * Maintains a map of bucketID (cycle number) to hashes for cycle, receipt, and originalTx buckets.
 * Ordered by bucketID (ascending). Max size is config.checkpoint.statusArraySize.
 * When a new entry is added and the size exceeds the limit, the oldest entry is removed.
 */
export class CheckpointStatusMap {
  private map: Map<number, BucketHashes>
  private maxSize: number
  private minKey: number | undefined

  constructor(maxSize: number) {
    this.map = new Map()
    this.maxSize = maxSize
    this.minKey = undefined
  }

  /**
   * Set or update the hashes for a given bucketID.
   * Any of the hashes can be undefined if not available.
   */
  set(bucketID: number, cycleHash?: string, receiptHash?: string, originalTxHash?: string) {
    let entry = this.map.get(bucketID)
    if (!entry) {
      entry = {
        cycleHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        receiptHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        originalTxHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      }
    }
    if (cycleHash !== undefined) entry.cycleHash = cycleHash
    if (receiptHash !== undefined) entry.receiptHash = receiptHash
    if (originalTxHash !== undefined) entry.originalTxHash = originalTxHash

    this.map.set(bucketID, entry)

    // Update minKey
    if (this.minKey === undefined || bucketID < this.minKey) {
      this.minKey = bucketID
    }

    // Trim if needed
    while (this.map.size > this.maxSize) {
      // Remove the minKey
      if (this.minKey !== undefined) {
        this.map.delete(this.minKey)
        // Find new minKey
        this.minKey = this.findMinKey()
      }
    }
  }

  private findMinKey(): number | undefined {
    let min: number | undefined
    for (const key of this.map.keys()) {
      if (min === undefined || key < min) min = key
    }
    return min
  }

  /**
   * Get the hashes for a given bucketID.
   */
  get(bucketID: number): BucketHashes | undefined {
    return this.map.get(bucketID)
  }

  /**
   * Get all entries as an array, ordered by bucketID ascending.
   */
  entries(): Array<[number, BucketHashes]> {
    // If you want sorted by bucketID ascending:
    return Array.from(this.map.entries()).sort(([a], [b]) => a - b)
  }

  /**
   * Get the current size of the map.
   */
  get size(): number {
    return this.map.size
  }

  getOldestBucket(): [number, BucketHashes] | undefined {
    if (this.minKey === undefined) return undefined
    const hashes = this.map.get(this.minKey)
    if (hashes) return [this.minKey, hashes]
    return undefined
  }
}

export const checkpointStatusMap = new CheckpointStatusMap(config.checkpoint.statusArraySize)

function calculateBucketHash(bucket: CheckpointBucket<any>): string {
  // Example: hash all receipt data in the bucket
  // You may want to customize this based on your actual data structure
  const allData = Array.from(bucket.radixEntries.values()).flatMap((entry) => entry.sortedData)
  return Crypto.hash(StringUtils.safeStringify(allData))
}

export const checkpointStatusToTypeMap = {
  [CheckpointType.Cycle]: CheckpointStatusType.CYCLE,
  [CheckpointType.Receipt]: CheckpointStatusType.RECEIPT,
  [CheckpointType.OriginalTx]: CheckpointStatusType.ORIGINAL_TX,
}

// Represents a single piece of data in the system.
export class CheckpointData<T> {
  // Address used to determine the radix entry
  a: string
  // Timestamp of the data
  t: number
  // Unique hash/identifier for the data
  h: string
  // Class/type identifier
  c: number
  // Actual data payload
  d: T

  constructor(a: string, t: number, h: string, c: number, d: T) {
    this.a = a
    this.t = t
    this.h = h
    this.c = c
    this.d = d
  }
}

// Summarizes the data in one radix slot.
export class CheckpointRadixDigest {
  radix: string
  hash: string
  itemCount: number

  constructor(radix: string, hash: string, itemCount: number) {
    this.radix = radix
    this.hash = hash
    this.itemCount = itemCount
  }
}

// Represents a single radix entry in a bucket.
export class CheckpointRadixEntry<T> {
  digest: CheckpointRadixDigest
  sortedData: CheckpointData<T>[]

  constructor(radix: string) {
    this.digest = new CheckpointRadixDigest(radix, this.computeHash(), 0)
    this.sortedData = []
  }

  updateDigest(): void {
    // Sort data by address if not already sorted
    this.sortedData.sort((left: CheckpointData<T>, right: CheckpointData<T>) => {
      // Sort primarily by address
      if (left.a < right.a) return -1
      if (left.a > right.a) return 1
      // Then by class type
      if (left.c < right.c) return -1
      if (left.c > right.c) return 1
      return 0
    })

    // Compute new hash
    const newHash = this.computeHash()

    // Only update if hash changed
    if (this.digest.hash !== newHash) {
      this.digest.hash = newHash
      this.digest.itemCount = this.sortedData.length
    }
  }

  private computeHash(): string {
    if (!this.sortedData || this.sortedData?.length === 0) {
      return Crypto.hash('').toLowerCase()
    }

    const hashToCompute = this.sortedData
      .map((d) => d.h) // Use the unique hash/identifier
      .join('') // Join all hashes together

    const hash = Crypto.hash(hashToCompute).toLowerCase()
    return hash
  }
}

export interface DataPersistenceCallbacks<T> {
  updateData: (data: CheckpointData<T>) => Promise<void>
  validateData: (data: CheckpointData<T>) => Promise<boolean>
}

// Manages all buckets, routes incoming data to the correct bucket, and does periodic updates.
export class CheckpointBucketManager<T> {
  checkpointBuckets: Map<string, CheckpointBucket<T>>
  validateData: (data: CheckpointData<T>) => Promise<boolean>
  updateData: (data: CheckpointData<T>) => Promise<void>
  checkpointType: CheckpointType
  lastFailedBucketTime: number
  bucketsToPersist: Map<string, CheckpointBucket<T>>

  constructor(
    private persistenceCallbacks: DataPersistenceCallbacks<T>,
    checkpointType: CheckpointType
  ) {
    this.checkpointBuckets = new Map<string, CheckpointBucket<T>>()
    this.validateData = persistenceCallbacks.validateData
    this.updateData = persistenceCallbacks.updateData
    this.checkpointType = checkpointType
    this.bucketsToPersist = new Map<string, CheckpointBucket<T>>()
    // set to 5 minutes ago as we giveup on a bucket after 20 minutes
    this.lastFailedBucketTime = Date.now() - config.checkpoint.bucketConfig.lastFailedBucketDuration
  }

  // Returns true for success if the last failed bucket time is older than 5 minutes
  hasLastFailedBucketExceededDuration(): boolean {
    return Date.now() - this.lastFailedBucketTime > config.checkpoint.bucketConfig.lastFailedBucketDuration
  }

  addData(data: CheckpointData<T>, bucketID: string): void {
    if (!config.checkpoint.bucketConfig.allowCheckpointUpdates) {
      // Don't save data if checkpoint system updates are disabled
      return
    }

    let bucket = this.checkpointBuckets.get(bucketID)
    if (!bucket) {
      // Determine if data.t is in milliseconds or seconds
      let startTime = data.t
      if (startTime > 9999999999) {
        // If greater than 10-digit Unix timestamp, assume milliseconds
        startTime /= 1000 // Convert to seconds
      }
      startTime = Math.floor(startTime) // Ensure it's a full second
      const endTime = startTime + config.checkpoint.bucketConfig.cycleAge

      bucket = new CheckpointBucket<T>(
        startTime,
        endTime,
        bucketID,
        this.validateData,
        this.updateData,
        this.checkpointType
      )
      this.checkpointBuckets.set(bucketID, bucket) // adding an entry that maps the CheckpointType object to its contents, the key here is the address
    }
    bucket.addData(data)
  }

  // Persists the data in the buckets that have majority consensus
  async persistBucketsData(): Promise<void> {
    try {
      const promises: Promise<void>[] = []
      for (const [bucketID, bucket] of this.bucketsToPersist.entries()) {
        for (const entry of bucket.radixEntries.values()) {
          const radixTally = bucket.peerRadixDigests.get(entry.digest.radix)
          if (radixTally) {
            // Calculate majority threshold
            const totalArchivers = State.activeArchivers.length
            const majorityThreshold = Math.floor(totalArchivers / 2) + 1

            // Get votes for this entry's hash
            const votesForHash = radixTally.hashTally.get(entry.digest.hash) || 0

            // Only persist if we have majority consensus
            if (votesForHash >= majorityThreshold) {
              for (const dataItem of entry.sortedData) {
                promises.push(bucket.updateData(dataItem))
              }
            } else {
              if (config.VERBOSE) {
                Logger.mainLogger.debug(
                  `Skipping persistence for radix ${entry.digest.radix} - insufficient consensus (${votesForHash}/${majorityThreshold} votes)`
                )
              }
            }
          }
        }
        this.bucketsToPersist.delete(bucketID)
      }
      await Promise.all(promises)
    } catch (err) {
      Logger.mainLogger.error('Error in persistBucketsData:', err)
    }
  }

  async update(): Promise<void> {
    try {
      const currentTime = Math.floor(Date.now() / 1000)
      const toRemove: string[] = []
      for (const [id, bucket] of this.checkpointBuckets.entries()) {
        if (currentTime > bucket.GiveUpAge) {
          // We consider this bucket "failed" or "too old"
          if (config.VERBOSE) {
            Logger.mainLogger.debug(
              `Bucket ${bucket.bucketID} of type ${this.checkpointType} exceeded GiveUpAge. Persisting & removing.`
            )
          }
          if (bucket.hasUpdatesToShare) {
            if (config.VERBOSE) {
              Logger.mainLogger.debug(`Bucket ${bucket.bucketID} has updates to share. Writing to file and alerting.`)
            }
            /*
                If the bucket is older than the last cycle to sync, then we need to update the checkpoint status to true
                because the data cannot be verified using Checkpoint bucket system. So, we assume that the data is correct and 
                fetched from the verified source (Archivers).
            */
            updateCheckpointStatusField(
              parseInt(bucket.bucketID, 10),
              checkpointStatusToTypeMap[this.checkpointType],
              State.lastCycleToSync > parseInt(bucket.bucketID, 10) ? true : false
            )
            bucket.writeToFileAndAlert()
            this.lastFailedBucketTime = Date.now()
          } else {
            if (config.VERBOSE) {
              Logger.mainLogger.debug(
                `Bucket ${bucket.bucketID} has reached consensus. Marking it as read to writing to database.`
              )
            }
            // Add the bucket to the bucketsToPersist map so we can handle writing without blocking the update
            this.bucketsToPersist.set(bucket.bucketID, bucket)
            updateCheckpointStatusField(
              parseInt(bucket.bucketID, 10),
              checkpointStatusToTypeMap[this.checkpointType],
              true
            )
          }
          toRemove.push(id)
          // --- END: Add hash to CheckpointStatusMap ---
          let hash: string
          if (this.checkpointType === CheckpointType.Cycle) {
            hash = calculateBucketHash(bucket)
            checkpointStatusMap.set(parseInt(bucket.bucketID, 10), hash, undefined, undefined)
          } else if (this.checkpointType === CheckpointType.Receipt) {
            hash = calculateBucketHash(bucket)
            checkpointStatusMap.set(parseInt(bucket.bucketID, 10), undefined, hash, undefined)
          } else if (this.checkpointType === CheckpointType.OriginalTx) {
            hash = calculateBucketHash(bucket)
            checkpointStatusMap.set(parseInt(bucket.bucketID, 10), undefined, undefined, hash)
          }
        } else {
          // Let the bucket do its normal update
          bucket.update(currentTime)
        }
      }

      // Remove the stale buckets
      for (const id of toRemove) {
        this.checkpointBuckets.delete(id)
      }

      if (config.checkpoint.bucketConfig.allowCheckpointStorage) {
        // Call persistBucketsData to persist the buckets data to tables
        this.persistBucketsData()
      }
    } catch (err) {
      Logger.mainLogger.error(`Error in update for checkpoint type ${this.checkpointType}`, err)
    }
  }

  onHashDigestsReceived(senderAddress: string, bucketID: string, radixDigests: CheckpointRadixDigest[]): void {
    const bucket = this.checkpointBuckets.get(bucketID)
    if (bucket) {
      bucket.onHashDigestsReceived(senderAddress, bucketID, radixDigests)
    }
  }

  onExchangeRadixEntries(bucketID: string, entries: CheckpointRadixEntry<T>[]): CheckpointRadixEntry<T>[] {
    // receives a list of entries which contain radix metadata ( radixDigest ) and the payload for a respective radix ( radix Sorted Data )
    const bucket = this.checkpointBuckets.get(bucketID)
    if (!bucket) {
      if (config.VERBOSE) {
        Logger.mainLogger.debug(`no bucket found for ID=${bucketID}`)
      }
      return []
    }

    bucket.onExchangeRadixEntries(bucketID, entries)

    const result: CheckpointRadixEntry<T>[] = []
    for (const incomingEntry of entries) {
      const localEntry = bucket.radixEntries.get(incomingEntry.digest.radix)
      if (!localEntry) {
        continue
      }
      localEntry.updateDigest()
      result.push(localEntry)
    }

    return result
  }
}

// Represents a single bucket in the system.
export class CheckpointBucket<T> {
  startTime: number
  endTime: number
  bucketID: string
  hasUpdatesToShare: boolean
  sentDigestsCount: number
  receivedDigestCount: number
  lastProcessedDigestCount: number
  radixEntries: Map<string, CheckpointRadixEntry<T>>
  peerRadixDigests: Map<string, RadixDigestTally>
  validateData: (data: CheckpointData<T>) => Promise<boolean>
  updateData: (data: CheckpointData<T>) => Promise<void>
  GiveUpAge: number
  BucketMatureAge: number
  checkpointType: CheckpointType

  constructor(
    startTime: number,
    endTime: number,
    bucketID: string,
    validateData: (data: CheckpointData<T>) => Promise<boolean>,
    updateData: (data: CheckpointData<T>) => Promise<void>,
    checkpointType: CheckpointType
  ) {
    this.startTime = startTime
    this.endTime = endTime
    this.bucketID = bucketID
    this.hasUpdatesToShare = true
    this.sentDigestsCount = 0
    this.receivedDigestCount = 0
    this.lastProcessedDigestCount = 0
    this.radixEntries = new Map<string, CheckpointRadixEntry<T>>()
    this.peerRadixDigests = new Map<string, RadixDigestTally>()
    this.validateData = validateData
    this.updateData = updateData
    this.GiveUpAge = this.startTime + config.checkpoint.bucketConfig.GiveUpAge
    this.BucketMatureAge = this.startTime + config.checkpoint.bucketConfig.BucketMatureAge
    this.checkpointType = checkpointType

    // FIX: Zero-pad the radix keys to exactly two hex chars
    for (let i = 0; i < 256; i++) {
      const hexStr = i.toString(16).padStart(2, '0')
      this.radixEntries.set(hexStr, new CheckpointRadixEntry<T>(hexStr))
      this.peerRadixDigests.set(hexStr, new RadixDigestTally(hexStr))
    }
  }

  async addData(data: CheckpointData<T>): Promise<void> {
    if (this.validateData) {
      const isValid = await this.validateData(data)
      if (!isValid) {
        Logger.mainLogger.error('Validation failed for data:', data)
        return
      }
    }

    const address = data.a.toLowerCase()
    const radix = address.substring(0, 2)

    let entry = this.radixEntries.get(radix)
    if (!entry) {
      Logger.mainLogger.debug(`Radix ${radix} not found for bucket ${this.bucketID}`)
      return
    }

    // Store original hash before changes
    const originalHash = entry.digest.hash
    entry.sortedData.push(data)
    entry.updateDigest()
    // Only set hasUpdatesToShare if the hash actually changed
    if (originalHash !== entry.digest.hash) {
      this.hasUpdatesToShare = true
    }
  }

  async shareRadixDigests(radixList?: string[]): Promise<void> {
    try {
      if (!this.hasUpdatesToShare) {
        return
      }

      const digests: CheckpointRadixDigest[] = []
      const radixes = radixList ?? Array.from(this.radixEntries.keys())
      const digestsToUpdate = new Map<string, CheckpointRadixDigest>()

      // First ensure all digests are up to date
      for (const radix of radixes) {
        const entry = this.radixEntries.get(radix)
        if (!entry) {
          continue
        }

        // Update the digest
        entry.updateDigest()

        // Add to digests if there's data to share
        if (entry.sortedData.length > 0) {
          digests.push(entry.digest)
          digestsToUpdate.set(radix, entry.digest)
        }
      }

      if (digests.length === 0) {
        this.hasUpdatesToShare = false
        return
      }

      const peers = State.otherArchivers.map((archiver) => `${archiver.ip}:${archiver.port}`)
      const maxRetries = 3
      const retryDelay = 1000 // 1 second

      // Track successful peers to verify minimum consensus
      const successfulPeers = new Set<string>()

      for (let retry = 0; retry < maxRetries; retry++) {
        const remainingPeers = peers.filter((peer) => !successfulPeers.has(peer))
        if (remainingPeers.length === 0) break

        const sharePromises = remainingPeers.map(async (peerAddress) => {
          try {
            const body = {
              senderAddress: `${State.getNodeInfo().ip}:${State.getNodeInfo().port}`, // for tally use
              bucketID: this.bucketID,
              radixDigests: StringUtils.safeStringify(digests),
              checkpointType: this.checkpointType,
              sender: State.getNodeInfo().publicKey, // for signature verification
              startTime: this.startTime,
              endTime: this.endTime,
            }

            const response = await postJson(`http://${peerAddress}/shareCheckpointRadixDigests`, Crypto.sign(body))
            // Verify peer acknowledged receipt
            if (response && response.success) {
              successfulPeers.add(peerAddress)
            }
          } catch (err) {
            Logger.mainLogger.error(`Failed to share digests with peer ${peerAddress} (attempt ${retry + 1}):`, err)
          }
        })

        await Promise.allSettled(sharePromises)

        // If we haven't reached enough peers, wait before retry
        if (successfulPeers.size < Math.floor(peers.length / 2) && retry < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay))
        }
      }

      this.sentDigestsCount++

      // If there are no peers, we consider it successful since we're the only node
      if (peers.length === 0) {
        this.hasUpdatesToShare = false
      }
      // Only mark updates as shared if we reached consensus
      else if (successfulPeers.size >= Math.floor(peers.length / 2)) {
        // Check if any new updates arrived during sending
        const hasNewUpdates = Array.from(digestsToUpdate.entries()).some(([radix, originalDigest]) => {
          const currentEntry = this.radixEntries.get(radix)
          return currentEntry && currentEntry.digest.hash !== originalDigest.hash
        })

        this.hasUpdatesToShare = hasNewUpdates
      } else {
        if (config.VERBOSE) {
          Logger.mainLogger.debug(
            `Failed to reach consensus when sharing digests. Only ${successfulPeers.size}/${peers.length} peers acknowledged`
          )
        }
        // Keep hasUpdatesToShare true so we'll try again
      }
    } catch (err) {
      Logger.mainLogger.error('Error in shareRadixDigests:', err)
    }
  }

  update(currentTime: number): void {
    try {
      // Check if bucket has matured (11 minutes) and has updates to share
      if (currentTime > this.BucketMatureAge && this.hasUpdatesToShare) {
        this.shareRadixDigests()
      }

      // Check for consensus updates if we've received new digests since last processing
      // Process digests even before first send to handle early received digests
      if (this.receivedDigestCount > this.lastProcessedDigestCount) {
        this.evaluateDigestConsensus()
      }
    } catch (err) {
      Logger.mainLogger.error('Error in bucket update:', err)
    }
  }

  public writeToFileAndAlert(): void {
    try {
      const bucketData = {
        bucketID: this.bucketID,
        startTime: this.startTime,
        endTime: this.endTime,
        radixEntries: Array.from(this.radixEntries.entries()),
        peerDigests: Array.from(this.peerRadixDigests.entries()),
      }
      const filename = `${config.failedBucketsDir}/failed-bucket-${this.checkpointType}-${this.bucketID}-${this.startTime}.json`
      if (config.VERBOSE) {
        Logger.mainLogger.debug(`Writing bucket id ${this.bucketID} data to file ${filename}`)
      }
      // Write to file
      fs.writeFileSync(filename, StringUtils.safeStringify(bucketData))
    } catch (err) {
      Logger.mainLogger.error(`Bucket ${this.bucketID} failed to reach consensus after timeout.`)
    }
  }

  evaluateDigestConsensus(): void {
    try {
      // If we have no peer data, nothing to evaluate
      if (this.peerRadixDigests.size === 0) {
        this.lastProcessedDigestCount = this.receivedDigestCount
        return
      }

      // totalArchivers counts ourself (+1) and external peers
      const totalArchivers = State.activeArchivers.length
      // "Majority" means more than half
      const majorityThreshold = Math.floor(totalArchivers / 2) + 1

      for (const [radix, tally] of this.peerRadixDigests.entries()) {
        const localEntry = this.radixEntries.get(radix)
        if (!localEntry) continue

        // Include our own hash in the tally
        const localHash = localEntry.digest.hash
        if (localHash) {
          const currentCount = tally.hashTally.get(localHash) || 0
          tally.hashTally.set(localHash, currentCount + 1)
        }

        // Find the hash with the most votes
        let majorityHash = ''
        let maxVotes = 0

        for (const [hash, votes] of tally.hashTally.entries()) {
          if (votes > maxVotes) {
            maxVotes = votes
            majorityHash = hash
          }
        }

        // Only request repair if:
        // 1. We have a majority hash
        // 2. The majority hash has enough votes
        // 3. Our hash is different from majority hash
        if (majorityHash && maxVotes >= majorityThreshold && majorityHash !== localEntry.digest.hash) {
          this.requestRepairForRadix(radix)
        }

        // Remove our vote from the tally to not affect future evaluations
        if (localHash) {
          const currentCount = tally.hashTally.get(localHash) || 0
          if (currentCount > 0) {
            tally.hashTally.set(localHash, currentCount - 1)
          }
        }
      }

      this.lastProcessedDigestCount = this.receivedDigestCount
    } catch (err) {
      Logger.mainLogger.error('Error in evaluateDigestConsensus:', err)
    }
  }

  private requestRepairForRadix(radix: string): void {
    try {
      // Find archivers with the majority hash
      const tally = this.peerRadixDigests.get(radix)
      if (!tally) return

      // Get the majority hash
      let majorityHash = ''
      let maxVotes = 0
      for (const [hash, votes] of tally.hashTally.entries()) {
        if (votes > maxVotes) {
          maxVotes = votes
          majorityHash = hash
        }
      }

      if (!majorityHash) return

      // Get all peers who have the majority hash
      const peersWithMajority = Array.from(tally.peerDigests.entries())
        .filter(([_, digest]) => digest.hash === majorityHash)
        .map(([peer]) => peer)

      if (peersWithMajority.length > 0) {
        // Request data from a random peer that has the majority hash
        const randomPeer = peersWithMajority[Math.floor(Math.random() * peersWithMajority.length)]
        this.exchangeAndRepairRadix(randomPeer, radix)
      }
    } catch (err) {
      Logger.mainLogger.error('Error requesting repair:', err)
    }
  }

  async exchangeAndRepairRadix(peerAddress: string, radix: string): Promise<void> {
    const localEntry = this.radixEntries.get(radix)
    if (!localEntry) return

    try {
      // Exchange entries with peer
      const response: any = await postJson(
        `http://${peerAddress}/exchangeCheckpointRadixEntries`,
        Crypto.sign({
          bucketID: this.bucketID,
          entries: StringUtils.safeStringify([localEntry]),
          checkpointType: this.checkpointType,
          sender: State.getNodeInfo().publicKey, // for signature verification
        })
      )

      if (!response.success || !response?.entries || response?.bucketID !== this.bucketID) {
        Logger.mainLogger.error('exchangeCheckpointRadixEntries invalid response:', response)
        return
      }

      if (!Crypto.verify(response)) {
        Logger.mainLogger.error('exchangeCheckpointRadixEntries invalid response:', response)
        return
      }

      const previousHash = localEntry.digest.hash

      // Process received entries
      this.onExchangeRadixEntries(response.bucketID, response.entries)
    } catch (err) {
      Logger.mainLogger.error('Exchange and repair radix failed:', err)
    }
  }

  // We update the tallies for each radix.
  onHashDigestsReceived(senderAddress: string, bucketID: string, radixDigests: CheckpointRadixDigest[]): void {
    try {
      for (const digest of radixDigests) {
        let tally = this.peerRadixDigests.get(digest.radix)

        if (!tally) {
          tally = this.initializeNewTally(digest.radix)
        }

        this.updateTallyForPeer(tally, senderAddress, digest)
      }

      this.receivedDigestCount++
    } catch (err) {
      Logger.mainLogger.error('Error in onHashDigestsReceived:', err)
    }
  }

  onExchangeRadixEntries(bucketID: string, entries: CheckpointRadixEntry<T>[]): void {
    try {
      // Validate input
      if (!this.validateExchangeInput(bucketID, entries)) {
        return
      }

      const updatedRadixes = new Set<string>()
      const batchPromises: Promise<void>[] = []

      // Process entries in batches
      for (let i = 0; i < entries.length; i += 100) {
        const batch = entries.slice(i, i + 100)
        batchPromises.push(this.processBatchEntries(batch, updatedRadixes))
      }

      // Wait for all batches to complete
      Promise.all(batchPromises)
        .then(() => {
          if (updatedRadixes.size > 0) {
            const updatedRadixArray = Array.from(updatedRadixes)
            if (updatedRadixArray.length === 0) return
            this.hasUpdatesToShare = true
            this.shareRadixDigests(updatedRadixArray)
          }
        })
        .catch((err) => {
          Logger.mainLogger.error('Error processing entry batches:', err)
        })
    } catch (err) {
      Logger.mainLogger.error('Error in onExchangeRadixEntries:', err)
    }
  }

  private validateExchangeInput(bucketID: string, entries: CheckpointRadixEntry<T>[]): boolean {
    if (bucketID !== this.bucketID) {
      return false
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      return false
    }

    return true
  }

  private initializeNewTally(radix: string): RadixDigestTally {
    const tally = new RadixDigestTally(radix)
    this.peerRadixDigests.set(radix, tally)

    const ourEntry = this.radixEntries.get(radix)
    if (ourEntry) {
      tally.hashTally.set(ourEntry.digest.hash, 1)
    }

    return tally
  }

  private updateTallyForPeer(tally: RadixDigestTally, senderAddress: string, digest: CheckpointRadixDigest): void {
    const previousDigest = tally.peerDigests.get(senderAddress)
    // Remove previous vote if exists
    if (previousDigest && previousDigest.hash !== digest.hash) {
      const oldCount = tally.hashTally.get(previousDigest.hash) || 0
      if (oldCount > 0) {
        tally.hashTally.set(previousDigest.hash, oldCount - 1)
      }
    }

    // Update peer's digest
    tally.peerDigests.set(senderAddress, digest)

    // Update hash tally with new vote
    const newCount = (tally.hashTally.get(digest.hash) || 0) + 1
    tally.hashTally.set(digest.hash, newCount)

    // Check if we need to update our entry
    const ourEntry = this.radixEntries.get(digest.radix)
    if (ourEntry && ourEntry.digest.hash !== digest.hash) {
      this.hasUpdatesToShare = true
    }
  }

  private async processBatchEntries(entries: CheckpointRadixEntry<T>[], updatedRadixes: Set<string>): Promise<void> {
    for (const incomingEntry of entries) {
      const localEntry = this.radixEntries.get(incomingEntry.digest.radix)
      if (!localEntry) continue

      const previousHash = localEntry.digest.hash
      const entryUpdated = await this.mergeEntryData(localEntry, incomingEntry)

      if (entryUpdated) {
        localEntry.updateDigest()
        if (previousHash !== localEntry.digest.hash) {
          await this.updateTallyAfterMerge(localEntry, previousHash)
          updatedRadixes.add(incomingEntry.digest.radix)
        }
      }
    }
  }

  private async mergeEntryData(
    localEntry: CheckpointRadixEntry<T>,
    incomingEntry: CheckpointRadixEntry<T>
  ): Promise<boolean> {
    try {
      let entryUpdated = false

      // Get the majority hash for this radix
      const tally = this.peerRadixDigests.get(incomingEntry.digest.radix)
      if (!tally) return false

      let majorityHash = ''
      let maxVotes = 0
      const totalArchivers = State.activeArchivers.length
      const majorityThreshold = Math.floor(totalArchivers / 2) + 1

      // Track all hashes and their votes
      const hashVotes = new Map<string, Set<string>>()

      // First collect all peer votes including the source of each vote
      for (const [peer, digest] of tally.peerDigests.entries()) {
        const voters = hashVotes.get(digest.hash) || new Set<string>()
        voters.add(peer)
        hashVotes.set(digest.hash, voters)
      }

      // Add our own vote
      const ourVoters = hashVotes.get(localEntry.digest.hash) || new Set<string>()
      ourVoters.add(`${config.ARCHIVER_IP}:${config.ARCHIVER_PORT}`)
      hashVotes.set(localEntry.digest.hash, ourVoters)

      // Find hash with most original votes (not propagated copies)
      for (const [hash, voters] of hashVotes.entries()) {
        const voteCount = voters.size
        if (voteCount > maxVotes) {
          maxVotes = voteCount
          majorityHash = hash
        }
      }

      // If we have the majority hash, we should not accept other data
      if (localEntry.digest.hash === majorityHash && maxVotes >= majorityThreshold) {
        return false
      }

      // Check if the local entry contains a receipt with successful status
      // If it does, we should not allow it to be overwritten with a failed receipt
      if (localEntry.sortedData.length > 0 && this.checkpointType === CheckpointType.Receipt) {
        try {
          // We're dealing with receipts, check for success/fail status
          for (const data of localEntry.sortedData) {
            const receipt = data.d as any // Receipt type

            // Check if the local receipt has successful status (status=1)
            if (receipt?.appReceiptData?.data?.readableReceipt?.status === 1) {
              // If local receipt is successful, check if incoming entry has any failed receipts
              let incomingContainsFailedReceipt = false

              for (const incomingData of incomingEntry.sortedData) {
                const incomingReceipt = incomingData.d as any
                if (incomingReceipt?.appReceiptData?.data?.readableReceipt?.status === 0) {
                  incomingContainsFailedReceipt = true
                  Logger.mainLogger.debug(
                    'Rejecting checkpoint update: Cannot replace a successful receipt (status=1) with a failed receipt (status=0)',
                    'local receipt:',
                    StringUtils.safeStringify(receipt),
                    'incoming receipt:',
                    StringUtils.safeStringify(incomingReceipt)
                  )
                  break
                }
              }

              // If incoming entry has failed receipts, don't accept the update
              if (incomingContainsFailedReceipt) {
                // Track ignored receipts due to local success
                nestedCountersInstance?.countEvent?.('checkpoint', 'ignored_failed_receipt_due_to_local_success', 1);
                return false
              }
            }
          }
        } catch (err) {
          // If there's an error checking the receipt status, log it but continue with normal processing
          Logger.mainLogger.error('Error checking receipt status during checkpoint merge:', err)
        }
      }

      // Only accept data if:
      // 1. It has the majority hash
      // 2. The majority is from original sources (not propagated copies)
      // 3. It meets the threshold
      if (majorityHash && incomingEntry.digest.hash === majorityHash && maxVotes >= majorityThreshold) {
        // Get the original sources that voted for this hash
        const originalVoters = hashVotes.get(majorityHash)
        if (!originalVoters || originalVoters.size < majorityThreshold) {
          return false
        }

        // Create a new array for sorted data to avoid reference issues
        const newSortedData: Array<CheckpointData<T>> = []

        // Validate and copy each data item
        for (const data of incomingEntry.sortedData) {
          if (await this.validateData?.(data)) {
            // Create a deep copy of the data to avoid reference issues
            newSortedData.push(StringUtils.safeJsonParse(StringUtils.safeStringify(data)))
          } else {
            Logger.mainLogger.error('Validation failed for data:', data)
          }
        }

        // Only update if we have valid data
        if (newSortedData.length > 0) {
          localEntry.sortedData = newSortedData
          localEntry.updateDigest() // Update the digest immediately

          // Update our vote in the tally
          const ourAddress = `${config.ARCHIVER_IP}:${config.ARCHIVER_PORT}`
          tally.peerDigests.set(ourAddress, {
            radix: incomingEntry.digest.radix,
            hash: majorityHash,
            itemCount: newSortedData.length,
          })

          // Update hash tally
          const oldHash = localEntry.digest.hash
          if (oldHash !== majorityHash) {
            const oldCount = tally.hashTally.get(oldHash) || 0
            if (oldCount > 0) {
              tally.hashTally.set(oldHash, oldCount - 1)
            }
            const newCount = (tally.hashTally.get(majorityHash) || 0) + 1
            tally.hashTally.set(majorityHash, newCount)
          }

          entryUpdated = true
        }
      }

      return entryUpdated
    } catch (err) {
      Logger.mainLogger.error('Error in mergeEntryData:', err)
      return false
    }
  }

  private async updateTallyAfterMerge(localEntry: CheckpointRadixEntry<T>, previousHash: string): Promise<void> {
    const tally = this.peerRadixDigests.get(localEntry.digest.radix)
    if (!tally) return

    // Decrement old hash count
    const oldCount = tally.hashTally.get(previousHash) || 0
    if (oldCount > 0) {
      tally.hashTally.set(previousHash, oldCount - 1)
    }

    // Calculate total votes for this hash from peers
    const peerVotes = Array.from(tally.peerDigests.entries()).filter(
      ([_, d]) => d.hash === localEntry.digest.hash
    ).length

    // Set the total count (including our vote)
    tally.hashTally.set(localEntry.digest.hash, peerVotes + 1)
  }

  toJSON() {
    try {
      return {
        startTime: this.startTime,
        endTime: this.endTime,
        bucketID: this.bucketID,
        checkpointType: this.checkpointType,
        hasUpdatesToShare: this.hasUpdatesToShare,
        sentDigestsCount: this.sentDigestsCount,
        receivedDigestCount: this.receivedDigestCount,
        lastProcessedDigestCount: this.lastProcessedDigestCount,
        BucketMatureAge: this.BucketMatureAge,
        GiveUpAge: this.GiveUpAge,
        // Convert Maps to objects
        radixEntries: Object.fromEntries(this.radixEntries),
        peerRadixDigests: Object.fromEntries(this.peerRadixDigests),
      }
    } catch (err) {
      Logger.mainLogger.error('Error in toJSON:', err)
      return null
    }
  }
}

// Use this to keep track of peers, include our tally in this too
export class RadixDigestTally {
  radix: string
  // key = digestHash, value = number of peers who reported it
  hashTally: Map<string, number>
  // key = peerAddress, value = the digest from that peer
  peerDigests: Map<string, CheckpointRadixDigest>

  constructor(radix: string) {
    this.radix = radix
    this.hashTally = new Map<string, number>() // tracks the count of how many archivers contain the hash for a particular digest in the current CheckpointBucket
    this.peerDigests = new Map<string, CheckpointRadixDigest>() // maps a peer archiver to a radixDigest for the current CheckpointBucket
  }
}
