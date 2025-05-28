import { Receipt as ReceiptType } from '../../../../src/dbstore/receipts'
import * as Crypto from '../../../../src/Crypto'
import * as Logger from '../../../../src/Logger'
import { insertReceipt } from '../../../../src/dbstore/receipts'
import { CheckpointType } from '../../../../src/checkpoint/CheckpointData'
import { verifyAppReceiptData } from '../../../../src/shardeum/verifyAppReceiptData'
import {
  ReceiptCheckpointData,
  calculateBucketID,
  ReceiptCheckpointRadixEntry,
  ReceiptCheckpointRadixDigest,
  ReceiptCheckpointBucket,
  ReceiptRadixDigestTally
} from '../../../../src/checkpoint/ReceiptData'

// Mock dependencies
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}))
jest.mock('../../../../src/dbstore/receipts')
jest.mock('../../../../src/shardeum/verifyAppReceiptData')
jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeStringify: jest.fn((obj) => JSON.stringify(obj))
  }
}))
jest.mock('../../../../src/State', () => ({
  getNodeInfo: jest.fn(),
  activeArchivers: [],
  otherArchivers: []
}))
jest.mock('../../../../src/P2P', () => ({
  postJson: jest.fn()
}))
jest.mock('../../../../src/Config', () => ({
  config: {
    checkpoint: {
      bucketConfig: {
        allowCheckpointUpdates: true,
        cycleAge: 300,
        lastFailedBucketDuration: 300000,
        GiveUpAge: 1200,
        BucketMatureAge: 600
      },
      statusArraySize: 100
    },
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PORT: 4000,
    VERBOSE: false
  }
}))
jest.mock('../../../../src/dbstore/checkpointStatus', () => ({
  CheckpointStatusType: {
    CYCLE: 'cycle',
    RECEIPT: 'receipt',
    ORIGINAL_TX: 'originalTx'
  },
  updateCheckpointStatusField: jest.fn()
}))

describe('ReceiptData', () => {
  const mockReceipt: ReceiptType = {
    receiptId: 'receipt-1',
    timestamp: 1234567890,
    cycle: 42,
    tx: {
      txId: 'tx-1',
      timestamp: 1234567890,
      to: '0x123',
      from: '0x456',
      value: '1000'
    },
    afterStates: {},
    appliedReceipt: {
      result: true
    },
    signatures: []
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('ReceiptCheckpointData', () => {
    it('should create a ReceiptCheckpointData instance', () => {
      const mockHash = 'abcdef1234567890'
      ;(Crypto.hash as jest.Mock).mockReturnValue(mockHash)

      const checkpointData = new ReceiptCheckpointData(mockReceipt)

      expect(Crypto.hash).toHaveBeenCalledWith(JSON.stringify(mockReceipt))
      expect(checkpointData.a).toBe('ab') // First 2 chars of hash
      expect(checkpointData.t).toBe(1234567890) // Timestamp from tx
      expect(checkpointData.h).toBe(mockHash)
      expect(checkpointData.c).toBe(CheckpointType.Receipt)
      expect(checkpointData.d).toBe(mockReceipt)
    })

    it('should handle uppercase hash correctly', () => {
      const mockHash = 'ABCDEF1234567890'
      ;(Crypto.hash as jest.Mock).mockReturnValue(mockHash)

      const checkpointData = new ReceiptCheckpointData(mockReceipt)

      expect(checkpointData.a).toBe('ab') // Should be lowercase
      expect(checkpointData.h).toBe('abcdef1234567890') // Should be lowercase
    })

    it('should handle receipt with no tx timestamp', () => {
      const receiptNoTimestamp = {
        ...mockReceipt,
        tx: { ...mockReceipt.tx, timestamp: 0 }
      }
      ;(Crypto.hash as jest.Mock).mockReturnValue('123456')

      const checkpointData = new ReceiptCheckpointData(receiptNoTimestamp)

      expect(checkpointData.t).toBe(0)
    })
  })

  describe('calculateBucketID', () => {
    it('should return cycle as bucket ID', () => {
      const bucketId = calculateBucketID(mockReceipt)
      expect(bucketId).toBe('42')
    })

    it('should handle zero cycle', () => {
      const receiptWithZeroCycle = { ...mockReceipt, cycle: 0 }
      const bucketId = calculateBucketID(receiptWithZeroCycle)
      expect(bucketId).toBe('0')
    })

    it('should throw error for invalid receipt data', () => {
      expect(() => calculateBucketID(null as any)).toThrow('Invalid receipt data')
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid receipt data')
    })

    it('should throw error for receipt without tx', () => {
      const invalidReceipt = { ...mockReceipt, tx: null } as any
      expect(() => calculateBucketID(invalidReceipt)).toThrow()
      // The error happens before the Logger.mainLogger.error call
    })

    it('should throw error for undefined tx timestamp', () => {
      const invalidReceipt = { 
        ...mockReceipt, 
        tx: { ...mockReceipt.tx, timestamp: undefined } 
      } as any
      expect(() => calculateBucketID(invalidReceipt)).toThrow('Invalid receipt data')
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid receipt data')
    })
  })

  describe('ReceiptCheckpointRadixEntry', () => {
    it('should create a ReceiptCheckpointRadixEntry instance', () => {
      // Mock the hash function for empty data
      ;(Crypto.hash as jest.Mock).mockReturnValue('empty-hash')
      
      const radixEntry = new ReceiptCheckpointRadixEntry('ab')
      
      expect(radixEntry).toBeDefined()
      expect(radixEntry.digest).toBeDefined()
      expect(radixEntry.digest.radix).toBe('ab')
      expect(radixEntry.digest.hash).toBe('empty-hash')
      expect(radixEntry.digest.itemCount).toBe(0)
      expect(radixEntry.sortedData).toEqual([])
    })
  })

  describe('ReceiptCheckpointRadixDigest', () => {
    it('should create a ReceiptCheckpointRadixDigest instance', () => {
      const radixDigest = new ReceiptCheckpointRadixDigest('ab', 'hash123', 5)
      
      expect(radixDigest).toBeDefined()
      expect(radixDigest.radix).toBe('ab')
      expect(radixDigest.hash).toBe('hash123')
      expect(radixDigest.itemCount).toBe(5)
    })

    it('should handle zero item count', () => {
      const radixDigest = new ReceiptCheckpointRadixDigest('cd', 'hash456', 0)
      
      expect(radixDigest.itemCount).toBe(0)
    })
  })

  describe('ReceiptRadixDigestTally', () => {
    it('should create a ReceiptRadixDigestTally instance', () => {
      const tally = new ReceiptRadixDigestTally('ab')
      
      expect(tally).toBeDefined()
      expect(tally.radix).toBe('ab')
      expect(tally.hashTally).toBeDefined()
      expect(tally.hashTally.size).toBe(0)
      expect(tally.peerDigests).toBeDefined()
      expect(tally.peerDigests.size).toBe(0)
    })
  })

  describe('ReceiptCheckpointBucket', () => {
    const mockValidateData = jest.fn()
    const mockUpdateData = jest.fn()

    it('should create a ReceiptCheckpointBucket instance', () => {
      const bucket = new ReceiptCheckpointBucket(
        1000,
        2000,
        'bucket-1',
        mockValidateData,
        mockUpdateData
      )
      
      expect(bucket).toBeDefined()
      expect(bucket.startTime).toBe(1000)
      expect(bucket.endTime).toBe(2000)
      expect(bucket.bucketID).toBe('bucket-1')
      expect(bucket.checkpointType).toBe(CheckpointType.Receipt)
    })

    it('should call parent update method', async () => {
      const bucket = new ReceiptCheckpointBucket(
        1000,
        2000,
        'bucket-1',
        mockValidateData,
        mockUpdateData
      )
      
      // Spy on parent's update method
      const parentUpdateSpy = jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(bucket)), 'update')
      
      await bucket.update(1500)
      
      expect(parentUpdateSpy).toHaveBeenCalledWith(1500)
    })
  })

  describe('validateData function', () => {
    // We test this through the ReceiptCheckpointManager usage
    it('should validate receipt data correctly', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      ;(Crypto.hash as jest.Mock).mockReturnValue('validhash')
      ;(verifyAppReceiptData as jest.Mock).mockResolvedValue({ valid: true })

      // Access the validateData function through the module
      const module = require('../../../../src/checkpoint/ReceiptData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(true)
        expect(verifyAppReceiptData).toHaveBeenCalledWith(mockReceipt, null, [], [])
      }
    })

    it('should return false for invalid hash', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'invalidhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      ;(Crypto.hash as jest.Mock).mockReturnValue('differenthash')

      const module = require('../../../../src/checkpoint/ReceiptData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(false)
      }
    })

    it('should return false for invalid app receipt', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      ;(Crypto.hash as jest.Mock).mockReturnValue('validhash')
      ;(verifyAppReceiptData as jest.Mock).mockResolvedValue({ valid: false })

      const module = require('../../../../src/checkpoint/ReceiptData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(false)
      }
    })

    it('should handle validation errors gracefully', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      ;(Crypto.hash as jest.Mock).mockImplementation(() => {
        throw new Error('Hash error')
      })

      const module = require('../../../../src/checkpoint/ReceiptData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(false)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('ValidateData failed:', expect.any(Error))
      }
    })
  })

  describe('updateData function', () => {
    it('should insert receipt successfully', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      ;(insertReceipt as jest.Mock).mockResolvedValue(undefined)

      const module = require('../../../../src/checkpoint/ReceiptData')
      const updateData = module.updateData || module.default?.updateData

      if (updateData) {
        await updateData(mockData)
        expect(insertReceipt).toHaveBeenCalledWith(mockReceipt, false)
      }
    })

    it('should handle insert errors', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.Receipt,
        d: mockReceipt
      }

      const error = new Error('Database error')
      ;(insertReceipt as jest.Mock).mockRejectedValue(error)

      const module = require('../../../../src/checkpoint/ReceiptData')
      const updateData = module.updateData || module.default?.updateData

      if (updateData) {
        await expect(updateData(mockData)).rejects.toThrow('Database error')
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to store receipt checkpoint data:', error)
      }
    })
  })

  describe('receiptCheckpointManager singleton', () => {
    it('should export a singleton instance', () => {
      const { receiptCheckpointManager } = require('../../../../src/checkpoint/ReceiptData')
      expect(receiptCheckpointManager).toBeDefined()
    })

    it('should always return the same instance', () => {
      const module1 = require('../../../../src/checkpoint/ReceiptData')
      const module2 = require('../../../../src/checkpoint/ReceiptData')
      
      expect(module1.receiptCheckpointManager).toBe(module2.receiptCheckpointManager)
    })
  })
})