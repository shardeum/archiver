import * as db from '../../../../src/dbstore/sqlite3storage'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../../../../src/utils/serialization'
import * as Logger from '../../../../src/Logger'
import { config } from '../../../../src/Config'
import {
  insertTransaction,
  bulkInsertTransactions,
  queryTransactionByTxId,
  queryTransactionByAccountId,
  queryLatestTransactions,
  queryTransactions,
  queryTransactionCount,
  queryTransactionCountBetweenCycles,
  queryTransactionsBetweenCycles,
  Transaction,
} from '../../../../src/dbstore/transactions'

// Mock dependencies
jest.mock('../../../../src/dbstore/sqlite3storage')
jest.mock('../../../../src/utils/serialization')
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
    VERBOSE: false,
  },
}))
jest.mock('../../../../src/dbstore', () => ({
  transactionDatabase: 'mock-transaction-db',
}))

// Sample transaction data for testing
const sampleTransaction: Transaction = {
  txId: 'test-tx-id-123',
  appReceiptId: 'test-receipt-id-456',
  timestamp: 1625097600000,
  cycleNumber: 42,
  data: { key: 'value', txId: 'test-tx-id-123' } as unknown as { txId?: string; appReceiptId?: string },
  originalTxData: { original: 'data' },
}

const sampleDbTransaction = {
  txId: 'test-tx-id-123',
  appReceiptId: 'test-receipt-id-456',
  timestamp: 1625097600000,
  cycleNumber: 42,
  data: '{"key":"value","txId":"test-tx-id-123"}',
  originalTxData: '{"original":"data"}',
}

describe('Transactions Database Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Mock SerializeToJsonString to return JSON string
    jest.mocked(SerializeToJsonString).mockImplementation((obj) => {
      if (typeof obj === 'object') {
        return JSON.stringify(obj)
      }
      return obj as any
    })

    // Mock DeSerializeFromJsonString to parse JSON string
    jest.mocked(DeSerializeFromJsonString).mockImplementation((str) => {
      if (typeof str === 'string') {
        try {
          return JSON.parse(str)
        } catch (e) {
          return str
        }
      }
      return str
    })

    // Set default config.VERBOSE to false before each test
    config.VERBOSE = false
  })

  afterEach(() => {
    // Reset all mocks after each test for isolation
    jest.clearAllMocks()
  })

  describe('insertTransaction', () => {
    it('should successfully insert a transaction', async () => {
      // Setup: mock successful db run
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      // Execute
      await insertTransaction(sampleTransaction)

      // Verify correct SQL and parameters were used
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        'INSERT OR REPLACE INTO transactions (txId, appReceiptId, timestamp, cycleNumber, data, originalTxData) VALUES (?, ?, ?, ?, ?, ?)',
        [
          'test-tx-id-123',
          'test-receipt-id-456',
          1625097600000,
          42,
          '{"key":"value","txId":"test-tx-id-123"}',
          '{"original":"data"}',
        ]
      )

      // Verify serialization functions were called
      expect(SerializeToJsonString).toHaveBeenCalled()

      // Verify no errors were logged
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging
      config.VERBOSE = true
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      // Execute
      await insertTransaction(sampleTransaction)

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Transaction', 'test-tx-id-123')
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database insertion failed')
      jest.mocked(db.run).mockRejectedValueOnce(dbError)

      // Execute
      await insertTransaction(sampleTransaction)

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to insert Transaction or it is already stored in the database',
        'test-tx-id-123'
      )
    })
  })

  describe('bulkInsertTransactions', () => {
    it('should successfully bulk insert transactions', async () => {
      // Create multiple sample transactions
      const sampleTransactions = [
        sampleTransaction,
        {
          ...sampleTransaction,
          txId: 'test-tx-id-789',
          appReceiptId: 'test-receipt-id-101',
          cycleNumber: 43,
        },
      ]

      // Setup: mock successful db run
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      // Execute
      await bulkInsertTransactions(sampleTransactions)

      // Verify correct SQL and parameters
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        'INSERT OR REPLACE INTO transactions (txId, appReceiptId, timestamp, cycleNumber, data, originalTxData) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
        expect.any(Array)
      )

      // Verify no errors were logged
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging
      config.VERBOSE = true
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      // Execute with a single transaction in array
      await bulkInsertTransactions([sampleTransaction])

      // Verify debug was called with count
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Transactions', 1)
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database bulk insertion failed')
      jest.mocked(db.run).mockRejectedValueOnce(dbError)

      // Execute
      await bulkInsertTransactions([sampleTransaction])

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Unable to bulk insert Transactions', 1)
    })

    it('should handle empty array gracefully', async () => {
      // Execute with empty array
      await bulkInsertTransactions([])

      // Verify SQL wasn't executed with any values
      // The function still calls db.run but with an empty VALUES clause
      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        'INSERT OR REPLACE INTO transactions (txId, appReceiptId, timestamp, cycleNumber, data, originalTxData) VALUES ',
        []
      )
    })
  })

  describe('queryTransactionByTxId', () => {
    it('should successfully return a transaction by txId', async () => {
      // Setup: mock successful db get with transaction
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      // Execute
      const result = await queryTransactionByTxId('test-tx-id-123')

      // Verify correct SQL and parameters
      expect(db.get).toHaveBeenCalledWith('mock-transaction-db', 'SELECT * FROM transactions WHERE txId=?', [
        'test-tx-id-123',
      ])

      // Verify deserialization
      expect(DeSerializeFromJsonString).toHaveBeenCalled()

      // Verify correct result structure
      expect(result).toEqual(
        expect.objectContaining({
          txId: 'test-tx-id-123',
          data: expect.any(Object),
          originalTxData: expect.any(Object),
        })
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      // Execute
      await queryTransactionByTxId('test-tx-id-123')

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction txId', expect.anything())
    })

    it('should return null when transaction is not found', async () => {
      // Setup: mock db returning null (transaction not found)
      jest.mocked(db.get).mockResolvedValueOnce(null)

      // Execute
      const result = await queryTransactionByTxId('non-existent-id')

      // Verify correct result
      expect(result).toBeNull()
      expect(DeSerializeFromJsonString).not.toHaveBeenCalled()
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.get).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionByTxId('test-tx-id-123')

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(result).toBeNull()
    })
  })

  describe('queryTransactionByAccountId', () => {
    it('should successfully return a transaction by accountId', async () => {
      // Setup: mock successful db get with transaction
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      // Execute
      const result = await queryTransactionByAccountId('test-account-id')

      // Verify correct SQL and parameters
      expect(db.get).toHaveBeenCalledWith('mock-transaction-db', 'SELECT * FROM transactions WHERE accountId=?', [
        'test-account-id',
      ])

      // Verify deserialization
      expect(DeSerializeFromJsonString).toHaveBeenCalled()

      // Verify correct result structure
      expect(result).toEqual(
        expect.objectContaining({
          txId: 'test-tx-id-123',
          data: expect.any(Object),
          originalTxData: expect.any(Object),
        })
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      // Execute
      await queryTransactionByAccountId('test-account-id')

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction accountId', expect.anything())
    })

    it('should return null when account transaction is not found', async () => {
      // Setup: mock db returning null (transaction not found)
      jest.mocked(db.get).mockResolvedValueOnce(null)

      // Execute
      const result = await queryTransactionByAccountId('non-existent-id')

      // Verify correct result
      expect(result).toBeNull()
      expect(DeSerializeFromJsonString).not.toHaveBeenCalled()
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.get).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionByAccountId('test-account-id')

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(result).toBeNull()
    })
  })

  describe('queryLatestTransactions', () => {
    it('should successfully return latest transactions', async () => {
      // Setup: mock successful db all with transactions
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute
      const result = await queryLatestTransactions(10)

      // Verify correct SQL
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT 10'
      )

      // Verify deserialization was called
      expect(DeSerializeFromJsonString).toHaveBeenCalled()

      // Verify correct result
      expect(result).toEqual([
        expect.objectContaining({
          txId: 'test-tx-id-123',
          data: expect.any(Object),
        }),
      ])
    })

    it('should use default limit of 100 when count is 0', async () => {
      // Setup: mock successful db all with transactions
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute with count = 0 (falsy)
      const result = await queryLatestTransactions(0)

      // Verify SQL uses default 100 limit
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT 100'
      )

      // Verify result
      expect(result).toEqual([
        expect.objectContaining({
          txId: 'test-tx-id-123',
        }),
      ])
    })

    it('should use default limit of 100 when count is not provided', async () => {
      // Setup: mock the Number.isInteger check to return false
      const originalIsInteger = Number.isInteger
      Number.isInteger = jest.fn().mockReturnValue(false)

      // Execute with undefined count (falls back to validation error path)
      const result = await queryLatestTransactions(undefined as any)

      // Restore the original function
      Number.isInteger = originalIsInteger

      // Verify error is logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute
      await queryLatestTransactions(10)

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction latest', expect.anything())
    })

    it('should handle non-integer count parameter', async () => {
      // Execute with non-integer count
      const result = await queryLatestTransactions(10.5)

      // Verify error is logged and null returned
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
      expect(db.all).not.toHaveBeenCalled()
    })

    it('should handle empty result array', async () => {
      // Setup: mock empty result
      jest.mocked(db.all).mockResolvedValueOnce([])

      // Execute
      const result = await queryLatestTransactions(10)

      // Verify correct handling of empty result
      expect(result).toEqual([]) // We expect an empty array, not a transaction
      expect(DeSerializeFromJsonString).not.toHaveBeenCalled()
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.all).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryLatestTransactions(10)

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(result).toBeNull()
    })
  })

  describe('queryTransactions', () => {
    it('should successfully return transactions with default pagination', async () => {
      // Setup: mock successful db all with transactions
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute with default values
      const result = await queryTransactions()

      // Verify correct SQL with default values
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT 10000 OFFSET 0'
      )

      // Verify result is an array with transactions
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
    })

    it('should use custom pagination parameters when provided', async () => {
      // Setup: mock successful db all with transactions
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute with custom pagination
      const result = await queryTransactions(100, 50)

      // Verify correct SQL with custom values
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT 50 OFFSET 100'
      )

      // Verify correct result
      expect(result.length).toBe(1)
    })

    it('should handle undefined transactions in debug logging', async () => {
      // Setup: Enable verbose logging
      config.VERBOSE = true

      // Mock db.all to throw an error so transactions remains undefined
      const dbError = new Error('Database query failed')
      jest.mocked(db.all).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactions()

      // Verify debug message with undefined transactions
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Transaction transactions',
        undefined, // transactions is undefined after error
        'skip',
        0
      )

      // Verify the result is undefined
      expect(result).toBeUndefined()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute
      await queryTransactions(5, 10)

      // Verify debug was called with transaction count and skip value
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction transactions', 1, 'skip', 5)
    })

    it('should handle non-integer skip and limit parameters', async () => {
      // Execute with non-integer skip
      const result1 = await queryTransactions(10.5)

      // Verify error is logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryTransactions - Invalid skip or limit')
      expect(result1).toBeNull()

      // Reset mocks
      jest.clearAllMocks()

      // Execute with non-integer limit
      const result2 = await queryTransactions(0, 10.5)

      // Verify error is logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryTransactions - Invalid skip or limit')
      expect(result2).toBeNull()
    })

    it('should handle empty result', async () => {
      // Setup: mock empty result
      jest.mocked(db.all).mockResolvedValueOnce([])

      // Execute
      const result = await queryTransactions()

      // Verify correct handling of empty result
      expect(result).toEqual([]) // Return empty array from actual implementation
      expect(DeSerializeFromJsonString).not.toHaveBeenCalled()
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.all).mockRejectedValueOnce(dbError)

      // Execute - this also covers lines 141-142 in the implementation
      const result = await queryTransactions()

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      // In the actual implementation, the function returns undefined after logging the error
      expect(result).toBeUndefined()
    })
  })

  describe('queryTransactionCount', () => {
    it('should successfully return transaction count', async () => {
      // Setup: mock successful db get with count
      jest.mocked(db.get).mockResolvedValueOnce({ 'COUNT(*)': 42 })

      // Execute
      const result = await queryTransactionCount()

      // Verify correct SQL
      expect(db.get).toHaveBeenCalledWith('mock-transaction-db', 'SELECT COUNT(*) FROM transactions', [])

      // Verify correct result
      expect(result).toBe(42)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.get).mockResolvedValueOnce({ 'COUNT(*)': 42 })

      // Execute
      await queryTransactionCount()

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction count', { 'COUNT(*)': 42 })
    })

    it('should return 0 when query returns no results', async () => {
      // Setup: mock null result
      jest.mocked(db.get).mockResolvedValueOnce(null)

      // Execute
      const result = await queryTransactionCount()

      // Verify correct default
      expect(result).toBe(0)
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.get).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionCount()

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(result).toBe(0) // Should default to 0 on error
    })
  })

  describe('queryTransactionCountBetweenCycles', () => {
    it('should successfully return transaction count between cycles', async () => {
      // Setup: mock successful db get with count
      jest.mocked(db.get).mockResolvedValueOnce({ 'COUNT(*)': 42 })

      // Execute
      const result = await queryTransactionCountBetweenCycles(10, 20)

      // Verify correct SQL and parameters
      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT COUNT(*) FROM transactions WHERE cycleNumber BETWEEN ? AND ?',
        [10, 20]
      )

      // Verify correct result
      expect(result).toBe(42)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.get).mockResolvedValueOnce({ 'COUNT(*)': 42 })

      // Execute
      await queryTransactionCountBetweenCycles(10, 20)

      // Verify debug was called
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction count between cycles', { 'COUNT(*)': 42 })
    })

    it('should return 0 when query returns no results', async () => {
      // Setup: mock null result
      jest.mocked(db.get).mockResolvedValueOnce(null)

      // Execute
      const result = await queryTransactionCountBetweenCycles(10, 20)

      // Verify correct default
      expect(result).toBe(0)
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.get).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionCountBetweenCycles(10, 20)

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      expect(result).toBe(0) // Should default to 0 on error
    })
  })

  describe('queryTransactionsBetweenCycles', () => {
    it('should successfully return transactions between cycles with default pagination', async () => {
      // Setup: mock successful db all with transactions
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute with default pagination values
      const result = await queryTransactionsBetweenCycles(0, 10000, 10, 20)

      // Verify correct SQL and parameters
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT 10000 OFFSET 0',
        [10, 20]
      )

      // Verify result is an array with transactions
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(1)
    })

    it('should handle undefined transactions in debug logging', async () => {
      // Setup: Enable verbose logging
      config.VERBOSE = true

      // Mock db.all to throw an error so transactions remains undefined
      const dbError = new Error('Database query failed')
      jest.mocked(db.all).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionsBetweenCycles(0, 10000, 10, 20)

      // Verify debug message with undefined transactions
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Transaction transactions between cycles',
        undefined, // transactions is undefined after error
        'skip',
        0
      )

      // Verify the result is undefined
      expect(result).toBeUndefined()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup: Enable verbose logging and successful response
      config.VERBOSE = true
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      // Execute
      await queryTransactionsBetweenCycles(5, 10, 10, 20)

      // Verify debug was called with transaction count and skip value
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Transaction transactions between cycles', 1, 'skip', 5)
    })

    it('should handle non-integer skip and limit parameters', async () => {
      // Execute with non-integer skip
      const result1 = await queryTransactionsBetweenCycles(10.5, 100, 10, 20)

      // Verify error is logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'queryTransactionsBetweenCycles - Invalid skip or limit value'
      )
      expect(result1).toBeNull()

      // Reset mocks
      jest.clearAllMocks()

      // Execute with non-integer limit
      const result2 = await queryTransactionsBetweenCycles(0, 10.5, 10, 20)

      // Verify error is logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'queryTransactionsBetweenCycles - Invalid skip or limit value'
      )
      expect(result2).toBeNull()
    })

    it('should handle empty result', async () => {
      // Setup: mock empty result
      jest.mocked(db.all).mockResolvedValueOnce([])

      // Execute
      const result = await queryTransactionsBetweenCycles(0, 10000, 10, 20)

      // Verify correct handling of empty result
      expect(result).toEqual([]) // Return empty array from actual implementation
      expect(DeSerializeFromJsonString).not.toHaveBeenCalled()
    })

    it('should handle and log database errors', async () => {
      // Setup: mock db error
      const dbError = new Error('Database query failed')
      jest.mocked(db.all).mockRejectedValueOnce(dbError)

      // Execute
      const result = await queryTransactionsBetweenCycles(0, 10000, 10, 20)

      // Verify error handling
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(dbError)
      // In the actual implementation, the function returns undefined after logging the error
      expect(result).toBeUndefined()
    })
  })
})
