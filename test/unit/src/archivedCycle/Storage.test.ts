import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as Storage from '../../../../src/archivedCycle/Storage'
import { Database } from 'tydb'
import * as Logger from '../../../../src/Logger'
import { CycleChain } from '../../../../src/Data/Cycles'
import { StateManager, P2P } from '@shardeum-foundation/lib-types'
import * as StateMetaData from '../../../../src/archivedCycle/StateMetaData'

// Mock dependencies
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  },
}))

jest.mock('../../../../src/Data/Cycles', () => ({
  CycleChain: {
    get: jest.fn(),
  },
}))

jest.mock('tydb', () => {
  const mockDatabase = {
    createIndex: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    find: jest.fn(),
  }
  return {
    Database: jest.fn(() => mockDatabase),
    FS_Persistence_Adapter: jest.fn(),
  }
})

jest.mock('../../../../src/archivedCycle/StateMetaData', () => ({
  ArchivedCycle: {
    new: jest.fn((data) => data),
  },
}))

describe('archivedCycle/Storage', () => {
  let mockDatabase: any
  let mockLogger: any
  let mockCycleChain: any
  let mockConfig: any

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()

    // Get mocked instances
    mockLogger = Logger.mainLogger
    mockCycleChain = CycleChain
    
    // Create a new mock database instance
    mockDatabase = {
      createIndex: jest.fn(() => Promise.resolve()),
      insert: jest.fn(() => Promise.resolve()),
      update: jest.fn(() => Promise.resolve()),
      find: jest.fn(() => Promise.resolve([])),
    }
    
    // Mock Database constructor to return our mock
    ;(Database as jest.Mock).mockImplementation(() => mockDatabase)

    // Default config
    mockConfig = {
      ARCHIVER_DB: 'test-archiver.db',
    }
  })

  afterEach(() => {
    // Reset module state
    jest.resetModules()
  })

  describe('initStorage', () => {
    it('should initialize database with correct configuration', async () => {
      await Storage.initStorage(mockConfig)

      expect(Database).toHaveBeenCalledWith({
        ref: 'test-archiver.db',
        model: StateMetaData.ArchivedCycle,
        persistence_adapter: expect.any(Function),
        autoCompaction: 300000, // 10 * 30 * 1000
      })

      expect(mockDatabase.createIndex).toHaveBeenCalledWith({
        fieldName: 'cycleMarker',
        unique: true,
      })
    })

    it('should handle custom database path from config', async () => {
      mockConfig.ARCHIVER_DB = '/custom/path/archiver.db'
      
      await Storage.initStorage(mockConfig)

      expect(Database).toHaveBeenCalledWith(
        expect.objectContaining({
          ref: '/custom/path/archiver.db',
        })
      )
    })
  })

  describe('insertArchivedCycle', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    it('should successfully insert archived cycle', async () => {
      const archivedCycle = {
        cycleMarker: 'marker123',
        cycleRecord: {
          counter: 10,
        },
      } as StateMetaData.ArchivedCycle

      await Storage.insertArchivedCycle(archivedCycle)

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Inserting archived cycle',
        10,
        'marker123'
      )
      expect(StateMetaData.ArchivedCycle.new).toHaveBeenCalledWith(archivedCycle)
      expect(mockDatabase.insert).toHaveBeenCalledWith([archivedCycle])
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Successfully inserted archivedCycle',
        10
      )
    })

    it('should handle insertion errors', async () => {
      const archivedCycle = {
        cycleMarker: 'marker123',
        cycleRecord: {
          counter: 10,
        },
      } as StateMetaData.ArchivedCycle

      const error = new Error('Duplicate key error')
      mockDatabase.insert.mockRejectedValueOnce(error)

      await Storage.insertArchivedCycle(archivedCycle)

      expect(mockLogger.error).toHaveBeenCalledWith(error)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unable to insert archive cycle or it is already stored in to database',
        10,
        'marker123'
      )
    })
  })

  describe('updateReceiptMap', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    it('should update receipt map successfully', async () => {
      const receiptMapResult: StateManager.StateManagerTypes.ReceiptMapResult = {
        cycle: 5,
        partition: 2,
        receiptMap: { test: 'map' },
        txsMap: { tx1: ['data1'] },
      } as any

      const parentCycle = { marker: 'parent-marker' }
      mockCycleChain.get.mockReturnValue(parentCycle)

      const existingArchivedCycle = {
        receipt: {
          partitionMaps: { 1: 'existing' },
          partitionTxs: { 1: 'existing' },
        },
      }
      mockDatabase.find.mockResolvedValueOnce([existingArchivedCycle])

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockCycleChain.get).toHaveBeenCalledWith(5)
      expect(mockDatabase.find).toHaveBeenCalledWith({
        filter: { cycleMarker: 'parent-marker' },
      })
      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'parent-marker' },
        update: {
          $set: {
            'receipt.partitionMaps': {
              1: 'existing',
              2: { test: 'map' },
            },
            'receipt.partitionTxs': {
              1: 'existing',
              2: { tx1: ['data1'] },
            },
          },
        },
      })
    })

    it('should handle null receiptMapResult', async () => {
      await Storage.updateReceiptMap(null as any)

      expect(mockCycleChain.get).not.toHaveBeenCalled()
      expect(mockDatabase.update).not.toHaveBeenCalled()
    })

    it('should handle missing parent cycle', async () => {
      const receiptMapResult = { cycle: 5 } as any
      mockCycleChain.get.mockReturnValue(null)

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unable find record with parent cycle with counter',
        5
      )
      expect(mockDatabase.update).not.toHaveBeenCalled()
    })

    it('should handle missing existing archived cycle', async () => {
      const receiptMapResult = { cycle: 5 } as any
      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      mockDatabase.find.mockResolvedValueOnce([])

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unable find existing archived cycle with marker',
        'marker'
      )
      expect(mockDatabase.update).not.toHaveBeenCalled()
    })

    it('should handle EVM receipts in txsMap', async () => {
      const receiptMapResult: any = {
        cycle: 5,
        partition: 2,
        receiptMap: { test: 'map' },
        txsMap: { tx1: ['data1'] },
        txsMapEVMReceipt: { tx1: 'evmData' },
      }

      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      mockDatabase.find.mockResolvedValueOnce([{ receipt: {} }])

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'marker' },
        update: {
          $set: {
            'receipt.partitionMaps': { 2: { test: 'map' } },
            'receipt.partitionTxs': { 2: { tx1: ['data1', 'evmData'] } },
          },
        },
      })
    })

    it('should handle update errors', async () => {
      const receiptMapResult = { cycle: 5, partition: 2 } as any
      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      mockDatabase.find.mockResolvedValueOnce([{ receipt: {} }])
      
      const error = new Error('Update failed')
      mockDatabase.update.mockRejectedValueOnce(error)

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unable to update receipt maps in archived cycle'
      )
      expect(mockLogger.error).toHaveBeenCalledWith(error)
    })
  })

  describe('updateSummaryBlob', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    it('should update summary blob successfully', async () => {
      const summaryBlob = {
        partition: 3,
        data: 'blob-data',
      } as any

      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      mockDatabase.find.mockResolvedValueOnce([{
        summary: {
          partitionBlobs: { 1: 'existing' },
        },
      }])

      await Storage.updateSummaryBlob(summaryBlob, 10)

      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'marker' },
        update: {
          $set: {
            'summary.partitionBlobs': {
              1: 'existing',
              3: summaryBlob,
            },
          },
        },
      })
    })

    it('should handle null summaryBlob', async () => {
      await Storage.updateSummaryBlob(null as any, 10)

      expect(mockCycleChain.get).not.toHaveBeenCalled()
      expect(mockDatabase.update).not.toHaveBeenCalled()
    })

    it('should handle errors', async () => {
      const summaryBlob = { partition: 3 } as any
      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      mockDatabase.find.mockResolvedValueOnce([{}])
      
      const error = new Error('Update failed')
      mockDatabase.update.mockRejectedValueOnce(error)

      await Storage.updateSummaryBlob(summaryBlob, 10)

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Unable to update summary blobs in archived cycle'
      )
      expect(mockLogger.error).toHaveBeenCalledWith(error)
    })
  })

  describe('updateArchivedCycle', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    it('should update archived cycle field', async () => {
      await Storage.updateArchivedCycle('marker123', 'status', 'completed')

      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'marker123' },
        update: { $set: { status: 'completed' } },
      })
    })

    it('should handle complex field values', async () => {
      const complexData = { nested: { value: 123 } }
      
      await Storage.updateArchivedCycle('marker123', 'data', complexData)

      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'marker123' },
        update: { $set: { data: complexData } },
      })
    })
  })

  describe('query functions', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    describe('queryAllArchivedCycles', () => {
      it('should query all archived cycles with default sort', async () => {
        const mockCycles = [{ cycleRecord: { counter: 10 } }, { cycleRecord: { counter: 9 } }]
        mockDatabase.find.mockResolvedValueOnce(mockCycles)

        const result = await Storage.queryAllArchivedCycles()

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: {},
          sort: { 'cycleRecord.counter': -1 },
          limit: null,
          project: { _id: 0 },
        })
        expect(result).toEqual(mockCycles)
      })

      it('should limit results when count is provided', async () => {
        await Storage.queryAllArchivedCycles(5)

        expect(mockDatabase.find).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 5,
          })
        )
      })
    })

    describe('queryAllArchivedCyclesBetween', () => {
      it('should query cycles within range', async () => {
        const mockCycles = [{ cycleRecord: { counter: 20 } }]
        mockDatabase.find.mockResolvedValueOnce(mockCycles)

        const result = await Storage.queryAllArchivedCyclesBetween(10, 20)

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: {
            $and: [
              { 'cycleRecord.counter': { $gte: 10 } },
              { 'cycleRecord.counter': { $lte: 20 } },
            ],
          },
          sort: { 'cycleRecord.counter': -1 },
          limit: 11, // end - start + 1
          project: { _id: 0 },
        })
        expect(result).toEqual(mockCycles)
      })
    })

    describe('queryAllCycleRecords', () => {
      it('should return only cycle records', async () => {
        const mockData = [
          { cycleRecord: { counter: 10 } },
          { cycleRecord: { counter: 9 } },
        ]
        mockDatabase.find.mockResolvedValueOnce(mockData)

        const result = await Storage.queryAllCycleRecords()

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: {},
          sort: { 'cycleRecord.counter': -1 },
          project: {
            _id: 0,
            cycleMarker: 0,
            receipt: 0,
            data: 0,
            summary: 0,
          },
        })
        expect(result).toEqual([{ counter: 10 }, { counter: 9 }])
      })
    })

    describe('queryLatestCycleRecords', () => {
      it('should query latest cycle records with default count', async () => {
        const mockData = [{ cycleRecord: { counter: 100 } }]
        mockDatabase.find.mockResolvedValueOnce(mockData)

        const result = await Storage.queryLatestCycleRecords()

        expect(mockDatabase.find).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 1,
          })
        )
        expect(result).toEqual([{ counter: 100 }])
      })

      it('should query multiple latest records', async () => {
        await Storage.queryLatestCycleRecords(5)

        expect(mockDatabase.find).toHaveBeenCalledWith(
          expect.objectContaining({
            limit: 5,
          })
        )
      })
    })

    describe('queryCycleRecordsBetween', () => {
      it('should query cycle records between range', async () => {
        const mockData = [
          { cycleRecord: { counter: 15 } },
          { cycleRecord: { counter: 12 } },
        ]
        mockDatabase.find.mockResolvedValueOnce(mockData)

        const result = await Storage.queryCycleRecordsBetween(10, 20)

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: {
            $and: [
              { 'cycleRecord.counter': { $gte: 10 } },
              { 'cycleRecord.counter': { $lte: 20 } },
            ],
          },
          sort: { 'cycleRecord.counter': -1 },
        })
        expect(result).toEqual([{ counter: 15 }, { counter: 12 }])
      })
    })

    describe('queryArchivedCycleByMarker', () => {
      it('should return archived cycle when found', async () => {
        const mockCycle = { cycleMarker: 'marker123' }
        mockDatabase.find.mockResolvedValueOnce([mockCycle])

        const result = await Storage.queryArchivedCycleByMarker('marker123')

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: { cycleMarker: 'marker123' },
        })
        expect(result).toEqual(mockCycle)
      })

      it('should return undefined when not found', async () => {
        mockDatabase.find.mockResolvedValueOnce([])

        const result = await Storage.queryArchivedCycleByMarker('nonexistent')

        expect(result).toBeUndefined()
      })
    })

    describe('queryReceiptMapHash', () => {
      it('should return receipt map hash when found', async () => {
        const mockCycle = {
          receipt: {
            partitionHashes: {
              2: 'hash123',
            },
          },
        }
        mockDatabase.find.mockResolvedValueOnce([mockCycle])

        const result = await Storage.queryReceiptMapHash(10, 2)

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: { 'cycleRecord.counter': 10 },
        })
        expect(result).toBe('hash123')
      })

      it('should return undefined when cycle not found', async () => {
        mockDatabase.find.mockResolvedValueOnce([])

        const result = await Storage.queryReceiptMapHash(10, 2)

        expect(result).toBeUndefined()
      })

      it('should return undefined when receipt data missing', async () => {
        mockDatabase.find.mockResolvedValueOnce([{}])

        const result = await Storage.queryReceiptMapHash(10, 2)

        expect(result).toBeUndefined()
      })
    })

    describe('querySummaryHash', () => {
      it('should return summary hash when found', async () => {
        const mockCycle = {
          summary: {
            partitionHashes: {
              3: 'summary-hash',
            },
          },
        }
        mockDatabase.find.mockResolvedValueOnce([mockCycle])

        const result = await Storage.querySummaryHash(10, 3)

        expect(mockDatabase.find).toHaveBeenCalledWith({
          filter: { 'cycleRecord.counter': 10 },
        })
        expect(result).toBe('summary-hash')
      })

      it('should return undefined when summary data missing', async () => {
        mockDatabase.find.mockResolvedValueOnce([{}])

        const result = await Storage.querySummaryHash(10, 3)

        expect(result).toBeUndefined()
      })
    })
  })

  describe('edge cases', () => {
    beforeEach(async () => {
      await Storage.initStorage(mockConfig)
    })

    it('should handle undefined fields in updateReceiptMap', async () => {
      const receiptMapResult: any = {
        cycle: 5,
        partition: 2,
        receiptMap: { test: 'map' },
        txsMap: { tx1: ['data1'] },
      }

      mockCycleChain.get.mockReturnValue({ marker: 'marker' })
      // Existing cycle has no receipt field
      mockDatabase.find.mockResolvedValueOnce([{}])

      await Storage.updateReceiptMap(receiptMapResult)

      expect(mockDatabase.update).toHaveBeenCalledWith({
        filter: { cycleMarker: 'marker' },
        update: {
          $set: {
            'receipt.partitionMaps': { 2: { test: 'map' } },
            'receipt.partitionTxs': { 2: { tx1: ['data1'] } },
          },
        },
      })
    })

    it('should handle database connection errors', async () => {
      const error = new Error('Database connection failed')
      mockDatabase.createIndex.mockRejectedValueOnce(error)

      // initStorage doesn't catch errors, so it will throw
      await expect(Storage.initStorage(mockConfig)).rejects.toThrow(error)
    })

    it('should handle empty query results gracefully', async () => {
      mockDatabase.find.mockResolvedValueOnce([])

      const allCycles = await Storage.queryAllArchivedCycles()
      const cycleRecords = await Storage.queryAllCycleRecords()
      const latestRecords = await Storage.queryLatestCycleRecords()

      expect(allCycles).toEqual([])
      expect(cycleRecords).toEqual([])
      expect(latestRecords).toEqual([])
    })

    it('should handle large batch operations', async () => {
      // Test querying a large range
      const start = 1
      const end = 10000
      
      await Storage.queryAllArchivedCyclesBetween(start, end)

      expect(mockDatabase.find).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10000, // end - start + 1
        })
      )
    })
  })
})