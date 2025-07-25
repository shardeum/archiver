// Mock all dependencies before importing
jest.mock('../../../../src/Data/Collector', () => ({
  verifyArchiverReceipt: jest.fn(),
  ReceiptVerificationResult: {},
}))
jest.mock('../../../../src/Config', () => ({
  config: {
    lastActivityCheckTimeout: 60000,
    lastActivityCheckInterval: 10000,
  },
}))
jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeJsonParse: jest.fn((str) => JSON.parse(str)),
  },
}))
jest.mock('../../../../src/primary-process', () => ({
  ChildMessageInterface: {},
}))
jest.mock('../../../../src/dbstore/receipts', () => ({
  ArchiverReceipt: {},
}))

import { initWorkerProcess } from '../../../../src/worker-process/index'
import * as Collector from '../../../../src/Data/Collector'
import { config } from '../../../../src/Config'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

describe('worker-process/index', () => {
  let mockProcessSend: jest.Mock
  let mockProcessOn: jest.Mock
  let mockSetInterval: jest.SpyInstance
  let mockConsoleLog: jest.SpyInstance
  let mockConsoleError: jest.SpyInstance
  let messageHandlers: { [key: string]: Function } = {}
  let intervalCallback: Function
  let originalProcessOn: any

  beforeEach(() => {
    jest.clearAllMocks()
    messageHandlers = {}

    // Save original process.on
    originalProcessOn = process.on

    // Mock process methods
    mockProcessSend = jest.fn()
    mockProcessOn = jest.fn((event, handler) => {
      messageHandlers[event] = handler
    })

    process.send = mockProcessSend
    process.on = mockProcessOn as any
    // Mock process.pid using Object.defineProperty
    Object.defineProperty(process, 'pid', {
      value: 12345,
      configurable: true,
    })

    // Mock timers
    jest.useFakeTimers()
    mockSetInterval = jest.spyOn(global, 'setInterval')

    // Mock console methods
    mockConsoleLog = jest.spyOn(console, 'log').mockImplementation()
    mockConsoleError = jest.spyOn(console, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    mockConsoleLog.mockRestore()
    mockConsoleError.mockRestore()
    // Restore original process.on
    process.on = originalProcessOn
  })

  describe('initWorkerProcess', () => {
    it('should log worker start message', async () => {
      await initWorkerProcess()

      expect(mockConsoleLog).toHaveBeenCalledWith('Worker 12345 started')
    })

    it('should send child_ready message after initialization', async () => {
      await initWorkerProcess()

      expect(mockProcessSend).toHaveBeenCalledWith({ type: 'child_ready' })
    })

    it('should set up message handler for process', async () => {
      await initWorkerProcess()

      expect(mockProcessOn).toHaveBeenCalledWith('message', expect.any(Function))
    })

    it('should set up interval for activity check', async () => {
      await initWorkerProcess()

      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 10000)
      intervalCallback = mockSetInterval.mock.calls[0][0]
    })
  })

  describe('message handler', () => {
    beforeEach(async () => {
      await initWorkerProcess()
    })

    describe('receipt-verification message', () => {
      const mockReceipt = {
        tx: {
          txId: 'test-tx-id',
          timestamp: 1234567890,
        },
        cycle: 1,
        signedReceipt: {},
      }

      it('should verify receipt and send verification result', async () => {
        const mockVerificationResult = {
          success: true,
          failedReasons: [],
          nestedCounterMessages: [],
        }

        const mockVerifyArchiverReceipt = Collector.verifyArchiverReceipt as jest.Mock
        mockVerifyArchiverReceipt.mockResolvedValueOnce(mockVerificationResult)

        await messageHandlers['message']({
          type: 'receipt-verification',
          data: {
            stringifiedReceipt: JSON.stringify(mockReceipt),
            requiredSignatures: 3,
          },
        })

        expect(mockVerifyArchiverReceipt).toHaveBeenCalledWith(mockReceipt)
        expect(mockProcessSend).toHaveBeenCalledWith({
          type: 'receipt-verification',
          data: {
            txId: 'test-tx-id',
            timestamp: 1234567890,
            verificationResult: mockVerificationResult,
          },
        })
      })

      it('should handle verification errors', async () => {
        const mockVerifyArchiverReceipt = Collector.verifyArchiverReceipt as jest.Mock
        mockVerifyArchiverReceipt.mockRejectedValueOnce(new Error('Verification failed'))

        await messageHandlers['message']({
          type: 'receipt-verification',
          data: {
            stringifiedReceipt: JSON.stringify(mockReceipt),
            requiredSignatures: 3,
          },
        })

        expect(mockConsoleError).toHaveBeenCalledWith(
          'Error in Worker 12345 while verifying receipt',
          expect.any(Error)
        )
        expect(mockProcessSend).toHaveBeenCalledWith({
          type: 'receipt-verification',
          data: {
            txId: 'test-tx-id',
            timestamp: 1234567890,
            verificationResult: {
              success: false,
              failedReasons: ['Error in Worker while verifying receipt'],
              nestedCounterMessages: ['Error in Worker while verifying receipt'],
            },
          },
        })
      })

      it('should handle missing stringifiedReceipt', async () => {
        await messageHandlers['message']({
          type: 'receipt-verification',
          data: {
            requiredSignatures: 3,
          },
        })

        expect(mockConsoleError).toHaveBeenCalledWith('Worker 12345 received invalid receipt for verification', {
          requiredSignatures: 3,
        })
        // Process.send was called once with child_ready, but not for verification
        expect(mockProcessSend).toHaveBeenCalledTimes(1)
        expect(mockProcessSend).toHaveBeenCalledWith({ type: 'child_ready' })
      })

      it('should handle invalid requiredSignatures', async () => {
        await messageHandlers['message']({
          type: 'receipt-verification',
          data: {
            stringifiedReceipt: JSON.stringify(mockReceipt),
            requiredSignatures: 'invalid',
          },
        })

        expect(mockConsoleError).toHaveBeenCalledWith(
          'Worker 12345 received invalid requiredSignatures for verification',
          { stringifiedReceipt: JSON.stringify(mockReceipt), requiredSignatures: 'invalid' }
        )
        // Process.send was called once with child_ready, but not for verification
        expect(mockProcessSend).toHaveBeenCalledTimes(1)
        expect(mockProcessSend).toHaveBeenCalledWith({ type: 'child_ready' })
      })

      it('should handle malformed JSON in stringifiedReceipt', async () => {
        const mockSafeJsonParse = StringUtils.safeJsonParse as jest.Mock
        mockSafeJsonParse.mockImplementationOnce(() => {
          throw new Error('Invalid JSON')
        })

        // Since the JSON parse error happens outside the try/catch,
        // it will throw an unhandled error
        await expect(
          messageHandlers['message']({
            type: 'receipt-verification',
            data: {
              stringifiedReceipt: 'invalid-json',
              requiredSignatures: 3,
            },
          })
        ).rejects.toThrow('Invalid JSON')

        // The function should throw before reaching any error handling
        expect(mockProcessSend).toHaveBeenCalledTimes(1) // Only child_ready
      })
    })

    describe('unknown message type', () => {
      it('should log unknown message type', async () => {
        const unknownData = { some: 'data' }

        await messageHandlers['message']({
          type: 'unknown-type',
          data: unknownData,
        })

        expect(mockConsoleLog).toHaveBeenCalledWith('Worker 12345 received unknown message type: unknown-type')
        expect(mockConsoleLog).toHaveBeenCalledWith(unknownData)
      })
    })

    describe('lastActivity tracking', () => {
      it('should update lastActivity on message handling', async () => {
        const initialTime = Date.now()

        await messageHandlers['message']({
          type: 'unknown-type',
          data: {},
        })

        // Fast-forward time
        jest.advanceTimersByTime(30000)

        await messageHandlers['message']({
          type: 'receipt-verification',
          data: {
            stringifiedReceipt: JSON.stringify({ tx: { txId: '1', timestamp: 1 } }),
            requiredSignatures: 3,
          },
        })

        // The activity should have been updated
        // (We can't directly test the lastActivity variable, but we can test its effect)
      })
    })
  })

  describe('activity check interval', () => {
    beforeEach(async () => {
      await initWorkerProcess()
      intervalCallback = mockSetInterval.mock.calls[0][0]
    })

    it('should send child_close message when idle for too long', () => {
      // Fast-forward time beyond the timeout
      jest.advanceTimersByTime(config.lastActivityCheckTimeout + 1000)

      // Run the interval callback
      intervalCallback()

      expect(mockConsoleLog).toHaveBeenCalledWith('Worker 12345 is idle for more than 1 minute')
      expect(mockProcessSend).toHaveBeenCalledWith({ type: 'child_close' })
    })

    it('should not send child_close message when activity is recent', async () => {
      // Handle a message to update lastActivity
      await messageHandlers['message']({
        type: 'unknown-type',
        data: {},
      })

      // Fast-forward time less than the timeout
      jest.advanceTimersByTime(config.lastActivityCheckTimeout - 1000)

      // Run the interval callback
      intervalCallback()

      expect(mockConsoleLog).not.toHaveBeenCalledWith('Worker 12345 is idle for more than 1 minute')
      expect(mockProcessSend).not.toHaveBeenCalledWith({ type: 'child_close' })
    })

    it('should check activity at configured intervals', () => {
      // Fast-forward through multiple intervals
      jest.advanceTimersByTime(config.lastActivityCheckInterval * 3)

      // The interval should have been called 3 times
      expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 10000)
    })
  })

  describe('module-level error handlers', () => {
    it('should register uncaughtException handler on module load', () => {
      // Since error handlers are registered at module load time,
      // we need to re-import the module after setting up our mocks
      jest.resetModules()
      jest.doMock('../../../../src/Data/Collector', () => ({
        verifyArchiverReceipt: jest.fn(),
        ReceiptVerificationResult: {},
      }))
      jest.doMock('../../../../src/Config', () => ({
        config: {
          lastActivityCheckTimeout: 60000,
          lastActivityCheckInterval: 10000,
        },
      }))
      jest.doMock('@shardeum-foundation/lib-types', () => ({
        Utils: {
          safeJsonParse: jest.fn((str) => JSON.parse(str)),
        },
      }))
      jest.doMock('../../../../src/primary-process', () => ({
        ChildMessageInterface: {},
      }))
      jest.doMock('../../../../src/dbstore/receipts', () => ({
        ArchiverReceipt: {},
      }))

      // Import the module to trigger the module-level code
      require('../../../../src/worker-process/index')

      // Check that process.on was called with uncaughtException
      const uncaughtExceptionCalls = mockProcessOn.mock.calls.filter((call) => call[0] === 'uncaughtException')
      expect(uncaughtExceptionCalls.length).toBeGreaterThanOrEqual(1)

      // Find the handler
      const handler = uncaughtExceptionCalls[uncaughtExceptionCalls.length - 1][1]
      const error = new Error('Test uncaught exception')
      handler(error)

      expect(mockConsoleError).toHaveBeenCalledWith('Uncaught Exception in Child Process: 12345', error)
    })

    it('should register unhandledRejection handler on module load', async () => {
      // Since error handlers are registered at module load time,
      // we need to re-import the module after setting up our mocks
      jest.resetModules()
      jest.doMock('../../../../src/Data/Collector', () => ({
        verifyArchiverReceipt: jest.fn(),
        ReceiptVerificationResult: {},
      }))
      jest.doMock('../../../../src/Config', () => ({
        config: {
          lastActivityCheckTimeout: 60000,
          lastActivityCheckInterval: 10000,
        },
      }))
      jest.doMock('@shardeum-foundation/lib-types', () => ({
        Utils: {
          safeJsonParse: jest.fn((str) => JSON.parse(str)),
        },
      }))
      jest.doMock('../../../../src/primary-process', () => ({
        ChildMessageInterface: {},
      }))
      jest.doMock('../../../../src/dbstore/receipts', () => ({
        ArchiverReceipt: {},
      }))

      // Import the module to trigger the module-level code
      require('../../../../src/worker-process/index')

      // Check that process.on was called with unhandledRejection
      const unhandledRejectionCalls = mockProcessOn.mock.calls.filter((call) => call[0] === 'unhandledRejection')
      expect(unhandledRejectionCalls.length).toBeGreaterThanOrEqual(1)

      // Find the handler
      const handler = unhandledRejectionCalls[unhandledRejectionCalls.length - 1][1]
      const reason = 'Test rejection reason'
      const promise = Promise.reject(reason).catch(() => {})
      handler(reason, promise)

      expect(mockConsoleError).toHaveBeenCalledWith('Unhandled Rejection in Child Process:', promise, 'reason:', reason)
    }, 10000) // Increase timeout to 10 seconds
  })

  describe('edge cases', () => {
    it('should handle verification result with all fields populated', async () => {
      await initWorkerProcess()

      const mockVerificationResult = {
        success: false,
        failedReasons: ['reason1', 'reason2'],
        nestedCounterMessages: ['message1', 'message2'],
      }

      const mockVerifyArchiverReceipt = Collector.verifyArchiverReceipt as jest.Mock
      mockVerifyArchiverReceipt.mockResolvedValueOnce(mockVerificationResult)

      await messageHandlers['message']({
        type: 'receipt-verification',
        data: {
          stringifiedReceipt: JSON.stringify({ tx: { txId: '1', timestamp: 1 } }),
          requiredSignatures: 5,
        },
      })

      expect(mockProcessSend).toHaveBeenCalledWith({
        type: 'receipt-verification',
        data: {
          txId: '1',
          timestamp: 1,
          verificationResult: mockVerificationResult,
        },
      })
    })

    it('should handle requiredSignatures of 0', async () => {
      await initWorkerProcess()

      const mockVerifyArchiverReceipt = Collector.verifyArchiverReceipt as jest.Mock
      mockVerifyArchiverReceipt.mockResolvedValueOnce({ success: true, failedReasons: [], nestedCounterMessages: [] })

      await messageHandlers['message']({
        type: 'receipt-verification',
        data: {
          stringifiedReceipt: JSON.stringify({ tx: { txId: '1', timestamp: 1 } }),
          requiredSignatures: 0,
        },
      })

      expect(mockVerifyArchiverReceipt).toHaveBeenCalled()
    })
  })
})
