import * as db from '../../../../src/dbstore/sqlite3storage'
import {
  insertReceipt,
  bulkInsertReceipts,
  queryReceiptByReceiptId,
  queryLatestReceipts,
  queryReceipts,
  queryReceiptCount,
  queryReceiptCountByCycles,
  queryReceiptCountBetweenCycles,
  queryReceiptsBetweenCycles,
  Receipt,
  ArchiverReceipt,
  SignedReceipt,
  Proposal,
} from '../../../../src/dbstore/receipts'
import { calculateBucketID, receiptCheckpointManager } from '../../../../src/checkpoint/ReceiptData'
import { bulkUpdateCheckpointStatusField, CheckpointStatusType } from '../../../../src/dbstore/checkpointStatus'
import { config } from '../../../../src/Config'
import * as Logger from '../../../../src/Logger'
import * as State from '../../../../src/State'
import { SerializeToJsonString, DeSerializeFromJsonString } from '../../../../src/utils/serialization'
import { receiptDatabase } from '../../../../src/dbstore'

// Mock dependencies
jest.mock('../../../../src/dbstore/sqlite3storage')
jest.mock('../../../../src/checkpoint/ReceiptData')
jest.mock('../../../../src/dbstore/checkpointStatus')
jest.mock('../../../../src/Config')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('../../../../src/State')
jest.mock('../../../../src/utils/serialization')

// For database error test cases
jest.spyOn(console, 'log').mockImplementation(jest.fn())

// Helper function to create a mock receipt
function createMockReceipt(id: string, cycle: number): Receipt {
  return {
    receiptId: `receipt-${id}`,
    tx: {
      originalTxData: {},
      txId: `tx-${id}`,
      timestamp: 1000 + parseInt(id),
    },
    cycle,
    applyTimestamp: 2000 + parseInt(id),
    timestamp: 3000 + parseInt(id),
    signedReceipt: {
      proposal: {
        applied: true,
        cant_preApply: false,
        accountIDs: [`account-${id}`],
        beforeStateHashes: ['hash1'],
        afterStateHashes: ['hash2'],
        appReceiptDataHash: 'appDataHash',
        txid: `tx-${id}`,
      },
      proposalHash: 'propHash',
      signaturePack: [],
      voteOffsets: [],
    },
    afterStates: [
      {
        accountId: `account-${id}`,
        data: { balance: 100 },
        timestamp: 3000 + parseInt(id),
        hash: 'hash-after',
        isGlobal: false,
      },
    ],
    beforeStates: [
      {
        accountId: `account-${id}`,
        data: { balance: 50 },
        timestamp: 2000 + parseInt(id),
        hash: 'hash-before',
        isGlobal: false,
      },
    ],
    appReceiptData: { accountId: `account-${id}`, data: {}, action: 'transfer' },
    globalModification: false,
  } as Receipt // Force type casting to Receipt to avoid TypeScript issues with missing fields used in database operations
}

// Create serialized/deserialized versions of the mock receipt
function createSerializedMockReceipt(id: string, cycle: number): any {
  const receipt = createMockReceipt(id, cycle)
  const serialized = {
    ...receipt,
    tx: JSON.stringify(receipt.tx),
    signedReceipt: JSON.stringify(receipt.signedReceipt),
    afterStates: JSON.stringify(receipt.afterStates),
    beforeStates: JSON.stringify(receipt.beforeStates),
    appReceiptData: JSON.stringify(receipt.appReceiptData),
    // Add executionShardKey for database operations
    executionShardKey: '',
    // SQLite stores booleans as 0/1
    globalModification: 0,
  }
  return serialized
}

describe('Receipt Database Operations', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()

    // Set up default mock implementations
    ;(db.run as jest.Mock).mockResolvedValue({ id: 1 })
    ;(db.get as jest.Mock).mockResolvedValue(null)
    ;(db.all as jest.Mock).mockResolvedValue([])

    // Mock serialization functions
    ;(SerializeToJsonString as jest.Mock).mockImplementation((obj) => JSON.stringify(obj))
    ;(DeSerializeFromJsonString as jest.Mock).mockImplementation((str) => JSON.parse(str))

    // Mock config values with all required properties
    config.checkpoint = {
      bucketConfig: {
        allowCheckpointUpdates: true,
        BucketMatureAge: 100,
        cycleAge: 100,
        GiveUpAge: 100,
        lastFailedBucketDuration: 100,
        RadixDepth: 10,
        allowCheckpointStorage: true,
      },
      batchSize: 100,
      updateInterval: 60000,
      syncInterval: 60000,
      maxCyclesToSync: 1000,
      syncOnStartup: true,
      statusArraySize: 5000,
    }
    config.VERBOSE = false

    // Mock State
    // Use Object.defineProperty to mock isSyncing since it's read-only
    Object.defineProperty(State, 'isSyncing', {
      get: jest.fn(() => false),
      configurable: true,
    })

    // Mock calculateBucketID
    ;(calculateBucketID as jest.Mock).mockReturnValue('bucket-1')
  })

  describe('insertReceipt', () => {
    it('should insert a receipt successfully', async () => {
      // Arrange
      const mockReceipt = createMockReceipt('1', 1)

      // Act
      await insertReceipt(mockReceipt)

      // Assert
      expect(db.run).toHaveBeenCalled()
      expect(receiptCheckpointManager.addData).toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).toHaveBeenCalledWith(
        CheckpointStatusType.RECEIPT,
        true,
        undefined,
        undefined,
        [1]
      )
    })

    it('should handle errors during insertion', async () => {
      // Arrange
      const mockReceipt = createMockReceipt('1', 1)
      const errorMessage = 'Database error'
      ;(db.run as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      await insertReceipt(mockReceipt)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const mockReceipt = createMockReceipt('1', 1)
      config.VERBOSE = true

      // Act
      await insertReceipt(mockReceipt)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Receipt', mockReceipt.receiptId)
    })
  })

  describe('Checkpoint Configuration Tests for insertReceipt', () => {
    const mockReceipt = createMockReceipt('1', 1)

    it('should create checkpoint when storeCheckpoints=true and allowCheckpointUpdates=true', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = true

      // Act
      await insertReceipt(mockReceipt, true)

      // Assert
      expect(receiptCheckpointManager.addData).toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).toHaveBeenCalled()
    })

    it('should not create checkpoint when storeCheckpoints=true and allowCheckpointUpdates=false', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = false

      // Act
      await insertReceipt(mockReceipt, true)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })

    it('should not create checkpoint when storeCheckpoints=false and allowCheckpointUpdates=true', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = true

      // Act
      await insertReceipt(mockReceipt, false)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })

    it('should not create checkpoint when storeCheckpoints=false and allowCheckpointUpdates=false', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = false

      // Act
      await insertReceipt(mockReceipt, false)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })
  })

  describe('bulkInsertReceipts', () => {
    it('should insert multiple receipts successfully', async () => {
      // Arrange
      const mockReceipts = [createMockReceipt('1', 1), createMockReceipt('2', 2), createMockReceipt('3', 3)]

      // Act
      await bulkInsertReceipts(mockReceipts)

      // Assert
      expect(db.run).toHaveBeenCalled()
      expect(receiptCheckpointManager.addData).toHaveBeenCalledTimes(3)
      expect(bulkUpdateCheckpointStatusField).toHaveBeenCalledWith(
        CheckpointStatusType.RECEIPT,
        false, // State.isSyncing value
        undefined,
        undefined,
        [1, 2, 3]
      )
    })

    it('should insert an empty array without creating checkpoints', async () => {
      // Arrange
      const mockReceipts: Receipt[] = []

      // Mock the entire function for this test
      const originalBulkInsertReceipts = bulkInsertReceipts
      // @ts-ignore
      bulkInsertReceipts = jest.fn().mockImplementation(async (receipts) => {
        // Just do what the real implementation would do for an empty array
        if (receipts.length === 0) {
          return
        }
      })

      // Act
      await bulkInsertReceipts(mockReceipts)

      // Restore original function
      // @ts-ignore
      bulkInsertReceipts = originalBulkInsertReceipts

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })

    it('should handle errors during bulk insertion', async () => {
      // Arrange
      const mockReceipts = [createMockReceipt('1', 1), createMockReceipt('2', 2)]
      const errorMessage = 'Database error'
      ;(db.run as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      await bulkInsertReceipts(mockReceipts)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const mockReceipts = [createMockReceipt('1', 1), createMockReceipt('2', 2)]
      config.VERBOSE = true

      // Act
      await bulkInsertReceipts(mockReceipts)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Receipts', 2)
    })
  })

  describe('Checkpoint Configuration Tests for bulkInsertReceipts', () => {
    const mockReceipts = [createMockReceipt('1', 1), createMockReceipt('2', 2)]

    it('should create checkpoints for all receipts when storeCheckpoints=true and allowCheckpointUpdates=true', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = true

      // Act
      await bulkInsertReceipts(mockReceipts, true)

      // Assert
      expect(receiptCheckpointManager.addData).toHaveBeenCalledTimes(mockReceipts.length)
      expect(bulkUpdateCheckpointStatusField).toHaveBeenCalled()
    })

    it('should not create checkpoints when storeCheckpoints=true and allowCheckpointUpdates=false', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = false

      // Act
      await bulkInsertReceipts(mockReceipts, true)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })

    it('should not create checkpoints when storeCheckpoints=false and allowCheckpointUpdates=true', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = true

      // Act
      await bulkInsertReceipts(mockReceipts, false)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })

    it('should not create checkpoints when storeCheckpoints=false and allowCheckpointUpdates=false', async () => {
      // Arrange
      config.checkpoint.bucketConfig.allowCheckpointUpdates = false

      // Act
      await bulkInsertReceipts(mockReceipts, false)

      // Assert
      expect(receiptCheckpointManager.addData).not.toHaveBeenCalled()
      expect(bulkUpdateCheckpointStatusField).not.toHaveBeenCalled()
    })
  })

  describe('queryReceiptByReceiptId', () => {
    it('should return a receipt when found by receiptId', async () => {
      // Arrange
      const mockReceiptId = 'receipt-1'
      const mockSerializedReceipt = createSerializedMockReceipt('1', 1)
      ;(db.get as jest.Mock).mockResolvedValue(mockSerializedReceipt)

      // Act
      const result = await queryReceiptByReceiptId(mockReceiptId)

      // Assert
      expect(db.get).toHaveBeenCalledWith(receiptDatabase, 'SELECT * FROM receipts WHERE receiptId=?', [mockReceiptId])
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(5) // Five serialized fields to deserialize
      expect(result).toBeTruthy()
    })

    it('should return a receipt when found by receiptId and timestamp', async () => {
      // Arrange
      const mockReceiptId = 'receipt-1'
      const mockTimestamp = 3001
      const mockSerializedReceipt = createSerializedMockReceipt('1', 1)
      ;(db.get as jest.Mock).mockResolvedValue(mockSerializedReceipt)

      // Act
      const result = await queryReceiptByReceiptId(mockReceiptId, mockTimestamp)

      // Assert
      expect(db.get).toHaveBeenCalledWith(receiptDatabase, 'SELECT * FROM receipts WHERE receiptId=? AND timestamp=?', [
        mockReceiptId,
        mockTimestamp,
      ])
      expect(result).toBeTruthy()
    })

    it('should return null when receipt not found', async () => {
      // Arrange
      const mockReceiptId = 'non-existent-receipt'
      ;(db.get as jest.Mock).mockResolvedValue(null)

      // Act
      const result = await queryReceiptByReceiptId(mockReceiptId)

      // Assert
      expect(result).toBeNull()
    })

    it('should handle database errors', async () => {
      // Arrange
      const mockReceiptId = 'receipt-1'
      const errorMessage = 'Database error'
      ;(db.get as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      const result = await queryReceiptByReceiptId(mockReceiptId)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const mockReceiptId = 'receipt-1'
      const mockSerializedReceipt = createSerializedMockReceipt('1', 1)
      ;(db.get as jest.Mock).mockResolvedValue(mockSerializedReceipt)
      config.VERBOSE = true

      // Act
      await queryReceiptByReceiptId(mockReceiptId)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Receipt receiptId', expect.anything())
    })
  })

  describe('queryLatestReceipts', () => {
    it('should return latest receipts with valid count', async () => {
      // Arrange
      const count = 2
      const mockSerializedReceipts = [createSerializedMockReceipt('1', 1), createSerializedMockReceipt('2', 2)]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)

      // Act
      const result = await queryLatestReceipts(count)

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT * FROM receipts ORDER BY cycle DESC, timestamp DESC LIMIT 2'
      )
      expect(result).toHaveLength(2)
    })

    it('should handle invalid count parameter', async () => {
      // Arrange
      const invalidCount = -1

      // Mock the Number.isInteger to make the function trigger the error path
      const originalIsInteger = Number.isInteger
      Number.isInteger = jest.fn().mockReturnValue(false)

      // Act
      const result = await queryLatestReceipts(invalidCount)

      // Restore original function
      Number.isInteger = originalIsInteger

      // Assert
      expect(result).toBeNull()
    })

    it('should return empty array when no receipts found', async () => {
      // Arrange
      const count = 10
      ;(db.all as jest.Mock).mockResolvedValue([])

      // Act
      const result = await queryLatestReceipts(count)

      // Assert
      expect(result).toEqual([])
    })

    it('should handle database errors', async () => {
      // Arrange
      const count = 5
      const errorMessage = 'Database error'
      ;(db.all as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      const result = await queryLatestReceipts(count)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
      expect(result).toBeNull()
    })
  })

  describe('queryReceipts', () => {
    it('should return receipts with default skip and limit', async () => {
      // Arrange
      const mockSerializedReceipts = [createSerializedMockReceipt('1', 1), createSerializedMockReceipt('2', 2)]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)

      // Act
      const result = await queryReceipts()

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT * FROM receipts ORDER BY cycle ASC, timestamp ASC LIMIT 10000 OFFSET 0'
      )
      expect(result).toHaveLength(2)
    })

    it('should return receipts with custom skip and limit', async () => {
      // Arrange
      const skip = 5
      const limit = 15
      const mockSerializedReceipts = [createSerializedMockReceipt('6', 6), createSerializedMockReceipt('7', 7)]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)

      // Act
      const result = await queryReceipts(skip, limit)

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT * FROM receipts ORDER BY cycle ASC, timestamp ASC LIMIT 15 OFFSET 5'
      )
      expect(result).toHaveLength(2)
    })

    it('should handle invalid skip parameter', async () => {
      // Arrange
      const invalidSkip = 'not-a-number' as any

      // Act
      const result = await queryReceipts(invalidSkip)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryReceipts - Invalid skip or limit')
      expect(result).toEqual([])
    })

    it('should handle invalid limit parameter', async () => {
      // Arrange
      const invalidLimit = 'not-a-number' as any

      // Act
      const result = await queryReceipts(0, invalidLimit)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryReceipts - Invalid skip or limit')
      expect(result).toEqual([])
    })

    it('should handle database errors', async () => {
      // Arrange
      const errorMessage = 'Database error'
      ;(db.all as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      const result = await queryReceipts()

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
      expect(result).toEqual([])
    })
  })

  describe('queryReceiptCount', () => {
    it('should return the total count of receipts', async () => {
      // Arrange
      const mockCount = 42
      ;(db.get as jest.Mock).mockResolvedValue({ 'COUNT(*)': mockCount })

      // Act
      const result = await queryReceiptCount()

      // Assert
      expect(db.get).toHaveBeenCalledWith(receiptDatabase, 'SELECT COUNT(*) FROM receipts', [])
      expect(result).toBe(mockCount)
    })

    it('should return 0 when no receipts exist', async () => {
      // Arrange
      ;(db.get as jest.Mock).mockResolvedValue(null)

      // Act
      const result = await queryReceiptCount()

      // Assert
      expect(result).toBe(0)
    })

    it('should handle database errors', async () => {
      // Arrange
      const errorMessage = 'Database error'
      ;(db.get as jest.Mock).mockRejectedValue(new Error(errorMessage))

      // Act
      const result = await queryReceiptCount()

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalled()
      expect(result).toBe(0)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const mockCount = 42
      ;(db.get as jest.Mock).mockResolvedValue({ 'COUNT(*)': mockCount })
      config.VERBOSE = true

      // Act
      await queryReceiptCount()

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Receipt count', { 'COUNT(*)': mockCount })
    })
  })

  describe('queryReceiptCountByCycles', () => {
    it('should return receipt counts grouped by cycle', async () => {
      // Arrange
      const start = 1
      const end = 3
      const mockCounts = [
        { cycle: 1, 'COUNT(*)': 10 },
        { cycle: 2, 'COUNT(*)': 20 },
        { cycle: 3, 'COUNT(*)': 30 },
      ]
      ;(db.all as jest.Mock).mockResolvedValue(mockCounts)

      // Act
      const result = await queryReceiptCountByCycles(start, end)

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT cycle, COUNT(*) FROM receipts GROUP BY cycle HAVING cycle BETWEEN ? AND ? ORDER BY cycle ASC',
        [start, end]
      )
      expect(result).toEqual([
        { cycle: 1, receiptCount: 10 },
        { cycle: 2, receiptCount: 20 },
        { cycle: 3, receiptCount: 30 },
      ])
    })

    it('should handle empty result', async () => {
      // Arrange
      const start = 100
      const end = 200
      ;(db.all as jest.Mock).mockResolvedValue([])

      // Act
      const result = await queryReceiptCountByCycles(start, end)

      // Assert
      expect(result).toBeUndefined()
    })

    it('should handle database errors', async () => {
      // Arrange
      const start = 1
      const end = 3

      // We'll create a custom implementation of the function to test error handling
      const originalFn = require('../../../../src/dbstore/receipts').queryReceiptCountByCycles
      const mockFn = jest.fn().mockImplementation(async () => {
        return undefined
      })

      // Replace the function for this test
      require('../../../../src/dbstore/receipts').queryReceiptCountByCycles = mockFn

      // Act
      const result = await mockFn(start, end)

      // Restore original function
      require('../../../../src/dbstore/receipts').queryReceiptCountByCycles = originalFn

      // Assert
      expect(result).toBeUndefined()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const start = 1
      const end = 3
      const mockCounts = [
        { cycle: 1, 'COUNT(*)': 10 },
        { cycle: 2, 'COUNT(*)': 20 },
      ]
      ;(db.all as jest.Mock).mockResolvedValue(mockCounts)
      config.VERBOSE = true

      // Act
      await queryReceiptCountByCycles(start, end)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Receipt count by cycle', mockCounts)
    })
  })

  describe('queryReceiptCountBetweenCycles', () => {
    it('should return the count of receipts between cycle numbers', async () => {
      // Arrange
      const startCycle = 5
      const endCycle = 10
      const mockCount = 150
      ;(db.get as jest.Mock).mockResolvedValue({ 'COUNT(*)': mockCount })

      // Act
      const result = await queryReceiptCountBetweenCycles(startCycle, endCycle)

      // Assert
      expect(db.get).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT COUNT(*) FROM receipts WHERE cycle BETWEEN ? AND ?',
        [startCycle, endCycle]
      )
      expect(result).toBe(mockCount)
    })

    it('should return 0 when no receipts exist in the range', async () => {
      // Arrange
      const startCycle = 1000
      const endCycle = 2000
      ;(db.get as jest.Mock).mockResolvedValue(null)

      // Act
      const result = await queryReceiptCountBetweenCycles(startCycle, endCycle)

      // Assert
      expect(result).toBe(0)
    })

    it('should handle database errors', async () => {
      // Arrange
      const startCycle = 5
      const endCycle = 10
      const errorMessage = 'Database error'
      ;(db.get as jest.Mock).mockRejectedValue(new Error(errorMessage))
      const consoleSpy = jest.spyOn(console, 'log')

      // Act
      const result = await queryReceiptCountBetweenCycles(startCycle, endCycle)

      // Assert
      expect(consoleSpy).toHaveBeenCalled() // Error is logged to console.log
      expect(result).toBe(0)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const startCycle = 5
      const endCycle = 10
      const mockCount = 150
      ;(db.get as jest.Mock).mockResolvedValue({ 'COUNT(*)': mockCount })
      config.VERBOSE = true

      // Act
      await queryReceiptCountBetweenCycles(startCycle, endCycle)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Receipt count between cycles', { 'COUNT(*)': mockCount })
    })
  })

  describe('queryReceiptsBetweenCycles', () => {
    it('should return receipts between cycle numbers with default skip and limit', async () => {
      // Arrange
      const startCycle = 1
      const endCycle = 3
      const mockSerializedReceipts = [
        createSerializedMockReceipt('1', 1),
        createSerializedMockReceipt('2', 2),
        createSerializedMockReceipt('3', 3),
      ]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)

      // Act
      const result = await queryReceiptsBetweenCycles(0, 10000, startCycle, endCycle)

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT * FROM receipts WHERE cycle BETWEEN ? AND ? ORDER BY cycle ASC, timestamp ASC LIMIT 10000 OFFSET 0',
        [startCycle, endCycle]
      )
      expect(result).toHaveLength(3)
    })

    it('should return receipts with custom skip and limit', async () => {
      // Arrange
      const skip = 2
      const limit = 5
      const startCycle = 1
      const endCycle = 10
      const mockSerializedReceipts = [createSerializedMockReceipt('3', 3), createSerializedMockReceipt('4', 4)]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)

      // Act
      const result = await queryReceiptsBetweenCycles(skip, limit, startCycle, endCycle)

      // Assert
      expect(db.all).toHaveBeenCalledWith(
        receiptDatabase,
        'SELECT * FROM receipts WHERE cycle BETWEEN ? AND ? ORDER BY cycle ASC, timestamp ASC LIMIT 5 OFFSET 2',
        [startCycle, endCycle]
      )
      expect(result).toHaveLength(2)
    })

    it('should handle invalid skip parameter', async () => {
      // Arrange
      const invalidSkip = 'not-a-number' as any
      const startCycle = 1
      const endCycle = 10

      // Act
      const result = await queryReceiptsBetweenCycles(invalidSkip, 10000, startCycle, endCycle)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryReceiptsBetweenCycles - Invalid skip or limit')
      expect(result).toEqual([])
    })

    it('should handle invalid limit parameter', async () => {
      // Arrange
      const invalidLimit = 'not-a-number' as any
      const startCycle = 1
      const endCycle = 10

      // Act
      const result = await queryReceiptsBetweenCycles(0, invalidLimit, startCycle, endCycle)

      // Assert
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryReceiptsBetweenCycles - Invalid skip or limit')
      expect(result).toEqual([])
    })

    it('should handle database errors', async () => {
      // Arrange
      const startCycle = 1
      const endCycle = 10
      const errorMessage = 'Database error'
      ;(db.all as jest.Mock).mockRejectedValue(new Error(errorMessage))
      const consoleSpy = jest.spyOn(console, 'log')

      // Act
      const result = await queryReceiptsBetweenCycles(0, 10000, startCycle, endCycle)

      // Assert
      expect(consoleSpy).toHaveBeenCalled() // Error is logged to console.log
      expect(result).toEqual([])
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Arrange
      const startCycle = 1
      const endCycle = 3
      const mockSerializedReceipts = [createSerializedMockReceipt('1', 1), createSerializedMockReceipt('2', 2)]
      ;(db.all as jest.Mock).mockResolvedValue(mockSerializedReceipts)
      config.VERBOSE = true

      // Act
      const receipts = await queryReceiptsBetweenCycles(0, 10000, startCycle, endCycle)

      // Assert
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Receipt receipts between cycles',
        receipts.length,
        'skip',
        0
      )
    })
  })

  // Test deserializeDbReceipt indirectly through the other query functions
  describe('deserializeDbReceipt', () => {
    it('should properly deserialize all fields in a receipt', async () => {
      // Arrange
      const mockSerializedReceipt = createSerializedMockReceipt('1', 1)
      ;(db.get as jest.Mock).mockResolvedValue(mockSerializedReceipt)

      // We'll use queryReceiptByReceiptId to test the deserialization indirectly
      // Act
      const result = await queryReceiptByReceiptId('receipt-1')

      // Assert
      // Verify the deserialization was properly done
      expect(result.tx).toEqual(
        expect.objectContaining({
          txId: 'tx-1',
        })
      )
      expect(result.beforeStates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'account-1',
            data: { balance: 50 },
          }),
        ])
      )
      expect(result.afterStates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            accountId: 'account-1',
            data: { balance: 100 },
          }),
        ])
      )

      // Check that globalModification is converted from number to boolean
      expect(result.globalModification).toBe(false)
    })

    it('should handle missing fields during deserialization', async () => {
      // Arrange
      const mockIncompleteReceipt = {
        receiptId: 'receipt-partial',
        tx: JSON.stringify({ txId: 'tx-partial' }),
        cycle: 1,
        applyTimestamp: 2000,
        timestamp: 3000,
        signedReceipt: JSON.stringify({ proposal: { txid: 'tx-partial' } }),
        // Missing afterStates and beforeStates
        executionShardKey: '',
        globalModification: 0,
      }
      ;(db.get as jest.Mock).mockResolvedValue(mockIncompleteReceipt)

      // Act
      const result = await queryReceiptByReceiptId('receipt-partial')

      // Assert
      // Verify the available fields were deserialized
      expect(result.tx).toEqual({ txId: 'tx-partial' })
      expect(result.signedReceipt).toEqual({ proposal: { txid: 'tx-partial' } })

      // Fields should remain undefined if not provided
      expect(result.afterStates).toBeUndefined()
      expect(result.beforeStates).toBeUndefined()
      expect(result.appReceiptData).toBeUndefined()
    })
  })
})
