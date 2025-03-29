import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Database } from 'sqlite3'
import * as db from '../../../../src/dbstore/sqlite3storage'
import { accountDatabase } from '../../../../src/dbstore'
import * as accounts from '../../../../src/dbstore/accounts'
import * as Logger from '../../../../src/Logger'
import { config } from '../../../../src/Config'
import { DeSerializeFromJsonString, SerializeToJsonString } from '../../../../src/utils/serialization'

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

jest.mock('../../../../src/utils/serialization', () => ({
  SerializeToJsonString: jest.fn((obj) => JSON.stringify(obj)),
  DeSerializeFromJsonString: jest.fn((str) => JSON.parse(str as string)),
}))

jest.mock('../../../../src/dbstore', () => ({
  accountDatabase: {} as Database,
}))

jest.mock('../../../../src/dbstore/sqlite3storage', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
}))

// Sample account data for testing
const sampleAccount = {
  accountId: 'test-account-1',
  data: { balance: 100, nonce: 1 },
  timestamp: 1234567890,
  hash: 'test-hash-1',
  cycleNumber: 10,
  isGlobal: false,
}

const sampleDbAccount = {
  ...sampleAccount,
  data: JSON.stringify(sampleAccount.data),
}

describe('Accounts Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('insertAccount', () => {
    it('should insert an account successfully', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await accounts.insertAccount(sampleAccount)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        accountDatabase,
        'INSERT OR REPLACE INTO accounts (accountId, data, timestamp, hash, cycleNumber, isGlobal) VALUES (?, ?, ?, ?, ?, ?)',
        [
          sampleAccount.accountId,
          JSON.stringify(sampleAccount.data),
          sampleAccount.timestamp,
          sampleAccount.hash,
          sampleAccount.cycleNumber,
          sampleAccount.isGlobal,
        ]
      )
      expect(SerializeToJsonString).toHaveBeenCalledWith(sampleAccount.data)
    })

    it('should log error when insertion fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      // Execute
      await accounts.insertAccount(sampleAccount)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to insert Account or it is already stored in the database',
        sampleAccount.accountId
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.insertAccount(sampleAccount)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Account', sampleAccount.accountId)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('bulkInsertAccounts', () => {
    const sampleAccounts = [
      sampleAccount,
      {
        ...sampleAccount,
        accountId: 'test-account-2',
        hash: 'test-hash-2',
      },
    ]

    it('should insert multiple accounts successfully', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await accounts.bulkInsertAccounts(sampleAccounts)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        accountDatabase,
        'INSERT OR REPLACE INTO accounts (accountId, data, timestamp, hash, cycleNumber, isGlobal) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
        [
          sampleAccounts[0].accountId,
          JSON.stringify(sampleAccounts[0].data),
          sampleAccounts[0].timestamp,
          sampleAccounts[0].hash,
          sampleAccounts[0].cycleNumber,
          sampleAccounts[0].isGlobal,
          sampleAccounts[1].accountId,
          JSON.stringify(sampleAccounts[1].data),
          sampleAccounts[1].timestamp,
          sampleAccounts[1].hash,
          sampleAccounts[1].cycleNumber,
          sampleAccounts[1].isGlobal,
        ]
      )
    })

    it('should handle empty accounts array', async () => {
      // Execute
      await accounts.bulkInsertAccounts([])

      // Verify
      expect(db.run).toHaveBeenCalledWith(
        accountDatabase,
        'INSERT OR REPLACE INTO accounts (accountId, data, timestamp, hash, cycleNumber, isGlobal) VALUES ',
        []
      )
    })

    it('should log error when bulk insertion fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      // Execute
      await accounts.bulkInsertAccounts(sampleAccounts)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Unable to bulk insert Accounts',
        sampleAccounts.length
      )
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.bulkInsertAccounts(sampleAccounts)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully inserted Accounts', sampleAccounts.length)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('updateAccount', () => {
    it('should update an account successfully', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })

      // Execute
      await accounts.updateAccount(sampleAccount)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(db.run).toHaveBeenCalledWith(
        accountDatabase,
        'UPDATE accounts SET cycleNumber = $cycleNumber, timestamp = $timestamp, data = $data, hash = $hash WHERE accountId = $accountId ',
        {
          $cycleNumber: sampleAccount.cycleNumber,
          $timestamp: sampleAccount.timestamp,
          $data: JSON.stringify(sampleAccount.data),
          $hash: sampleAccount.hash,
          $accountId: sampleAccount.accountId,
        }
      )
    })

    it('should log error when update fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.run).mockRejectedValue(error)

      // Execute
      await accounts.updateAccount(sampleAccount)

      // Verify
      expect(db.run).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Unable to update Account', sampleAccount)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.run).mockResolvedValue({ id: 1 })
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.updateAccount(sampleAccount)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Successfully updated Account', sampleAccount.accountId)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryAccountByAccountId', () => {
    it('should return account when it exists', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(sampleDbAccount)

      // Execute
      const result = await accounts.queryAccountByAccountId(sampleAccount.accountId)

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(db.get).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT * FROM accounts WHERE accountId=?',
        [sampleAccount.accountId]
      )
      expect(DeSerializeFromJsonString).toHaveBeenCalledWith(sampleDbAccount.data)
      expect(result).toEqual(sampleAccount)
    })

    it('should return null when account does not exist', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(null)

      // Execute
      const result = await accounts.queryAccountByAccountId('non-existent-id')

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(result).toBeUndefined()
    })

    it('should return null when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.get).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryAccountByAccountId(sampleAccount.accountId)

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(sampleDbAccount)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryAccountByAccountId(sampleAccount.accountId)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Account accountId', sampleAccount)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryLatestAccounts', () => {
    const sampleDbAccounts = [
      sampleDbAccount,
      { ...sampleDbAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    const sampleAccounts = [
      sampleAccount,
      { ...sampleAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    it('should return latest accounts', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)

      // Execute
      const result = await accounts.queryLatestAccounts(2)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(db.all).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT * FROM accounts ORDER BY cycleNumber DESC, timestamp DESC LIMIT 2'
      )
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(2)
      expect(result).toEqual(sampleAccounts)
    })

    it('should return empty array when no accounts exist', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])

      // Execute
      const result = await accounts.queryLatestAccounts(10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
    })

    it('should use default limit of 100 when no count is provided', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])

      // Execute
      await accounts.queryLatestAccounts(0)

      // Verify
      expect(db.all).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT * FROM accounts ORDER BY cycleNumber DESC, timestamp DESC LIMIT 100'
      )
    })

    it('should return null when count is invalid', async () => {
      // Execute
      const result = await accounts.queryLatestAccounts(NaN)

      // Verify
      expect(db.all).not.toHaveBeenCalled()
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryLatestAccounts - Invalid count value')
      expect(result).toBeNull()
    })

    it('should return null when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryLatestAccounts(10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBeNull()
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryLatestAccounts(2)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Account latest', sampleAccounts)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryAccounts', () => {
    const sampleDbAccounts = [
      sampleDbAccount,
      { ...sampleDbAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    const sampleAccounts = [
      sampleAccount,
      { ...sampleAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    it('should return accounts with pagination', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)

      // Execute
      const result = await accounts.queryAccounts(0, 10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(db.all).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT * FROM accounts ORDER BY cycleNumber ASC, timestamp ASC LIMIT 10 OFFSET 0'
      )
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(2)
      expect(result).toEqual(sampleAccounts)
    })

    it('should return empty array when no accounts match', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])

      // Execute
      const result = await accounts.queryAccounts(100, 10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
    })

    it('should return empty array when skip or limit is invalid', async () => {
      // Execute
      const result = await accounts.queryAccounts(NaN, 10)

      // Verify
      expect(db.all).not.toHaveBeenCalled()
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryAccounts - Invalid skip or limit value')
      expect(result).toEqual([])
    })

    it('should return empty array when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryAccounts(0, 10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toEqual([])
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryAccounts(0, 10)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Account accounts',
        sampleAccounts.length,
        'skip',
        0
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryAccountCount', () => {
    it('should return correct count of accounts', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue({ 'COUNT(*)': 42 })

      // Execute
      const result = await accounts.queryAccountCount()

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(db.get).toHaveBeenCalledWith(accountDatabase, 'SELECT COUNT(*) FROM accounts', [])
      expect(result).toBe(42)
    })

    it('should return 0 when no accounts exist', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(null)

      // Execute
      const result = await accounts.queryAccountCount()

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(result).toBe(0)
    })

    it('should return 0 when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.get).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryAccountCount()

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBe(0)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      const countObj = { 'COUNT(*)': 42 }
      jest.mocked(db.get).mockResolvedValue(countObj)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryAccountCount()

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Account count', countObj)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryAccountCountBetweenCycles', () => {
    it('should return correct count of accounts between cycles', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue({ 'COUNT(*)': 42 })

      // Execute
      const result = await accounts.queryAccountCountBetweenCycles(5, 10)

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(db.get).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT COUNT(*) FROM accounts WHERE cycleNumber BETWEEN ? AND ?',
        [5, 10]
      )
      expect(result).toBe(42)
    })

    it('should return 0 when no accounts exist in range', async () => {
      // Setup
      jest.mocked(db.get).mockResolvedValue(null)

      // Execute
      const result = await accounts.queryAccountCountBetweenCycles(100, 200)

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(result).toBe(0)
    })

    it('should return 0 when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.get).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryAccountCountBetweenCycles(5, 10)

      // Verify
      expect(db.get).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toBe(0)
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      const countObj = { 'COUNT(*)': 42 }
      jest.mocked(db.get).mockResolvedValue(countObj)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryAccountCountBetweenCycles(5, 10)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Account count between cycles', countObj)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('queryAccountsBetweenCycles', () => {
    const sampleDbAccounts = [
      sampleDbAccount,
      { ...sampleDbAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    const sampleAccounts = [
      sampleAccount,
      { ...sampleAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    it('should return accounts between cycles with pagination', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)

      // Execute
      const result = await accounts.queryAccountsBetweenCycles(0, 10, 5, 10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(db.all).toHaveBeenCalledWith(
        accountDatabase,
        'SELECT * FROM accounts WHERE cycleNumber BETWEEN ? AND ? ORDER BY cycleNumber ASC, timestamp ASC LIMIT 10 OFFSET 0',
        [5, 10]
      )
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(2)
      expect(result).toEqual(sampleAccounts)
    })

    it('should return empty array when no accounts match', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])

      // Execute
      const result = await accounts.queryAccountsBetweenCycles(0, 10, 100, 200)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
    })

    it('should return empty array when skip or limit is invalid', async () => {
      // Execute
      const result = await accounts.queryAccountsBetweenCycles(NaN, 10, 5, 10)

      // Verify
      expect(db.all).not.toHaveBeenCalled()
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('queryAccountsBetweenCycles - Invalid skip or limit value')
      expect(result).toEqual([])
    })

    it('should return empty array when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)

      // Execute
      const result = await accounts.queryAccountsBetweenCycles(0, 10, 5, 10)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toEqual([])
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true

      // Execute
      await accounts.queryAccountsBetweenCycles(0, 10, 5, 10)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Account accounts between cycles',
        sampleAccounts.length,
        'skip',
        0
      )
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })

  describe('fetchAccountsBySqlQuery', () => {
    const sampleDbAccounts = [
      sampleDbAccount,
      { ...sampleDbAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    const sampleAccounts = [
      sampleAccount,
      { ...sampleAccount, accountId: 'test-account-2', hash: 'test-hash-2' },
    ]

    it('should return accounts matching custom SQL query', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)
      const customSql = 'SELECT * FROM accounts WHERE accountId LIKE ?'
      const params = ['test-%']

      // Execute
      const result = await accounts.fetchAccountsBySqlQuery(customSql, params)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(db.all).toHaveBeenCalledWith(accountDatabase, customSql, params)
      expect(DeSerializeFromJsonString).toHaveBeenCalledTimes(2)
      expect(result).toEqual(sampleAccounts)
    })

    it('should return empty array when no accounts match', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue([])
      const customSql = 'SELECT * FROM accounts WHERE accountId = ?'
      const params = ['non-existent']

      // Execute
      const result = await accounts.fetchAccountsBySqlQuery(customSql, params)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(result).toEqual([])
    })

    it('should return empty array when query fails', async () => {
      // Setup
      const error = new Error('DB error')
      jest.mocked(db.all).mockRejectedValue(error)
      const customSql = 'SELECT * FROM accounts WHERE accountId = ?'
      const params = ['test-account-1']

      // Execute
      const result = await accounts.fetchAccountsBySqlQuery(customSql, params)

      // Verify
      expect(db.all).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(error)
      expect(result).toEqual([])
    })

    it('should log debug message when VERBOSE is true', async () => {
      // Setup
      jest.mocked(db.all).mockResolvedValue(sampleDbAccounts)
      // @ts-ignore - Mocking config.VERBOSE as true
      config.VERBOSE = true
      const customSql = 'SELECT * FROM accounts WHERE accountId LIKE ?'
      const params = ['test-%']

      // Execute
      await accounts.fetchAccountsBySqlQuery(customSql, params)

      // Verify
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('fetchAccountsBySqlQuery', sampleAccounts.length)
      
      // Restore config
      // @ts-ignore - Restoring config.VERBOSE
      config.VERBOSE = false
    })
  })
}) 