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

    // NEW TEST: Test for ON CONFLICT behavior with update to existing record
    it('should include ON CONFLICT clause for updating existing records', async () => {
      // Setup
      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, 'sample-hash-value'])

      // Execute
      await insertTransactionDigest(sampleTxDigest)

      // Verify SQL includes ON CONFLICT clause
      expect(dbModule.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('ON CONFLICT (cycleEnd) DO UPDATE SET'),
        expect.anything()
      )
    })

    // NEW TEST: Test handling of malformed transaction digest
    it('should handle malformed transaction digest by properly extracting available values', async () => {
      // Setup: Partial transaction digest missing some properties
      const malformedTxDigest = {
        cycleStart: 100,
        cycleEnd: 200,
        // Missing txCount and hash
      } as unknown as TransactionDigest

      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, undefined, undefined])

      // Execute
      await insertTransactionDigest(malformedTxDigest)

      // Verify
      expect(dbModule.extractValues).toHaveBeenCalledWith(malformedTxDigest)
      expect(dbModule.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('INSERT INTO txDigests'),
        expect.arrayContaining([100, 200, undefined, undefined])
      )
    })

    // NEW TEST: Test SQL injection prevention
    it('should use parameterized queries to prevent SQL injection', async () => {
      // Setup: Transaction digest with malicious SQL in a field
      const maliciousTxDigest: TransactionDigest = {
        cycleStart: 100,
        cycleEnd: 200,
        txCount: 500,
        hash: "'); DROP TABLE txDigests; --",
      }

      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, "'); DROP TABLE txDigests; --"])

      // Execute
      await insertTransactionDigest(maliciousTxDigest)

      // Verify parameters are passed separately from SQL
      expect(dbModule.run).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.arrayContaining([100, 200, 500, "'); DROP TABLE txDigests; --"])
      )
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

    // NEW TEST: Empty database test
    it('should return null when no transaction digests exist in the database', async () => {
      // Setup - Database returns no results
      jest.mocked(dbModule.get).mockResolvedValue(null)

      // Execute
      const result = await getLastProcessedTxDigest()

      // Verify
      expect(result).toBeNull()
      expect(console.error).not.toHaveBeenCalled()
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

    // NEW TEST: Test with negative cycle value
    it('should handle negative cycle values without errors', async () => {
      // Setup
      const negativeCycle = -1
      jest.mocked(dbModule.get).mockResolvedValue(null)

      // Execute
      const result = await queryByEndCycle(negativeCycle)

      // Verify
      expect(dbModule.get).toHaveBeenCalledWith(expect.anything(), 'SELECT * FROM txDigests WHERE cycleEnd=? LIMIT 1', [
        negativeCycle,
      ])
      expect(result).toBeNull()
    })

    // NEW TEST: Test with extremely large cycle value
    it('should handle extremely large cycle values', async () => {
      // Setup
      const largeCycle = Number.MAX_SAFE_INTEGER
      jest.mocked(dbModule.get).mockResolvedValue(null)

      // Execute
      const result = await queryByEndCycle(largeCycle)

      // Verify
      expect(dbModule.get).toHaveBeenCalledWith(expect.anything(), 'SELECT * FROM txDigests WHERE cycleEnd=? LIMIT 1', [
        largeCycle,
      ])
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

    // NEW TEST: Test case where start > end cycle
    it('should handle invalid cycle range where start > end', async () => {
      // Setup - Swapped start and end cycles
      const invalidStart = 200
      const invalidEnd = 100

      // Execute
      const result = await queryByCycleRange(invalidStart, invalidEnd)

      // Verify
      expect(dbModule.all).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT * FROM txDigests WHERE cycleStart >= ? AND cycleEnd <= ? ORDER BY cycleEnd',
        [invalidStart, invalidEnd]
      )
      // Function should still work, but will return empty results because of the SQL condition
    })

    // NEW TEST: Test with null values
    it('should handle null start or end values gracefully', async () => {
      // Execute with null start value
      await queryByCycleRange(null as unknown as number, endCycle)

      // Verify parameterized query still works
      expect(dbModule.all).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT * FROM txDigests WHERE cycleStart >= ? AND cycleEnd <= ? ORDER BY cycleEnd',
        [null, endCycle]
      )
    })

    // NEW TEST: Test with extremely large range
    it('should handle querying extremely large ranges', async () => {
      // Setup
      const largeStart = 0
      const largeEnd = Number.MAX_SAFE_INTEGER

      // Execute
      await queryByCycleRange(largeStart, largeEnd)

      // Verify
      expect(dbModule.all).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT * FROM txDigests WHERE cycleStart >= ? AND cycleEnd <= ? ORDER BY cycleEnd',
        [largeStart, largeEnd]
      )
    })

    // NEW TEST: Test handling when db.all returns null instead of an empty array
    it('should convert null result to empty array', async () => {
      // Setup - Database returns null instead of empty array
      jest.mocked(dbModule.all).mockResolvedValue(null as unknown as [])

      // Execute
      const result = await queryByCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
      expect(Array.isArray(result)).toBe(true)
    })
  })

  // NEW TEST SUITE: Test for proper parameterization of SQL queries
  describe('SQL Query Parameterization', () => {
    it('should properly parameterize the INSERT query in insertTransactionDigest', async () => {
      // Setup
      jest.mocked(dbModule.run).mockResolvedValue(undefined)
      jest.mocked(dbModule.extractValues).mockReturnValue([100, 200, 500, 'sample-hash-value'])

      // Execute
      await insertTransactionDigest(sampleTxDigest)

      // Verify SQL query format
      const sqlCall = jest.mocked(dbModule.run).mock.calls[0]
      expect(sqlCall[1]).toContain('?') // SQL should contain parameter placeholders
      expect(sqlCall[1]).not.toContain('100') // Values should not be directly in SQL
      expect(sqlCall[1]).not.toContain('200')
      expect(sqlCall[1]).not.toContain('500')
      expect(sqlCall[1]).not.toContain('sample-hash-value')
    })

    it('should properly parameterize the SELECT query in queryByEndCycle', async () => {
      // Setup
      jest.mocked(dbModule.get).mockResolvedValue(sampleTxDigest)

      // Execute
      await queryByEndCycle(200)

      // Verify SQL query uses parameterization
      const sqlCall = jest.mocked(dbModule.get).mock.calls[0]
      expect(sqlCall[1]).toContain('cycleEnd=?') // Use parameter placeholder
      expect(sqlCall[1]).not.toContain('cycleEnd=200') // Value not directly in SQL
      expect(sqlCall[2]).toEqual([200]) // Parameter array contains the value
    })

    it('should properly parameterize the SELECT query in queryByCycleRange', async () => {
      // Setup
      jest.mocked(dbModule.all).mockResolvedValue([sampleTxDigest])

      // Execute
      await queryByCycleRange(100, 200)

      // Verify SQL query uses parameterization
      const sqlCall = jest.mocked(dbModule.all).mock.calls[0]
      expect(sqlCall[1]).toContain('cycleStart >= ?') // Use parameter placeholder
      expect(sqlCall[1]).toContain('cycleEnd <= ?') // Use parameter placeholder
      expect(sqlCall[1]).not.toContain('100') // Value not directly in SQL
      expect(sqlCall[1]).not.toContain('200') // Value not directly in SQL
      expect(sqlCall[2]).toEqual([100, 200]) // Parameter array contains values
    })
  })
})
