import { jest, describe, it, expect, beforeAll, afterEach, afterAll } from '@jest/globals'
import { TransactionDigest } from '../../../../src/txDigester/txDigests'
import * as txDigestFunctions from '../../../../src/txDigester/txDigestFunctions'
import * as processedTxs from '../../../../src/dbstore/processedTxs'
import * as txDigest from '../../../../src/txDigester/txDigests'
import * as Crypto from '../../../../src/Crypto'
import * as Config from '../../../../src/Config'

// Mock external dependencies, not the functions under test
jest.mock('../../../../src/dbstore/processedTxs', () => ({
  querySortedTxsBetweenCycleRange: jest.fn(),
}))

jest.mock('../../../../src/txDigester/txDigests', () => ({
  queryByEndCycle: jest.fn(),
  getLastProcessedTxDigest: jest.fn(),
  queryByCycleRange: jest.fn(),
  insertTransactionDigest: jest.fn(),
}))

jest.mock('../../../../src/Crypto', () => ({
  hashObj: jest.fn(),
}))

jest.mock('../../../../src/Config', () => ({
  config: {
    VERBOSE: false,
    txDigest: {
      cycleDiff: 10,
    },
  },
}))

describe('Transaction Digest Functions', () => {
  // Test data
  const sampleTxIds = ['tx1', 'tx2', 'tx3']
  const sampleTxDigest: TransactionDigest = {
    cycleStart: 100,
    cycleEnd: 110,
    txCount: 3,
    hash: 'sample-hash-value',
  }

  // Capture original console methods for restoration
  const originalConsoleLog = console.log
  const originalConsoleError = console.error

  beforeAll(() => {
    // Mock console methods to prevent test output noise
    console.log = jest.fn()
    console.error = jest.fn()
  })

  afterEach(() => {
    jest.clearAllMocks()

    // Reset config.VERBOSE to default state
    const config = require('../../../../src/Config').config
    config.VERBOSE = false

    // Clear module cache to ensure clean state for each test
    jest.isolateModules(async () => {
      const module = await import('../../../../src/txDigester/txDigestFunctions')
      await module.updateLastProcessedTxDigest()
    })
  })

  afterAll(() => {
    // Restore original console methods
    console.log = originalConsoleLog
    console.error = originalConsoleError
  })

  describe('getTxIds', () => {
    it('should retrieve transaction IDs between specified cycle range', async () => {
      // Setup
      const startCycle = 100
      const endCycle = 110
      jest.mocked(processedTxs.querySortedTxsBetweenCycleRange).mockResolvedValue(sampleTxIds)

      // Execute
      const result = await txDigestFunctions.getTxIds(startCycle, endCycle)

      // Verify
      expect(processedTxs.querySortedTxsBetweenCycleRange).toHaveBeenCalledWith(startCycle, endCycle)
      expect(result).toEqual(sampleTxIds)
    })

    it('should return empty array when no transactions exist for cycle range', async () => {
      // Setup
      const startCycle = 100
      const endCycle = 110
      jest.mocked(processedTxs.querySortedTxsBetweenCycleRange).mockResolvedValue([])

      // Execute
      const result = await txDigestFunctions.getTxIds(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
    })
  })

  describe('getHash', () => {
    it('should return default hash value (0x0) for cycle -1', async () => {
      // Execute
      const result = await txDigestFunctions.getHash(-1)

      // Verify
      expect(result).toEqual('0x0')
      expect(txDigest.queryByEndCycle).not.toHaveBeenCalled()
    })

    it('should retrieve hash from transaction digest for valid cycle', async () => {
      // Setup
      const cycle = 100
      jest.mocked(txDigest.queryByEndCycle).mockResolvedValue(sampleTxDigest)

      // Execute
      const result = await txDigestFunctions.getHash(cycle)

      // Verify
      expect(txDigest.queryByEndCycle).toHaveBeenCalledWith(cycle)
      expect(result).toEqual(sampleTxDigest.hash)
    })

    it('should throw error when transaction digest hash is not found', async () => {
      // Setup
      const cycle = 100
      jest.mocked(txDigest.queryByEndCycle).mockResolvedValue(null as any)

      // Execute & Verify
      await expect(txDigestFunctions.getHash(cycle)).rejects.toThrow(`Failed to fetch txDigestHash for cycle ${cycle}`)
    })
  })

  describe('updateLastProcessedTxDigest and getLastProcessedTxDigest', () => {
    it('should cache and retrieve the last processed digest', async () => {
      // Setup - First call saves to cache
      jest.mocked(txDigest.getLastProcessedTxDigest).mockResolvedValue(sampleTxDigest)

      // Execute - Update cache
      await txDigestFunctions.updateLastProcessedTxDigest()

      // Clear mock to verify DB isn't called again
      jest.mocked(txDigest.getLastProcessedTxDigest).mockClear()

      // Execute - Get from cache
      const result = await txDigestFunctions.getLastProcessedTxDigest()

      // Verify cached value returned without DB call
      expect(result).toEqual(sampleTxDigest)
      expect(txDigest.getLastProcessedTxDigest).not.toHaveBeenCalled()
    })

    it('should fetch from database if digest not previously cached', async () => {
      // Setup - Reset module state
      jest.resetModules()

      // Create fresh mocks with expected behavior
      jest.mock('../../../../src/txDigester/txDigests', () => ({
        getLastProcessedTxDigest: jest.fn().mockImplementation(() => Promise.resolve(sampleTxDigest)),
        insertTransactionDigest: jest.fn().mockImplementation(() => Promise.resolve()),
      }))

      // Import with fresh module state
      const refreshedTxDigests = require('../../../../src/txDigester/txDigests')
      const refreshedTxDigestFunctions = require('../../../../src/txDigester/txDigestFunctions')

      jest.clearAllMocks()

      // Execute
      const result = await refreshedTxDigestFunctions.getLastProcessedTxDigest()

      // Verify DB was queried
      expect(result).toEqual(sampleTxDigest)
      expect(refreshedTxDigests.getLastProcessedTxDigest).toHaveBeenCalledTimes(1)
    })

    it('should handle null response from database', async () => {
      // Setup
      jest.mocked(txDigest.getLastProcessedTxDigest).mockResolvedValue(null as any)

      // Execute
      await txDigestFunctions.updateLastProcessedTxDigest()
      const result = await txDigestFunctions.getLastProcessedTxDigest()

      // Verify
      expect(result).toBeNull()
    })
  })

  describe('processAndInsertTxDigests', () => {
    it('should process and store digests for multiple transaction batches', async () => {
      // Setup
      const lastCheckedCycle = 100
      const latestCycleCounter = 125 // Will create 2 batches with batchSize=10
      const config = require('../../../../src/Config').config
      config.txDigest.cycleDiff = 10

      // Mock transaction data for two batches
      jest
        .mocked(processedTxs.querySortedTxsBetweenCycleRange)
        .mockResolvedValueOnce(['tx1', 'tx2', 'tx3']) // First batch
        .mockResolvedValueOnce(['tx4', 'tx5']) // Second batch

      // Mock previous hash lookups
      jest
        .mocked(txDigest.queryByEndCycle)
        .mockResolvedValueOnce({ ...sampleTxDigest, hash: 'prev-hash-1' }) // For cycle 99
        .mockResolvedValueOnce({ ...sampleTxDigest, hash: 'prev-hash-2' }) // For cycle 109

      // Mock hash generation
      jest
        .mocked(Crypto.hashObj)
        .mockReturnValueOnce('txids-hash-1') // First batch txIds
        .mockReturnValueOnce('txrange-hash-1') // First batch txObj
        .mockReturnValueOnce('txids-hash-2') // Second batch txIds
        .mockReturnValueOnce('txrange-hash-2') // Second batch txObj

      // Execute
      await txDigestFunctions.processAndInsertTxDigests(lastCheckedCycle, latestCycleCounter)

      // Verify batch processing
      expect(processedTxs.querySortedTxsBetweenCycleRange).toHaveBeenCalledTimes(2)
      expect(processedTxs.querySortedTxsBetweenCycleRange).toHaveBeenCalledWith(100, 109)
      expect(processedTxs.querySortedTxsBetweenCycleRange).toHaveBeenCalledWith(110, 119)

      // Verify previous hash lookups
      expect(txDigest.queryByEndCycle).toHaveBeenCalledTimes(2)
      expect(txDigest.queryByEndCycle).toHaveBeenCalledWith(99)
      expect(txDigest.queryByEndCycle).toHaveBeenCalledWith(109)

      // Verify hash generation
      expect(Crypto.hashObj).toHaveBeenCalledTimes(4)

      // Verify digest storage
      expect(txDigest.insertTransactionDigest).toHaveBeenCalledTimes(2)
      expect(txDigest.insertTransactionDigest).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleStart: 100,
          cycleEnd: 109,
          txCount: 3,
          hash: 'txrange-hash-1',
        })
      )
      expect(txDigest.insertTransactionDigest).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleStart: 110,
          cycleEnd: 119,
          txCount: 2,
          hash: 'txrange-hash-2',
        })
      )
    })

    it('should handle missing transaction data gracefully', async () => {
      // Setup
      const lastCheckedCycle = 100
      const latestCycleCounter = 115
      const config = require('../../../../src/Config').config
      config.txDigest.cycleDiff = 10

      // Mock missing transaction data
      jest.mocked(processedTxs.querySortedTxsBetweenCycleRange).mockResolvedValue(null as any)

      // Execute
      await txDigestFunctions.processAndInsertTxDigests(lastCheckedCycle, latestCycleCounter)

      // Verify error handling
      expect(processedTxs.querySortedTxsBetweenCycleRange).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to fetch txIds for cycle ${lastCheckedCycle}`)
      )
      expect(txDigest.insertTransactionDigest).not.toHaveBeenCalled()
    })

    it('should log transaction IDs when verbose logging is enabled', async () => {
      // Setup
      const lastCheckedCycle = 100
      const latestCycleCounter = 120

      // Save original config
      const originalConfig = { ...Config.config }

      // Enable verbose logging
      Config.config.VERBOSE = true
      Config.config.txDigest = { ...Config.config.txDigest, cycleDiff: 5 }

      // Mock dependencies
      jest.spyOn(txDigestFunctions, 'getTxIds').mockResolvedValue(sampleTxIds)
      jest.spyOn(txDigestFunctions, 'getHash').mockResolvedValue('0xprevhash')
      jest.spyOn(txDigest, 'insertTransactionDigest').mockResolvedValue(undefined)

      try {
        // Execute
        await txDigestFunctions.processAndInsertTxDigests(lastCheckedCycle, latestCycleCounter)

        // Verify verbose logging
        expect(console.log).toHaveBeenCalledWith(
          `TxIds from ${lastCheckedCycle} to ${lastCheckedCycle + Config.config.txDigest.cycleDiff - 1} of length ${sampleTxIds.length}: `,
          sampleTxIds
        )
      } finally {
        // Restore original config
        Object.assign(Config.config, originalConfig)
      }
    })

    it('should handle errors during digest insertion', async () => {
      // Setup
      const lastCheckedCycle = 100
      const latestCycleCounter = 110

      // Save original config
      const originalConfig = { ...Config.config }

      // Configure batch size
      Config.config.txDigest = { ...Config.config.txDigest, cycleDiff: 10 }

      // Mock dependencies
      jest.spyOn(txDigestFunctions, 'getTxIds').mockResolvedValue(sampleTxIds)
      jest.spyOn(txDigestFunctions, 'getHash').mockResolvedValue('0xprevhash')

      // Simulate insertion error
      const error = new Error('Insert error')
      jest.spyOn(txDigest, 'insertTransactionDigest').mockImplementation(() => {
        throw error
      })

      // Monitor error logging
      jest.spyOn(console, 'error')

      try {
        // Execute
        await txDigestFunctions.processAndInsertTxDigests(lastCheckedCycle, latestCycleCounter)

        // Verify error handling
        expect(txDigest.insertTransactionDigest).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalledWith('Failed to insert txDigestObj: ', expect.any(Object))
        expect(console.error).toHaveBeenCalledWith(error)
      } finally {
        // Restore original config
        Object.assign(Config.config, originalConfig)
      }
    })

    it('should skip processing when no new cycles to process', async () => {
      // Setup - Latest cycle is before last checked cycle
      const lastCheckedCycle = 100
      const latestCycleCounter = 90

      // Execute
      await txDigestFunctions.processAndInsertTxDigests(lastCheckedCycle, latestCycleCounter)

      // Verify no processing occurs
      expect(processedTxs.querySortedTxsBetweenCycleRange).not.toHaveBeenCalled()
      expect(txDigest.queryByEndCycle).not.toHaveBeenCalled()
      expect(txDigest.insertTransactionDigest).not.toHaveBeenCalled()
    })
  })

  describe('getTxDigestsForACycleRange', () => {
    it('should retrieve all transaction digests within specified cycle range', async () => {
      // Setup
      const cycleStart = 100
      const cycleEnd = 120
      const txDigests = [sampleTxDigest, { ...sampleTxDigest, cycleStart: 110, cycleEnd: 120 }]
      jest.mocked(txDigest.queryByCycleRange).mockResolvedValue(txDigests)

      // Execute
      const result = await txDigestFunctions.getTxDigestsForACycleRange(cycleStart, cycleEnd)

      // Verify
      expect(txDigest.queryByCycleRange).toHaveBeenCalledWith(cycleStart, cycleEnd)
      expect(result).toEqual(txDigests)
    })

    it('should return empty array when no digests exist in cycle range', async () => {
      // Setup
      const cycleStart = 100
      const cycleEnd = 120
      jest.mocked(txDigest.queryByCycleRange).mockResolvedValue([])

      // Execute
      const result = await txDigestFunctions.getTxDigestsForACycleRange(cycleStart, cycleEnd)

      // Verify
      expect(result).toEqual([])
    })
  })
})
