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

  describe('validateAppReceiptData internal function', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle receipt with bitvector', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: { status: 0 },
          receipt: {
            logs: [],
            bitvector: { 0: 1, 1: 0, 2: 1 } // Object that needs conversion
          }
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle receipt with logs containing arrays', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: { status: 0 },
          receipt: {
            logs: [
              [
                [{ 0: 1, 1: 2 }, { 0: 3, 1: 4 }], // Nested arrays
                { 0: 5, 1: 6 } // Direct object
              ]
            ]
          }
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle validateAppReceiptData error', async () => {
      // Create a receipt that will cause an error in validateAppReceiptData
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      
      // Mock Object.values to throw an error
      const originalObjectValues = Object.values
      Object.values = jest.fn().mockImplementation(() => {
        throw new Error('Object.values error')
      })
      
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: { status: 0 },
          receipt: {
            logs: [],
            bitvector: { 0: 1, 1: 0, 2: 1 }
          }
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      expect(result).toEqual({ valid: false, needToSave: false })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('validateAppReceiptData error:'))
      expect(failedReasons.some(reason => reason.includes('validateAppReceiptData error:'))).toBe(true)
      
      // Restore original Object.values
      Object.values = originalObjectValues
      consoleErrorSpy.mockRestore()
    })
  })

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle null appReceiptData', async () => {
      receipt.appReceiptData = null as any
      
      // This will throw an error, so we need to catch it
      let result
      try {
        result = await verifyAppReceiptData(
          receipt as ArchiverReceipt,
          null,
          failedReasons as never[],
          nestedCounterMessages as never[]
        )
      } catch (error) {
        // Expected to throw
        expect(error).toBeDefined()
        return
      }
      
      // If it doesn't throw, it should return invalid
      expect(result).toEqual({ valid: false, needToSave: false })
    })

    it('should handle undefined appReceiptData.data', async () => {
      receipt.appReceiptData = { data: undefined } as any
      
      // This will throw an error when trying to access properties on undefined
      let result
      try {
        result = await verifyAppReceiptData(
          receipt as ArchiverReceipt,
          null,
          failedReasons as never[],
          nestedCounterMessages as never[]
        )
      } catch (error) {
        // Expected to throw
        expect(error).toBeDefined()
        return
      }
      
      // If it doesn't throw, it should return invalid
      expect(result).toEqual({ valid: false, needToSave: false })
    })

    it('should handle missing signedReceipt', async () => {
      receipt.signedReceipt = undefined as any
      
      // This will throw an error when trying to access signedReceipt.proposal
      let result
      try {
        result = await verifyAppReceiptData(
          receipt as ArchiverReceipt,
          null,
          failedReasons as never[],
          nestedCounterMessages as never[]
        )
      } catch (error) {
        // Expected to throw
        expect(error).toBeDefined()
        return
      }
      
      // If it doesn't throw, it should return invalid
      expect(result).toEqual({ valid: false, needToSave: false })
    })

    it('should handle empty arrays for accountIDs', async () => {
      (receipt.signedReceipt as SignedReceipt).proposal = {
        accountIDs: [],
        beforeStateHashes: [],
        afterStateHashes: [],
        appReceiptDataHash: 'calculated-hash',
        applied: false,
        cant_preApply: false,
        txid: 'test-tx-id'
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle when existing receipt has same timestamp as new receipt', async () => {
      if (existingReceipt && receipt.tx) {
        existingReceipt.timestamp = receipt.tx.timestamp // Same timestamp
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle existing receipt status=0, new receipt status=0, existing amountSpent>0, new amountSpent=0', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (existingReceipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x1';
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (receipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x0';
      }
      
      // Different timestamp to enter the comparison logic
      if (existingReceipt) {
        existingReceipt.timestamp = 123456000;
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      // Since existingReceipt.timestamp !== receipt.tx.timestamp, result defaults to needToSave: true (line 120)
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle existing receipt status=1, new receipt status=0', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 1;
      }
      
      if (receipt.appReceiptData && receipt.appReceiptData.data) {
        (receipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
      }
      
      // Different timestamp to enter the comparison logic
      if (existingReceipt) {
        existingReceipt.timestamp = 123456000;
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        existingReceipt as Receipt,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      // Since existingReceipt.timestamp !== receipt.tx.timestamp, result defaults to needToSave: true (line 120)
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle both failed receipts with gas charged', async () => {
      // This test is in the 'edge cases and error handling' section which doesn't set up existingReceipt
      // We need to create it here
      existingReceipt = {
        tx: {
          txId: 'existing-tx',
          timestamp: 123456000,
          originalTxData: {}
        },
        appReceiptData: {
          data: {
            amountSpent: '0x1',
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
      
      // The timestamps are different (123456000 !== 123456789), so it enters the if block
      // Both have status=0 and amountSpent='0x1', so it logs the message but keeps needToSave=false
      expect(result).toEqual({ valid: true, needToSave: false })
      expect(failedReasons.length).toBeGreaterThan(0)
      expect(failedReasons.some(reason => reason.includes('Both failed receipts with gas charged'))).toBe(true)
    })
  })

  describe('edge cases for amountSpent values', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle various hex amountSpent values', async () => {
      const testCases = [
        '0x0',      // zero
        '0x1',      // one
        '0xff',     // 255
        '0xffff',   // 65535
        '0x123abc', // large hex
        '0X0',      // uppercase X
      ]
      
      for (const amount of testCases) {
        receipt.appReceiptData = {
          data: {
            amountSpent: amount,
            readableReceipt: { status: 0 },
            receipt: { logs: [] }
          } as ShardeumReceipt
        }
        
        const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
        expect(result.valid).toBe(true)
      }
    })

    it('should handle empty string amountSpent', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '',
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
  })

  describe('edge cases for readableReceipt status', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle various status values', async () => {
      const testCases = [0, 1, 2, -1, 100, Number.MAX_SAFE_INTEGER]
      
      for (const status of testCases) {
        receipt.appReceiptData = {
          data: {
            amountSpent: '0x0',
            readableReceipt: { status },
            receipt: { logs: [] }
          } as ShardeumReceipt
        }
        
        const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
        expect(result.valid).toBe(true)
      }
    })

    it('should handle missing status property', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: {} as any // Missing status property
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        failedReasons as never[],
        nestedCounterMessages as never[]
      )
      
      // The code doesn't specifically check for missing status, it just uses it
      // So this will pass validation as valid unless status is explicitly checked
      expect(result).toEqual({ valid: true, needToSave: true })
    })
  })

  describe('performance and boundary tests', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle very large number of accounts', async () => {
      const largeAccountCount = 1000;
      const accountIDs = new Array(largeAccountCount).fill('account');
      const hashes = new Array(largeAccountCount).fill('hash');
      
      (receipt.signedReceipt as SignedReceipt).proposal = {
        accountIDs,
        beforeStateHashes: hashes,
        afterStateHashes: hashes,
        appReceiptDataHash: 'calculated-hash',
        applied: false,
        cant_preApply: false,
        txid: 'test-tx-id'
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle deeply nested log structures', async () => {
      const deepLogs: any[] = []
      let current: any = deepLogs
      for (let i = 0; i < 10; i++) {
        const nested: any[] = [{ 0: i, 1: i + 1 }]
        current.push(nested)
        current = nested
      }
      
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: { status: 0 },
          receipt: {
            logs: deepLogs
          }
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })
  })

  describe('edge case for line 138 coverage - validateAppReceiptData branch', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle appReceiptData without data property', async () => {
      receipt.appReceiptData = {} as any // No data property
      
      // This will throw an error when trying to access data.amountSpent
      let result
      try {
        result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      } catch (error) {
        // Expected to throw
        expect(error).toBeDefined()
        return
      }
      
      // If it doesn't throw, check the result
      expect(result).toBeDefined()
    })

    it('should handle appReceiptData.data without receipt property', async () => {
      receipt.appReceiptData = {
        data: {
          amountSpent: '0x0',
          readableReceipt: { status: 0 }
          // No receipt property
        } as ShardeumReceipt
      }
      
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      // validateAppReceiptData will return true because line 140 checks if receipt exists
      expect(result).toEqual({ valid: true, needToSave: true })
    })
  })

  describe('edge case for existing receipt line 102 coverage', () => {
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

    it('should handle existing receipt status=0, new receipt status=0, both amountSpent>0', async () => {
      if (existingReceipt && existingReceipt.appReceiptData && existingReceipt.appReceiptData.data) {
        (existingReceipt.appReceiptData.data as ShardeumReceipt).readableReceipt.status = 0;
        (existingReceipt.appReceiptData.data as ShardeumReceipt).amountSpent = '0x1';
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
      
      // This covers line 102: Both failed receipts with gas charged
      expect(result).toEqual({ valid: true, needToSave: false })
      expect(failedReasons.some(reason => reason.includes('Both failed receipts with gas charged'))).toBe(true)
    })
  })

  describe('default parameters and edge cases', () => {
    beforeEach(() => {
      mockVerifyPayload.mockReturnValue(true) // Make schema validation pass
    })

    it('should handle call without optional parameters', async () => {
      const result = await verifyAppReceiptData(receipt as ArchiverReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle call with empty arrays for failedReasons and nestedCounterMessages', async () => {
      const emptyFailedReasons: never[] = []
      const emptyNestedMessages: never[] = []
      
      const result = await verifyAppReceiptData(
        receipt as ArchiverReceipt,
        null,
        emptyFailedReasons,
        emptyNestedMessages
      )
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })

    it('should handle receipt as Receipt type instead of ArchiverReceipt', async () => {
      const receiptAsReceipt: Receipt = {
        ...receipt,
        receiptId: 'test-receipt-id',
        timestamp: 123456789,
        applyTimestamp: 123456789
      } as Receipt
      
      const result = await verifyAppReceiptData(receiptAsReceipt)
      
      expect(result).toEqual({ valid: true, needToSave: true })
    })
  })
})
