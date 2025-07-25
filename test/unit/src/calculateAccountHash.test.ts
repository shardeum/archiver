import { expect, describe, it, beforeAll, beforeEach, jest } from '@jest/globals'
import * as crypto from '../../../src/Crypto'
import {
  AccountType,
  accountSpecificHash,
  verifyAccountHash,
  verifyNonGlobalTxAccountChange,
} from '../../../src/shardeum/calculateAccountHash'
import { ArchiverReceipt, Receipt, SignedReceipt } from '../../../src/dbstore/receipts'
import { AccountsCopy } from '../../../src/dbstore/accounts'
import * as helpers from '../../../src/types/ajv/Helpers'
import * as verifyGlobalTxReceiptModule from '../../../src/shardeum/verifyGlobalTxReceipt'

// Only mock dependencies, never the functions under test
jest.mock('../../../src/types/ajv/Helpers', () => ({
  verifyPayload: jest.fn(),
}))

jest.mock('../../../src/shardeum/verifyGlobalTxReceipt', () => ({
  verifyGlobalTxAccountChange: jest.fn(),
}))

describe('calculateAccountHash', () => {
  // Initialize crypto module with a test key before all tests
  beforeAll(() => {
    crypto.setCryptoHashKey('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
  })

  describe('accountSpecificHash', () => {
    /**
     * Test helper to verify hash calculation for an account
     * @param account The account object to test
     * @param expectedChange Whether the hash should change from the original
     */
    const testAccountHash = (account: any, expectedChange = true) => {
      const initialHash = account.hash
      const result = accountSpecificHash(account)

      expect(account.hash).toBe(result) // Hash is set on account and returned

      if (expectedChange) {
        expect(account.hash).not.toBe(initialHash) // Hash was updated
      }

      return result
    }

    it('should calculate hash for Account type account', () => {
      const account = {
        accountType: AccountType.Account,
        account: { balance: '100' },
        timestamp: 12345,
        hash: 'old-hash',
      }

      testAccountHash(account)
    })

    it('should calculate hash for Account type account with operatorAccountInfo', () => {
      const accountWithOperator = {
        accountType: AccountType.Account,
        account: { balance: '100' },
        operatorAccountInfo: { stake: '1000' },
        timestamp: 12345,
        hash: 'old-hash',
      }

      const accountWithoutOperator = {
        accountType: AccountType.Account,
        account: { balance: '100' },
        timestamp: 12345,
        hash: 'old-hash',
      }

      const hashWithOperator = testAccountHash(accountWithOperator)
      const hashWithoutOperator = testAccountHash(accountWithoutOperator)

      expect(hashWithOperator).not.toBe(hashWithoutOperator)
    })

    const accountTypeTestCases = [
      {
        name: 'ContractStorage',
        type: AccountType.ContractStorage,
        data: { key: 'storage-key', value: 'storage-value' },
      },
      {
        name: 'ContractCode',
        type: AccountType.ContractCode,
        data: { codeHash: 'code-hash', codeByte: 'code-byte' },
      },
      {
        name: 'Receipt',
        type: AccountType.Receipt,
        data: { txId: 'tx-id', receipt: { data: 'receipt-data' } },
      },
      {
        name: 'Debug',
        type: AccountType.Debug,
        data: { someData: 'debug-data' },
      },
      {
        name: 'NetworkAccount',
        type: AccountType.NetworkAccount,
        data: { someData: 'network-data' },
      },
      {
        name: 'NodeAccount',
        type: AccountType.NodeAccount,
        data: { someData: 'node-data' },
      },
      {
        name: 'NodeAccount2',
        type: AccountType.NodeAccount2,
        data: { someData: 'node2-data' },
      },
      {
        name: 'NodeRewardReceipt',
        type: AccountType.NodeRewardReceipt,
        data: { someData: 'reward-data' },
      },
      {
        name: 'DevAccount',
        type: AccountType.DevAccount,
        data: { someData: 'dev-data' },
      },
      {
        name: 'StakeReceipt',
        type: AccountType.StakeReceipt,
        data: { someData: 'stake-data' },
      },
      {
        name: 'UnstakeReceipt',
        type: AccountType.UnstakeReceipt,
        data: { someData: 'unstake-data' },
      },
      {
        name: 'InternalTxReceipt',
        type: AccountType.InternalTxReceipt,
        data: { someData: 'internal-tx-data' },
      },
      {
        name: 'SecureAccount',
        type: AccountType.SecureAccount,
        data: { someData: 'secure-data' },
      },
    ]

    accountTypeTestCases.forEach((testCase) => {
      it(`should calculate hash for ${testCase.name} type account`, () => {
        const account = {
          accountType: testCase.type,
          ...testCase.data,
          hash: 'old-hash',
        }

        testAccountHash(account)
      })
    })

    it('should throw error when account is null', () => {
      expect(() => accountSpecificHash(null)).toThrow('Account data is null or undefined')
    })

    it('should throw error when account is undefined', () => {
      expect(() => accountSpecificHash(undefined)).toThrow('Account data is null or undefined')
    })

    it('should handle error when crypto.hashObj fails', () => {
      const account = {
        accountType: AccountType.Account,
        account: { balance: '100' },
        hash: 'old-hash',
      }

      // Mock crypto.hashObj to throw an error
      jest.spyOn(crypto, 'hashObj').mockImplementation(() => {
        throw new Error('Hash calculation failed')
      })

      // Test that the error is caught and a new error is thrown
      expect(() => accountSpecificHash(account)).toThrow('Failed to calculate account-specific hash')

      // Restore the mock
      jest.restoreAllMocks()
    })
  })

  describe('verifyAccountHash', () => {
    let mockReceipt: Receipt
    let failedReasons: any[]
    let nestedCounterMessages: any[]

    beforeAll(() => {
      // Reset mocks between test blocks
      jest.clearAllMocks()
    })

    beforeEach(() => {
      // Reset arrays for collecting error messages
      failedReasons = []
      nestedCounterMessages = []

      // Setup a complete mock receipt for testing
      mockReceipt = {
        tx: {
          txId: 'test-tx-id',
          timestamp: 12345,
          originalTxData: {},
        },
        cycle: 1,
        receiptId: 'test-receipt-id',
        timestamp: 12345,
        applyTimestamp: 12345,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: ['account1', 'account2'],
            beforeStateHashes: ['hash1', 'hash2'],
            afterStateHashes: ['hash3', 'hash4'],
            appReceiptDataHash: 'data-hash',
            txid: 'test-tx-id',
          },
          proposalHash: 'proposal-hash',
          signaturePack: [],
          voteOffsets: [],
        } as SignedReceipt,
        afterStates: [
          {
            accountId: 'account1',
            data: {
              accountType: AccountType.Account,
              account: { balance: '100' },
              timestamp: 12345,
              hash: 'old-hash',
            },
            timestamp: 12345,
            hash: 'hash3',
            isGlobal: false,
          },
          {
            accountId: 'account2',
            data: {
              accountType: AccountType.Account,
              account: { balance: '200' },
              timestamp: 12345,
              hash: 'old-hash',
            },
            timestamp: 12345,
            hash: 'hash4',
            isGlobal: false,
          },
        ],
        beforeStates: [],
        appReceiptData: { data: {} },
        globalModification: false,
      }

      // Configure mock for crypto.hashObj to return predictable values for tests
      jest.spyOn(crypto, 'hashObj').mockImplementation((obj: any) => {
        if (obj.EVMAccountInfo?.balance === '100') return 'hash3'
        if (obj.EVMAccountInfo?.balance === '200') return 'hash4'
        return 'mocked-hash'
      })

      // Set default mock behaviors for dependencies
      ;(helpers.verifyPayload as jest.Mock).mockReturnValue(null)
      ;(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange as jest.Mock).mockReturnValue(true)
    })

    it('should use default empty arrays when failedReasons and nestedCounterMessages are not provided', async () => {
      // WHEN verifying with default parameters
      const result = await verifyAccountHash(mockReceipt)

      // THEN it should succeed and use empty arrays for the defaults
      expect(result).toBe(true)
      expect(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange).toHaveBeenCalledWith(mockReceipt, [], [])
    })

    it('should handle GlobalTxReceipt validation error exception', async () => {
      // GIVEN verifyPayload throws an error
      ;(helpers.verifyPayload as jest.Mock).mockImplementation(() => {
        throw new Error('Validation error')
      })

      // WHEN verifying the receipt
      const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

      // THEN it should fail with appropriate error messages
      expect(result).toBe(false)
      expect(failedReasons.length).toBeGreaterThan(0)
      expect(failedReasons[0]).toContain('Invalid Global Tx Receipt error')
      expect(nestedCounterMessages[0]).toContain('Invalid Global Tx Receipt error')
    })

    it('should verify using verifyGlobalTxAccountChange when GlobalTxReceipt is valid', async () => {
      // GIVEN a valid GlobalTxReceipt
      ;(helpers.verifyPayload as jest.Mock).mockReturnValue(null)
      ;(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange as jest.Mock).mockReturnValue(true)

      // WHEN verifying the receipt
      const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

      // THEN it should succeed and call the verification function
      expect(result).toBe(true)
      expect(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange).toHaveBeenCalledWith(
        mockReceipt,
        failedReasons,
        nestedCounterMessages
      )
    })

    it('should fail when verifyGlobalTxAccountChange returns false', async () => {
      // GIVEN verifyGlobalTxAccountChange returns false
      ;(helpers.verifyPayload as jest.Mock).mockReturnValue(null)
      ;(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange as jest.Mock).mockReturnValue(false)

      // WHEN verifying the receipt
      const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

      // THEN it should fail
      expect(result).toBe(false)
    })

    describe('when validating receipt properties', () => {
      beforeEach(() => {
        // Set verifyPayload to return validation errors for these tests
        ;(helpers.verifyPayload as jest.Mock).mockReturnValue(['Invalid schema'])
      })

      it('should fail when account IDs and after state hashes length do not match', async () => {
        // GIVEN account IDs and after state hashes length mismatch
        ;(mockReceipt.signedReceipt as SignedReceipt).proposal.accountIDs = ['account1']

        // WHEN verifying the receipt
        const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

        // THEN it should fail with mismatch error
        expect(result).toBe(false)
        expect(failedReasons[0]).toContain('Modified account count')
        expect(nestedCounterMessages[0]).toContain('Modified account count')
      })

      it('should fail when before state hashes and after state hashes length do not match', async () => {
        // GIVEN mismatch between before and after state hashes
        ;(mockReceipt.signedReceipt as SignedReceipt).proposal.beforeStateHashes = ['hash1']

        // WHEN verifying the receipt
        const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

        // THEN it should fail with mismatch error
        expect(result).toBe(false)
        expect(failedReasons[0]).toContain('Account state hash before and after count does not match')
        expect(nestedCounterMessages[0]).toContain('Account state hash before and after count does not match')
      })

      it('should fail when account is not found in afterStates', async () => {
        // GIVEN an account ID not found in afterStates
        ;(mockReceipt.signedReceipt as SignedReceipt).proposal.accountIDs = ['missing-account', 'account2']
        ;(mockReceipt.signedReceipt as SignedReceipt).proposal.beforeStateHashes = ['hash1', 'hash2']
        ;(mockReceipt.signedReceipt as SignedReceipt).proposal.afterStateHashes = ['hash3', 'hash4']

        // WHEN verifying the receipt
        const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

        // THEN it should fail with account not found error
        expect(result).toBe(false)
        expect(failedReasons[0]).toContain("Account not found in the receipt's afterStates")
        expect(nestedCounterMessages[0]).toContain('Account not found in the receipt')
      })

      it('should fail when calculated account hash does not match expected hash', async () => {
        // GIVEN a calculated hash that doesn't match expected hash
        jest.spyOn(crypto, 'hashObj').mockImplementation(() => 'wrong-hash')

        // WHEN verifying the receipt
        const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

        // THEN it should fail with hash mismatch error
        expect(result).toBe(false)
        expect(failedReasons[0]).toContain('Account hash does not match')
        expect(nestedCounterMessages[0]).toContain('Account hash does not match')
      })
    })

    it('should handle other exceptions during verification', async () => {
      // GIVEN an exception will occur during verification (missing proposal)
      ;(helpers.verifyPayload as jest.Mock).mockReturnValue(['Invalid schema'])
      delete (mockReceipt.signedReceipt as any).proposal

      // WHEN verifying the receipt
      const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

      // THEN it should capture the exception and fail
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Error while verifying non global account change')
      expect(failedReasons[0]).toContain('test-tx-id')
      expect(failedReasons[0]).toContain('Cannot destructure property')
      expect(nestedCounterMessages[0]).toContain('Error while verifying non global account change')
    })

    it('should handle unexpected errors in verifyAccountHash', async () => {
      // GIVEN verifyPayload itself causes an error in the outer try block
      ;(helpers.verifyPayload as jest.Mock).mockImplementation(() => {
        // This will pass the globalReceiptValidationErrors check
        return null
      })

      // Mock verifyGlobalTxAccountChange to throw an error
      ;(verifyGlobalTxReceiptModule.verifyGlobalTxAccountChange as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error in global verification')
      })

      // WHEN verifying the receipt
      const result = await verifyAccountHash(mockReceipt, failedReasons as any[], nestedCounterMessages as any[])

      // THEN it should capture the error in the outer catch block
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Error in verifyAccountHash')
      expect(failedReasons[0]).toContain('Unexpected error in global verification')
      expect(nestedCounterMessages[0]).toBe('Error in verifyAccountHash')
    })
  })

  describe('verifyNonGlobalTxAccountChange', () => {
    let mockReceipt: ArchiverReceipt
    let failedReasons: any[]
    let nestedCounterMessages: any[]

    beforeEach(() => {
      // Reset arrays for collecting error messages
      failedReasons = []
      nestedCounterMessages = []

      // Setup a complete mock receipt for testing
      mockReceipt = {
        tx: {
          txId: 'test-tx-id',
          timestamp: 12345,
          originalTxData: {},
        },
        cycle: 1,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: ['account1', 'account2'],
            beforeStateHashes: ['hash1', 'hash2'],
            afterStateHashes: ['hash3', 'hash4'],
            appReceiptDataHash: 'data-hash',
            txid: 'test-tx-id',
          },
          proposalHash: 'proposal-hash',
          signaturePack: [],
          voteOffsets: [],
        } as SignedReceipt,
        afterStates: [
          {
            accountId: 'account1',
            data: {
              accountType: AccountType.Account,
              account: { balance: '100' },
              timestamp: 12345,
              hash: 'old-hash',
            },
            timestamp: 12345,
            hash: 'hash3',
            isGlobal: false,
          },
          {
            accountId: 'account2',
            data: {
              accountType: AccountType.Account,
              account: { balance: '200' },
              timestamp: 12345,
              hash: 'old-hash',
            },
            timestamp: 12345,
            hash: 'hash4',
            isGlobal: false,
          },
        ] as AccountsCopy[],
        beforeStates: [],
        appReceiptData: { data: {} },
        globalModification: false,
      }

      // Configure mock for crypto.hashObj to return predictable values for tests
      jest.spyOn(crypto, 'hashObj').mockImplementation((obj: any) => {
        // Account data hashes based on balance
        if (obj.account?.balance === '100') return 'hash3'
        if (obj.account?.balance === '200') return 'hash4'
        return 'mocked-hash'
      })
    })

    it('should verify valid non-global transaction successfully', async () => {
      // WHEN verifying a valid receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should succeed
      expect(result).toBe(true)
      expect(failedReasons).toHaveLength(0)
      expect(nestedCounterMessages).toHaveLength(0)
    })

    it('should handle empty account arrays', async () => {
      // GIVEN receipt with empty arrays
      mockReceipt.signedReceipt = {
        proposal: {
          applied: true,
          cant_preApply: false,
          accountIDs: [],
          beforeStateHashes: [],
          afterStateHashes: [],
          appReceiptDataHash: 'data-hash',
          txid: 'test-tx-id',
        },
        proposalHash: 'proposal-hash',
        signaturePack: [],
        voteOffsets: [],
      } as SignedReceipt
      mockReceipt.afterStates = []

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should succeed for empty arrays
      expect(result).toBe(true)
      expect(failedReasons).toHaveLength(0)
    })

    it('should fail when accountIDs length does not match afterStateHashes length', async () => {
      // GIVEN mismatched accountIDs and afterStateHashes lengths
      ;(mockReceipt.signedReceipt as SignedReceipt).proposal.accountIDs = ['account1', 'account2', 'account3']

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should fail with appropriate error
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Modified account count specified in the receipt')
      expect(nestedCounterMessages[0]).toContain('Modified account count specified in the receipt')
    })

    it('should fail when beforeStateHashes length does not match afterStateHashes length', async () => {
      // GIVEN mismatched beforeStateHashes and afterStateHashes lengths
      ;(mockReceipt.signedReceipt as SignedReceipt).proposal.beforeStateHashes = ['hash1']

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should fail with appropriate error
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Account state hash before and after count does not match')
      expect(nestedCounterMessages[0]).toContain('Account state hash before and after count does not match')
    })

    it('should fail when account is not found in afterStates', async () => {
      // GIVEN an account missing from afterStates
      mockReceipt.afterStates = mockReceipt.afterStates?.slice(0, 1) || [] // Keep only first account

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should fail with appropriate error
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain("Account not found in the receipt's afterStates")
      expect(failedReasons[0]).toContain('account2')
      expect(nestedCounterMessages[0]).toContain('Account not found in the receipt')
    })

    it('should fail when calculated hash does not match expected hash', async () => {
      // GIVEN wrong hash calculation
      jest.spyOn(crypto, 'hashObj').mockReturnValue('wrong-hash')

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should fail with hash mismatch
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Account hash does not match')
      expect(failedReasons[0]).toContain('account1')
      expect(nestedCounterMessages[0]).toContain('Account hash does not match')
    })

    it('should process multiple accounts and validate all hashes', async () => {
      // Clear any previous mocks
      jest.clearAllMocks()

      // GIVEN receipt with 4 accounts
      mockReceipt.signedReceipt = {
        proposal: {
          applied: true,
          cant_preApply: false,
          accountIDs: ['acc1', 'acc2', 'acc3', 'acc4'],
          beforeStateHashes: ['b1', 'b2', 'b3', 'b4'],
          afterStateHashes: ['a1', 'a2', 'a3', 'a4'],
          appReceiptDataHash: 'data-hash',
          txid: 'test-tx-id',
        },
        proposalHash: 'proposal-hash',
        signaturePack: [],
        voteOffsets: [],
      } as SignedReceipt

      mockReceipt.afterStates = [
        { accountId: 'acc1', data: { id: 'acc1' }, timestamp: 12345, hash: 'a1', isGlobal: false },
        { accountId: 'acc2', data: { id: 'acc2' }, timestamp: 12345, hash: 'a2', isGlobal: false },
        { accountId: 'acc3', data: { id: 'acc3' }, timestamp: 12345, hash: 'a3', isGlobal: false },
        { accountId: 'acc4', data: { id: 'acc4' }, timestamp: 12345, hash: 'a4', isGlobal: false },
      ]

      // Mock hash calculation to return expected hashes
      jest
        .spyOn(crypto, 'hashObj')
        .mockReturnValueOnce('a1')
        .mockReturnValueOnce('a2')
        .mockReturnValueOnce('a3')
        .mockReturnValueOnce('a4')

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should succeed and verify all accounts
      expect(result).toBe(true)
      // Verify it was called for each account
      expect(crypto.hashObj).toHaveBeenCalledWith({ id: 'acc1', hash: 'a1' })
      expect(crypto.hashObj).toHaveBeenCalledWith({ id: 'acc2', hash: 'a2' })
      expect(crypto.hashObj).toHaveBeenCalledWith({ id: 'acc3', hash: 'a3' })
      expect(crypto.hashObj).toHaveBeenCalledWith({ id: 'acc4', hash: 'a4' })
    })

    it('should handle exceptions during verification', async () => {
      // GIVEN a receipt that will cause an exception
      delete (mockReceipt.signedReceipt as any).proposal

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should catch the error and fail gracefully
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Error while verifying non global account change')
      expect(failedReasons[0]).toContain("Cannot destructure property 'accountIDs'")
      expect(nestedCounterMessages[0]).toContain('Error while verifying non global account change')
    })

    it('should handle afterStates being undefined', async () => {
      // GIVEN afterStates is undefined
      mockReceipt.afterStates = undefined

      // WHEN verifying the receipt
      const result = await verifyNonGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      // THEN it should fail when trying to find accounts
      expect(result).toBe(false)
      expect(failedReasons[0]).toContain('Error while verifying non global account change')
    })

    it('should pass default empty arrays when not provided', async () => {
      // WHEN verifying without providing failedReasons and nestedCounterMessages
      const result = await verifyNonGlobalTxAccountChange(mockReceipt)

      // THEN it should use default empty arrays and succeed
      expect(result).toBe(true)
    })
  })
})
