import { compressReceiptSignatures, decompressReceiptSignatures, clearNodeCache } from '../receiptTransformer'
import { ArchiverReceipt, SignedReceipt } from '../../dbstore/receipts'
import { config } from '../../Config'
import * as db from '../../dbstore/sqlite3storage'
import { receiptDatabase } from '../../dbstore'

// Mock dependencies
jest.mock('../../dbstore/sqlite3storage')
jest.mock('../../Logger', () => ({
  mainLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

// Mock database responses
const mockDbGet = db.get as jest.MockedFunction<typeof db.get>
const mockDbRun = db.run as jest.MockedFunction<typeof db.run>
const mockDbAll = db.all as jest.MockedFunction<typeof db.all>

describe('receiptTransformer', () => {
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()
    clearNodeCache()
    
    // Enable optimization by default
    config.receiptSignatureOptimization = {
      enabled: true,
      cacheSize: 10000,
      batchSize: 100,
    }
  })

  afterEach(() => {
    clearNodeCache()
  })

  describe('compressReceiptSignatures', () => {
    it('should return receipt unchanged when optimization is disabled', async () => {
      config.receiptSignatureOptimization.enabled = false
      
      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { owner: 'publicKey1', sig: 'signature1' },
            { owner: 'publicKey2', sig: 'signature2' },
          ],
          voteOffsets: [7, 7],
        } as SignedReceipt,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await compressReceiptSignatures(receipt)
      expect(result).toEqual(receipt)
    })

    it('should compress signatures when optimization is enabled', async () => {
      // Mock database responses
      mockDbGet.mockResolvedValueOnce(null) // No existing node for publicKey1
      mockDbRun.mockResolvedValueOnce(undefined) // Insert successful
      mockDbGet.mockResolvedValueOnce({ node_id: 1 }) // Return new node_id for publicKey1
      
      mockDbGet.mockResolvedValueOnce(null) // No existing node for publicKey2
      mockDbRun.mockResolvedValueOnce(undefined) // Insert successful
      mockDbGet.mockResolvedValueOnce({ node_id: 2 }) // Return new node_id for publicKey2

      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { owner: 'publicKey1', sig: 'signature1' },
            { owner: 'publicKey2', sig: 'signature2' },
          ],
          voteOffsets: [7, 7],
        } as SignedReceipt,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await compressReceiptSignatures(receipt)
      
      expect(result.signedReceipt).toHaveProperty('_compressed', true)
      expect((result.signedReceipt as any).signaturePack).toEqual([
        { id: 1, sig: 'signature1' },
        { id: 2, sig: 'signature2' },
      ])
    })

    it('should skip compression if receipt already compressed', async () => {
      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { id: 1, sig: 'signature1' },
            { id: 2, sig: 'signature2' },
          ] as any,
          voteOffsets: [7, 7],
          _compressed: true,
        } as any,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await compressReceiptSignatures(receipt)
      expect(result).toEqual(receipt)
      expect(mockDbGet).not.toHaveBeenCalled()
    })

    it('should handle batch compression efficiently', async () => {
      // Mock batch database response
      mockDbAll.mockResolvedValueOnce([
        { node_id: 1, public_key: 'publicKey1' },
      ])
      mockDbRun.mockResolvedValueOnce(undefined) // Batch insert
      mockDbAll.mockResolvedValueOnce([
        { node_id: 2, public_key: 'publicKey2' },
      ])

      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { owner: 'publicKey1', sig: 'signature1' },
            { owner: 'publicKey2', sig: 'signature2' },
          ],
          voteOffsets: [7, 7],
        } as SignedReceipt,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await compressReceiptSignatures(receipt)
      
      expect(result.signedReceipt).toHaveProperty('_compressed', true)
      expect((result.signedReceipt as any).signaturePack).toHaveLength(2)
    })
  })

  describe('decompressReceiptSignatures', () => {
    it('should return receipt unchanged when optimization is disabled', async () => {
      config.receiptSignatureOptimization.enabled = false
      
      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { id: 1, sig: 'signature1' },
            { id: 2, sig: 'signature2' },
          ] as any,
          voteOffsets: [7, 7],
          _compressed: true,
        } as any,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await decompressReceiptSignatures(receipt)
      expect(result).toEqual(receipt)
    })

    it('should decompress signatures when optimization is enabled', async () => {
      // Mock database response
      mockDbAll.mockResolvedValueOnce([
        { node_id: 1, public_key: 'publicKey1' },
        { node_id: 2, public_key: 'publicKey2' },
      ])

      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { id: 1, sig: 'signature1' },
            { id: 2, sig: 'signature2' },
          ] as any,
          voteOffsets: [7, 7],
          _compressed: true,
        } as any,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await decompressReceiptSignatures(receipt)
      
      expect(result.signedReceipt).not.toHaveProperty('_compressed')
      expect((result.signedReceipt as SignedReceipt).signaturePack).toEqual([
        { owner: 'publicKey1', sig: 'signature1' },
        { owner: 'publicKey2', sig: 'signature2' },
      ])
    })

    it('should skip decompression if receipt not compressed', async () => {
      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { owner: 'publicKey1', sig: 'signature1' },
            { owner: 'publicKey2', sig: 'signature2' },
          ],
          voteOffsets: [7, 7],
        } as SignedReceipt,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      const result = await decompressReceiptSignatures(receipt)
      expect(result).toEqual(receipt)
      expect(mockDbAll).not.toHaveBeenCalled()
    })
  })

  describe('cache behavior', () => {
    it('should use cache for repeated operations', async () => {
      // First compression - should hit database
      mockDbGet.mockResolvedValueOnce({ node_id: 1 })

      const receipt: ArchiverReceipt = {
        tx: { originalTxData: {}, txId: 'test', timestamp: 123 },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: 'hash',
            txid: 'test',
          },
          proposalHash: 'hash',
          signaturePack: [
            { owner: 'publicKey1', sig: 'signature1' },
          ],
          voteOffsets: [7],
        } as SignedReceipt,
        globalModification: false,
        appReceiptData: { data: {} },
      }

      // First call - should query database
      await compressReceiptSignatures(receipt)
      expect(mockDbGet).toHaveBeenCalledTimes(1)

      // Clear mock calls
      mockDbGet.mockClear()

      // Second call - should use cache
      await compressReceiptSignatures(receipt)
      expect(mockDbGet).not.toHaveBeenCalled()
    })
  })
})