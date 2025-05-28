import { expect, describe, it, jest } from '@jest/globals'
import * as Crypto from '../../../src/Crypto'
import * as AccountDB from '../../../src/dbstore/accounts'
import * as State from '../../../src/State'
import * as Utils from '../../../src/Utils'
import * as calculateAccountHash from '../../../src/shardeum/calculateAccountHash'
import { allowedArchiversManager } from '../../../src/shardeum/allowedArchiversManager'

// Mock dependencies before importing the module under test
jest.mock('rfdc', () => jest.fn(() => jest.fn((obj) => JSON.parse(JSON.stringify(obj)))))

jest.mock('../../../src/Crypto', () => ({
  hashObj: jest.fn(),
  sign: jest.fn(),
}))

jest.mock('../../../src/State', () => ({
  otherArchivers: [],
}))

jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../src/dbstore/accounts', () => ({
  AccountsCopy: jest.fn(),
  updateAccount: jest.fn(),
  fetchAccountsBySqlQuery: jest.fn(),
  queryAccountByAccountId: jest.fn(),
}))

jest.mock('../../../src/Config', () => ({
  config: {
    globalNetworkAccount: 'global-network-account-id',
    configChangeMaxChangesToKeep: 5,
    configChangeMaxCyclesToKeep: 10,
  },
}))

jest.mock('../../../src/P2P', () => ({
  postJson: jest.fn(),
  getJson: jest.fn(),
}))

jest.mock('../../../src/Utils', () => ({
  robustQuery: jest.fn(),
  deepCopy: jest.fn((obj) => JSON.parse(JSON.stringify(obj))),
}))

jest.mock('../../../src/shardeum/calculateAccountHash', () => ({
  accountSpecificHash: jest.fn(),
}))

jest.mock('../../../src/shardeum/allowedArchiversManager', () => ({
  allowedArchiversManager: {
    setGlobalAccountConfig: jest.fn(),
  },
}))

jest.mock('util', () => ({
  isDeepStrictEqual: jest.fn().mockReturnValue(true),
}))

// Test the public API of GlobalAccount
describe('GlobalAccount Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  // Test the getGlobalNetworkAccount and setGlobalNetworkAccount functions together
  describe('getGlobalNetworkAccount and setGlobalNetworkAccount', () => {
    it('should set and get the global network account correctly', () => {
      jest.isolateModules(() => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Create a test account
        const testAccount = {
          accountId: 'global-network-account-id',
          data: {
            listOfChanges: [
              {
                cycle: 1,
                change: {
                  debug: {
                    multisigKeys: { key1: 1 },
                    minSigRequiredForArchiverWhitelist: 1,
                  },
                },
              },
            ],
          },
          hash: 'test-hash',
          timestamp: 1234567890,
        }

        // Set the account
        GlobalAccount.setGlobalNetworkAccount(testAccount)

        // Get the account and verify it's the same one we set
        const retrievedAccount = GlobalAccount.getGlobalNetworkAccount(false)
        const retrievedHash = GlobalAccount.getGlobalNetworkAccount(true)

        // Assert the account was set correctly
        expect(retrievedAccount).toEqual(testAccount)
        expect(retrievedHash).toBe('test-hash')

        // Verify allowedArchiversManager was updated
        expect(allowedArchiversManager.setGlobalAccountConfig).toHaveBeenCalledWith({ key1: 1 }, 1)
      })
    })

    it('should return undefined when no account is set', () => {
      jest.isolateModules(() => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Get the account without setting it first
        const retrievedAccount = GlobalAccount.getGlobalNetworkAccount(false)
        const retrievedHash = GlobalAccount.getGlobalNetworkAccount(true)

        // Assert the default return values - based on actual behavior
        expect(retrievedAccount).toBeUndefined()
        expect(retrievedHash).toBeUndefined()
      })
    })
  })

  // Test updateGlobalNetworkAccount
  describe('updateGlobalNetworkAccount', () => {
    it('should not update account if cachedGlobalNetworkAccountHash is not set', async () => {
      jest.isolateModules(async () => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Call updateGlobalNetworkAccount without setting a global account first
        await GlobalAccount.updateGlobalNetworkAccount(1)

        // Verify that updateAccount was not called
        expect(AccountDB.updateAccount).not.toHaveBeenCalled()
      })
    })
  })

  // Test loadGlobalAccounts
  describe('loadGlobalAccounts', () => {
    it('should load global accounts and update the map', async () => {
      jest.isolateModules(async () => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Mock the database response
        const mockAccounts = [
          { accountId: 'account1', data: {}, hash: 'hash1', timestamp: 100, isGlobal: true },
          { accountId: 'global-network-account-id', data: {}, hash: 'hash2', timestamp: 200, isGlobal: true },
        ]
        jest.mocked(AccountDB.fetchAccountsBySqlQuery).mockResolvedValue(mockAccounts)

        // Call loadGlobalAccounts
        await GlobalAccount.loadGlobalAccounts()

        // Verify that the accounts were loaded correctly
        expect(GlobalAccount.globalAccountsMap.size).toBe(2)
        expect(GlobalAccount.globalAccountsMap.get('account1')).toEqual({ hash: 'hash1', timestamp: 100 })
        expect(GlobalAccount.globalAccountsMap.get('global-network-account-id')).toEqual({
          hash: 'hash2',
          timestamp: 200,
        })

        // Verify that the global network account was set
        expect(GlobalAccount.getGlobalNetworkAccount(true)).toBe('hash2')
      })
    })

    it('should handle empty results from the database', async () => {
      jest.isolateModules(async () => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Mock an empty database response
        jest.mocked(AccountDB.fetchAccountsBySqlQuery).mockResolvedValue([])

        // Call loadGlobalAccounts
        await GlobalAccount.loadGlobalAccounts()

        // Verify that no accounts were loaded
        expect(GlobalAccount.globalAccountsMap.size).toBe(0)

        // Verify default values are returned
        expect(GlobalAccount.getGlobalNetworkAccount(true)).toBeUndefined()
        expect(GlobalAccount.getGlobalNetworkAccount(false)).toBeUndefined()
      })
    })
  })

  // Test syncGlobalAccount
  describe('syncGlobalAccount', () => {
    it('should sync accounts from other archivers', async () => {
      jest.isolateModules(async () => {
        // Import inside isolateModules to get a fresh copy of the module
        const GlobalAccount = require('../../../src/GlobalAccount')

        // Setup test data
        const mockResponse = {
          value: {
            accounts: [
              { id: 'account1', hash: 'hash1', timestamp: 100 },
              { id: 'global-network-account-id', hash: 'hash-new', timestamp: 300 },
            ],
          },
          count: 1,
          nodes: [{ ip: '127.0.0.1', port: 8080 }],
        }

        // Setup State.otherArchivers
        Object.defineProperty(State, 'otherArchivers', {
          value: [{ ip: '127.0.0.1', port: 8080 }],
          writable: true,
        })

        // Mock robustQuery to return mockResponse
        jest.mocked(Utils.robustQuery).mockResolvedValue(mockResponse)

        // Mock queryAccountByAccountId
        const mockAccount = {
          accountId: 'global-network-account-id',
          data: {},
          hash: 'hash-new',
          timestamp: 300,
          isGlobal: true,
        }
        jest.mocked(AccountDB.queryAccountByAccountId).mockResolvedValue(mockAccount)

        // Call syncGlobalAccount
        await GlobalAccount.syncGlobalAccount()

        // Verify that the accounts were synced correctly
        expect(GlobalAccount.globalAccountsMap.size).toBe(2)
        expect(GlobalAccount.globalAccountsMap.get('global-network-account-id')).toEqual({
          hash: 'hash-new',
          timestamp: 300,
        })

        // Verify that robustQuery was called
        expect(Utils.robustQuery).toHaveBeenCalled()
      })
    })
  })
})
