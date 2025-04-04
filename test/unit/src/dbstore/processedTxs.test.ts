import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Database } from 'sqlite3'
import * as db from '../../../../src/dbstore/sqlite3storage'
import { processedTxDatabase } from '../../../../src/dbstore'
import * as processedTxs from '../../../../src/dbstore/processedTxs'
import * as Logger from '../../../../src/Logger'
import { config } from '../../../../src/Config'

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

// Sample processed transaction data for testing
const sampleProcessedTx = {
  txId: 'test-tx-1',
  cycle: 10,
  txTimestamp: 1234567890,
  applyTimestamp: 1234567899,
}

describe('ProcessedTxs Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('insertProcessedTx', () => {
    it('should insert a processed transaction successfully', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await processedTxs.insertProcessedTx(sampleProcessedTx)

      // Verify
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

    it('should log error when insertion fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      // Execute
      await processedTxs.insertProcessedTx(sampleProcessedTx)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to insert ProcessedTransaction or it is already stored in the database',
        sampleProcessedTx.txId
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await processedTxs.insertProcessedTx(sampleProcessedTx)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Successfully inserted ProcessedTransaction',
        sampleProcessedTx.txId
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('bulkInsertProcessedTxs', () => {
    const sampleProcessedTxs = [
      sampleProcessedTx,
      {
        ...sampleProcessedTx,
        txId: 'test-tx-2',
        cycle: 11,
      },
    ]

    it('should insert multiple processed transactions successfully', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      // Verify
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
        ]
      )
    })

    it('should handle empty array of transactions', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await processedTxs.bulkInsertProcessedTxs([])

      // Verify - the run call is made but with empty values array
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        processedTxDatabase,
        expect.stringContaining('INSERT INTO processedTxs'),
        []
      )
    })

    it('should log error when bulk insertion fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      // Execute
      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to bulk insert ProcessedTransactions',
        sampleProcessedTxs.length
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await processedTxs.bulkInsertProcessedTxs(sampleProcessedTxs)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Successfully inserted ProcessedTransactions',
        sampleProcessedTxs.length
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryProcessedTxByTxId', () => {
    it('should return processed transaction when found by txId', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(sampleProcessedTx)

      // Execute
      const result = await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      // Verify
      expect(db.get).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE txId=?',
        [sampleProcessedTx.txId]
      )
      expect(result).toEqual(sampleProcessedTx)
    })

    it('should return null when transaction is not found', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(null)

      // Execute
      const result = await processedTxs.queryProcessedTxByTxId('non-existent-tx')

      // Verify
      expect(result).toBeNull()
    })

    it('should handle errors and return null', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.get).mockRejectedValue(error)

      // Execute
      const result = await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      // Verify
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(sampleProcessedTx)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await processedTxs.queryProcessedTxByTxId(sampleProcessedTx.txId)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('ProcessedTransaction txId', sampleProcessedTx)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryProcessedTxsByCycleNumber', () => {
    const cycleProcessedTxs = [
      sampleProcessedTx,
      {
        ...sampleProcessedTx,
        txId: 'test-tx-2',
      },
    ]

    it('should return array of transactions for a given cycle', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(cycleProcessedTxs)
      const cycleNumber = 10

      // Execute
      const result = await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      // Verify
      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT * FROM processedTxs WHERE cycle=?',
        [cycleNumber]
      )
      expect(result).toEqual(cycleProcessedTxs)
    })

    it('should return null when error occurs', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)
      const cycleNumber = 10

      // Execute
      const result = await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      // Verify
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(cycleProcessedTxs)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true
      const cycleNumber = 10

      // Execute
      await processedTxs.queryProcessedTxsByCycleNumber(cycleNumber)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `ProcessedTransactions for cycle: ${cycleNumber} ${cycleProcessedTxs.length}`
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('querySortedTxsBetweenCycleRange', () => {
    const txIdsArray = [
      { txId: 'test-tx-2' },
      { txId: 'test-tx-1' },
      { txId: 'test-tx-3' },
    ]

    it('should return sorted array of transaction IDs between specified cycles', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(txIdsArray)
      const startCycle = 5
      const endCycle = 15

      // Execute
      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      // Verify
      expect(db.all).toHaveBeenCalledWith(
        processedTxDatabase,
        'SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?',
        [startCycle, endCycle]
      )
      // Result should be sorted
      expect(result).toEqual(['test-tx-1', 'test-tx-2', 'test-tx-3'])
    })

    it('should return empty array when no transactions exist in the range', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])
      const startCycle = 100
      const endCycle = 110

      // Execute
      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
    })

    it('should return empty array when null result from database', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(null as unknown as any[])
      const startCycle = 100
      const endCycle = 110

      // Execute
      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      // Verify
      expect(result).toEqual([])
    })

    it('should handle errors and return null', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)
      const startCycle = 5
      const endCycle = 15

      // Execute
      const result = await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      // Verify
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('error in querySortedTxsBetweenCycleRange: ', error)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(txIdsArray)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true
      const startCycle = 5
      const endCycle = 15

      // Execute
      await processedTxs.querySortedTxsBetweenCycleRange(startCycle, endCycle)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        `txIds between ${startCycle} and ${endCycle} are ${txIdsArray.length}`
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })
}) 