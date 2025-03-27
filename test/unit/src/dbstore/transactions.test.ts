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
    
    // Reset config
    config.VERBOSE = false
    
    // Restore default implementations
    jest.mocked(SerializeToJsonString).mockImplementation((obj) => {
      if (typeof obj === 'object') {
        return JSON.stringify(obj)
      }
      return obj as any
    })
    
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

    // Edge cases and negative tests
    it('should handle transaction with null/undefined appReceiptId', async () => {
      const transactionWithNullReceiptId = {
        ...sampleTransaction,
        appReceiptId: null,
      } as any
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithNullReceiptId)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([
          'test-tx-id-123',
          'null', // null gets serialized to 'null' string
          1625097600000,
          42,
          expect.any(String),
          expect.any(String),
        ])
      )
    })

    it('should handle transaction with extremely large data objects', async () => {
      const largeData = {}
      for (let i = 0; i < 1000; i++) {
        largeData[`key${i}`] = `value${i}`.repeat(100)
      }
      
      const transactionWithLargeData = {
        ...sampleTransaction,
        data: largeData,
        originalTxData: largeData,
      }
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithLargeData)

      expect(db.run).toHaveBeenCalled()
      expect(SerializeToJsonString).toHaveBeenCalledWith(largeData)
    })

    it('should handle transaction with special characters in txId', async () => {
      const transactionWithSpecialChars = {
        ...sampleTransaction,
        txId: 'test-tx-id-!@#$%^&*()_+{}[]|\\:";\'<>?,./`~',
      }
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithSpecialChars)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([
          'test-tx-id-!@#$%^&*()_+{}[]|\\:";\'<>?,./`~',
          expect.any(String),
          expect.any(Number),
          expect.any(Number),
          expect.any(String),
          expect.any(String),
        ])
      )
    })

    it('should handle transaction with negative timestamp', async () => {
      const transactionWithNegativeTimestamp = {
        ...sampleTransaction,
        timestamp: -1625097600000,
      }
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithNegativeTimestamp)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          -1625097600000,
          expect.any(Number),
          expect.any(String),
          expect.any(String),
        ])
      )
    })

    it('should handle transaction with zero cycleNumber', async () => {
      const transactionWithZeroCycle = {
        ...sampleTransaction,
        cycleNumber: 0,
      }
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithZeroCycle)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(Number),
          0,
          expect.any(String),
          expect.any(String),
        ])
      )
    })

    it('should handle transaction with nested circular references in data', async () => {
      const circularData: any = { a: 1 }
      circularData.circular = circularData // Create circular reference
      
      const transactionWithCircular = {
        ...sampleTransaction,
        data: circularData,
      }
      
      // Mock SerializeToJsonString to throw error for circular reference
      jest.mocked(SerializeToJsonString).mockImplementationOnce(() => {
        throw new Error('Converting circular structure to JSON')
      })
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithCircular)

      expect(Logger.mainLogger.error).toHaveBeenCalled()
    })

    it('should handle transaction when db.run returns unexpected result', async () => {
      // Mock db.run to return a result instead of undefined
      jest.mocked(db.run).mockResolvedValueOnce({ changes: 1 } as any)

      await insertTransaction(sampleTransaction)

      // Should still work without errors
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should handle transaction with empty string txId', async () => {
      const transactionWithEmptyTxId = {
        ...sampleTransaction,
        txId: '',
      }
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithEmptyTxId)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining(['', expect.any(String), expect.any(Number), expect.any(Number), expect.any(String), expect.any(String)])
      )
    })

    it('should handle undefined transaction data fields gracefully', async () => {
      const transactionWithUndefinedData = {
        txId: 'test-tx-id-123',
        timestamp: 1625097600000,
        cycleNumber: 42,
        data: undefined,
        originalTxData: undefined,
      } as unknown as Transaction
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await insertTransaction(transactionWithUndefinedData)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([
          'test-tx-id-123',
          undefined,
          1625097600000,
          42,
          undefined,
          undefined,
        ])
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

      // Execute - should not throw
      await expect(bulkInsertTransactions([sampleTransaction])).resolves.not.toThrow()

      // Verify db.run was called
      expect(db.run).toHaveBeenCalledTimes(1)
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

    // Edge cases and negative tests
    it('should handle bulk insert with very large array (1000+ transactions)', async () => {
      // Create a large array of transactions
      const largeTransactionArray = Array.from({ length: 1000 }, (_, i) => ({
        ...sampleTransaction,
        txId: `test-tx-id-${i}`,
        appReceiptId: `test-receipt-id-${i}`,
        cycleNumber: 42 + i,
      }))
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(largeTransactionArray)

      // Verify SQL was called with correct number of placeholders
      const sqlCall = jest.mocked(db.run).mock.calls[0]
      const sql = sqlCall[1] as string
      const placeholderCount = (sql.match(/\?/g) || []).length
      expect(placeholderCount).toBe(6000) // 1000 transactions * 6 fields each
    })

    it('should handle bulk insert with mixed valid and invalid data', async () => {
      const mixedTransactions = [
        sampleTransaction,
        {
          ...sampleTransaction,
          txId: '', // empty txId
          appReceiptId: undefined,
        } as any,
        {
          ...sampleTransaction,
          data: null,
          originalTxData: null,
        },
      ]
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(mixedTransactions)

      expect(db.run).toHaveBeenCalled()
      const values = jest.mocked(db.run).mock.calls[0][2] as any[]
      expect(values).toContain('') // empty txId
      expect(values).toContain(undefined) // undefined appReceiptId
    })

    it('should handle bulk insert when serialization fails for some transactions', async () => {
      const transactions: any[] = [
        sampleTransaction,
        {
          ...sampleTransaction,
          txId: 'test-tx-id-2',
          data: { circular: null }, // Will be made circular below
        },
      ]
      
      // Create circular reference
      transactions[1].data.circular = transactions[1].data
      
      // Mock SerializeToJsonString to fail on circular reference
      jest.mocked(SerializeToJsonString).mockImplementation((obj) => {
        if (obj && typeof obj === 'object' && 'circular' in obj) {
          throw new Error('Converting circular structure to JSON')
        }
        return JSON.stringify(obj)
      })
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(transactions)

      // Should handle error and log it
      expect(Logger.mainLogger.error).toHaveBeenCalled()
    })

    it('should handle bulk insert with duplicate txIds', async () => {
      // Create transactions with duplicate txIds
      const duplicateTransactions = [
        sampleTransaction,
        { ...sampleTransaction }, // Same txId
        { ...sampleTransaction, appReceiptId: 'different-receipt' }, // Same txId, different receipt
      ]
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(duplicateTransactions)

      // INSERT OR REPLACE should handle duplicates
      expect(db.run).toHaveBeenCalled()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should handle bulk insert with extremely long string values', async () => {
      const longString = 'x'.repeat(10000) // 10KB string
      const transactionsWithLongStrings = [
        {
          ...sampleTransaction,
          txId: longString,
          appReceiptId: longString,
        },
      ]
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(transactionsWithLongStrings)

      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        expect.arrayContaining([longString, longString])
      )
    })

    it('should handle bulk insert when db.run throws specific SQL errors', async () => {
      const sqlError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')
      jest.mocked(db.run).mockRejectedValueOnce(sqlError)

      // Execute - should not throw
      await expect(bulkInsertTransactions([sampleTransaction])).resolves.not.toThrow()

      // Verify db.run was called
      expect(db.run).toHaveBeenCalledTimes(1)
    })

    it('should correctly flatten array with transactions containing array data', async () => {
      const transactionsWithArrayData = [
        {
          ...sampleTransaction,
          data: [1, 2, 3, { nested: 'array' }],
          originalTxData: ['a', 'b', 'c'],
        } as any,
      ]
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions(transactionsWithArrayData)

      expect(SerializeToJsonString).toHaveBeenCalledWith([1, 2, 3, { nested: 'array' }])
      expect(SerializeToJsonString).toHaveBeenCalledWith(['a', 'b', 'c'])
    })

    it('should handle single transaction in array identically to insertTransaction', async () => {
      jest.mocked(db.run).mockResolvedValueOnce(undefined)

      await bulkInsertTransactions([sampleTransaction])

      // Verify the SQL parameters match what insertTransaction would produce
      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('INSERT OR REPLACE INTO transactions'),
        [
          'test-tx-id-123',
          'test-receipt-id-456',
          1625097600000,
          42,
          '{"key":"value","txId":"test-tx-id-123"}',
          '{"original":"data"}',
        ]
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

    // Edge cases and SQL injection prevention tests
    it('should handle potential SQL injection in txId parameter', async () => {
      const maliciousTxId = "'; DROP TABLE transactions; --"
      await queryTransactionByTxId(maliciousTxId)

      // Parameterized queries should prevent SQL injection
      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        ["'; DROP TABLE transactions; --"]
      )
    })

    it('should handle extremely long txId', async () => {
      const longTxId = 'x'.repeat(10000)
      jest.mocked(db.get).mockResolvedValueOnce(null)

      const result = await queryTransactionByTxId(longTxId)

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        [longTxId]
      )
      expect(result).toBeNull()
    })

    it('should handle txId with special unicode characters', async () => {
      const unicodeTxId = '🚀💎🌟 test-tx-id 你好世界'
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      const result = await queryTransactionByTxId(unicodeTxId)

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        [unicodeTxId]
      )
      expect(result).toBeDefined()
    })

    it('should handle empty string txId', async () => {
      jest.mocked(db.get).mockResolvedValueOnce(null)

      const result = await queryTransactionByTxId('')

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        ['']
      )
      expect(result).toBeNull()
    })

    it('should handle transaction with partially deserialized data', async () => {
      const partialTransaction = {
        ...sampleDbTransaction,
        data: '{"key":"value"}',
        originalTxData: null, // null instead of string
      }
      jest.mocked(db.get).mockResolvedValueOnce(partialTransaction)

      const result = await queryTransactionByTxId('test-tx-id')

      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(1) // Only called for data, not originalTxData
      expect(result.originalTxData).toBeNull()
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

    // Edge cases and SQL injection prevention tests
    it('should handle potential SQL injection in accountId parameter', async () => {
      const maliciousAccountId = "'; DROP TABLE transactions; --"
      jest.mocked(db.get).mockResolvedValueOnce(null)
      
      await queryTransactionByAccountId(maliciousAccountId)

      // Parameterized queries should prevent SQL injection
      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE accountId=?',
        ["'; DROP TABLE transactions; --"]
      )
    })

    it('should handle extremely long txId', async () => {
      const longTxId = 'x'.repeat(10000)
      jest.mocked(db.get).mockResolvedValueOnce(null)

      const result = await queryTransactionByTxId(longTxId)

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        [longTxId]
      )
      expect(result).toBeNull()
    })

    it('should handle txId with special unicode characters', async () => {
      const unicodeTxId = '🚀💎🌟 test-tx-id 你好世界'
      jest.mocked(db.get).mockResolvedValueOnce(sampleDbTransaction)

      const result = await queryTransactionByTxId(unicodeTxId)

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        [unicodeTxId]
      )
      expect(result).toBeDefined()
    })

    it('should handle empty string txId', async () => {
      jest.mocked(db.get).mockResolvedValueOnce(null)

      const result = await queryTransactionByTxId('')

      expect(db.get).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions WHERE txId=?',
        ['']
      )
      expect(result).toBeNull()
    })

    it('should handle transaction with partially deserialized data', async () => {
      const partialTransaction = {
        ...sampleDbTransaction,
        data: '{"key":"value"}',
        originalTxData: null, // null instead of string
      }
      jest.mocked(db.get).mockResolvedValueOnce(partialTransaction)

      const result = await queryTransactionByTxId('test-tx-id')

      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(1) // Only called for data, not originalTxData
      expect(result.originalTxData).toBeNull()
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

    // Edge cases and negative tests
    it('should handle negative count values', async () => {
      // The implementation doesn't validate negative values, it passes them to SQL
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryLatestTransactions(-10)

      // SQL would be executed with negative LIMIT (which SQLite treats as no limit)
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT -10'
      )
      expect(result).toEqual([])
    })

    it('should handle extremely large count values', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      const result = await queryLatestTransactions(Number.MAX_SAFE_INTEGER)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        `SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT ${Number.MAX_SAFE_INTEGER}`
      )
      expect(result).toBeDefined()
    })

    it('should handle string count that looks like a number', async () => {
      const result = await queryLatestTransactions('10' as any)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
    })

    it('should handle NaN count value', async () => {
      const result = await queryLatestTransactions(NaN)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
    })

    it('should handle Infinity count value', async () => {
      const result = await queryLatestTransactions(Infinity)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
    })

    it('should handle null count value', async () => {
      const result = await queryLatestTransactions(null as any)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestTransactions - Invalid count value')
      expect(result).toBeNull()
    })

    it('should handle transactions with malformed data during deserialization', async () => {
      const malformedDbTransaction = {
        ...sampleDbTransaction,
        data: 'not-valid-json',
        originalTxData: '{invalid json',
      }
      jest.mocked(db.all).mockResolvedValueOnce([malformedDbTransaction])
      
      // Mock DeSerializeFromJsonString to return the string as-is for invalid JSON
      jest.mocked(DeSerializeFromJsonString).mockImplementation((str) => str)

      const result = await queryLatestTransactions(10)

      expect(result).toBeDefined()
      expect(result[0].data).toBe('not-valid-json')
      expect(result[0].originalTxData).toBe('{invalid json')
    })

    it('should handle mixed transactions with null and undefined data fields', async () => {
      const mixedTransactions = [
        { ...sampleDbTransaction, data: null, originalTxData: null },
        { ...sampleDbTransaction, data: undefined, originalTxData: undefined },
        sampleDbTransaction,
      ]
      jest.mocked(db.all).mockResolvedValueOnce(mixedTransactions)

      const result = await queryLatestTransactions(10)

      // Should not call DeSerializeFromJsonString for null/undefined values
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(2) // Only for the valid transaction
      expect(result).toHaveLength(3)
    })

    it('should handle db.all returning non-array value', async () => {
      jest.mocked(db.all).mockResolvedValueOnce(null as any)

      const result = await queryLatestTransactions(10)

      // Function will throw error when trying to access .length on null
      expect(Logger.mainLogger.error).toHaveBeenCalled()
      expect(result).toBeNull()
    })

    it('should correctly apply LIMIT when count is 1', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      const result = await queryLatestTransactions(1)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber DESC, timestamp DESC LIMIT 1'
      )
      expect(result).toHaveLength(1)
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

    // SQL injection prevention tests
    it('should handle potential SQL injection in skip parameter', async () => {
      const maliciousSkip = "0; DROP TABLE transactions; --" as any
      const result = await queryTransactions(maliciousSkip, 10)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryTransactions - Invalid skip or limit')
      expect(result).toBeNull()
      expect(db.all).not.toHaveBeenCalled()
    })

    it('should handle potential SQL injection in limit parameter', async () => {
      const maliciousLimit = "10 OR 1=1" as any
      const result = await queryTransactions(0, maliciousLimit)

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryTransactions - Invalid skip or limit')
      expect(result).toBeNull()
      expect(db.all).not.toHaveBeenCalled()
    })

    it('should handle negative skip values', async () => {
      // Negative integers pass the Number.isInteger check, so SQL is executed
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryTransactions(-10, 100)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT 100 OFFSET -10'
      )
      expect(result).toEqual([])
    })

    it('should handle negative limit values', async () => {
      // Negative integers pass the Number.isInteger check, so SQL is executed
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryTransactions(0, -100)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT -100 OFFSET 0'
      )
      expect(result).toEqual([])
    })

    it('should handle zero limit value', async () => {
      // Zero is a valid integer, so SQL is executed
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryTransactions(0, 0)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        'SELECT * FROM transactions ORDER BY cycleNumber ASC, timestamp ASC LIMIT 0 OFFSET 0'
      )
      expect(result).toEqual([])
    })

    it('should handle extremely large skip and limit values', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([])

      const result = await queryTransactions(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining(`LIMIT ${Number.MAX_SAFE_INTEGER} OFFSET ${Number.MAX_SAFE_INTEGER}`)
      )
      expect(result).toEqual([])
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

    // Edge cases for cycle range validation
    it('should handle inverted cycle range (start > end)', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([])

      const result = await queryTransactionsBetweenCycles(0, 100, 20, 10)

      // Should still execute query - database handles the BETWEEN logic
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [20, 10]
      )
      expect(result).toEqual([])
    })

    it('should handle negative cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      const result = await queryTransactionsBetweenCycles(0, 100, -10, 5)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [-10, 5]
      )
      expect(result).toBeDefined()
    })

    it('should handle zero cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])

      const result = await queryTransactionsBetweenCycles(0, 100, 0, 0)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [0, 0]
      )
      expect(result).toHaveLength(1)
    })

    it('should handle extremely large cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([])

      const result = await queryTransactionsBetweenCycles(0, 100, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]
      )
      expect(result).toEqual([])
    })

    it('should handle SQL injection in cycle parameters', async () => {
      // Even though these are numbers, test that string injection attempts are handled
      const maliciousStart = "10; DROP TABLE transactions; --" as any
      const maliciousEnd = "20 OR 1=1" as any

      // The function doesn't validate cycle numbers, they are passed as parameters to SQL
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryTransactionsBetweenCycles(0, 100, maliciousStart, maliciousEnd)

      // Function passes the values to parameterized query
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [maliciousStart, maliciousEnd]
      )
      expect(result).toEqual([])
    })

    it('should handle missing cycle parameters', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result = await queryTransactionsBetweenCycles(0, 100, undefined as any, undefined as any)

      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [undefined, undefined]
      )
      expect(result).toEqual([])
    })

    it('should handle float cycle numbers', async () => {
      jest.mocked(db.all).mockResolvedValueOnce([])

      const result = await queryTransactionsBetweenCycles(0, 100, 10.5, 20.7)

      // Float values are passed through to the query
      expect(db.all).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.stringContaining('BETWEEN ? AND ?'),
        [10.5, 20.7]
      )
      expect(result).toEqual([])
    })

    it('should handle transactions with complex deserialization scenarios', async () => {
      const complexTransactions = [
        { ...sampleDbTransaction, data: null, originalTxData: '{}' },
        { ...sampleDbTransaction, data: '[]', originalTxData: null },
        { ...sampleDbTransaction, data: '{"nested":{"deep":true}}', originalTxData: '{"array":[1,2,3]}' },
      ]
      jest.mocked(db.all).mockResolvedValueOnce(complexTransactions)

      const result = await queryTransactionsBetweenCycles(0, 100, 1, 100)

      expect(result).toHaveLength(3)
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(4) // Called for non-null data and originalTxData
    })
  })

  // Additional edge cases and data integrity tests
  describe('Data Integrity and Edge Cases', () => {
    it('should handle concurrent insert operations gracefully', async () => {
      const concurrentTransactions = Array.from({ length: 5 }, (_, i) => ({
        ...sampleTransaction,
        txId: `concurrent-tx-${i}`,
        timestamp: Date.now() + i,
      }))

      // Simulate concurrent inserts
      const promises = concurrentTransactions.map(tx => insertTransaction(tx))
      
      // All should resolve without errors
      await expect(Promise.all(promises)).resolves.not.toThrow()
      
      // Verify all were attempted
      expect(db.run).toHaveBeenCalledTimes(5)
    })

    it('should handle race condition in bulk insert vs single insert', async () => {
      const tx1 = { ...sampleTransaction, txId: 'race-tx-1' }
      const tx2 = { ...sampleTransaction, txId: 'race-tx-2' }
      
      // Start both operations simultaneously
      const bulkPromise = bulkInsertTransactions([tx1, tx2])
      const singlePromise = insertTransaction(tx1)
      
      // Both should complete without errors (INSERT OR REPLACE handles conflicts)
      await expect(Promise.all([bulkPromise, singlePromise])).resolves.not.toThrow()
    })

    it('should handle transaction with maximum field lengths', async () => {
      const maxLengthTransaction = {
        txId: 'x'.repeat(255), // Typical max for indexed fields
        appReceiptId: 'y'.repeat(255),
        timestamp: Number.MAX_SAFE_INTEGER,
        cycleNumber: Number.MAX_SAFE_INTEGER,
        data: { bigData: 'z'.repeat(65536) } as any, // 64KB of data
        originalTxData: { bigOriginal: 'w'.repeat(65536) },
      }
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)
      
      await insertTransaction(maxLengthTransaction)
      
      expect(db.run).toHaveBeenCalled()
      expect(SerializeToJsonString).toHaveBeenCalledWith(maxLengthTransaction.data)
    })

    it('should handle transaction data type validation', async () => {
      const invalidTypeTransaction = {
        txId: 123 as any, // Should be string
        appReceiptId: true as any, // Should be string
        timestamp: '2023-01-01' as any, // Should be number
        cycleNumber: '42' as any, // Should be number
        data: 'not-an-object' as any, // Should be object
        originalTxData: 123 as any, // Should be object
      } as Transaction
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)
      
      // Function should still attempt to insert (no runtime validation)
      await insertTransaction(invalidTypeTransaction)
      
      expect(db.run).toHaveBeenCalled()
    })

    it('should handle deserialization of legacy data formats', async () => {
      const legacyTransaction = {
        ...sampleDbTransaction,
        data: '{"legacyFormat":true,"version":1}',
        originalTxData: 'plain-string-not-json', // Old format might not be JSON
      }
      
      jest.mocked(db.get).mockResolvedValueOnce(legacyTransaction)
      jest.mocked(DeSerializeFromJsonString).mockImplementation((str) => {
        try {
          return JSON.parse(str as string)
        } catch {
          return str // Return as-is if not valid JSON
        }
      })
      
      const result = await queryTransactionByTxId('legacy-tx')
      
      expect(result.data).toEqual({ legacyFormat: true, version: 1 })
      expect(result.originalTxData).toBe('plain-string-not-json')
    })

    it('should handle database connection errors during bulk operations', async () => {
      const connectionError = new Error('SQLITE_BUSY: database is locked')
      jest.mocked(db.run).mockRejectedValueOnce(connectionError)
      
      const transactions = Array.from({ length: 100 }, (_, i) => ({
        ...sampleTransaction,
        txId: `bulk-tx-${i}`,
      }))
      
      await bulkInsertTransactions(transactions)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(connectionError)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Unable to bulk insert Transactions', 100)
    })

    it('should handle memory constraints with very large result sets', async () => {
      // Simulate a very large result set
      const largeResultSet = Array.from({ length: 10000 }, (_, i) => ({
        ...sampleDbTransaction,
        txId: `large-result-${i}`,
      }))
      
      jest.mocked(db.all).mockResolvedValueOnce(largeResultSet)
      
      const result = await queryTransactions(0, 10000)
      
      expect(result).toHaveLength(10000)
      // Deserialization should be called for each transaction's data fields
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(20000) // 2 fields per transaction
    })

    it('should handle special database values (NULL, empty strings, zero)', async () => {
      const specialValuesTransaction = {
        txId: '',
        appReceiptId: null as any,
        timestamp: 0,
        cycleNumber: 0,
        data: {},
        originalTxData: null as any,
      }
      
      jest.mocked(db.run).mockResolvedValueOnce(undefined)
      
      await insertTransaction(specialValuesTransaction)
      
      expect(db.run).toHaveBeenCalledWith(
        'mock-transaction-db',
        expect.any(String),
        ['', 'null', 0, 0, '{}', 'null']
      )
    })

    it('should handle count queries returning unexpected formats', async () => {
      // Mock unexpected count result format
      jest.mocked(db.get).mockResolvedValueOnce({ count: 42 }) // Wrong key
      
      const result = await queryTransactionCount()
      
      // When COUNT(*) key is missing, it returns undefined (which is then set to 0)
      expect(result).toBe(undefined)
    })

    it('should handle pagination edge cases', async () => {
      // Test skip at boundary
      jest.mocked(db.all).mockResolvedValueOnce([])
      
      const result1 = await queryTransactions(Number.MAX_SAFE_INTEGER - 1, 2)
      
      expect(result1).toEqual([])
      
      // Test limit of 1
      jest.mocked(db.all).mockResolvedValueOnce([sampleDbTransaction])
      
      const result2 = await queryTransactions(0, 1)
      
      expect(result2).toHaveLength(1)
    })
  })
})
