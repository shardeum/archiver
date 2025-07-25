// Mock all dependencies first
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
  },
}))

jest.mock('../../../../src/checkpoint/CycleData', () => ({
  cycleCheckpointManager: { type: 'cycle' },
}))

jest.mock('../../../../src/checkpoint/OriginalTxsData', () => ({
  originalTxCheckpointManager: { type: 'originalTx' },
}))

jest.mock('../../../../src/checkpoint/ReceiptData', () => ({
  receiptCheckpointManager: { type: 'receipt' },
}))

// Mock entire dependency chain to prevent circular dependencies
jest.mock('../../../../src/P2P')
jest.mock('../../../../src/Config')
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/State')
jest.mock('../../../../src/dbstore/checkpointStatus')

import { getCheckpointManager } from '../../../../src/checkpoint/Utils'
import { CheckpointType } from '../../../../src/checkpoint/CheckpointData'
import * as Logger from '../../../../src/Logger'

// Get the mocked managers after imports
const { cycleCheckpointManager: mockCycleManager } = require('../../../../src/checkpoint/CycleData')
const { originalTxCheckpointManager: mockOriginalTxManager } = require('../../../../src/checkpoint/OriginalTxsData')
const { receiptCheckpointManager: mockReceiptManager } = require('../../../../src/checkpoint/ReceiptData')

describe('checkpoint/Utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('getCheckpointManager', () => {
    it('should return cycle checkpoint manager for CheckpointType.Cycle', () => {
      const manager = getCheckpointManager(CheckpointType.Cycle)
      expect(manager).toBe(mockCycleManager)
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should return original tx checkpoint manager for CheckpointType.OriginalTx', () => {
      const manager = getCheckpointManager(CheckpointType.OriginalTx)
      expect(manager).toBe(mockOriginalTxManager)
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should return receipt checkpoint manager for CheckpointType.Receipt', () => {
      const manager = getCheckpointManager(CheckpointType.Receipt)
      expect(manager).toBe(mockReceiptManager)
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should return undefined for invalid checkpoint type', () => {
      const invalidType = 999 as CheckpointType // Using number outside enum range
      const manager = getCheckpointManager(invalidType)
      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should return undefined for undefined checkpoint type', () => {
      const manager = getCheckpointManager(undefined as any)
      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should return undefined for null checkpoint type', () => {
      const manager = getCheckpointManager(null as any)
      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should handle numeric checkpoint types', () => {
      // CheckpointType might be an enum with numeric values
      const numericTypes = [0, 1, 2, 3, 4, 5]

      numericTypes.forEach((type) => {
        const manager = getCheckpointManager(type as CheckpointType)
        // Should return manager for valid enum values, undefined for invalid ones
        if (type === CheckpointType.Cycle || type === CheckpointType.OriginalTx || type === CheckpointType.Receipt) {
          expect(manager).toBeDefined()
        } else {
          expect(manager).toBeUndefined()
        }
      })
    })

    it('should be case-sensitive for string checkpoint types', () => {
      // Test various string cases that might not match enum values
      const invalidCases = ['CYCLE', 'cycle', 'Cycle', 'ORIGINALTX', 'originaltx', 'RECEIPT', 'receipt']

      invalidCases.forEach((invalidCase) => {
        const manager = getCheckpointManager(invalidCase as any)
        // These should all return undefined as they don't match the enum exactly
        expect(manager).toBeUndefined()
      })
    })

    it('should handle errors gracefully', () => {
      // Create a proxy that throws on property access
      const throwingCheckpointType = new Proxy(
        {},
        {
          get() {
            throw new Error('Test error')
          },
        }
      ) as CheckpointType

      const manager = getCheckpointManager(throwingCheckpointType)

      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error getting checkpoint manager:', expect.any(Error))
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Error getting checkpoint manager:',
        expect.objectContaining({ message: 'Test error' })
      )
    })

    it('should handle multiple calls efficiently', () => {
      // Test that the function returns consistent results
      const manager1 = getCheckpointManager(CheckpointType.Cycle)
      const manager2 = getCheckpointManager(CheckpointType.Cycle)
      const manager3 = getCheckpointManager(CheckpointType.Cycle)

      expect(manager1).toBe(manager2)
      expect(manager2).toBe(manager3)
      expect(manager1).toBe(mockCycleManager)
    })

    it('should work with all valid CheckpointType values', () => {
      // Test all valid checkpoint types
      const validTypes = [CheckpointType.Cycle, CheckpointType.OriginalTx, CheckpointType.Receipt]

      const expectedManagers = [mockCycleManager, mockOriginalTxManager, mockReceiptManager]

      validTypes.forEach((type, index) => {
        const manager = getCheckpointManager(type)
        expect(manager).toBe(expectedManagers[index])
      })
    })

    it('should not modify the checkpoint type parameter', () => {
      const originalType = CheckpointType.Cycle
      const typeCopy = originalType

      getCheckpointManager(originalType)

      expect(originalType).toBe(typeCopy)
    })

    it('should handle Symbol checkpoint types', () => {
      const symbolType = Symbol('checkpoint') as any
      const manager = getCheckpointManager(symbolType)

      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })

    it('should handle object checkpoint types', () => {
      const objectType = { toString: () => 'Cycle' } as any
      const manager = getCheckpointManager(objectType)

      expect(manager).toBeUndefined()
      expect(Logger.mainLogger.error).not.toHaveBeenCalled()
    })
  })

  describe('checkpointManagers mapping', () => {
    it('should have all checkpoint types mapped', () => {
      // Verify that all checkpoint types have managers
      const allTypes = [CheckpointType.Cycle, CheckpointType.OriginalTx, CheckpointType.Receipt]

      allTypes.forEach((type) => {
        const manager = getCheckpointManager(type)
        expect(manager).toBeDefined()
        expect(manager).not.toBeNull()
      })
    })

    it('should return unique managers for different types', () => {
      const cycleManager = getCheckpointManager(CheckpointType.Cycle)
      const originalTxManager = getCheckpointManager(CheckpointType.OriginalTx)
      const receiptManager = getCheckpointManager(CheckpointType.Receipt)

      // All managers should be different objects
      expect(cycleManager).not.toBe(originalTxManager)
      expect(cycleManager).not.toBe(receiptManager)
      expect(originalTxManager).not.toBe(receiptManager)
    })
  })

  describe('Error handling', () => {
    it('should log error with correct format', () => {
      const testError = new Error('Custom test error')

      // Create a scenario that throws
      const throwingType = new Proxy(
        {},
        {
          get() {
            throw testError
          },
        }
      ) as CheckpointType

      getCheckpointManager(throwingType)

      expect(Logger.mainLogger.error).toHaveBeenCalledTimes(1)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error getting checkpoint manager:', testError)
    })

    it('should continue to work after an error', () => {
      // First call with error
      const throwingType = new Proxy(
        {},
        {
          get() {
            throw new Error('Error')
          },
        }
      ) as CheckpointType

      const errorResult = getCheckpointManager(throwingType)
      expect(errorResult).toBeUndefined()

      // Subsequent calls should still work
      const validResult = getCheckpointManager(CheckpointType.Cycle)
      expect(validResult).toBe(mockCycleManager)
    })
  })
})
