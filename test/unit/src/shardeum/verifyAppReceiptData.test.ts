import * as crypto from '../../../../src/Crypto'
import { verifyAppReceiptData, ShardeumReceipt } from '../../../../src/shardeum/verifyAppReceiptData'
import { verifyPayload } from '../../../../src/types/ajv/Helpers'
import { AJVSchemaEnum } from '../../../../src/types/enum/AJVSchemaEnum'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { ArchiverReceipt, Receipt, SignedReceipt } from '../../../../src/dbstore/receipts'

// Mock dependencies
jest.mock('../../../../src/Crypto', () => ({
  hashObj: jest.fn()
}))

// Mock with correct return type for verifyPayload
jest.mock('../../../../src/types/ajv/Helpers', () => ({
  verifyPayload: jest.fn().mockImplementation(() => null) // Return null for no errors by default
}))

jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeStringify: jest.fn((obj) => JSON.stringify(obj))
  }
}))

// Create properly typed arrays for the test parameters
// These need to be defined at the top level for proper scoping
const createFailedReasons = (): any[] => []
const createNestedMessages = (): any[] => []

describe('verifyAppReceiptData', () => {
  // Common test variables
  let receipt: Partial<ArchiverReceipt>
  let existingReceipt: Partial<Receipt> | null
  let failedReasons: any[]
  let nestedCounterMessages: any[]

  // Mock implementation setup
  const mockVerifyPayload = verifyPayload as jest.Mock
  const mockHashObj = jest.fn().mockReturnValue('calculated-hash')

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()
    
    // Setup crypto mock
    jest.spyOn(crypto, 'hashObj').mockImplementation(mockHashObj)
    
    // Setup default receipt
    receipt = {
      tx: {
        txId: 'test-tx-id',
        timestamp: 123456789,
        originalTxData: {}
      },
      cycle: 1,
      signedReceipt: {
        proposal: {
          accountIDs: [],
          beforeStateHashes: [],
          afterStateHashes: [],
          appReceiptDataHash: 'calculated-hash',
          applied: false,
          cant_preApply: false,
          txid: 'test-tx-id'
        },
        proposalHash: 'hash',
        signaturePack: [],
        voteOffsets: []
      },
      appReceiptData: {
        data: {
          amountSpent: '0x0',
          readableReceipt: {
            status: 0
          },
          receipt: {
            logs: []
          }
        } as ShardeumReceipt
      },
      globalModification: false
    }
    
    // Reset test tracking arrays
    failedReasons = []
    nestedCounterMessages = []
    existingReceipt = null
  })

  describe('schema validation', () => {
    it('should return valid and needToSave if schema validation passes', async () => {
      mockVerifyPayload.mockReturnValue(false)
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
      expect(mockVerifyPayload).toHaveBeenCalledWith(AJVSchemaEnum.GlobalTxReceipt, receipt.signedReceipt)
    })

    it('should handle and return invalid when schema validation throws an error', async () => {
      mockVerifyPayload.mockImplementation(() => {
        throw new Error('Schema validation error')
      })
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: false, needToSave: false })
      expect(failedReasons.length).toBeGreaterThan(0)
      expect(failedReasons[0]).toContain('Invalid Global Tx Receipt error')
      expect(nestedCounterMessages.length).toBeGreaterThan(0)
    })
  })

  describe('appReceiptData validation', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should return invalid when amountSpent is missing', async () => {
      receipt.appReceiptData = {
        data: {
          readableReceipt: { status: 0 }
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: false, needToSave: false })
      expect(failedReasons[0]).toContain('appReceiptData missing amountSpent or readableReceipt')
    })

    it('should return invalid when readableReceipt is missing', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0'
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: false, needToSave: false })
      expect(failedReasons[0]).toContain('appReceiptData missing amountSpent or readableReceipt')
    })
  })

  describe('state hash validation', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should validate when receipt has 0 amountSpent, status 0 and matching state hashes', async () => {
      (receipt.signedReceipt as SignedReceipt).proposal = {
        accountIDs: ['account1'],
        beforeStateHashes: ['hash1'],
        afterStateHashes: ['hash1'],
        appReceiptDataHash: 'calculated-hash',
        applied: false,
        cant_preApply: false,
        txid: 'test-tx-id'
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should detect missing state hashes', async () => {
      (receipt.signedReceipt as SignedReceipt).proposal = {
        accountIDs: ['account1'],
        beforeStateHashes: [], // Missing hash
        afterStateHashes: ['hash1'],
        appReceiptDataHash: 'calculated-hash',
        applied: false,
        cant_preApply: false,
        txid: 'test-tx-id'
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
      expect(failedReasons.some(reason => reason.includes('hash before or after is missing'))).toBe(true)
    })

    it('should detect mismatched state hashes', async () => {
      (receipt.signedReceipt as SignedReceipt).proposal = {
        accountIDs: ['account1'],
        beforeStateHashes: ['hash1'],
        afterStateHashes: ['hash2'], // Different hash
        appReceiptDataHash: 'calculated-hash',
        applied: false,
        cant_preApply: false,
        txid: 'test-tx-id'
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
      expect(failedReasons.some(reason => reason.includes('has state updated accounts'))).toBe(true)
    })
  })

  describe('existing receipt comparison', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
      
      // Setup default existing receipt
      existingReceipt = {
        tx: {
          txId: 'existing-tx',
          timestamp: 123456000,
          originalTxData: {}
        },
        appReceiptData: {
          data: {
            amountSpent: '0x0',
            readableReceipt: {
              status: 0
            }
          } as ShardeumReceipt
        },
        receiptId: 'receipt-id',
        timestamp: 123456000,
        applyTimestamp: 123456000,
        cycle: 0,
        signedReceipt: {
          proposal: {
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: '',
            applied: false,
            cant_preApply: false,
            txid: ''
          },
          proposalHash: '',
          signaturePack: [],
          voteOffsets: []
        },
        globalModification: false
      }
    })

    it('should set needToSave=true when existing receipt status=0, amountSpent=0 and new receipt status=1', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (existingReceipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x0';
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 1;
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should set needToSave=false when existing receipt status=0, amountSpent>0 and new receipt status=1, amountSpent>0', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (existingReceipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x1';
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 1;
        (receipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x1';
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: false })
      expect(failedReasons.some(reason => reason.includes('Success and failed receipts with gas charged'))).toBe(true)
    })

    it('should set needToSave=true when existing receipt status=0, amountSpent=0 and new receipt status=0, amountSpent>0', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (existingReceipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x0';
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (receipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x1';
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should log when there are duplicate success receipts', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 1;
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 1;
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: true, needToSave: false })
      expect(failedReasons.some(reason => reason.includes('Duplicate success receipt'))).toBe(true)
    })
  })

  describe('appReceiptData hash validation', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should validate appReceiptDataHash matches calculated hash', async () => {
      mockHashObj.mockReturnValue('calculated-hash')
      if (receipt.signedReceipt && (receipt.signedReceipt as SignedReceipt).proposal) {
        (receipt.signedReceipt as SignedReceipt).proposal.appReceiptDataHash = 'calculated-hash'
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
      expect(mockHashObj).toHaveBeenCalledWith(receipt.appReceiptData)
    })

    it('should detect hash mismatch', async () => {
      mockHashObj.mockReturnValue('calculated-hash')
      if (receipt.signedReceipt && (receipt.signedReceipt as SignedReceipt).proposal) {
        (receipt.signedReceipt as SignedReceipt).proposal.appReceiptDataHash = 'different-hash'
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: false, needToSave: false })
      expect(failedReasons.some(reason => reason.includes('appReceiptData hash mismatch'))).toBe(true)
    })
  })
})
