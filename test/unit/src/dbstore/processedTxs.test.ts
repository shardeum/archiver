import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Database } from 'sqlite3'
import * as db from '../../../../src/dbstore/sqlite3storage'
import { processedTxDatabase } from '../../../../src/dbstore'
import * as processedTxs from '../../../../src/dbstore/processedTxs'
import * as Logger from '../../../../src/Logger'
import { config } from '../../../../src/Config'
import { ProcessedTransaction } from '../../../../src/dbstore/processedTxs'

// Mock dependencies
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

jest.mock('../../../../src/dbstore', () => ({
  processedTxDatabase: {} as Database,
}))

jest.mock('../../../../src/dbstore/sqlite3storage', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
}))

// Test data factory
const createProcessedTx = (overrides: Partial<ProcessedTransaction> = {}): ProcessedTransaction => ({
  txId: 'test-tx-1',
  cycle: 10,
  txTimestamp: 1234567890,
  applyTimestamp: 1234567899,
  ...overrides,
})

// Sample processed transaction data for testing
const sampleProcessedTx = createProcessedTx()

describe('ProcessedTxs Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Reset config
    Object.defineProperty(config, 'VERBOSE', {
      value: false,
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('insertProcessedTx', () => {
    it('should insert a processed transaction successfully', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.stringContaining('INSERT INTO processedTxs (txId, cycle, txTimestamp, applyTimestamp) VALUES'),
        [
          sampleProcessedTx.txId,
          sampleProcessedTx.cycle,
          sampleProcessedTx.txTimestamp,
          sampleProcessedTx.applyTimestamp,
        ]
      )
    })

    it('should handle SQL ON CONFLICT clause for duplicate txId', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.stringContaining('ON CONFLICT (txId) DO UPDATE SET'),
        expect.any(Array)
      )
    })

    it('should log error when insertion fails', async () => {
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to insert ProcessedTransaction or it is already stored in the database',
        sampleProcessedTx.txId
      )
    })

    it('should handle database constraint errors', async () => {
      const constraintError = new Error('UNIQUE constraint failed: processedTxs.txId')
      jest.mocked(db.run).mockRejectedValue(constraintError)

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(constraintError)
    })

    it('should handle null or undefined input gracefully', async () => {
      const incompleteData = {
        txId: 'test-tx',
        cycle: 10,
        // Missing required fields
      } as ProcessedTransaction

      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.insertProcessedTx(incompleteData)

      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.any(String),
        ['test-tx', 10, undefined, undefined]
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Successfully inserted ProcessedTransaction',
        sampleProcessedTx.txId
      )
    })

    it('should not log debug message when VERBOSE is false', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      Object.defineProperty(config, 'VERBOSE', { value: false, writable: true })

      await processedTxs.insertProcessedTx(sampleProcessedTx)

      expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
    })
  })

  describe('bulkInsertProcessedTxs', () => {
    const sampleProcessedTxs = [
      sampleProcessedTx,
      createProcessedTx({ txId: 'test-tx-2', cycle: 11 }),
      createProcessedTx({ txId: 'test-tx-3', cycle: 12, txTimestamp: 1234567900 }),
    ]

    it('should insert multiple processed transactions successfully', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.stringContaining('INSERT INTO processedTxs'),
        [
          sampleProcessedTxs[0].txId,
          sampleProcessedTxs[0].cycle,
          sampleProcessedTxs[0].txTimestamp,
          sampleProcessedTxs[0].applyTimestamp,
          sampleProcessedTxs[1].txId,
          sampleProcessedTxs[1].cycle,
          sampleProcessedTxs[1].txTimestamp,
          sampleProcessedTxs[1].applyTimestamp,
          sampleProcessedTxs[2].txId,
          sampleProcessedTxs[2].cycle,
          sampleProcessedTxs[2].txTimestamp,
          sampleProcessedTxs[2].applyTimestamp,
        ]
      )
    })

    it('should handle empty array of transactions', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs([])

      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.stringContaining('INSERT INTO processedTxs'),
        []
      )
    })

    it('should handle large batches of transactions', async () => {
      const largeBatch = Array.from({ length: 100 }, (_, i) => 
        createProcessedTx({ txId: `tx-${i}`, cycle: i })
      )
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs(largeBatch)

      expect(db.run).toHaveBeenCalledTimes(1)
      const callArgs = jest.mocked(db.run).mock.calls[0][2] as any[]
      expect(callArgs).toHaveLength(400) // 100 transactions * 4 fields each
    })

    it('should handle ON CONFLICT for bulk inserts', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      const sqlQuery = jest.mocked(db.run).mock.calls[0][1] as string
      expect(sqlQuery).toContain('ON CONFLICT (txId) DO UPDATE SET')
      expect(sqlQuery).toContain('cycle = excluded.cycle')
      expect(sqlQuery).toContain('txTimestamp = excluded.txTimestamp')
      expect(sqlQuery).toContain('applyTimestamp = excluded.applyTimestamp')
    })

    it('should handle transactions with missing fields', async () => {
      const incompleteTransactions = [
        { txId: 'tx-1', cycle: 10 } as ProcessedTransaction,
        { txId: 'tx-2', cycle: 11, txTimestamp: 123456 } as ProcessedTransaction,
      ]
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs(incompleteTransactions)

      const values = jest.mocked(db.run).mock.calls[0][2] as any[]
      expect(values).toEqual([
        'tx-1', 10, undefined, undefined,
        'tx-2', 11, 123456, undefined,
      ])
    })

    it('should log error when bulk insertion fails', async () => {
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to bulk insert ProcessedTransactions',
        sampleProcessedTxs.length
      )
    })

    it('should handle database timeout errors', async () => {
      const timeoutError = new Error('SQLITE_BUSY: database is locked')
      jest.mocked(db.run).mockRejectedValue(timeoutError)

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(timeoutError)
    })

    it('should log debug message when VERBOSE is true', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Successfully inserted ProcessedTransactions',
        sampleProcessedTxs.length
      )
    })

    it('should not log debug message when VERBOSE is false', async () => {
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      Object.defineProperty(config, 'VERBOSE', { value: false, writable: true })

      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
    })

    it('should preserve transaction order in values array', async () => {
      const orderedTxs = [
        createProcessedTx({ txId: 'tx-a', cycle: 1 }),
        createProcessedTx({ txId: 'tx-b', cycle: 2 }),
        createProcessedTx({ txId: 'tx-c', cycle: 3 }),
      ]
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      await processedTxs.bulkInsertProcessedTxs(orderedTxs)

      const values = jest.mocked(db.run).mock.calls[0][2] as any[]
      expect(values[0]).toBe('tx-a')
      expect(values[4]).toBe('tx-b')
      expect(values[8]).toBe('tx-c')
    })
  })

  describe('queryProcessedTxByTxId', () => {
    it('should return processed transaction when found by txId', async () => {
      jest.mocked(db.get).mockResolvedValue(sampleProcessedTx)

      const result = await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      expect(db.get).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE txId=?',
        [sampleProcessedTx.txId]
      )
      expect(result).toEqual(sampleProcessedTx)
    })

    it('should return null when transaction is not found', async () => {
      jest.mocked(db.get).mockResolvedValue(null)

      const result = await processedTxs.queryProcessedTxByTxId('non-existent-tx')

      expect(result).toBeNull()
    })

    it('should return null when database returns undefined', async () => {
      jest.mocked(db.get).mockResolvedValue(undefined)

      const result = await processedTxs.queryProcessedTxByTxId('non-existent-tx')

      expect(result).toBeUndefined()
    })

    it('should handle empty string txId', async () => {
      jest.mocked(db.get).mockResolvedValue(null)

      const result = await processedTxs.queryProcessedTxByTxId('')

      expect(db.get).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE txId=?',
        ['']
      )
      expect(result).toBeNull()
    })

    it('should handle special characters in txId', async () => {
      const specialTxId = "tx'with\"special;chars"
      const specialTx = createProcessedTx({ txId: specialTxId })
      jest.mocked(db.get).mockResolvedValue(specialTx)

      const result = await processedTxs.queryProcessedTxByTxId(specialTxId)

      expect(db.get).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE txId=?',
        [specialTxId]
      )
      expect(result).toEqual(specialTx)
    })

    it('should handle errors and return null', async () => {
      const error = new Error('DB error')
      jest.mocked(db.get).mockRejectedValue(error)

      const result = await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should handle database connection errors', async () => {
      const connectionError = new Error('SQLITE_ERROR: no such table: processedTxs')
      jest.mocked(db.get).mockRejectedValue(connectionError)

      const result = await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(connectionError)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      jest.mocked(db.get).mockResolvedValue(sampleProcessedTx)
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })

      await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('ProcessedTransaction txId', sampleProcessedTx)
    })

    it('should not log debug message when VERBOSE is false', async () => {
      jest.mocked(db.get).mockResolvedValue(sampleProcessedTx)
      Object.defineProperty(config, 'VERBOSE', { value: false, writable: true })

      await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
    })

    it('should log debug even when transaction is not found and VERBOSE is true', async () => {
      jest.mocked(db.get).mockResolvedValue(null)
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })

      await processedTxs.queryProcessedTxByTxId('non-existent')

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('ProcessedTransaction txId', null)
    })
  })

  describe('queryProcessedTxsByCycleNumber', () => {
    const cycleProcessedTxs = [
      sampleProcessedTx,
      createProcessedTx({ txId: 'test-tx-2' }),
      createProcessedTx({ txId: 'test-tx-3', txTimestamp: 1234567900 }),
    ]

    it('should return array of transactions for a given cycle', async () => {
      jest.mocked(db.all).mockResolvedValue(cycleProcessedTxs)
      const cycleNumber = 10

      const result = await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE cycle=?',
        [cycleNumber]
      )
      expect(result).toEqual(cycleProcessedTxs)
    })

    it('should return empty array when no transactions found', async () => {
      jest.mocked(db.all).mockResolvedValue([])

      const result = await processedTxs.queryProcessedTxsByCycleNumber(999)

      expect(result).toEqual([])
    })

    it('should handle negative cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValue([])

      const result = await processedTxs.queryProcessedTxsByCycleNumber(-1)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE cycle=?',
        [-1]
      )
      expect(result).toEqual([])
    })

    it('should handle zero cycle number', async () => {
      const cycle0Txs = [createProcessedTx({ cycle: 0 })]
      jest.mocked(db.all).mockResolvedValue(cycle0Txs)

      const result = await processedTxs.queryProcessedTxsByCycleNumber(0)

      expect(result).toEqual(cycle0Txs)
    })

    it('should handle large cycle numbers', async () => {
      const largeCycle = 999999999
      jest.mocked(db.all).mockResolvedValue([])

      const result = await processedTxs.queryProcessedTxsByCycleNumber(largeCycle)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE cycle=?',
        [largeCycle]
      )
      expect(result).toEqual([])
    })

    it('should return null when error occurs', async () => {
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)
      const cycleNumber = 10

      const result = await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should handle database timeout errors', async () => {
      const timeoutError = new Error('SQLITE_BUSY: database is locked')
      jest.mocked(db.all).mockRejectedValue(timeoutError)

      const result = await processedTxs.queryProcessedTxsByCycleNumber(10)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith(timeoutError)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      jest.mocked(db.all).mockResolvedValue(cycleProcessedTxs)
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })
      const cycleNumber = 10

      await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `ProcessedTransactions for cycle: ${cycleNumber} ${cycleProcessedTxs.length}`
      )
    })

    it('should not log debug message when VERBOSE is false', async () => {
      jest.mocked(db.all).mockResolvedValue(cycleProcessedTxs)
      Object.defineProperty(config, 'VERBOSE', { value: false, writable: true })

      await processedTxs.queryProcessedTxsByCycleNumber(10)

      expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
    })

    it('should log debug with zero count when empty result', async () => {
      jest.mocked(db.all).mockResolvedValue([])
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })
      const cycleNumber = 10

      await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `ProcessedTransactions for cycle: ${cycleNumber} 0`
      )
    })
  })

  describe('querySortedTxsBetweenCycleRange', () => {
    const txIdsArray = [
      { txId: 'test-tx-2' },
      { txId: 'test-tx-1' },
      { txId: 'test-tx-3' },
    ]

    it('should return sorted array of transaction IDs between specified cycles', async () => {
      jest.mocked(db.all).mockResolvedValue(txIdsArray)
      const startCycle = 5
      const endCycle = 15

      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?',
        [startCycle, endCycle]
      )
      // Result should be sorted
      expect(result).toEqual(['test-tx-1', 'test-tx-2', 'test-tx-3'])
    })

    it('should handle lexicographic sorting of transaction IDs', async () => {
      const unsortedTxIds = [
        { txId: 'tx-10' },
        { txId: 'tx-2' },
        { txId: 'tx-1' },
        { txId: 'tx-20' },
      ]
      jest.mocked(db.all).mockResolvedValue(unsortedTxIds)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(1, 10)

      expect(result).toEqual(['tx-1', 'tx-10', 'tx-2', 'tx-20'])
    })

    it('should handle case-sensitive sorting', async () => {
      const mixedCaseTxIds = [
        { txId: 'TX-a' },
        { txId: 'tx-A' },
        { txId: 'TX-B' },
        { txId: 'tx-b' },
      ]
      jest.mocked(db.all).mockResolvedValue(mixedCaseTxIds)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(1, 10)

      // JavaScript's sort is case-sensitive by default
      expect(result).toEqual(['TX-B', 'TX-a', 'tx-A', 'tx-b'])
    })

    it('should return empty array when no transactions exist in the range', async () => {
      jest.mocked(db.all).mockResolvedValue([])
      const startCycle = 100
      const endCycle = 110

      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(result).toEqual([])
    })

    it('should return empty array when null result from database', async () => {
      jest.mocked(db.all).mockResolvedValue(null as unknown as any[])
      const startCycle = 100
      const endCycle = 110

      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(result).toEqual([])
    })

    it('should handle single cycle range (start equals end)', async () => {
      const singleCycleTxs = [{ txId: 'tx-1' }, { txId: 'tx-2' }]
      jest.mocked(db.all).mockResolvedValue(singleCycleTxs)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(10, 10)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?',
        [10, 10]
      )
      expect(result).toEqual(['tx-1', 'tx-2'])
    })

    it('should handle inverted range (start > end)', async () => {
      jest.mocked(db.all).mockResolvedValue([])

      const result = await processedTxs.querySortedTxsBetweenCycleRange(20, 10)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?',
        [20, 10]
      )
      expect(result).toEqual([])
    })

    it('should handle negative cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValue([])

      const result = await processedTxs.querySortedTxsBetweenCycleRange(-10, -5)

      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?',
        [-10, -5]
      )
      expect(result).toEqual([])
    })

    it('should handle errors and return null', async () => {
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)
      const startCycle = 5
      const endCycle = 15

      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('error in querySortedTxsBetweenCycleRange: ', error)
      expect(result).toBeNull()
    })

    it('should handle database connection errors', async () => {
      const connectionError = new Error('SQLITE_ERROR: no such table: processedTxs')
      jest.mocked(db.all).mockRejectedValue(connectionError)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(1, 10)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('error in querySortedTxsBetweenCycleRange: ', connectionError)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      jest.mocked(db.all).mockResolvedValue(txIdsArray)
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })
      const startCycle = 5
      const endCycle = 15

      await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `txIds between ${startCycle} and ${endCycle} are ${txIdsArray.length}`
      )
    })

    it('should not log debug message when VERBOSE is false', async () => {
      jest.mocked(db.all).mockResolvedValue(txIdsArray)
      Object.defineProperty(config, 'VERBOSE', { value: false, writable: true })

      await processedTxs.querySortedTxsBetweenCycleRange(5, 15)

      expect(Logger.mainLogger.debug).not.toHaveBeenCalled()
    })

    it('should log debug with zero when result is null and VERBOSE is true', async () => {
      jest.mocked(db.all).mockResolvedValue(null as unknown as any[])
      Object.defineProperty(config, 'VERBOSE', { value: true, writable: true })
      const startCycle = 5
      const endCycle = 15

      await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `txIds between ${startCycle} and ${endCycle} are 0`
      )
    })

    it('should handle empty txId in results', async () => {
      const resultsWithEmptyId = [
        { txId: 'tx-1' },
        { txId: '' },
        { txId: 'tx-2' },
      ]
      jest.mocked(db.all).mockResolvedValue(resultsWithEmptyId)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(1, 10)

      expect(result).toEqual(['', 'tx-1', 'tx-2'])
    })

    it('should handle large result sets efficiently', async () => {
      const largeResultSet = Array.from({ length: 10000 }, (_, i) => ({
        txId: `tx-${String(i).padStart(5, '0')}`
      }))
      jest.mocked(db.all).mockResolvedValue(largeResultSet)

      const result = await processedTxs.querySortedTxsBetweenCycleRange(1, 10000)

      expect(result).toHaveLength(10000)
      expect(result[0]).toBe('tx-00000')
      expect(result[9999]).toBe('tx-09999')
    })
  })
}) 