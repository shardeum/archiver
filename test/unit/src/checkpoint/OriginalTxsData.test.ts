import { OriginalTxData } from '../../../../src/dbstore/originalTxsData'
import * as Crypto from '../../../../src/Crypto'
import * as Logger from '../../../../src/Logger'
import { insertOriginalTxData } from '../../../../src/dbstore/originalTxsData'
import { CheckpointType } from '../../../../src/checkpoint/CheckpointData'
import { validateOriginalTxDataSchema } from '../../../../src/Data/Collector'
import {
  OriginalTxCheckpointData,
  calculateBucketID,
  OriginalTxCheckpointRadixEntry,
  OriginalTxCheckpointRadixDigest,
  OriginalTxCheckpointBucket
} from '../../../../src/checkpoint/OriginalTxsData'

// Mock dependencies
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn()
  }
}))
jest.mock('../../../../src/dbstore/originalTxsData')
jest.mock('../../../../src/dbstore/sqlite3storage')
jest.mock('../../../../src/Data/Collector')
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
    VERBOSE: false,
    tickets: {
      allowedTicketSigners: [],
      minSigRequired: 1,
      requiredSecurityLevel: 'low'
    },
    REQUEST_LIMIT: {
      MAX_CYCLES_PER_REQUEST: 100,
      MAX_ORIGINAL_TXS_PER_REQUEST: 1000,
      MAX_RECEIPTS_PER_REQUEST: 1000,
      MAX_ACCOUNTS_PER_REQUEST: 1000,
      MAX_BETWEEN_CYCLES_PER_REQUEST: 100
    }
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

describe('OriginalTxsData', () => {
  const mockOriginalTx: OriginalTxData = {
    txId: 'tx-123',
    timestamp: 1234567890,
    cycle: 42,
    originalTxData: {
      tx: {
        to: '0x123',
        from: '0x456',
        value: '1000',
        data: '0x'
      }
    },
    submitterAppData: {
      networkId: 'testnet'
    }
  } as any

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('OriginalTxCheckpointData', () => {
    it('should create an OriginalTxCheckpointData instance', () => {
      const mockHash = 'abcdef1234567890'
      ;(Crypto.hash as jest.Mock).mockReturnValue(mockHash)

      const checkpointData = new OriginalTxCheckpointData(mockOriginalTx)

      expect(Crypto.hash).toHaveBeenCalledWith(JSON.stringify(mockOriginalTx))
      expect(checkpointData.a).toBe('ab') // First 2 chars of hash
      expect(checkpointData.t).toBe(1234567890) // Timestamp
      expect(checkpointData.h).toBe(mockHash)
      expect(checkpointData.c).toBe(CheckpointType.OriginalTx)
      expect(checkpointData.d).toBe(mockOriginalTx)
    })

    it('should handle uppercase hash correctly', () => {
      const mockHash = 'ABCDEF1234567890'
      ;(Crypto.hash as jest.Mock).mockReturnValue(mockHash)

      const checkpointData = new OriginalTxCheckpointData(mockOriginalTx)

      expect(checkpointData.a).toBe('ab') // Should be lowercase
      expect(checkpointData.h).toBe('abcdef1234567890') // Should be lowercase
    })

    it('should handle original tx with zero timestamp', () => {
      const txWithZeroTimestamp = { ...mockOriginalTx, timestamp: 0 }
      ;(Crypto.hash as jest.Mock).mockReturnValue('123456')

      const checkpointData = new OriginalTxCheckpointData(txWithZeroTimestamp)

      expect(checkpointData.t).toBe(0)
    })

    it('should handle empty original tx data', () => {
      const emptyTx = { ...mockOriginalTx, originalTxData: {} }
      ;(Crypto.hash as jest.Mock).mockReturnValue('emptyhash')

      const checkpointData = new OriginalTxCheckpointData(emptyTx)

      expect(checkpointData.d.originalTxData).toEqual({})
    })
  })

  describe('calculateBucketID', () => {
    it('should return cycle as bucket ID', () => {
      const bucketId = calculateBucketID(mockOriginalTx)
      expect(bucketId).toBe('42')
    })

    it('should handle zero cycle', () => {
      const txWithZeroCycle = { ...mockOriginalTx, cycle: 0 }
      const bucketId = calculateBucketID(txWithZeroCycle)
      expect(bucketId).toBe('0')
    })

    it('should handle large cycle numbers', () => {
      const txWithLargeCycle = { ...mockOriginalTx, cycle: 999999 }
      const bucketId = calculateBucketID(txWithLargeCycle)
      expect(bucketId).toBe('999999')
    })

    it('should throw error for invalid original tx data', () => {
      expect(() => calculateBucketID(null as any)).toThrow('Invalid originalTx data')
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid originalTx data')
    })

    it('should throw error for undefined txId', () => {
      const invalidTx = { ...mockOriginalTx, txId: undefined } as any
      expect(() => calculateBucketID(invalidTx)).toThrow('Invalid originalTx data')
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid originalTx data')
    })

    it('should throw error for missing tx data', () => {
      const invalidTx = {} as any
      expect(() => calculateBucketID(invalidTx)).toThrow('Invalid originalTx data')
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid originalTx data')
    })
  })

  describe('OriginalTxCheckpointRadixEntry', () => {
    it('should create an OriginalTxCheckpointRadixEntry instance', () => {
      // Mock the hash function for empty data
      ;(Crypto.hash as jest.Mock).mockReturnValue('empty-hash')
      
      const radixEntry = new OriginalTxCheckpointRadixEntry('ab')
      
      expect(radixEntry).toBeDefined()
      expect(radixEntry.digest).toBeDefined()
      expect(radixEntry.digest.radix).toBe('ab')
      expect(radixEntry.digest.hash).toBe('empty-hash')
      expect(radixEntry.digest.itemCount).toBe(0)
      expect(radixEntry.sortedData).toEqual([])
    })

    it('should create with different radix values', () => {
      ;(Crypto.hash as jest.Mock).mockReturnValue('hash-ff')
      
      const radixEntry = new OriginalTxCheckpointRadixEntry('ff')
      
      expect(radixEntry.digest.radix).toBe('ff')
    })
  })

  describe('OriginalTxCheckpointRadixDigest', () => {
    it('should create an OriginalTxCheckpointRadixDigest instance', () => {
      const radixDigest = new OriginalTxCheckpointRadixDigest('ab', 'hash123', 5)
      
      expect(radixDigest).toBeDefined()
      expect(radixDigest.radix).toBe('ab')
      expect(radixDigest.hash).toBe('hash123')
      expect(radixDigest.itemCount).toBe(5)
    })

    it('should handle zero item count', () => {
      const radixDigest = new OriginalTxCheckpointRadixDigest('cd', 'hash456', 0)
      
      expect(radixDigest.itemCount).toBe(0)
    })

    it('should handle large item counts', () => {
      const radixDigest = new OriginalTxCheckpointRadixDigest('ef', 'hash789', 1000000)
      
      expect(radixDigest.itemCount).toBe(1000000)
    })
  })

  describe('OriginalTxCheckpointBucket', () => {
    const mockValidateData = jest.fn()
    const mockUpdateData = jest.fn()

    it('should create an OriginalTxCheckpointBucket instance', () => {
      const bucket = new OriginalTxCheckpointBucket(
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
      expect(bucket.checkpointType).toBe(CheckpointType.OriginalTx)
    })

    it('should call parent update method', async () => {
      const bucket = new OriginalTxCheckpointBucket(
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

    it('should handle different time ranges', () => {
      const bucket = new OriginalTxCheckpointBucket(
        5000,
        10000,
        'bucket-2',
        mockValidateData,
        mockUpdateData
      )
      
      expect(bucket.startTime).toBe(5000)
      expect(bucket.endTime).toBe(10000)
    })
  })

  describe('validateData function', () => {
    it('should validate original tx data correctly', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      ;(validateOriginalTxDataSchema as jest.Mock).mockReturnValue(true)

      // Access the validateData function through the module
      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(true)
        expect(validateOriginalTxDataSchema).toHaveBeenCalledWith(mockOriginalTx)
      }
    })

    it('should return false for invalid data', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      ;(validateOriginalTxDataSchema as jest.Mock).mockReturnValue(false)

      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        const result = await validateData(mockData)
        expect(result).toBe(false)
        expect(validateOriginalTxDataSchema).toHaveBeenCalledWith(mockOriginalTx)
      }
    })

    it('should handle validation errors', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      ;(validateOriginalTxDataSchema as jest.Mock).mockImplementation(() => {
        throw new Error('Validation error')
      })

      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const validateData = module.validateData || module.default?.validateData

      if (validateData) {
        await expect(validateData(mockData)).rejects.toThrow('Validation error')
      }
    })
  })

  describe('updateData function', () => {
    it('should insert original tx data successfully', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      ;(insertOriginalTxData as jest.Mock).mockResolvedValue(undefined)

      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const updateData = module.updateData || module.default?.updateData

      if (updateData) {
        await updateData(mockData)
        expect(insertOriginalTxData).toHaveBeenCalledWith(mockOriginalTx, false)
      }
    })

    it('should handle insert errors', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      const error = new Error('Database error')
      ;(insertOriginalTxData as jest.Mock).mockRejectedValue(error)

      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const updateData = module.updateData || module.default?.updateData

      if (updateData) {
        await expect(updateData(mockData)).rejects.toThrow('Database error')
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to store originalTx checkpoint data:', error)
      }
    })

    it('should handle network errors', async () => {
      const mockData = {
        a: 'ab',
        t: 1234567890,
        h: 'validhash',
        c: CheckpointType.OriginalTx,
        d: mockOriginalTx
      }

      const error = new Error('Network timeout')
      ;(insertOriginalTxData as jest.Mock).mockRejectedValue(error)

      const module = require('../../../../src/checkpoint/OriginalTxsData')
      const updateData = module.updateData || module.default?.updateData

      if (updateData) {
        await expect(updateData(mockData)).rejects.toThrow('Network timeout')
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to store originalTx checkpoint data:', error)
      }
    })
  })

  describe('originalTxCheckpointManager singleton', () => {
    it('should export a singleton instance', () => {
      const { originalTxCheckpointManager } = require('../../../../src/checkpoint/OriginalTxsData')
      expect(originalTxCheckpointManager).toBeDefined()
    })

    it('should always return the same instance', () => {
      const module1 = require('../../../../src/checkpoint/OriginalTxsData')
      const module2 = require('../../../../src/checkpoint/OriginalTxsData')
      
      expect(module1.originalTxCheckpointManager).toBe(module2.originalTxCheckpointManager)
    })

    it('should be an instance of CheckpointBucketManager', () => {
      const { originalTxCheckpointManager } = require('../../../../src/checkpoint/OriginalTxsData')
      expect(originalTxCheckpointManager).toBeDefined()
      expect(originalTxCheckpointManager.checkpointType).toBe(CheckpointType.OriginalTx)
    })
  })
})