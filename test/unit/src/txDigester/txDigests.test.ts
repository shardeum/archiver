import { jest, describe, it, expect, beforeAll, afterEach, afterAll } from '@jest/globals'
import * as dbModule from '../../../../src/dbstore/sqlite3storage'
import {
  TransactionDigest,
  insertTransactionDigest,
  getLastProcessedTxDigest,
  queryByEndCycle,
  queryByCycleRange,
} from '../../../../src/txDigester/txDigests'

// Mock external database dependencies
jest.mock('../../../../src/dbstore/sqlite3storage', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
  extractValues: jest.fn(),
}))

// Mock database connection
jest.mock('../../../../src/txDigester/index', () => ({
  digesterDatabase: {},
}))

// Mock configuration
jest.mock('../../../../src/Config', () => ({
  config: {
    VERBOSE: false,
  },
}))

describe('Transaction Digest Database Operations', () => {
  // Sample test data
  const sampleTxDigest: TransactionDigest = {
    cycleStart: 100,
    cycleEnd: 200,
    txCount: 500,
    hash: 'sample-hash-value',
  }

  const config = require('../../../../src/Config').config

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
    // Reset verbose logging setting to default
    config.VERBOSE = false
  })

  afterAll(() => {
    // Restore original console methods
    console.log = originalConsoleLog
    console.error = originalConsoleError
  })

  describe('insertTransactionDigest', () => {
    it('should store a transaction digest record in the database', async () => {
      // Setup
      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, 'sample-hash-value'])

      // Execute
      await insertTransactionDigest(sampleTxDigest)

      // Verify
      expect(dbModule.extractValues).toHaveBeenCalledWith(sampleTxDigest)
      expect(dbModule.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO txDigests'),
        expect.arrayContaining([100, 200, 500, 'sample-hash-value'])
      )
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should log operation details when verbose logging is enabled', async () => {
      // Setup
      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, 'sample-hash-value'])

      // Enable verbose logging
      config.VERBOSE = true

      // Execute
      await insertTransactionDigest(sampleTxDigest)

      // Verify logging behavior
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          `Successfully inserted txDigest for cycle records from ${sampleTxDigest.cycleStart} to ${sampleTxDigest.cycleEnd}`
        )
      )
    })

    it('should throw descriptive error when database insertion fails', async () => {
      // Setup
      const dbError = new Error('Database error')
      jest.mocked(dbModule.run).mockRejectedValue(dbError)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, 'sample-hash-value'])

      // Execute & Verify
      await expect(insertTransactionDigest(sampleTxDigest)).rejects.toThrow(
        `Unable to insert txDigest for cycle records from ${sampleTxDigest.cycleStart} to ${sampleTxDigest.cycleEnd}`
      )
      expect(console.error).toHaveBeenCalledWith(dbError)
    })
  })

  describe('getLastProcessedTxDigest', () => {
    it('should retrieve the most recent transaction digest by cycle end', async () => {
      // Setup
      jest.mocked(dbModule.get).mockResolvedValue(sampleTxDigest)

      // Execute
      const result = await getLastProcessedTxDigest()

      // Verify
      expect(dbModule.get).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT * FROM txDigests ORDER BY cycleEnd DESC LIMIT 1'
      )
      expect(result).toEqual(sampleTxDigest)
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should log retrieved digest when verbose logging is enabled', async () => {
      // Setup
      jest.mocked(dbModule.get).mockResolvedValue(sampleTxDigest)

      // Enable verbose logging
      config.VERBOSE = true

      // Execute
      const result = await getLastProcessedTxDigest()

      // Verify
      expect(result).toEqual(sampleTxDigest)
      expect(console.log).toHaveBeenCalledWith('LastProcessed Tx Digest', sampleTxDigest)
    })

    it('should handle database errors gracefully by returning null', async () => {
      // Setup
      const dbError = new Error('Database error')
      jest.mocked(dbModule.get).mockRejectedValue(dbError)

      // Execute
      const result = await getLastProcessedTxDigest()

      // Verify
      expect(result).toBeNull()
      expect(console.error).toHaveBeenCalledWith(dbError)
    })
  })

  describe('queryByEndCycle', () => {
    const endCycle = 200

    it('should retrieve transaction digest matching the specified end cycle', async () => {
      // Setup
      jest.mocked(dbModule.get).mockResolvedValue(sampleTxDigest)

      // Execute
      const result = await queryByEndCycle(endCycle)

      // Verify
      expect(dbModule.get).toHaveBeenCalledWith(expect.anything(), 'SELECT * FROM txDigests WHERE cycleEnd=? LIMIT 1', [
        endCycle,
      ])
      expect(result).toEqual(sampleTxDigest)
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should log retrieved digest when verbose logging is enabled', async () => {
      // Setup
      jest.mocked(dbModule.get).mockResolvedValue(sampleTxDigest)

      // Enable verbose logging
      config.VERBOSE = true

      // Execute
      const result = await queryByEndCycle(endCycle)

      // Verify
      expect(result).toEqual(sampleTxDigest)
      expect(console.log).toHaveBeenCalledWith('Tx Digest by endCycle', sampleTxDigest)
    })

    it('should handle database errors gracefully by returning null', async () => {
      // Setup
      const dbError = new Error('Database error')
      jest.mocked(dbModule.get).mockRejectedValue(dbError)

      // Execute
      const result = await queryByEndCycle(endCycle)

      // Verify
      expect(result).toBeNull()
      expect(console.error).toHaveBeenCalledWith(dbError)
    })

    it('should return null when no matching digest exists', async () => {
      // Setup - Database returns no results
      jest.mocked(dbModule.get).mockResolvedValue(null)

      // Execute
      const result = await queryByEndCycle(endCycle)

      // Verify
      expect(result).toBeNull()
    })
  })

  describe('queryByCycleRange', () => {
    const startCycle = 100
    const endCycle = 200
    const sampleTxDigests = [sampleTxDigest, { ...sampleTxDigest, cycleStart: 150, cycleEnd: 250 }]

    it('should retrieve all transaction digests within specified cycle range', async () => {
      // Setup
      jest.mocked(dbModule.all).mockResolvedValue(sampleTxDigests)

      // Execute
      const result = await queryByCycleRange(startCycle, endCycle)

      // Verify
      expect(dbModule.all).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT * FROM txDigests WHERE cycleStart >= ? AND cycleEnd <= ? ORDER BY cycleEnd',
        [startCycle, endCycle]
      )
      expect(result).toEqual(sampleTxDigests)
      expect(console.log).not.toHaveBeenCalled()
    })

    it('should log retrieved digests when verbose logging is enabled', async () => {
      // Setup
      jest.mocked(dbModule.all).mockResolvedValue(sampleTxDigests)

      // Enable verbose logging
      config.VERBOSE = true

      // Execute
      const result = await queryByCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual(sampleTxDigests)
      expect(console.log).toHaveBeenCalledWith('Tx Digest by cycle range', sampleTxDigests)
    })

    it('should handle database errors gracefully by returning empty array', async () => {
      // Setup
      const dbError = new Error('Database error')
      jest.mocked(dbModule.all).mockRejectedValue(dbError)

      // Execute
      const result = await queryByCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
      expect(console.error).toHaveBeenCalledWith(dbError)
    })

    it('should return empty array when no matching digests exist', async () => {
      // Setup - Database returns empty result set
      jest.mocked(dbModule.all).mockResolvedValue([])

      // Execute
      const result = await queryByCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
    })
  })
})
