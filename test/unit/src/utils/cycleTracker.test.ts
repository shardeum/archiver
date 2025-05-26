// Mock dependencies before imports
jest.mock('fs')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}))
jest.mock('@shardeum-foundation/lib-crypto-utils', () => ({}))
jest.mock('../../../../src/Utils', () => ({}))
jest.mock('../../../../src/dbstore/sqlite3storage', () => ({}))
jest.mock('../../../../src/dbstore/index', () => ({}))
jest.mock('../../../../src/dbstore/checkpointStatus')
jest.mock('../../../../src/Config', () => ({
  config: {
    checkpoint: {
      bucketConfig: {
        GiveUpAge: 20,
        cycleAge: 1,
      },
    },
  },
}))

import * as fs from 'fs'
import * as path from 'path'
import {
  getLastUpdatedCycle,
  updateLastUpdatedCycle,
  updateCycleTrackerOnShutdown,
} from '../../../../src/utils/cycleTracker'
import * as Logger from '../../../../src/Logger'
import { getCheckpointStatusesByUnifiedStatus } from '../../../../src/dbstore/checkpointStatus'
import { config } from '../../../../src/Config'

const mockFs = fs as jest.Mocked<typeof fs>
const mockLogger = Logger.mainLogger as jest.Mocked<typeof Logger.mainLogger>
const mockGetCheckpointStatusesByUnifiedStatus = getCheckpointStatusesByUnifiedStatus as jest.MockedFunction<
  typeof getCheckpointStatusesByUnifiedStatus
>

describe('cycleTracker', () => {
  const CYCLE_TRACKER_FILE = path.join(process.cwd(), 'cycle-tracker.json')
  const mockDate = new Date('2024-01-15T10:30:00Z').getTime()

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(Date, 'now').mockReturnValue(mockDate)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('getLastUpdatedCycle', () => {
    it('should return the last updated cycle from existing file', () => {
      const mockData = {
        lastUpdatedCycle: 42,
        lastUpdatedTimestamp: mockDate - 1000,
      }
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify(mockData))

      const result = getLastUpdatedCycle()

      expect(result).toBe(42)
      expect(mockFs.readFileSync).toHaveBeenCalledWith(CYCLE_TRACKER_FILE, 'utf8')
    })

    it('should create file and return 0 if file does not exist', () => {
      const mockFd = 123
      mockFs.readFileSync.mockImplementationOnce(() => {
        const error = new Error('File not found') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })
      mockFs.openSync.mockReturnValueOnce(mockFd)
      mockFs.writeFileSync.mockImplementationOnce(() => {})
      mockFs.closeSync.mockImplementationOnce(() => {})

      const result = getLastUpdatedCycle()

      expect(result).toBe(0)
      expect(mockFs.openSync).toHaveBeenCalledWith(
        CYCLE_TRACKER_FILE,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600
      )
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        mockFd,
        JSON.stringify({ lastUpdatedCycle: 0, lastUpdatedTimestamp: 0 }, null, 2),
        'utf8'
      )
      expect(mockFs.closeSync).toHaveBeenCalledWith(mockFd)
    })

    it('should read existing file if creation fails due to race condition', () => {
      const mockData = {
        lastUpdatedCycle: 15,
        lastUpdatedTimestamp: mockDate - 500,
      }

      mockFs.readFileSync
        .mockImplementationOnce(() => {
          const error = new Error('File not found') as NodeJS.ErrnoException
          error.code = 'ENOENT'
          throw error
        })
        .mockReturnValueOnce(JSON.stringify(mockData))

      mockFs.openSync.mockImplementationOnce(() => {
        const error = new Error('File exists') as NodeJS.ErrnoException
        error.code = 'EEXIST'
        throw error
      })

      const result = getLastUpdatedCycle()

      expect(result).toBe(15)
      expect(mockFs.readFileSync).toHaveBeenCalledTimes(2)
    })

    it('should throw error if file creation fails with non-EEXIST error', () => {
      mockFs.readFileSync.mockImplementationOnce(() => {
        const error = new Error('File not found') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })

      mockFs.openSync.mockImplementationOnce(() => {
        const error = new Error('Permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      })

      const result = getLastUpdatedCycle()

      expect(result).toBe(0)
      expect(mockLogger.error).toHaveBeenCalledWith('Error reading cycle tracker file:', expect.any(Error))
    })

    it('should throw error if initial read fails with non-ENOENT error', () => {
      mockFs.readFileSync.mockImplementationOnce(() => {
        const error = new Error('Permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      })

      const result = getLastUpdatedCycle()

      expect(result).toBe(0)
      expect(mockLogger.error).toHaveBeenCalledWith('Error reading cycle tracker file:', expect.any(Error))
    })

    it('should handle invalid JSON data', () => {
      mockFs.readFileSync.mockReturnValueOnce('invalid json')

      const result = getLastUpdatedCycle()

      expect(result).toBe(0)
      expect(mockLogger.error).toHaveBeenCalledWith('Error reading cycle tracker file:', expect.any(Error))
    })

    it('should handle missing lastUpdatedCycle property', () => {
      mockFs.readFileSync.mockReturnValueOnce(JSON.stringify({ someOtherProp: 123 }))

      const result = getLastUpdatedCycle()

      expect(result).toBeUndefined()
    })
  })

  describe('updateLastUpdatedCycle', () => {
    it('should update cycle when new cycle is greater than current', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 10, lastUpdatedTimestamp: mockDate - 1000 })
      )
      mockFs.writeFileSync.mockImplementationOnce(() => {})

      updateLastUpdatedCycle(15)

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        CYCLE_TRACKER_FILE,
        JSON.stringify({ lastUpdatedCycle: 15, lastUpdatedTimestamp: mockDate }, null, 2),
        'utf8'
      )
      expect(mockLogger.debug).toHaveBeenCalledWith('Updated cycle tracker to cycle 15')
    })

    it('should not update cycle when new cycle is less than current', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 20, lastUpdatedTimestamp: mockDate - 1000 })
      )

      updateLastUpdatedCycle(15)

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(mockLogger.debug).not.toHaveBeenCalled()
    })

    it('should not update cycle when new cycle equals current', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 15, lastUpdatedTimestamp: mockDate - 1000 })
      )

      updateLastUpdatedCycle(15)

      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
      expect(mockLogger.debug).not.toHaveBeenCalled()
    })

    it('should handle write errors gracefully', () => {
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 10, lastUpdatedTimestamp: mockDate - 1000 })
      )
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Write failed')
      })

      updateLastUpdatedCycle(15)

      expect(mockLogger.error).toHaveBeenCalledWith('Error updating cycle tracker file:', expect.any(Error))
    })

    it('should handle getLastUpdatedCycle errors', () => {
      mockFs.readFileSync.mockImplementationOnce(() => {
        throw new Error('Read failed')
      })

      updateLastUpdatedCycle(15)

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        CYCLE_TRACKER_FILE,
        JSON.stringify({ lastUpdatedCycle: 15, lastUpdatedTimestamp: mockDate }, null, 2),
        'utf8'
      )
    })
  })

  describe('updateCycleTrackerOnShutdown', () => {
    it('should update cycle tracker with latest unified cycle', async () => {
      const mockStatuses = [
        {
          cycle: 50,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 49,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 48,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 47,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 46,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 45,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 44,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 43,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 42,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 41,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 40,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 39,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 38,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 37,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 36,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 35,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 34,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 33,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 32,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 31,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 30,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 29,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 28,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
      ]

      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce(mockStatuses)
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 20, lastUpdatedTimestamp: mockDate - 1000 })
      )
      mockFs.writeFileSync.mockImplementationOnce(() => {})

      await updateCycleTrackerOnShutdown()

      // Should skip latest 21 cycles and use cycle 29
      expect(mockLogger.info).toHaveBeenCalledWith('Updating cycle tracker with latest unified cycle: 29')
      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        CYCLE_TRACKER_FILE,
        JSON.stringify({ lastUpdatedCycle: 29, lastUpdatedTimestamp: mockDate }, null, 2),
        'utf8'
      )
    })

    it('should handle no unified statuses found', async () => {
      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce([])

      await updateCycleTrackerOnShutdown()

      expect(mockLogger.warn).toHaveBeenCalledWith('No unified cycle statuses found')
      expect(mockLogger.warn).toHaveBeenCalledWith('No valid unified cycle found during shutdown')
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should handle not enough unified cycles', async () => {
      const mockStatuses = [
        {
          cycle: 50,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 49,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
        {
          cycle: 48,
          unifiedStatus: true,
          cycleStatus: true,
          receiptStatus: true,
          originalTxStatus: true,
          created_at: mockDate,
        },
      ]

      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce(mockStatuses)

      await updateCycleTrackerOnShutdown()

      expect(mockLogger.warn).toHaveBeenCalledWith('Not enough unified cycles available (3). Need more than 21 cycles.')
      expect(mockLogger.warn).toHaveBeenCalledWith('No valid unified cycle found during shutdown')
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should handle database errors gracefully', async () => {
      mockGetCheckpointStatusesByUnifiedStatus.mockRejectedValueOnce(new Error('Database error'))

      await updateCycleTrackerOnShutdown()

      expect(mockLogger.error).toHaveBeenCalledWith('Error getting latest unified cycle:', expect.any(Error))
      expect(mockLogger.warn).toHaveBeenCalledWith('No valid unified cycle found during shutdown')
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should handle update errors gracefully', async () => {
      const mockStatuses = Array.from({ length: 25 }, (_, i) => ({
        cycle: 50 - i,
        unifiedStatus: true,
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: true,
        created_at: mockDate,
      }))

      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce(mockStatuses)
      mockFs.readFileSync.mockReturnValueOnce(
        JSON.stringify({ lastUpdatedCycle: 20, lastUpdatedTimestamp: mockDate - 1000 })
      )
      mockFs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Write failed')
      })

      await updateCycleTrackerOnShutdown()

      expect(mockLogger.info).toHaveBeenCalledWith('Updating cycle tracker with latest unified cycle: 29')
      expect(mockLogger.error).toHaveBeenCalledWith('Error updating cycle tracker file:', expect.any(Error))
    })

    it('should handle null unified statuses', async () => {
      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce(null as any)

      await updateCycleTrackerOnShutdown()

      expect(mockLogger.warn).toHaveBeenCalledWith('No unified cycle statuses found')
      expect(mockLogger.warn).toHaveBeenCalledWith('No valid unified cycle found during shutdown')
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })

    it('should correctly calculate cycles to skip based on config', async () => {
      // Modify config for this test
      ;(config as any).checkpoint.bucketConfig.GiveUpAge = 30
      ;(config as any).checkpoint.bucketConfig.cycleAge = 2

      // Create only 15 statuses, which is less than the required 16 to skip
      const mockStatuses = Array.from({ length: 15 }, (_, i) => ({
        cycle: 50 - i,
        unifiedStatus: true,
        cycleStatus: true,
        receiptStatus: true,
        originalTxStatus: true,
        created_at: mockDate,
      }))

      mockGetCheckpointStatusesByUnifiedStatus.mockResolvedValueOnce(mockStatuses)

      await updateCycleTrackerOnShutdown()

      // Math.ceil(30 / 2) + 1 = 16
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Not enough unified cycles available (15). Need more than 16 cycles.'
      )

      // Reset config
      ;(config as any).checkpoint.bucketConfig.GiveUpAge = 20
      ;(config as any).checkpoint.bucketConfig.cycleAge = 1
    })
  })
})
