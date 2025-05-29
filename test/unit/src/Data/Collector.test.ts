import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import * as Collector from '../../../../src/Data/Collector'
import * as Receipt from '../../../../src/dbstore/receipts'
import * as Account from '../../../../src/dbstore/accounts'
import * as Transaction from '../../../../src/dbstore/transactions'
import * as OriginalTxsData from '../../../../src/dbstore/originalTxsData'
import * as ProcessedTransaction from '../../../../src/dbstore/processedTxs'
import * as Crypto from '../../../../src/Crypto'
import * as State from '../../../../src/State'
import * as Logger from '../../../../src/Logger'
import * as cycles from '../../../../src/dbstore/cycles'
import { config } from '../../../../src/Config'
import { DataType } from '../../../../src/Data/GossipData'
import { P2P as P2PTypes } from '@shardeum-foundation/lib-types'

// Mock all the dependencies
jest.mock('../../../../src/dbstore/accounts')
jest.mock('../../../../src/dbstore/receipts')
jest.mock('../../../../src/dbstore/originalTxsData')
jest.mock('../../../../src/dbstore/processedTxs')
jest.mock('../../../../src/dbstore/transactions')
jest.mock('../../../../src/dbstore/cycles')
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/Data/Data')
jest.mock('../../../../src/Data/Cycles')
jest.mock('../../../../src/Logger')
jest.mock('../../../../src/State')
jest.mock('../../../../src/GlobalAccount')
jest.mock('../../../../src/Data/GossipData')
jest.mock('../../../../src/P2P')
jest.mock('../../../../src/profiler/nestedCounters')
jest.mock('../../../../src/profiler/profiler')
jest.mock('../../../../src/ShardFunctions')
jest.mock('../../../../src/shardeum/calculateAccountHash')
jest.mock('../../../../src/shardeum/verifyAppReceiptData')
jest.mock('../../../../src/services/transactionVerification')
jest.mock('../../../../src/types/ajv/Helpers')
jest.mock('../../../../src/Utils')
jest.mock('../../../../src/Data/DataLogWriter')

// Mock StringUtils
jest.mock('@shardeum-foundation/lib-types', () => ({
  P2P: {},
  Utils: {
    safeStringify: jest.fn((obj) => JSON.stringify(obj))
  }
}))

describe('Collector Module', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Setup default mock implementations
    ;(Logger.mainLogger as any) = {
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
      info: jest.fn()
    }
  })

  afterEach(() => {
    jest.resetModules()
  })

  describe('validateReceiptType', () => {
    it('should validate a valid receipt', async () => {
      const { verifyPayload } = await import('../../../../src/types/ajv/Helpers')
      ;(verifyPayload as any).mockReturnValueOnce(false) // Valid Receipt

      const mockReceipt = {
        receiptId: 'test-receipt',
        tx: { txId: 'test-tx', timestamp: 1000000 }
      } as any

      const result = Collector.validateReceiptType(mockReceipt)
      
      expect(result).toBe(true)
      expect(verifyPayload).toHaveBeenCalledWith('Receipt', mockReceipt)
    })

    it('should remove executionShardKey if present', async () => {
      const { verifyPayload } = await import('../../../../src/types/ajv/Helpers')
      ;(verifyPayload as any).mockReturnValueOnce(false)

      const receiptWithKey = { 
        executionShardKey: 'test-key',
        receiptId: 'test-receipt'
      } as any

      Collector.validateReceiptType(receiptWithKey)
      
      expect(receiptWithKey).not.toHaveProperty('executionShardKey')
    })
  })

  describe('verifyReceiptData', () => {
    it('should fail when cycle shard data not found', async () => {
      const { getCurrentCycleCounter, shardValuesByCycle } = await import('../../../../src/Data/Cycles')
      
      ;(getCurrentCycleCounter as any).mockReturnValue(1)
      ;(shardValuesByCycle as any).get = jest.fn().mockReturnValue(null)

      const mockReceipt = {
        cycle: 1,
        tx: { txId: 'test-tx', timestamp: 1000000 },
        globalModification: false
      } as any

      const result = await Collector.verifyReceiptData(mockReceipt)
      
      expect(result.success).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Cycle shard data not found')
    })

    it('should handle verification errors gracefully', async () => {
      const { getCurrentCycleCounter, shardValuesByCycle } = await import('../../../../src/Data/Cycles')
      
      ;(getCurrentCycleCounter as any).mockReturnValue(1)
      ;(shardValuesByCycle as any).get = jest.fn().mockImplementation(() => {
        throw new Error('Test error')
      })

      const mockReceipt = {
        cycle: 1,
        tx: { txId: 'test-tx', timestamp: 1000000 }
      } as any

      const result = await Collector.verifyReceiptData(mockReceipt)
      
      expect(result.success).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error in verifyReceiptData: Test error')
    })
  })

  describe('checkIfValidOverwrite', () => {
    it('should allow insert when no existing receipt', async () => {
      ;(Receipt.queryReceiptByReceiptId as any).mockResolvedValue(null)

      const result = await Collector.checkIfValidOverwrite({}, 'test-tx-id')
      
      expect(result).toBe(true)
    })

    it('should reject overwrite when existing receipt has status 1', async () => {
      const existingReceipt = {
        appReceiptData: {
          data: {
            readableReceipt: { status: 1 }
          }
        }
      }
      ;(Receipt.queryReceiptByReceiptId as any).mockResolvedValue(existingReceipt)

      const result = await Collector.checkIfValidOverwrite({}, 'test-tx-id')
      
      expect(result).toBe(false)
    })

    it('should allow overwrite when existing receipt has status 0', async () => {
      const existingReceipt = {
        appReceiptData: {
          data: {
            readableReceipt: { status: 0 }
          }
        }
      }
      ;(Receipt.queryReceiptByReceiptId as any).mockResolvedValue(existingReceipt)

      const result = await Collector.checkIfValidOverwrite({}, 'test-tx-id')
      
      expect(result).toBe(true)
    })

    it('should handle errors and return false', async () => {
      ;(Receipt.queryReceiptByReceiptId as any).mockRejectedValue(new Error('Database error'))

      const result = await Collector.checkIfValidOverwrite({}, 'test-tx-id')
      
      expect(result).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalled()
    })
  })

  describe('storeReceiptData', () => {
    it('should return early when receipts array is empty', async () => {
      await Collector.storeReceiptData([])
      
      expect(Receipt.bulkInsertReceipts).not.toHaveBeenCalled()
    })

    it('should return early when receipts is null', async () => {
      await Collector.storeReceiptData(null as any)
      
      expect(Receipt.bulkInsertReceipts).not.toHaveBeenCalled()
    })

    it('should skip invalid receipts', async () => {
      await Collector.storeReceiptData([null as any, undefined as any])
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('storeReceiptData : Invalid incoming receipt, Receipt is ', null)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('storeReceiptData : Invalid incoming receipt, Receipt is ', undefined)
    })
  })

  describe('storeCycleData', () => {
    it('should store new cycle data', async () => {
      const cycleData = {
        counter: 1,
        marker: 'test-marker'
      } as any

      ;(cycles.queryCycleByMarker as any).mockResolvedValue(null)
      ;(cycles.bulkInsertCycles as any).mockResolvedValue(undefined)

      await Collector.storeCycleData([cycleData])
      
      expect(cycles.bulkInsertCycles).toHaveBeenCalledWith([{
        counter: 1,
        cycleMarker: 'test-marker',
        cycleRecord: cycleData
      }])
    })

    it('should handle empty cycles array', async () => {
      await Collector.storeCycleData([])
      
      expect(cycles.bulkInsertCycles).not.toHaveBeenCalled()
    })
  })

  describe('storeAccountData', () => {
    it('should handle empty data', async () => {
      await Collector.storeAccountData({})
      
      expect(Account.bulkInsertAccounts).not.toHaveBeenCalled()
      expect(Transaction.bulkInsertTransactions).not.toHaveBeenCalled()
    })
  })

  describe('validateOriginalTxDataSchema', () => {
    it('should validate valid original tx data', async () => {
      const { verifyPayload } = await import('../../../../src/types/ajv/Helpers')
      
      const originalTxData = {
        txId: 'test-tx',
        timestamp: 1000000,
        cycle: 1,
        originalTxData: { tx: { data: 'test' } }
      }

      ;(verifyPayload as any).mockReturnValue(false) // No errors

      const result = Collector.validateOriginalTxDataSchema(originalTxData)
      
      expect(result).toBe(true)
    })
  })

  describe('validateGossipData', () => {
    it('should validate valid gossip data', async () => {
      const { validateTypes } = await import('../../../../src/Utils')
      
      const gossipData = {
        dataType: DataType.RECEIPT,
        data: [],
        sign: { owner: 'test-key', sig: 'test-sig' }
      }

      ;(validateTypes as any)
        .mockReturnValueOnce(null) // First call for main data
        .mockReturnValueOnce(null) // Second call for sign validation

      ;(State.activeArchivers as any) = [{ publicKey: 'test-key' }]
      ;(Crypto.verify as any).mockReturnValue(true)

      const result = Collector.validateGossipData(gossipData)
      
      expect(result.success).toBe(true)
    })

    it('should fail validation for non-active archiver', async () => {
      const { validateTypes } = await import('../../../../src/Utils')
      
      const gossipData = {
        dataType: DataType.RECEIPT,
        data: [],
        sign: { owner: 'unknown-key', sig: 'test-sig' }
      }

      ;(validateTypes as any)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
      ;(State.activeArchivers as any) = [{ publicKey: 'test-key' }]

      const result = Collector.validateGossipData(gossipData)
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('Data sender not the active archivers')
    })

    it('should fail validation for invalid signature', async () => {
      const { validateTypes } = await import('../../../../src/Utils')
      
      const gossipData = {
        dataType: DataType.RECEIPT,
        data: [],
        sign: { owner: 'test-key', sig: 'test-sig' }
      }

      ;(validateTypes as any)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
      ;(State.activeArchivers as any) = [{ publicKey: 'test-key' }]
      ;(Crypto.verify as any).mockReturnValue(false)

      const result = Collector.validateGossipData(gossipData)
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid signature')
    })
  })

  describe('processGossipData', () => {
    it('should process receipt gossip data', async () => {
      const gossipData = {
        dataType: DataType.RECEIPT,
        data: [{ txId: 'test-tx', timestamp: 1000000 }],
        sign: { owner: 'test-key' }
      } as any

      ;(State.activeArchivers as any) = [{ publicKey: 'test-key', ip: '127.0.0.1', port: 4000 }]

      // Should not throw
      expect(() => Collector.processGossipData(gossipData)).not.toThrow()
    })
  })

  describe('cleanOldReceiptsMap', () => {
    it('should clean old receipts from map', async () => {
      const { getCurrentCycleCounter } = await import('../../../../src/Data/Cycles')
      ;(getCurrentCycleCounter as any).mockReturnValue(1)

      // Just verify it doesn't throw
      expect(() => Collector.cleanOldReceiptsMap(1000000)).not.toThrow()
    })
  })

  describe('cleanOldOriginalTxsMap', () => {
    it('should clean old original txs from map', async () => {
      const { getCurrentCycleCounter } = await import('../../../../src/Data/Cycles')
      ;(getCurrentCycleCounter as any).mockReturnValue(1)

      // Just verify it doesn't throw
      expect(() => Collector.cleanOldOriginalTxsMap(1000000)).not.toThrow()
    })
  })

  describe('queryTxDataFromArchivers', () => {
    it('should return null when no data received', async () => {
      const { postJson } = await import('../../../../src/P2P')
      
      ;(State.getNodeInfo as any).mockReturnValue({ publicKey: 'my-key' })
      ;(Crypto.sign as any).mockReturnValue({ signed: 'data' })
      ;(postJson as any).mockResolvedValue(null)

      const result = await Collector.queryTxDataFromArchivers({} as any, DataType.RECEIPT, [])
      
      expect(result).toBeNull()
    })
  })

  describe('collectMissingReceipts', () => {
    it('should collect missing receipts from senders', async () => {
      const senders = ['sender1']
      const mockArchiver = { publicKey: 'sender1', ip: '127.0.0.1', port: 4000 }

      ;(State.activeArchivers as any) = [mockArchiver]
      ;(State.getNodeInfo as any).mockReturnValue({ publicKey: 'my-key' })
      ;(Crypto.sign as any).mockReturnValue({ signed: 'data' })

      const { postJson } = await import('../../../../src/P2P')
      ;(postJson as any).mockResolvedValue({ receipts: [] })

      await Collector.collectMissingReceipts(senders, 'test-tx', 1000000)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith(
        'Collecting missing receipt for txId test-tx with timestamp 1000000 from archivers',
        ['127.0.0.1:4000']
      )
    })

    it('should log error when failed to collect receipts', async () => {
      const senders = ['unknown-sender']
      ;(State.activeArchivers as any) = []

      await Collector.collectMissingReceipts(senders, 'test-tx', 1000000)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Failed to collect receipt for txId test-tx with timestamp 1000000 from archivers unknown-sender'
      )
    })
  })

  describe('scheduleMissingTxsDataQuery', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should schedule periodic collection of missing tx data', () => {
      const collectSpy = jest.spyOn(Collector, 'collectMissingTxDataFromArchivers').mockResolvedValue(undefined)

      Collector.scheduleMissingTxsDataQuery()
      
      // Fast forward 1 second
      jest.advanceTimersByTime(1000)
      
      expect(collectSpy).toHaveBeenCalled()
      
      // Fast forward another second
      jest.advanceTimersByTime(1000)
      
      expect(collectSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('storeOriginalTxData', () => {
    it('should return early when originalTxsData array is empty', async () => {
      await Collector.storeOriginalTxData([])
      
      expect(OriginalTxsData.bulkInsertOriginalTxsData).not.toHaveBeenCalled()
    })

    it('should return early when originalTxsData is null', async () => {
      await Collector.storeOriginalTxData(null as any)
      
      expect(OriginalTxsData.bulkInsertOriginalTxsData).not.toHaveBeenCalled()
    })
  })

  describe('collectMissingTxDataFromArchivers', () => {
    it('should handle empty missing receipts map', async () => {
      // Just verify it doesn't throw
      await expect(Collector.collectMissingTxDataFromArchivers()).resolves.not.toThrow()
    })
  })

  describe('Edge Cases', () => {
    it('should handle storeReceiptData with saveOnlyGossipData flag', async () => {
      const mockReceipt = {
        tx: { txId: 'test-tx', timestamp: 1000000 }
      } as any

      await Collector.storeReceiptData([mockReceipt], 'sender', false, true)
      
      expect(Receipt.bulkInsertReceipts).not.toHaveBeenCalled()
    })

    it('should handle storeOriginalTxData with saveOnlyGossipData flag', async () => {
      const originalTxData = {
        txId: 'test-tx',
        timestamp: 1000000
      } as any

      await Collector.storeOriginalTxData([originalTxData], 'sender', true)
      
      expect(OriginalTxsData.bulkInsertOriginalTxsData).not.toHaveBeenCalled()
    })

    it('should handle receipts with missing tx data', async () => {
      const invalidReceipt = {
        tx: {},
        globalModification: false,
        signedReceipt: { proposal: { txid: 'test' } }
      } as any

      await Collector.storeReceiptData([invalidReceipt])
      
      expect(Receipt.bulkInsertReceipts).not.toHaveBeenCalled()
    })

    it('should handle invalid dataType in validateGossipData', async () => {
      const { validateTypes } = await import('../../../../src/Utils')
      
      const gossipData = {
        dataType: 'INVALID_TYPE',
        data: [],
        sign: { owner: 'test-key', sig: 'test-sig' }
      } as any

      ;(validateTypes as any)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
      ;(State.activeArchivers as any) = [{ publicKey: 'test-key' }]

      const result = Collector.validateGossipData(gossipData)
      
      expect(result.success).toBe(false)
      expect(result.error).toBe('Invalid dataType')
    })
  })

  describe('validateCycleData', () => {
    it('should return false when cycle marker does not match', async () => {
      const { validateTypes } = await import('../../../../src/Utils')
      const { computeCycleMarker } = await import('../../../../src/Data/Cycles')
      
      ;(validateTypes as any).mockReturnValue(null)
      ;(computeCycleMarker as any).mockReturnValue('different-marker')

      const result = Collector.validateCycleData({ marker: 'test-marker' } as any)
      
      expect(result).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid Cycle Record: cycle marker does not match with the computed marker')
    })
  })
})