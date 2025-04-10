import { jest, describe, it, expect, beforeEach } from '@jest/globals'
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
import { initializeDB, closeDatabase } from '../../../../src/txDigester/index'

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
  })

  describe('closeDatabase', () => {
    it('should close the database connection gracefully', async () => {
      // Execute
      await closeDatabase()

      // Verify database close was called with correct parameters
      expect(dbModule.close).toHaveBeenCalledWith(expect.anything(), 'TxDigesterDB')
    })
  })
})
