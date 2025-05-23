import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { Database } from 'sqlite3'
import * as dbModule from '../../../../src/dbstore/sqlite3storage'
import * as Utils from '../../../../src/Utils'

// We need to mock these modules before importing the module under test
jest.mock('sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}))

jest.mock('../../../../src/dbstore/sqlite3storage', () => ({
  createDB: jest.fn(),
  runCreate: jest.fn(),
  close: jest.fn(),
}))

jest.mock('../../../../src/Utils', () => ({
  createDirectories: jest.fn(),
}))

// Import the module under test after mocking dependencies
import { initializeDB, closeDatabase, digesterDatabase } from '../../../../src/txDigester/index'

describe('Transaction Digest Database Initialization', () => {
  // Sample test data
  const mockConfig = {
    ARCHIVER_DB: 'test-archiver-db',
    ARCHIVER_DATA: {
      txDigestDB: 'test-txDigest.sqlite3',
    },
  }

  // Database mock
  const mockDatabase = {} as Database

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks()

    // Setup common mock implementations
    jest.mocked(dbModule.createDB).mockResolvedValue(mockDatabase)
    jest.mocked(dbModule.runCreate).mockResolvedValue(undefined)
    jest.mocked(dbModule.close).mockResolvedValue(undefined)
    jest.mocked(Utils.createDirectories).mockImplementation(() => {
      /* no-op */
    })
  })

  afterEach(() => {
    // Reset module state between tests to avoid cross-test contamination
    jest.resetModules()
  })

  describe('initializeDB', () => {
    it('should create necessary directories for the database', async () => {
      // Execute
      await initializeDB(mockConfig as any)

      // Verify directory creation
      expect(Utils.createDirectories).toHaveBeenCalledWith(mockConfig.ARCHIVER_DB)
    })

    it('should initialize the transaction digest database', async () => {
      // Execute
      await initializeDB(mockConfig as any)

      // Verify database creation
      expect(dbModule.createDB).toHaveBeenCalledWith(
        `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.txDigestDB}`,
        'TxDigestDB'
      )
    })

    it('should create the txDigests table if it does not exist', async () => {
      // Execute
      await initializeDB(mockConfig as any)

      // Verify table creation
      expect(dbModule.runCreate).toHaveBeenCalledWith(
        expect.anything(),
        'CREATE TABLE if not exists `txDigests` (`cycleStart` NUMBER NOT NULL UNIQUE, `cycleEnd` NUMBER NOT NULL UNIQUE, `txCount` NUMBER NOT NULL, `hash` TEXT NOT NULL, PRIMARY KEY (`cycleEnd`))'
      )
    })

    it('should set the digesterDatabase module variable', async () => {
      // Execute
      await initializeDB(mockConfig as any)

      // Verify module state
      expect(digesterDatabase).toBe(mockDatabase)
    })

    it('should handle directory creation failures', async () => {
      // Setup
      const mockError = new Error('Failed to create directory')
      jest.mocked(Utils.createDirectories).mockImplementation(() => {
        throw mockError
      })

      // Execute and verify
      await expect(initializeDB(mockConfig as any)).rejects.toThrow(mockError)
      expect(dbModule.createDB).not.toHaveBeenCalled()
    })

    it('should handle database creation failures', async () => {
      // Setup
      const mockError = new Error('Failed to create database')
      jest.mocked(dbModule.createDB).mockRejectedValue(mockError)

      // Execute and verify
      await expect(initializeDB(mockConfig as any)).rejects.toThrow(mockError)
      expect(dbModule.runCreate).not.toHaveBeenCalled()
    })

    it('should handle table creation failures', async () => {
      // Setup
      const mockError = new Error('Failed to create table')
      jest.mocked(dbModule.runCreate).mockRejectedValue(mockError)

      // Execute and verify
      await expect(initializeDB(mockConfig as any)).rejects.toThrow(mockError)
    })

    it('should handle calling initializeDB multiple times', async () => {
      // Execute first initialization
      await initializeDB(mockConfig as any)
      
      // Clear mocks to track second call
      jest.clearAllMocks()
      
      // Execute second initialization
      await initializeDB(mockConfig as any)
      
      // Verify all initialization steps are executed again
      expect(Utils.createDirectories).toHaveBeenCalledWith(mockConfig.ARCHIVER_DB)
      expect(dbModule.createDB).toHaveBeenCalledWith(
        `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.txDigestDB}`,
        'TxDigestDB'
      )
      expect(dbModule.runCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String)
      )
    })
  })

  describe('closeDatabase', () => {
    it('should close the database connection gracefully', async () => {
      // Setup - initialize first
      await initializeDB(mockConfig as any)
      
      // Execute
      await closeDatabase()

      // Verify database close was called with correct parameters
      expect(dbModule.close).toHaveBeenCalledWith(expect.anything(), 'TxDigesterDB')
    })

    it('should handle database close failures', async () => {
      // Setup
      await initializeDB(mockConfig as any)
      
      const mockError = new Error('Failed to close database')
      jest.mocked(dbModule.close).mockRejectedValue(mockError)

      // Execute and verify
      await expect(closeDatabase()).rejects.toThrow(mockError)
    })

    it('should handle calling closeDatabase before initialization', async () => {
      // Execute without initialization
      await expect(closeDatabase()).resolves.not.toThrow()
      
      // Verify close is still called even with undefined database
      expect(dbModule.close).toHaveBeenCalled()
    })

    it('should handle calling closeDatabase multiple times', async () => {
      // Setup - initialize first
      await initializeDB(mockConfig as any)
      
      // First close
      await closeDatabase()
      
      // Clear mocks to track second call
      jest.clearAllMocks()
      
      // Second close
      await closeDatabase()
      
      // Verify close is called again
      expect(dbModule.close).toHaveBeenCalled()
    })
  })
})
