import { selectBestSuccessReceipt } from '../../../../src/checkpoint/ReceiptUtils'
import { Receipt as ReceiptType } from '../../../../src/dbstore/receipts'
import * as Crypto from '../../../../src/Crypto'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

// Mock dependencies
jest.mock('../../../../src/Crypto')
jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeStringify: jest.fn((obj) => JSON.stringify(obj)),
  },
}))

describe('ReceiptUtils', () => {
  describe('selectBestSuccessReceipt', () => {
    const mockCrypto = Crypto as jest.Mocked<typeof Crypto>
    const mockStringUtils = StringUtils as jest.Mocked<typeof StringUtils>

    beforeEach(() => {
      jest.clearAllMocks()
      // Setup default mock implementations
      mockCrypto.hash.mockImplementation((input) => `hash_${input}`)
      mockStringUtils.safeStringify.mockImplementation((obj) => JSON.stringify(obj))
    })

    describe('Input validation', () => {
      it('should return undefined for null input', () => {
        const result = selectBestSuccessReceipt(null as any)
        expect(result).toBeUndefined()
      })

      it('should return undefined for undefined input', () => {
        const result = selectBestSuccessReceipt(undefined as any)
        expect(result).toBeUndefined()
      })

      it('should return undefined for empty array', () => {
        const result = selectBestSuccessReceipt([])
        expect(result).toBeUndefined()
      })

      it('should return undefined for non-array input', () => {
        const result = selectBestSuccessReceipt({} as any)
        expect(result).toBeUndefined()
      })
    })

    describe('Status filtering', () => {
      it('should return undefined when no receipts have success status', () => {
        const receipts: ReceiptType[] = [
          createMockReceipt({ status: 0 }),
          createMockReceipt({ status: 2 }),
          createMockReceipt({ status: -1 }),
        ]

        const result = selectBestSuccessReceipt(receipts)
        expect(result).toBeUndefined()
      })

      it('should only consider receipts with status=1', () => {
        const successReceipt = createMockReceipt({ status: 1 })
        const failureReceipt = createMockReceipt({ status: 0 })
        const receipts: ReceiptType[] = [failureReceipt, successReceipt]

        const result = selectBestSuccessReceipt(receipts)
        expect(result).toBe(successReceipt)
      })

      it('should handle receipts with missing or malformed readableReceipt', () => {
        const receipts: ReceiptType[] = [
          createMockReceipt({ status: 1 }),
          createMockReceipt({ status: 1, appReceiptData: {} as any }),
          createMockReceipt({ status: 1, appReceiptData: { data: null } as any }),
          createMockReceipt({ status: 1, appReceiptData: { data: {} } as any }),
        ]

        const result = selectBestSuccessReceipt(receipts)
        expect(result).toBe(receipts[0])
      })
    })

    describe('Sorting by median time', () => {
      it('should select receipt with lowest median time', () => {
        const receipt1 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30] // median = 20, median time = 1000 + 20*1000 = 21000
        })
        const receipt2 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [5, 10, 15] // median = 10, median time = 1000 + 10*1000 = 11000
        })
        const receipt3 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [15, 25, 35] // median = 25, median time = 1000 + 25*1000 = 26000
        })

        const result = selectBestSuccessReceipt([receipt1, receipt2, receipt3])
        expect(result).toBe(receipt2)
      })

      it('should handle receipts without voteOffsets', () => {
        const receiptWithOffsets = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30]
        })
        const receiptWithoutOffsets = createMockReceipt({ 
          status: 1, 
          timestamp: 500,
          voteOffsets: undefined
        })

        const result = selectBestSuccessReceipt([receiptWithOffsets, receiptWithoutOffsets])
        expect(result).toBe(receiptWithoutOffsets) // Lower timestamp without offsets
      })

      it('should handle empty voteOffsets array', () => {
        const receipt = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: []
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })
    })

    describe('Sorting by sum of offsets (tie-breaker)', () => {
      it('should use sum of offsets when median times are equal', () => {
        const receipt1 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30] // median = 20, sum = 60
        })
        const receipt2 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [15, 20, 25] // median = 20, sum = 60
        })
        const receipt3 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [5, 20, 25] // median = 20, sum = 50
        })

        const result = selectBestSuccessReceipt([receipt1, receipt2, receipt3])
        expect(result).toBe(receipt3) // Lowest sum
      })
    })

    describe('Sorting by receipt hash (tie-breaker)', () => {
      it('should use receipt hash when median time and sum are equal', () => {
        mockCrypto.hash
          .mockReturnValueOnce('hash_b')
          .mockReturnValueOnce('sig_b')
          .mockReturnValueOnce('hash_a')
          .mockReturnValueOnce('sig_a')
          .mockReturnValueOnce('hash_c')
          .mockReturnValueOnce('sig_c')

        const receipt1 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30]
        })
        const receipt2 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30]
        })
        const receipt3 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30]
        })

        const result = selectBestSuccessReceipt([receipt1, receipt2, receipt3])
        expect(result).toBe(receipt2) // 'hash_a' comes before 'hash_b' and 'hash_c'
      })
    })

    describe('Sorting by signature pack hash (final tie-breaker)', () => {
      it('should use signature pack hash when all other criteria are equal', () => {
        // Mock to return same receipt hash but different sig pack hashes
        mockCrypto.hash
          .mockImplementation((input) => {
            if (input.includes('signaturePack')) {
              return input.includes('"id":"receipt1"') ? 'sig_b' : 'sig_a'
            }
            return 'same_hash'
          })

        const receipt1 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30],
          id: 'receipt1'
        })
        const receipt2 = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30],
          id: 'receipt2'
        })

        const result = selectBestSuccessReceipt([receipt1, receipt2])
        expect(result).toBe(receipt2) // 'sig_a' comes before 'sig_b'
      })
    })

    describe('Edge cases', () => {
      it('should handle single success receipt', () => {
        const receipt = createMockReceipt({ status: 1 })
        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })

      it('should handle non-numeric voteOffsets', () => {
        const receipt = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: ['10', '20', '30'] as any
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })

      it('should handle missing signedReceipt', () => {
        const receipt = createMockReceipt({ 
          status: 1,
          signedReceipt: undefined
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })

      it('should handle signedReceipt without voteOffsets property', () => {
        const receipt = createMockReceipt({ 
          status: 1,
          signedReceipt: { someOtherProp: 'value' } as any
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })

      it('should sort voteOffsets before calculating median', () => {
        const receipt = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [30, 10, 20] // Should be sorted to [10, 20, 30], median = 20
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })

      it('should handle even number of voteOffsets', () => {
        const receipt = createMockReceipt({ 
          status: 1, 
          timestamp: 1000,
          voteOffsets: [10, 20, 30, 40] // median = 30 (floor of length/2)
        })

        const result = selectBestSuccessReceipt([receipt])
        expect(result).toBe(receipt)
      })
    })

    describe('Integration scenarios', () => {
      it('should handle complex realistic scenario', () => {
        const receipts: ReceiptType[] = [
          createMockReceipt({ status: 0 }), // Failed - should be filtered out
          createMockReceipt({ 
            status: 1, 
            timestamp: 1000,
            voteOffsets: [15, 25, 35] // median = 25, time = 26000
          }),
          createMockReceipt({ 
            status: 1, 
            timestamp: 2000,
            voteOffsets: [5, 10, 15] // median = 10, time = 12000
          }),
          createMockReceipt({ status: 2 }), // Other status - should be filtered out
          createMockReceipt({ 
            status: 1, 
            timestamp: 500,
            voteOffsets: [20, 30, 40] // median = 30, time = 30500
          }),
        ]

        const result = selectBestSuccessReceipt(receipts)
        expect(result).toBe(receipts[2]) // Lowest median time (12000)
      })
    })
  })
})

// Helper function to create mock receipts
function createMockReceipt(options: {
  status?: number
  timestamp?: number
  voteOffsets?: number[]
  id?: string
  signedReceipt?: any
  appReceiptData?: any
} = {}): ReceiptType {
  const {
    status = 1,
    timestamp = Date.now(),
    voteOffsets = [10, 20, 30],
    id = `receipt_${Math.random()}`,
    signedReceipt,
    appReceiptData,
  } = options

  return {
    receiptId: id,
    tx: {
      timestamp: timestamp.toString(),
      originalTxData: {}
    },
    cycle: 1,
    beforeStateAccounts: [],
    accounts: [],
    appliedReceipt: {},
    appReceiptData: appReceiptData !== undefined ? appReceiptData : {
      data: {
        readableReceipt: {
          status,
        },
      },
    },
    executionShardKey: 'shard1',
    globalModification: false,
    signedReceipt: signedReceipt !== undefined ? signedReceipt : {
      voteOffsets,
      signaturePack: {
        id,
        signatures: [],
      },
    },
  } as any as ReceiptType
}