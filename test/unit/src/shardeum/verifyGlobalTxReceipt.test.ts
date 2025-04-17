import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import {
  verifyGlobalTxAccountChange,
  InternalTXType,
  SetGlobalTxValue,
} from '../../../../src/shardeum/verifyGlobalTxReceipt'
import { accountSpecificHash } from '../../../../src/shardeum/calculateAccountHash'
import { ArchiverReceipt, queryInitNetworkReceiptCountBetweenCycles } from '../../../../src/dbstore/receipts'
import { GlobalTxReceipt } from '@shardeum-foundation/lib-types/build/src/p2p/GlobalAccountsTypes'

// Mock the queryInitNetworkReceiptCountBetweenCycles function
jest.mock('../../../../src/dbstore/receipts', () => ({
  queryInitNetworkReceiptCountBetweenCycles: jest.fn(),
}))

// Mock the accountSpecificHash function
jest.mock('../../../../src/shardeum/calculateAccountHash', () => ({
  accountSpecificHash: jest.fn(),
}))

describe('verifyGlobalTxAccountChange', () => {
  // Common variables used across tests
  let mockReceipt: ArchiverReceipt
  let failedReasons: string[]
  let nestedCounterMessages: string[]

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()

    // Reset arrays used for collecting error messages
    failedReasons = []
    nestedCounterMessages = []

    // Setup base mock receipt that will be modified for specific tests
    mockReceipt = {
      signedReceipt: {
        tx: {
          value: {} as SetGlobalTxValue,
          address: 'test-address',
          addressHash: 'test-address-hash',
          afterStateHash: 'test-after-state-hash',
          txId: 'test-tx-id',
        },
      } as unknown as GlobalTxReceipt,
      beforeStates: [],
      afterStates: [],
      tx: {
        txId: 'test-tx-id',
        timestamp: 123456789,
      },
      cycle: 5,
    } as unknown as ArchiverReceipt
  })

  describe('ApplyChangeConfig and ApplyNetworkParam transaction types', () => {
    beforeEach(() => {
      // Default account hash calculation mock
      ;(accountSpecificHash as jest.Mock).mockImplementation((data: any) => {
        return data?.hash || 'calculated-hash'
      })
    })

    it('should verify account hash for ApplyChangeConfig transaction with matching hashes', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      mockReceipt.beforeStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      mockReceipt.afterStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-after-state-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(true)
      expect(accountSpecificHash).toHaveBeenCalledTimes(2)
      expect(failedReasons).toHaveLength(0)
      expect(nestedCounterMessages).toHaveLength(0)
    })

    it('should verify account hash for ApplyNetworkParam transaction with matching hashes', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyNetworkParam,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      mockReceipt.beforeStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      mockReceipt.afterStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-after-state-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(true)
      expect(accountSpecificHash).toHaveBeenCalledTimes(2)
      expect(failedReasons).toHaveLength(0)
      expect(nestedCounterMessages).toHaveLength(0)
    })

    it('should return false if beforeStates account ID does not match tx address', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      mockReceipt.beforeStates = [
        {
          accountId: 'wrong-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Unexpected account found in before accounts')
      expect(nestedCounterMessages).toContain('Unexpected account found in before accounts')
    })

    it('should return false if afterStates account ID does not match tx address', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      mockReceipt.beforeStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      mockReceipt.afterStates = [
        {
          accountId: 'wrong-address',
          data: { hash: 'test-after-state-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Mock accountSpecificHash to return the expected hashes
      ;(accountSpecificHash as jest.Mock).mockImplementation((data: any) => {
        if (data?.hash === 'test-address-hash') return 'test-address-hash'
        if (data?.hash === 'test-after-state-hash') return 'test-after-state-hash'
        return 'unexpected-hash'
      })

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Unexpected account found in accounts')
      expect(nestedCounterMessages).toContain('Unexpected account found in accounts')
    })

    it('should return false if afterStates account hash does not match', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      mockReceipt.beforeStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      mockReceipt.afterStates = [
        {
          accountId: 'test-address',
          data: { hash: 'wrong-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Mock accountSpecificHash to return expected hash for beforeStates but wrong hash for afterStates
      ;(accountSpecificHash as jest.Mock).mockImplementation((data: any) => {
        if (data?.hash === 'test-address-hash') return 'test-address-hash'
        return 'wrong-calculated-hash'
      })

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Account afterStateHash does not match in globalModification tx')
      expect(nestedCounterMessages).toContain('Account afterStateHash does not match in globalModification tx')
    })

    it('should return false if network account is not found in before or after states', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      // Empty beforeStates will cause network account not found error
      mockReceipt.beforeStates = []
      mockReceipt.afterStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-after-state-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Network account Before or After states not found')
      expect(nestedCounterMessages).toContain('Network account Before or After states not found')
    })
  })

  describe('Other transaction types', () => {
    it('should return false for unsupported transaction types', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.NodeReward, // Unsupported type
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Unexpected internal transaction type in the globalModification tx')
      expect(nestedCounterMessages).toContain('Unexpected internal transaction type in the globalModification tx')
    })
  })

  describe('Error handling', () => {
    it('should return false and add error message if an exception occurs', async () => {
      // Arrange
      // Create a receipt that will cause an error
      const badReceipt = {
        signedReceipt: null, // This will cause an error when code tries to access properties
        tx: {
          txId: 'test-tx-id',
          timestamp: 123456789,
        },
        cycle: 5,
      } as unknown as ArchiverReceipt

      // Mock console.error to prevent actual console output in tests
      const originalConsoleError = console.error
      console.error = jest.fn()

      // Act
      const result = await verifyGlobalTxAccountChange(badReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(false)
      expect(failedReasons).toHaveLength(1)
      expect(failedReasons[0]).toContain('Error while verifying global account change')
      expect(nestedCounterMessages).toContain('Error while verifying global account change')
      expect(console.error).toHaveBeenCalled()

      // Restore console.error
      console.error = originalConsoleError
    })
  })

  describe('Empty addressHash scenarios', () => {
    it('should skip before state hash verification when addressHash is empty', async () => {
      // Arrange
      ;(mockReceipt.signedReceipt as any).tx.value = {
        internalTXType: InternalTXType.ApplyChangeConfig,
        isInternalTx: true,
        timestamp: 123456789,
        from: 'test-from',
        change: { cycle: 1, change: {} },
      } as SetGlobalTxValue

      // Set addressHash to empty string to skip validation
      ;(mockReceipt.signedReceipt as any).tx.addressHash = ''

      mockReceipt.beforeStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-address-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ]

      mockReceipt.afterStates = [
        {
          accountId: 'test-address',
          data: { hash: 'test-after-state-hash' },
          timestamp: 123456789,
          hash: 'account-hash',
          isGlobal: false,
        } as any,
      ] as any

      // Act
      const result = await verifyGlobalTxAccountChange(mockReceipt, failedReasons as any, nestedCounterMessages as any)

      // Assert
      expect(result).toBe(true)
      // accountSpecificHash should only be called once for the afterStates check, not for beforeStates
      expect(accountSpecificHash).toHaveBeenCalledTimes(1)
      expect(failedReasons).toHaveLength(0)
      expect(nestedCounterMessages).toHaveLength(0)
    })
  })
})
