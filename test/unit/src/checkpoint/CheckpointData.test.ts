import {
  CheckpointBucket,
  CheckpointData,
  CheckpointRadixEntry,
  CheckpointType,
  RadixDigestTally,
} from '../../../../src/checkpoint/CheckpointData'
import * as Logger from '../../../../src/Logger'

jest.mock('../../../../src/State', () => ({
  activeArchivers: [
    { ip: '127.0.0.1', port: 8080, publicKey: 'pk1', curvePk: 'cpk1' },
    { ip: '127.0.0.2', port: 8080, publicKey: 'pk2', curvePk: 'cpk2' },
    { ip: '127.0.0.3', port: 8080, publicKey: 'pk3', curvePk: 'cpk3' },
  ],
  getNodeInfo: jest.fn().mockReturnValue({ ip: '127.0.0.1', port: 8080, publicKey: 'test-key' }),
}))

jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../../src/Crypto', () => ({
  hash: jest.fn((data) => `mocked-hash-${data}`),
  sign: jest.fn(),
  verify: jest.fn(),
}))

jest.mock('../../../../src/Config', () => ({
  config: {
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PORT: 8080,
    VERBOSE: false,
    checkpoint: {
      bucketConfig: {
        lastFailedBucketDuration: 300000,
      },
    },
  },
}))

describe('CheckpointBucket', () => {
  let bucket: CheckpointBucket<any>
  let validateDataMock: jest.Mock
  let updateDataMock: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()

    validateDataMock = jest.fn().mockResolvedValue(true)
    updateDataMock = jest.fn().mockResolvedValue(undefined)

    bucket = new CheckpointBucket(
      Date.now(),
      Date.now() + 3600000,
      'test-bucket',
      validateDataMock,
      updateDataMock,
      CheckpointType.Receipt
    )

    // Initialize radix entries in the bucket - usually done by bucket.initialize()
    bucket['radixEntries'] = new Map()
    for (let i = 0; i < 16; i++) {
      const radix = i.toString(16).padStart(2, '0') // '00', '01', ..., '0f'
      const entry = new CheckpointRadixEntry<any>(radix)
      bucket['radixEntries'].set(radix, entry)
    }

    // Initialize peer radix digests map
    bucket['peerRadixDigests'] = new Map()
  })

  describe('mergeEntryData', () => {
    it('should not replace a successful receipt with a failed receipt', async () => {
      // Arrange
      const radix = '01'
      const localEntry = bucket['radixEntries'].get(radix)

      // Ensure localEntry is defined before proceeding
      if (!localEntry) {
        throw new Error(`Local entry for radix ${radix} not found`)
      }

      // Create a successful receipt (status=1)
      const successfulReceipt = {
        tx: { txId: 'tx123', timestamp: Date.now() },
        appReceiptData: {
          data: {
            readableReceipt: {
              status: 1, // Success
            },
            amountSpent: '0x123',
          },
        },
      }

      // Create a failed receipt (status=0)
      const failedReceipt = {
        tx: { txId: 'tx123', timestamp: Date.now() },
        appReceiptData: {
          data: {
            readableReceipt: {
              status: 0, // Failure
            },
            amountSpent: '0x123',
          },
        },
      }

      // Create checkpoint data for the receipts
      const successData = new CheckpointData(
        radix,
        Date.now(),
        'hash-success',
        CheckpointType.Receipt,
        successfulReceipt
      )

      const failData = new CheckpointData(radix, Date.now(), 'hash-fail', CheckpointType.Receipt, failedReceipt)

      // Add the successful receipt to the local entry
      localEntry.sortedData.push(successData)
      localEntry.updateDigest()

      // Create an incoming entry with the failed receipt
      const incomingEntry = new CheckpointRadixEntry<any>(radix)
      incomingEntry.sortedData.push(failData)
      incomingEntry.updateDigest()

      // Setup peer radix digests to have majority vote for the failed receipt
      const tally = new RadixDigestTally(radix)

      tally.hashTally.set(incomingEntry.digest.hash, 2) // 2 votes for fail
      tally.hashTally.set(localEntry.digest.hash, 1) // 1 vote for success

      tally.peerDigests.set('127.0.0.2:8080', {
        radix,
        hash: incomingEntry.digest.hash,
        itemCount: 1,
      })

      tally.peerDigests.set('127.0.0.3:8080', {
        radix,
        hash: incomingEntry.digest.hash,
        itemCount: 1,
      })

      bucket['peerRadixDigests'].set(radix, tally)

      // Act
      const result = await bucket['mergeEntryData'](localEntry, incomingEntry)

      // Assert
      // The merge should be rejected (return false)
      expect(result).toBe(false)

      // Local entry should still have the successful receipt
      expect(localEntry.sortedData.length).toBe(1)
      expect(localEntry.sortedData[0].d.appReceiptData.data.readableReceipt.status).toBe(1)

      // Verify that we logged the rejection
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Rejecting checkpoint update: Cannot replace a successful receipt (status=1) with a failed receipt (status=0)',
        'local receipt:',
        expect.any(String),
        'incoming receipt:',
        expect.any(String)
      )
    })

    it('should accept replacing a failed receipt with a successful receipt', async () => {
      // Arrange
      const radix = '01'
      const localEntry = bucket['radixEntries'].get(radix)

      // Ensure localEntry is defined before proceeding
      if (!localEntry) {
        throw new Error(`Local entry for radix ${radix} not found`)
      }

      // Create a failed receipt (status=0)
      const failedReceipt = {
        tx: { txId: 'tx123', timestamp: Date.now() },
        appReceiptData: {
          data: {
            readableReceipt: {
              status: 0, // Failure
            },
            amountSpent: '0x123',
          },
        },
      }

      // Create a successful receipt (status=1)
      const successfulReceipt = {
        tx: { txId: 'tx123', timestamp: Date.now() },
        appReceiptData: {
          data: {
            readableReceipt: {
              status: 1, // Success
            },
            amountSpent: '0x123',
          },
        },
      }

      // Create checkpoint data for the receipts
      const failData = new CheckpointData(radix, Date.now(), 'hash-fail', CheckpointType.Receipt, failedReceipt)

      const successData = new CheckpointData(
        radix,
        Date.now(),
        'hash-success',
        CheckpointType.Receipt,
        successfulReceipt
      )

      // Add the failed receipt to the local entry
      localEntry.sortedData.push(failData)
      localEntry.updateDigest()

      // Create an incoming entry with the successful receipt
      const incomingEntry = new CheckpointRadixEntry<any>(radix)
      incomingEntry.sortedData.push(successData)
      incomingEntry.updateDigest()

      // Setup peer radix digests to have majority vote for the successful receipt
      const tally = new RadixDigestTally(radix)

      tally.hashTally.set(incomingEntry.digest.hash, 2) // 2 votes for success
      tally.hashTally.set(localEntry.digest.hash, 1) // 1 vote for fail

      tally.peerDigests.set('127.0.0.2:8080', {
        radix,
        hash: incomingEntry.digest.hash,
        itemCount: 1,
      })

      tally.peerDigests.set('127.0.0.3:8080', {
        radix,
        hash: incomingEntry.digest.hash,
        itemCount: 1,
      })

      bucket['peerRadixDigests'].set(radix, tally)

      // Act
      const result = await bucket['mergeEntryData'](localEntry, incomingEntry)

      // Assert
      // The merge should be accepted (return true)
      expect(result).toBe(true)

      // Local entry should now have the successful receipt
      expect(localEntry.sortedData.length).toBe(1)
      expect(localEntry.sortedData[0].d.appReceiptData.data.readableReceipt.status).toBe(1)
    })
  })
})
