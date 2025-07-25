import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as CheckpointV2 from '../../../../src/checkpoint/CheckpointV2'

// Mock all dependencies
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../../src/Config', () => ({
  config: {
    checkpointSyncInterval: 60000, // 1 minute
  },
}))

jest.mock('../../../../src/Data/Data', () => ({
  syncCycleData: jest.fn(),
  syncReceiptsByCycle: jest.fn(),
}))

jest.mock('../../../../src/Data/Cycles', () => ({
  getNewestCycleFromArchivers: jest.fn(),
  getCurrentCycleCounter: jest.fn(),
}))

jest.mock('../../../../src/utils/cycleTracker', () => ({
  getLastUpdatedCycle: jest.fn(),
  updateLastUpdatedCycle: jest.fn(),
}))

jest.mock('../../../../src/dbstore/checkpointStatus', () => ({
  processCyclesNeedingSync: jest.fn(),
}))

// Use fake timers
jest.useFakeTimers()

describe('CheckpointV2', () => {
  let mockLogger: any
  let mockConfig: any
  let mockData: any
  let mockCycles: any
  let mockCycleTracker: any
  let mockCheckpointStatus: any

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()

    // Get mocked modules
    mockLogger = require('../../../../src/Logger').mainLogger
    mockConfig = require('../../../../src/Config').config
    mockData = require('../../../../src/Data/Data')
    mockCycles = require('../../../../src/Data/Cycles')
    mockCycleTracker = require('../../../../src/utils/cycleTracker')
    mockCheckpointStatus = require('../../../../src/dbstore/checkpointStatus')

    // Set up default mock return values
    mockCycleTracker.getLastUpdatedCycle.mockReturnValue(100)
    mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 150 })
    mockCycles.getCurrentCycleCounter.mockReturnValue(100)
    mockData.syncCycleData.mockResolvedValue(undefined)
    mockData.syncReceiptsByCycle.mockResolvedValue(undefined)
  })

  afterEach(() => {
    jest.clearAllTimers()
  })

  describe('syncMissingCheckpoints', () => {
    it('should sync checkpoints from lastUpdatedCycle to currentCycle', async () => {
      // Setup mock to simulate processing cycles 101-105
      mockCheckpointStatus.processCyclesNeedingSync.mockImplementation(
        async (start: number, end: number, max: number, callback: (cycle: number) => Promise<void>) => {
          // Simulate processing 5 cycles
          for (let cycle = 101; cycle <= 105; cycle++) {
            await callback(cycle)
          }
        }
      )

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockCycleTracker.getLastUpdatedCycle).toHaveBeenCalled()
      expect(mockCycles.getNewestCycleFromArchivers).toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith('[syncMissingCheckpoints] Last updated cycle from tracker: 100')
      expect(mockLogger.info).toHaveBeenCalledWith('[syncMissingCheckpoints] Processing cycles from 100 to 150')

      // Verify processCyclesNeedingSync was called with correct parameters
      expect(mockCheckpointStatus.processCyclesNeedingSync).toHaveBeenCalledWith(100, 150, 100, expect.any(Function))

      // Verify sync operations for each cycle
      expect(mockData.syncCycleData).toHaveBeenCalledTimes(5)
      expect(mockData.syncReceiptsByCycle).toHaveBeenCalledTimes(5)
      expect(mockCycleTracker.updateLastUpdatedCycle).toHaveBeenCalledTimes(5)

      // Verify specific cycle calls
      expect(mockData.syncCycleData).toHaveBeenCalledWith(101)
      expect(mockData.syncCycleData).toHaveBeenCalledWith(105)
      expect(mockData.syncReceiptsByCycle).toHaveBeenCalledWith(101, 101)
      expect(mockData.syncReceiptsByCycle).toHaveBeenCalledWith(105, 105)

      expect(mockLogger.info).toHaveBeenCalledWith('[syncMissingCheckpoints] Processed 5 cycles, successfully synced 5')
    })

    it('should handle when no checkpoints need syncing', async () => {
      // Setup mock to simulate no cycles need syncing
      mockCheckpointStatus.processCyclesNeedingSync.mockImplementation(
        async (start: number, end: number, max: number, callback: (cycle: number) => Promise<void>) => {
          // Don't call the callback - no cycles to process
        }
      )

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockLogger.debug).toHaveBeenCalledWith('[syncMissingCheckpoints] No checkpoints need syncing')
      expect(mockData.syncCycleData).not.toHaveBeenCalled()
      expect(mockData.syncReceiptsByCycle).not.toHaveBeenCalled()
    })

    it('should handle error when getting network cycle count', async () => {
      // Setup
      mockCycles.getNewestCycleFromArchivers.mockRejectedValue(new Error('Network error'))

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[syncMissingCheckpoints] Failed to get network cycle count:',
        expect.any(Error)
      )
      expect(mockCheckpointStatus.processCyclesNeedingSync).not.toHaveBeenCalled()
    })

    it('should handle when current cycle is invalid', async () => {
      // Setup - return invalid cycle
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: undefined })

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockLogger.warn).toHaveBeenCalledWith('[syncMissingCheckpoints] Could not determine current network cycle')
      expect(mockCheckpointStatus.processCyclesNeedingSync).not.toHaveBeenCalled()
    })

    it('should handle when getNewestCycleFromArchivers returns null', async () => {
      // Setup
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue(null)

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockLogger.warn).toHaveBeenCalledWith('[syncMissingCheckpoints] Could not determine current network cycle')
      expect(mockCheckpointStatus.processCyclesNeedingSync).not.toHaveBeenCalled()
    })

    it('should continue processing even when some cycles fail', async () => {
      // Setup mock to simulate processing cycles with some failures
      mockCheckpointStatus.processCyclesNeedingSync.mockImplementation(
        async (start: number, end: number, max: number, callback: (cycle: number) => Promise<void>) => {
          // Process 3 cycles, fail on the second
          await callback(101)
          await callback(102)
          await callback(103)
        }
      )

      // Make syncCycleData fail on cycle 102
      mockData.syncCycleData.mockImplementation(async (cycle: number) => {
        if (cycle === 102) {
          throw new Error('Sync failed for cycle 102')
        }
      })

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockData.syncCycleData).toHaveBeenCalledTimes(3)
      expect(mockData.syncReceiptsByCycle).toHaveBeenCalledTimes(2) // Should not be called for failed cycle
      expect(mockCycleTracker.updateLastUpdatedCycle).toHaveBeenCalledTimes(2) // Should not update for failed cycle

      expect(mockLogger.error).toHaveBeenCalledWith(
        '[syncMissingCheckpoints] Error syncing cycle 102:',
        expect.any(Error)
      )

      expect(mockLogger.info).toHaveBeenCalledWith('[syncMissingCheckpoints] Processed 3 cycles, successfully synced 2')
    })

    it('should respect maxCyclesToSync parameter', async () => {
      // Setup
      const maxCycles = 50

      // Execute
      await CheckpointV2.syncMissingCheckpoints(maxCycles)

      // Verify processCyclesNeedingSync was called with the custom max
      expect(mockCheckpointStatus.processCyclesNeedingSync).toHaveBeenCalledWith(
        100,
        150,
        maxCycles,
        expect.any(Function)
      )
    })

    it('should handle general errors gracefully', async () => {
      // Setup
      mockCycleTracker.getLastUpdatedCycle.mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      // Execute
      await CheckpointV2.syncMissingCheckpoints()

      // Verify
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[syncMissingCheckpoints] Error syncing missing checkpoints:',
        expect.any(Error)
      )
    })
  })

  describe('scheduleMissingCheckpointSync', () => {
    it('should schedule periodic syncing', async () => {
      // Setup - mock sync to be successful
      mockCycles.getCurrentCycleCounter.mockReturnValue(100)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 105 })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync should happen immediately
      await jest.runOnlyPendingTimersAsync()

      // Verify first sync
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalled()
      expect(mockCycles.getNewestCycleFromArchivers).toHaveBeenCalled()

      // Since stored < network, sync should continue
      expect(mockCycleTracker.getLastUpdatedCycle).toHaveBeenCalled()

      // Clear previous mock calls
      const previousCalls = mockCycles.getCurrentCycleCounter.mock.calls.length

      // Advance time and verify next sync
      await jest.advanceTimersByTimeAsync(60000)

      // Should have been called again
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalledTimes(previousCalls + 1)
    })

    it('should stop syncing when stored cycle count matches network', async () => {
      // Setup - both cycles are equal
      mockCycles.getCurrentCycleCounter.mockReturnValue(150)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 150 })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Verify sync stopped
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[syncCheckpoints] Stopping checkpoint sync as stored cycle count (150) matches or exceeds network cycle count (150)'
      )

      // Clear mocks
      jest.clearAllMocks()

      // Advance time - no more syncs should happen
      await jest.advanceTimersByTimeAsync(60000)

      // Should not have been called again
      expect(mockCycles.getCurrentCycleCounter).not.toHaveBeenCalled()
    })

    it('should stop syncing when stored cycle count exceeds network', async () => {
      // Setup - stored is ahead of network
      mockCycles.getCurrentCycleCounter.mockReturnValue(155)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 150 })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Verify sync stopped
      expect(mockLogger.info).toHaveBeenCalledWith(
        '[syncCheckpoints] Stopping checkpoint sync as stored cycle count (155) matches or exceeds network cycle count (150)'
      )
    })

    it('should continue syncing when network cycle fetch fails', async () => {
      // Setup
      mockCycles.getCurrentCycleCounter.mockReturnValue(100)
      mockCycles.getNewestCycleFromArchivers.mockRejectedValue(new Error('Network error'))

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Verify warning logged but sync continues
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[syncCheckpoints] Failed to get network cycle count, will continue syncing:',
        expect.any(Error)
      )

      // Should still call syncMissingCheckpoints
      expect(mockCycleTracker.getLastUpdatedCycle).toHaveBeenCalled()

      // Clear mocks
      jest.clearAllMocks()

      // Advance time - sync should continue
      await jest.advanceTimersByTimeAsync(60000)

      // Should have been called again
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalled()
    })

    it('should handle errors in scheduled sync gracefully', async () => {
      // Setup - make getCurrentCycleCounter throw
      mockCycles.getCurrentCycleCounter.mockImplementation(() => {
        throw new Error('Unexpected error')
      })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Verify error logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        '[syncCheckpoints] Error in scheduled checkpoint sync:',
        expect.any(Error)
      )

      // Clear mocks
      jest.clearAllMocks()

      // Advance time - sync should continue despite error
      await jest.advanceTimersByTimeAsync(60000)

      // Should have been called again
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalled()
    })

    it('should use custom sync interval from config', async () => {
      // Setup custom interval
      mockConfig.checkpointSyncInterval = 30000 // 30 seconds
      mockCycles.getCurrentCycleCounter.mockReturnValue(100)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 105 })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Clear mocks
      jest.clearAllMocks()

      // Advance by 30 seconds
      await jest.advanceTimersByTimeAsync(30000)

      // Should have been called with custom interval
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalled()
    })

    it('should handle invalid cycle counts', async () => {
      // Setup - invalid stored cycle
      mockCycles.getCurrentCycleCounter.mockReturnValue(-1)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 150 })

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // First sync
      await jest.runOnlyPendingTimersAsync()

      // Should continue syncing since stored cycle is invalid
      expect(mockCycleTracker.getLastUpdatedCycle).toHaveBeenCalled()

      // Verify it didn't stop
      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Stopping checkpoint sync'))
    })

    it('should continue scheduling until cycles match then stop', async () => {
      // Setup - simulate progression where stored cycle catches up to network
      let storedCycle = 100
      mockCycles.getCurrentCycleCounter.mockImplementation(() => storedCycle)
      mockCycles.getNewestCycleFromArchivers.mockResolvedValue({ counter: 150 })

      // Mock processCyclesNeedingSync to increment stored cycle
      mockCheckpointStatus.processCyclesNeedingSync.mockImplementation(
        async (start: number, end: number, max: number, callback: (cycle: number) => Promise<void>) => {
          // Simulate syncing 10 cycles at a time
          storedCycle = Math.min(storedCycle + 10, 150)
        }
      )

      // Execute
      CheckpointV2.scheduleMissingCheckpointSync()

      // Run multiple sync cycles until stored matches network
      let syncCount = 0
      let syncStopped = false

      while (!syncStopped && syncCount < 10) {
        await jest.runOnlyPendingTimersAsync()

        // Check if stop message was logged
        const stopLogged = mockLogger.info.mock.calls.some(
          (call) => call[0] && call[0].includes('Stopping checkpoint sync')
        )

        if (stopLogged) {
          syncStopped = true
          // Verify the message content
          const stopCall = mockLogger.info.mock.calls.find(
            (call) => call[0] && call[0].includes('Stopping checkpoint sync')
          )
          expect(stopCall[0]).toContain('stored cycle count (150)')
          expect(stopCall[0]).toContain('network cycle count (150)')
        } else {
          // Advance to next sync
          await jest.advanceTimersByTimeAsync(60000)
        }

        syncCount++
      }

      // Ensure sync eventually stopped
      expect(syncStopped).toBe(true)

      // Clear mocks and verify no more syncs happen
      const currentCallCount = mockCycles.getCurrentCycleCounter.mock.calls.length
      await jest.advanceTimersByTimeAsync(60000)

      // Should not have been called again after stopping
      expect(mockCycles.getCurrentCycleCounter).toHaveBeenCalledTimes(currentCallCount)
    })
  })
})
