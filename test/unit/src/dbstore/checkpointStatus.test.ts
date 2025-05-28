import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as db from '../../../../src/dbstore/sqlite3storage'
import { checkpointStatusDatabase } from '../../../../src/dbstore'
import * as Logger from '../../../../src/Logger'
import { config } from '../../../../src/Config'
import {
  CheckpointStatusType,
  CheckpointStatus,
  fieldMapping,
  upsertCheckpointStatus,
  updateCheckpointStatusField,
  bulkUpdateCheckpointStatusField,
  getCheckpointStatus,
  getCheckpointStatusesByUnifiedStatus,
  getOldestPendingOrFailedCheckpointStatus,
  processCyclesNeedingSync,
  isBucketVerified,
} from '../../../../src/dbstore/checkpointStatus'

// Mock all dependencies
jest.mock('../../../../src/dbstore/sqlite3storage')
jest.mock('../../../../src/dbstore', () => ({
  checkpointStatusDatabase: 'checkpoint_status_db',
}))
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('../../../../src/Config', () => ({
  config: {
    VERBOSE: false,
  },
}))

describe('checkpointStatus', () => {
  // Cast mocked functions to jest.MockedFunction type
  const mockedRun = db.run as jest.MockedFunction<typeof db.run>
  const mockedGet = db.get as jest.MockedFunction<typeof db.get>
  const mockedAll = db.all as jest.MockedFunction<typeof db.all>
  const mockedLoggerDebug = Logger.mainLogger.debug as jest.MockedFunction<typeof Logger.mainLogger.debug>
  const mockedLoggerError = Logger.mainLogger.error as jest.MockedFunction<typeof Logger.mainLogger.error>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('CheckpointStatusType enum', () => {
    it('should have correct enum values', () => {
      expect(CheckpointStatusType.CYCLE).toBe('cycle')
      expect(CheckpointStatusType.RECEIPT).toBe('receipt')
      expect(CheckpointStatusType.ORIGINAL_TX).toBe('original_tx')
    })
  })

  describe('fieldMapping', () => {
    it('should map enum values to field names correctly', () => {
      expect(fieldMapping[CheckpointStatusType.CYCLE]).toBe('cycleStatus')
      expect(fieldMapping[CheckpointStatusType.RECEIPT]).toBe('receiptStatus')
      expect(fieldMapping[CheckpointStatusType.ORIGINAL_TX]).toBe('originalTxStatus')
    })
  })

  describe('upsertCheckpointStatus', () => {
    it('should insert or update a checkpoint status record with correct unified status', async () => {
      const status: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: false, // This should be recalculated
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: true,
        created_at: Date.now(),
      }

      await upsertCheckpointStatus(status)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('INSERT OR REPLACE INTO checkpoint_status'),
        [status.cycle, true, status.cycleStatus, status.receiptStatus, status.originalTxStatus, status.created_at]
      )
    })

    it('should calculate unified status as false when not all statuses are true', async () => {
      const status: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: true, // This should be recalculated to false
        cycleStatus: true,
        receiptStatus: false,
        originalTxStatus: true,
        created_at: Date.now(),
      }

      await upsertCheckpointStatus(status)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.anything(),
        [status.cycle, false, status.cycleStatus, status.receiptStatus, status.originalTxStatus, status.created_at]
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      ;(config as any).VERBOSE = true
      const status: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: false,
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: true,
        created_at: Date.now(),
      }

      await upsertCheckpointStatus(status)

      expect(mockedLoggerDebug).toHaveBeenCalledWith(
        expect.stringContaining('Successfully upserted checkpoint status for cycle 100')
      )
      ;(config as any).VERBOSE = false
    })

    it('should throw error when database operation fails', async () => {
      const error = new Error('Database error')
      mockedRun.mockRejectedValueOnce(error)

      const status: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: false,
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: true,
        created_at: Date.now(),
      }

      await expect(upsertCheckpointStatus(status)).rejects.toThrow('Database error')
      expect(mockedLoggerError).toHaveBeenCalledWith('Error upserting checkpoint status:', error)
    })
  })

  describe('updateCheckpointStatusField', () => {
    it('should update existing checkpoint status field', async () => {
      const existingStatus: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: false,
        cycleStatus: true,
        receiptStatus: false,
        originalTxStatus: false,
        created_at: Date.now(),
      }

      mockedGet.mockResolvedValueOnce(existingStatus)
      mockedGet.mockResolvedValueOnce({ ...existingStatus, receiptStatus: true })

      await updateCheckpointStatusField(100, CheckpointStatusType.RECEIPT, true)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        'UPDATE checkpoint_status SET receiptStatus = ? WHERE cycle = ?',
        [true, 100]
      )
      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        'UPDATE checkpoint_status SET unifiedStatus = ? WHERE cycle = ?',
        [false, 100]
      )
    })

    it('should create new checkpoint status when none exists', async () => {
      mockedGet.mockResolvedValueOnce(null)

      await updateCheckpointStatusField(100, CheckpointStatusType.CYCLE, true)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('INSERT INTO checkpoint_status'),
        expect.arrayContaining([100, false, true, false, false])
      )
    })

    it('should update unified status correctly when all statuses become true', async () => {
      const existingStatus: CheckpointStatus = {
        cycle: 100,
        unifiedStatus: false,
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: false,
        created_at: Date.now(),
      }

      mockedGet.mockResolvedValueOnce(existingStatus)
      mockedGet.mockResolvedValueOnce({ ...existingStatus, originalTxStatus: true })

      await updateCheckpointStatusField(100, CheckpointStatusType.ORIGINAL_TX, true)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        'UPDATE checkpoint_status SET unifiedStatus = ? WHERE cycle = ?',
        [true, 100]
      )
    })

    it('should throw error when database operation fails', async () => {
      const error = new Error('Database error')
      mockedGet.mockRejectedValueOnce(error)

      await expect(updateCheckpointStatusField(100, CheckpointStatusType.CYCLE, true)).rejects.toThrow('Database error')
      expect(mockedLoggerError).toHaveBeenCalledWith('Error updating checkpoint status field:', error)
    })
  })

  describe('bulkUpdateCheckpointStatusField', () => {
    it('should update status field for a range of cycles', async () => {
      const existingStatuses = [
        { cycle: 100, unifiedStatus: false, cycleStatus: true, receiptStatus: false, originalTxStatus: false, created_at: Date.now() },
        { cycle: 101, unifiedStatus: false, cycleStatus: false, receiptStatus: true, originalTxStatus: false, created_at: Date.now() },
      ]

      mockedAll.mockResolvedValueOnce(existingStatuses)

      await bulkUpdateCheckpointStatusField(CheckpointStatusType.ORIGINAL_TX, true, 100, 102)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('INSERT INTO checkpoint_status'),
        expect.arrayContaining([
          100, false, true, false, true, expect.any(Number),
          101, false, false, true, true, expect.any(Number),
          102, false, false, false, true, expect.any(Number),
        ])
      )
    })

    it('should update status field for specific cycles', async () => {
      const cycles = [100, 102, 105]
      
      mockedGet.mockResolvedValueOnce({ cycle: 100, unifiedStatus: false, cycleStatus: true, receiptStatus: false, originalTxStatus: false, created_at: Date.now() })
      mockedGet.mockResolvedValueOnce(null)
      mockedGet.mockResolvedValueOnce({ cycle: 105, unifiedStatus: true, cycleStatus: true, receiptStatus: true, originalTxStatus: true, created_at: Date.now() })

      await bulkUpdateCheckpointStatusField(CheckpointStatusType.RECEIPT, true, undefined, undefined, cycles)

      expect(mockedRun).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('INSERT INTO checkpoint_status'),
        expect.any(Array)
      )
    })

    it('should throw error when both range and cycles are provided', async () => {
      await expect(
        bulkUpdateCheckpointStatusField(CheckpointStatusType.CYCLE, true, 100, 200, [100, 101])
      ).rejects.toThrow('Only one of startCycle, endCycle, or cycles should be provided')
    })

    it('should throw error when endCycle < startCycle', async () => {
      await expect(
        bulkUpdateCheckpointStatusField(CheckpointStatusType.CYCLE, true, 200, 100)
      ).rejects.toThrow('Invalid range: endCycle (100) < startCycle (200)')
    })

    it('should log debug message when VERBOSE is true', async () => {
      ;(config as any).VERBOSE = true
      mockedAll.mockResolvedValueOnce([])

      await bulkUpdateCheckpointStatusField(CheckpointStatusType.CYCLE, true, 100, 100)

      expect(mockedLoggerDebug).toHaveBeenCalledWith(
        expect.stringContaining('Bulk updated field "cycle" to true for cycles [100..100]')
      )
      ;(config as any).VERBOSE = false
    })
  })

  describe('getCheckpointStatus', () => {
    it('should return checkpoint status for a given cycle', async () => {
      const dbRow = {
        cycle: 100,
        unifiedStatus: 1,
        cycleStatus: 1,
        receiptStatus: 0,
        originalTxStatus: 1,
        created_at: Date.now(),
      }

      mockedGet.mockResolvedValueOnce(dbRow)

      const result = await getCheckpointStatus(100)

      expect(result).toEqual({
        cycle: 100,
        unifiedStatus: true,
        cycleStatus: true,
        receiptStatus: false,
        originalTxStatus: true,
        created_at: dbRow.created_at,
      })
    })

    it('should return null when no status exists', async () => {
      mockedGet.mockResolvedValueOnce(null)

      const result = await getCheckpointStatus(100)

      expect(result).toBeNull()
    })

    it('should handle boolean values from database', async () => {
      const dbRow = {
        cycle: 100,
        unifiedStatus: true,
        cycleStatus: false,
        receiptStatus: true,
        originalTxStatus: false,
        created_at: Date.now(),
      }

      mockedGet.mockResolvedValueOnce(dbRow)

      const result = await getCheckpointStatus(100)

      expect(result).toEqual({
        cycle: 100,
        unifiedStatus: true,
        cycleStatus: false,
        receiptStatus: true,
        originalTxStatus: false,
        created_at: dbRow.created_at,
      })
    })

    it('should throw error when database operation fails', async () => {
      const error = new Error('Database error')
      mockedGet.mockRejectedValueOnce(error)

      await expect(getCheckpointStatus(100)).rejects.toThrow('Database error')
      expect(mockedLoggerError).toHaveBeenCalledWith('Error getting checkpoint status: Error: Database error')
    })
  })

  describe('getCheckpointStatusesByUnifiedStatus', () => {
    it('should return checkpoints with unified status true', async () => {
      const dbRows = [
        { cycle: 100, unifiedStatus: 1, cycleStatus: 1, receiptStatus: 1, originalTxStatus: 1, created_at: Date.now() },
        { cycle: 101, unifiedStatus: 1, cycleStatus: 1, receiptStatus: 1, originalTxStatus: 1, created_at: Date.now() },
      ]

      mockedAll.mockResolvedValueOnce(dbRows)

      const result = await getCheckpointStatusesByUnifiedStatus(true)

      expect(mockedAll).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('WHERE unifiedStatus = ?'),
        [1]
      )
      expect(result).toHaveLength(2)
      expect(result[0].unifiedStatus).toBe(true)
    })

    it('should return checkpoints with unified status false', async () => {
      const dbRows = [
        { cycle: 100, unifiedStatus: 0, cycleStatus: 1, receiptStatus: 0, originalTxStatus: 1, created_at: Date.now() },
      ]

      mockedAll.mockResolvedValueOnce(dbRows)

      const result = await getCheckpointStatusesByUnifiedStatus(false)

      expect(mockedAll).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('WHERE unifiedStatus = ?'),
        [0]
      )
      expect(result).toHaveLength(1)
      expect(result[0].unifiedStatus).toBe(false)
    })

    it('should filter by minCycle when provided', async () => {
      mockedAll.mockResolvedValueOnce([])

      await getCheckpointStatusesByUnifiedStatus(true, 50)

      expect(mockedAll).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('AND cycle >= ?'),
        [1, 50]
      )
    })

    it('should handle empty results', async () => {
      mockedAll.mockResolvedValueOnce([])

      const result = await getCheckpointStatusesByUnifiedStatus(true)

      expect(result).toEqual([])
    })
  })

  describe('getOldestPendingOrFailedCheckpointStatus', () => {
    it('should return the oldest pending checkpoint status', async () => {
      const dbRow = {
        cycle: 50,
        unifiedStatus: false,
        cycleStatus: true,
        receiptStatus: false,
        originalTxStatus: true,
        created_at: Date.now(),
      }

      mockedGet.mockResolvedValueOnce(dbRow)

      const result = await getOldestPendingOrFailedCheckpointStatus()

      expect(mockedGet).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('WHERE unifiedStatus = ?'),
        [false]
      )
      expect(result).toEqual(dbRow)
    })

    it('should return null when no pending checkpoints exist', async () => {
      mockedGet.mockResolvedValueOnce(null)

      const result = await getOldestPendingOrFailedCheckpointStatus()

      expect(result).toBeNull()
    })

    it('should throw error when database operation fails', async () => {
      const error = new Error('Database error')
      mockedGet.mockRejectedValueOnce(error)

      await expect(getOldestPendingOrFailedCheckpointStatus()).rejects.toThrow('Database error')
      expect(mockedLoggerError).toHaveBeenCalledWith(
        'Error getting oldest pending or failed checkpoint status:',
        error
      )
    })
  })

  describe('processCyclesNeedingSync', () => {
    it('should process cycles that need syncing', async () => {
      const existingStatuses = [
        { cycle: 100, unifiedStatus: 1 },
        { cycle: 101, unifiedStatus: 0 },
        { cycle: 103, unifiedStatus: 1 },
      ]

      mockedAll.mockResolvedValueOnce(existingStatuses)

      const callback = jest.fn<() => Promise<void>>().mockResolvedValue()

      await processCyclesNeedingSync(100, 104, 10, callback)

      expect(callback).toHaveBeenCalledTimes(3) // Cycles 101, 102, 104
      expect(callback).toHaveBeenCalledWith(101)
      expect(callback).toHaveBeenCalledWith(102)
      expect(callback).toHaveBeenCalledWith(104)
    })

    it('should process in batches', async () => {
      mockedAll.mockResolvedValueOnce([])
      mockedAll.mockResolvedValueOnce([])
      mockedAll.mockResolvedValueOnce([])

      const callback = jest.fn<() => Promise<void>>().mockResolvedValue()

      await processCyclesNeedingSync(100, 125, 10, callback)

      expect(mockedAll).toHaveBeenCalledTimes(3) // 3 batches: 100-109, 110-119, 120-125
    })

    it('should handle callback errors gracefully', async () => {
      mockedAll.mockResolvedValueOnce([{ cycle: 100, unifiedStatus: 0 }])

      const callback = jest.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('Callback error'))

      await expect(processCyclesNeedingSync(100, 100, 10, callback)).rejects.toThrow('Callback error')
    })

    it('should log debug messages for cycles needing sync', async () => {
      mockedAll.mockResolvedValueOnce([{ cycle: 100, unifiedStatus: 0 }])

      const callback = jest.fn<() => Promise<void>>().mockResolvedValue()

      await processCyclesNeedingSync(100, 100, 10, callback)

      expect(mockedLoggerDebug).toHaveBeenCalledWith(
        '[processCyclesNeedingSync] cycle 100 has unifiedStatus false.. syncing'
      )
    })
  })

  describe('isBucketVerified', () => {
    it('should return true for a single verified bucket', async () => {
      mockedGet.mockResolvedValueOnce({ unifiedStatus: 1 })

      const result = await isBucketVerified(100)

      expect(result).toBe(true)
      expect(mockedGet).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('WHERE cycle = ?'),
        [100]
      )
    })

    it('should return false for a single unverified bucket', async () => {
      mockedGet.mockResolvedValueOnce({ unifiedStatus: 0 })

      const result = await isBucketVerified(100)

      expect(result).toBe(false)
    })

    it('should return false when bucket does not exist', async () => {
      mockedGet.mockResolvedValueOnce(null)

      const result = await isBucketVerified(100)

      expect(result).toBe(false)
    })

    it('should return true when all buckets in range are verified', async () => {
      const results = [
        { cycle: 100, unifiedStatus: 1 },
        { cycle: 101, unifiedStatus: 1 },
        { cycle: 102, unifiedStatus: 1 },
      ]

      mockedAll.mockResolvedValueOnce(results)

      const result = await isBucketVerified(100, 102)

      expect(result).toBe(true)
      expect(mockedAll).toHaveBeenCalledWith(
        checkpointStatusDatabase,
        expect.stringContaining('WHERE cycle >= ? AND cycle <= ?'),
        [100, 102]
      )
    })

    it('should return false when any bucket in range is unverified', async () => {
      const results = [
        { cycle: 100, unifiedStatus: 1 },
        { cycle: 101, unifiedStatus: 0 },
        { cycle: 102, unifiedStatus: 1 },
      ]

      mockedAll.mockResolvedValueOnce(results)

      const result = await isBucketVerified(100, 102)

      expect(result).toBe(false)
    })

    it('should return false when not all buckets in range exist', async () => {
      const results = [
        { cycle: 100, unifiedStatus: 1 },
        { cycle: 102, unifiedStatus: 1 },
      ]

      mockedAll.mockResolvedValueOnce(results)

      const result = await isBucketVerified(100, 102)

      expect(result).toBe(false)
    })

    it('should return false for invalid range', async () => {
      const result = await isBucketVerified(102, 100)

      expect(result).toBe(false)
      expect(mockedAll).not.toHaveBeenCalled()
    })

    it('should handle boolean true values', async () => {
      mockedGet.mockResolvedValueOnce({ unifiedStatus: true })

      const result = await isBucketVerified(100)

      expect(result).toBe(true)
    })

    it('should handle mixed boolean and number values in range', async () => {
      const results = [
        { cycle: 100, unifiedStatus: true },
        { cycle: 101, unifiedStatus: 1 },
        { cycle: 102, unifiedStatus: true },
      ]

      mockedAll.mockResolvedValueOnce(results)

      const result = await isBucketVerified(100, 102)

      expect(result).toBe(true)
    })
  })
})