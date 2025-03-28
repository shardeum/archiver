import { Database } from 'sqlite3'
import { Config } from '../../../../src/Config'
import * as sqlite3storage from '../../../../src/dbstore/sqlite3storage'
import * as Utils from '../../../../src/Utils'
import {
  initializeDB,
  closeDatabase,
  accountDatabase,
  cycleDatabase,
  transactionDatabase,
  receiptDatabase,
  originalTxDataDatabase,
  processedTxDatabase,
  checkpointStatusDatabase,
} from '../../../../src/dbstore/index'
import * as dbStore from '../../../../src/dbstore/index'

// Mock dependencies
jest.mock('../../../../src/Utils', () => ({
  createDirectories: jest.fn(),
}))

jest.mock('../../../../src/dbstore/sqlite3storage', () => ({
  createDB: jest.fn().mockResolvedValue({} as Database),
  runCreate: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
}))

// Cast mocks to Jest Mock types for type safety
const mockCreateDirectories = Utils.createDirectories as jest.Mock
const mockCreateDB = sqlite3storage.createDB as jest.Mock
const mockRunCreate = sqlite3storage.runCreate as jest.Mock
const mockClose = sqlite3storage.close as jest.Mock

describe('dbstore/index', () => {
  const mockConfig: Config = {
    ARCHIVER_DB: '/path/to/db',
    ARCHIVER_DATA: {
      accountDB: 'accounts.db',
      cycleDB: 'cycles.db',
      transactionDB: 'transactions.db',
      receiptDB: 'receipts.db',
      originalTxDataDB: 'originalTxs.db',
      processedTxDB: 'processedTxs.db',
      checkpointStatusDB: 'checkpointStatus.db',
    },
  } as Config

  // Hold mock DB instances
  let mockAccountDb: Database
  let mockCycleDb: Database
  let mockTransactionDb: Database
  let mockReceiptDb: Database
  let mockOriginalTxDataDb: Database
  let mockProcessedTxDb: Database
  let mockCheckpointStatusDb: Database

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks()

    // Reset exported variables (important for error tests)
    // Use 'any' to bypass readonly checks for testing purposes
    ;(dbStore as any).accountDatabase = undefined
    ;(dbStore as any).cycleDatabase = undefined
    ;(dbStore as any).transactionDatabase = undefined
    ;(dbStore as any).receiptDatabase = undefined
    ;(dbStore as any).originalTxDataDatabase = undefined
    ;(dbStore as any).processedTxDatabase = undefined
    ;(dbStore as any).checkpointStatusDatabase = undefined

    // Setup mock DB instances for each test run
    mockAccountDb = { name: 'mockAccountDb' } as unknown as Database
    mockCycleDb = { name: 'mockCycleDb' } as unknown as Database
    mockTransactionDb = { name: 'mockTransactionDb' } as unknown as Database
    mockReceiptDb = { name: 'mockReceiptDb' } as unknown as Database
    mockOriginalTxDataDb = { name: 'mockOriginalTxDataDb' } as unknown as Database
    mockProcessedTxDb = { name: 'mockProcessedTxDb' } as unknown as Database
    mockCheckpointStatusDb = { name: 'mockCheckpointStatusDb' } as unknown as Database

    // Configure createDB mock to return specific instances by default
    mockCreateDB
      .mockResolvedValueOnce(mockAccountDb)
      .mockResolvedValueOnce(mockCycleDb)
      .mockResolvedValueOnce(mockTransactionDb)
      .mockResolvedValueOnce(mockReceiptDb)
      .mockResolvedValueOnce(mockOriginalTxDataDb)
      .mockResolvedValueOnce(mockProcessedTxDb)
      .mockResolvedValueOnce(mockCheckpointStatusDb)

    // Default successful mocks for others
    mockCreateDirectories.mockReturnValue(undefined)
    mockRunCreate.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
  })

  describe('initializeDB', () => {
    // --- Success Case ---
    describe('when successful', () => {
      beforeEach(async () => {
        await initializeDB(mockConfig)
      })

      it('should create directories', () => {
        expect(mockCreateDirectories).toHaveBeenCalledTimes(1)
        expect(mockCreateDirectories).toHaveBeenCalledWith(mockConfig.ARCHIVER_DB)
      })

      it('should create all databases with correct paths and names', () => {
        expect(mockCreateDB).toHaveBeenCalledTimes(7)
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          1,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.accountDB}`,
          'Account'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          2,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.cycleDB}`,
          'Cycle'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          3,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.transactionDB}`,
          'Transaction'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          4,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.receiptDB}`,
          'Receipt'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          5,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.originalTxDataDB}`,
          'OriginalTxData'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          6,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.processedTxDB}`,
          'ProcessedTransaction'
        )
        expect(mockCreateDB).toHaveBeenNthCalledWith(
          7,
          `${mockConfig.ARCHIVER_DB}/${mockConfig.ARCHIVER_DATA.checkpointStatusDB}`,
          'CheckpointStatus'
        )

        expect(accountDatabase).toBe(mockAccountDb)
        expect(cycleDatabase).toBe(mockCycleDb)
        expect(transactionDatabase).toBe(mockTransactionDb)
        expect(receiptDatabase).toBe(mockReceiptDb)
        expect(originalTxDataDatabase).toBe(mockOriginalTxDataDb)
        expect(processedTxDatabase).toBe(mockProcessedTxDb)
        expect(checkpointStatusDatabase).toBe(mockCheckpointStatusDb)
      })

      it('should run create table and index statements for all databases', () => {
        expect(mockRunCreate).toHaveBeenCalledTimes(24)

        // Spot check table and index creation calls
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockTransactionDb,
          expect.stringContaining('CREATE TABLE if not exists `transactions`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockTransactionDb,
          expect.stringContaining('CREATE INDEX if not exists `transactions_timestamp`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockCycleDb,
          expect.stringContaining('CREATE TABLE if not exists `cycles`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockCycleDb,
          expect.stringContaining('CREATE INDEX if not exists `cycles_idx`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockAccountDb,
          expect.stringContaining('CREATE TABLE if not exists `accounts`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockAccountDb,
          expect.stringContaining('CREATE INDEX if not exists `accounts_cycleNumber`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockReceiptDb,
          expect.stringContaining('CREATE TABLE if not exists `receipts`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockReceiptDb,
          expect.stringContaining('CREATE INDEX if not exists `receipts_cycle`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockOriginalTxDataDb,
          expect.stringContaining('CREATE TABLE if not exists `originalTxsData`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockOriginalTxDataDb,
          expect.stringContaining('CREATE INDEX if not exists `originalTxsData_cycle`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockProcessedTxDb,
          expect.stringContaining('CREATE TABLE if not exists `processedTxs`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockProcessedTxDb,
          expect.stringContaining('CREATE INDEX if not exists `processedTxs_cycle_idx`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockCheckpointStatusDb,
          expect.stringContaining('CREATE TABLE if not exists `checkpoint_status`')
        )
        expect(mockRunCreate).toHaveBeenCalledWith(
          mockCheckpointStatusDb,
          expect.stringContaining('CREATE INDEX if not exists `checkpoint_status_unified_status`')
        )
      })
    })

    // --- Failure Cases ---
    it('should reject if createDirectories fails', async () => {
      const errorMessage = 'Failed to create directory'
      mockCreateDirectories.mockImplementationOnce(() => {
        throw new Error(errorMessage)
      })

      await expect(initializeDB(mockConfig)).rejects.toThrow(errorMessage)
      expect(mockCreateDB).not.toHaveBeenCalled()
      expect(mockRunCreate).not.toHaveBeenCalled()
    })

    it('should reject if createDB fails for the first database', async () => {
      const errorMessage = 'Failed to create account DB'
      mockCreateDB.mockReset()
      mockCreateDB.mockRejectedValueOnce(new Error(errorMessage))

      await expect(initializeDB(mockConfig)).rejects.toThrow(errorMessage)
      expect(mockCreateDirectories).toHaveBeenCalledTimes(1)
      expect(mockCreateDB).toHaveBeenCalledTimes(1)
      expect(mockRunCreate).not.toHaveBeenCalled()
      expect(accountDatabase).toBeUndefined()
      expect(cycleDatabase).toBeUndefined()
    })

    it('should reject if createDB fails for a later database', async () => {
      const errorMessage = 'Failed to create transaction DB'
      mockCreateDB
        .mockReset()
        .mockResolvedValueOnce(mockAccountDb)
        .mockResolvedValueOnce(mockCycleDb)
        .mockRejectedValueOnce(new Error(errorMessage))

      await expect(initializeDB(mockConfig)).rejects.toThrow(errorMessage)
      expect(mockCreateDirectories).toHaveBeenCalledTimes(1)
      expect(mockCreateDB).toHaveBeenCalledTimes(3)
      expect(mockRunCreate).not.toHaveBeenCalled()
      expect(accountDatabase).toBe(mockAccountDb)
      expect(cycleDatabase).toBe(mockCycleDb)
      expect(transactionDatabase).toBeUndefined()
      expect(receiptDatabase).toBeUndefined()
    })

    it('should reject if runCreate fails for the first statement', async () => {
      const error = new Error('Failed to create transactions table')
      mockRunCreate.mockReset()
      mockRunCreate.mockRejectedValueOnce(error)

      await expect(initializeDB(mockConfig)).rejects.toThrow(error)
      expect(mockCreateDirectories).toHaveBeenCalledTimes(1)
      expect(mockCreateDB).toHaveBeenCalledTimes(7)
      expect(mockRunCreate).toHaveBeenCalledTimes(1)
      expect(accountDatabase).toBeDefined()
      expect(transactionDatabase).toBeDefined()
    })

    it('should reject if runCreate fails for a later statement', async () => {
      const error = new Error('Failed to create cycles index')
      mockRunCreate.mockReset()
      mockRunCreate
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(error)

      await expect(initializeDB(mockConfig)).rejects.toThrow(error)
      expect(mockCreateDirectories).toHaveBeenCalledTimes(1)
      expect(mockCreateDB).toHaveBeenCalledTimes(7)
      expect(mockRunCreate).toHaveBeenCalledTimes(6)
    })
  })

  describe('closeDatabase', () => {
    describe('when databases are initialized', () => {
      beforeEach(async () => {
        await initializeDB(mockConfig)
      })

      it('should close all initialized databases', async () => {
        await closeDatabase()

        expect(mockClose).toHaveBeenCalledTimes(7)
        expect(mockClose).toHaveBeenCalledWith(mockAccountDb, 'Account')
        expect(mockClose).toHaveBeenCalledWith(mockTransactionDb, 'Transaction')
        expect(mockClose).toHaveBeenCalledWith(mockCycleDb, 'Cycle')
        expect(mockClose).toHaveBeenCalledWith(mockReceiptDb, 'Receipt')
        expect(mockClose).toHaveBeenCalledWith(mockOriginalTxDataDb, 'OriginalTxData')
        expect(mockClose).toHaveBeenCalledWith(mockProcessedTxDb, 'ProcessedTransaction')
        expect(mockClose).toHaveBeenCalledWith(mockCheckpointStatusDb, 'CheckpointStatus')
      })

      it('should handle potential errors during close and reject', async () => {
        const error = new Error('Failed to close account DB')
        mockClose.mockReset().mockRejectedValueOnce(error).mockResolvedValue(undefined)

        await expect(closeDatabase()).rejects.toThrow(error)
        expect(mockClose).toHaveBeenCalledTimes(7)
      })
    })

    it('should not attempt to close undefined database variables', async () => {
      ;(dbStore as any).accountDatabase = mockAccountDb
      ;(dbStore as any).cycleDatabase = undefined
      ;(dbStore as any).transactionDatabase = mockTransactionDb
      ;(dbStore as any).receiptDatabase = undefined
      ;(dbStore as any).originalTxDataDatabase = mockOriginalTxDataDb
      ;(dbStore as any).processedTxDatabase = undefined
      ;(dbStore as any).checkpointStatusDatabase = mockCheckpointStatusDb

      await closeDatabase()

      expect(mockClose).toHaveBeenCalledTimes(7)
      expect(mockClose).toHaveBeenCalledWith(mockAccountDb, 'Account')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Cycle')
      expect(mockClose).toHaveBeenCalledWith(mockTransactionDb, 'Transaction')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Receipt')
      expect(mockClose).toHaveBeenCalledWith(mockOriginalTxDataDb, 'OriginalTxData')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'ProcessedTransaction')
      expect(mockClose).toHaveBeenCalledWith(mockCheckpointStatusDb, 'CheckpointStatus')
    })

    it('should resolve successfully even if all database variables are undefined', async () => {
      await expect(closeDatabase()).resolves.toBeUndefined()
      expect(mockClose).toHaveBeenCalledTimes(7)
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Account')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Transaction')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Cycle')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'Receipt')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'OriginalTxData')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'ProcessedTransaction')
      expect(mockClose).toHaveBeenCalledWith(undefined, 'CheckpointStatus')
    })
  })
})
