import { jest } from '@jest/globals'

// Import dependencies first so we can mock them
import * as Crypto from '../../../../src/Crypto'
import * as StateMetaData from '../../../../src/archivedCycle/StateMetaData'
import * as State from '../../../../src/State'
import * as P2P from '../../../../src/P2P'
import { config } from '../../../../src/Config'
import * as Logger from '../../../../src/Logger'

// Add SpyInstance type explicitly
type SpyInstance = ReturnType<typeof jest.spyOn>

// Mock the modules
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/archivedCycle/StateMetaData')
jest.mock('../../../../src/State')
jest.mock('../../../../src/P2P')
jest.mock('../../../../src/Config')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}))

// Import the module being tested after mocks are in place
import * as Gossip from '../../../../src/archivedCycle/Gossip'

describe('Gossip', () => {
  // Setup spies
  let postJsonSpy: SpyInstance
  let loggerDebugSpy: SpyInstance
  let loggerErrorSpy: SpyInstance
  let stateMetaDataMapGetSpy: SpyInstance
  let hashObjSpy: SpyInstance
  let processStateMetaDataSpy: SpyInstance

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks()

    // Setup spies
    postJsonSpy = jest.spyOn(P2P, 'postJson').mockImplementation(() => Promise.resolve({ success: true } as any))

    hashObjSpy = jest.spyOn(Crypto, 'hashObj').mockImplementation((obj) => JSON.stringify(obj))

    // Setup mock State
    jest.spyOn(State, 'getNodeInfo').mockReturnValue({
      publicKey: 'test-public-key',
    } as any)

    // Setup mock config
    // @ts-ignore - We know these properties exist and we're mocking them
    config.ARCHIVER_PUBLIC_KEY = 'test-public-key'
    // @ts-ignore
    config.VERBOSE = false

    // Setup mock logger spies
    loggerDebugSpy = jest.spyOn(Logger.mainLogger, 'debug')
    loggerErrorSpy = jest.spyOn(Logger.mainLogger, 'error')

    // Setup mock StateMetaData
    // @ts-ignore
    StateMetaData.StateMetaDataMap = new Map()
    stateMetaDataMapGetSpy = jest.spyOn(StateMetaData.StateMetaDataMap, 'get').mockImplementation(jest.fn())

    // Fix the return type to match required Promise<void>
    processStateMetaDataSpy = jest
      .spyOn(StateMetaData, 'processStateMetaData')
      .mockImplementation(() => Promise.resolve())

    jest.spyOn(StateMetaData, 'replaceDataSender').mockImplementation(() => Promise.resolve())

    // @ts-ignore
    StateMetaData.currentDataSender = 'test-sender'

    // Setup mock activeArchivers
    const mockActiveArchivers = [
      {
        publicKey: 'archiver1',
        ip: '127.0.0.1',
        port: 4001,
      },
      {
        publicKey: 'archiver2',
        ip: '127.0.0.1',
        port: 4002,
      },
      {
        publicKey: 'test-public-key',
        ip: '127.0.0.1',
        port: 4000,
      },
    ]

    // Mock the activeArchivers property
    Object.defineProperty(State, 'activeArchivers', {
      get: jest.fn(() => mockActiveArchivers),
    })
  })

  describe('sendGossip', () => {
    it('should send gossip to other archivers', async () => {
      const type = 'hashes'
      const payload = { data: 'test-payload' }

      await Gossip.sendGossip(type, payload)

      // Check that postJson was called once for each other archiver
      expect(postJsonSpy).toHaveBeenCalledTimes(2)

      // Check that correct URLs were used
      expect(postJsonSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:4001/gossip-hashes',
        expect.objectContaining({
          type,
          data: payload,
          sender: 'test-public-key',
        })
      )

      expect(postJsonSpy).toHaveBeenCalledWith(
        'http://127.0.0.1:4002/gossip-hashes',
        expect.objectContaining({
          type,
          data: payload,
          sender: 'test-public-key',
        })
      )
    })

    it('should not send gossip if there are no other archivers', async () => {
      // Setup State mock with only the current archiver
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          {
            publicKey: 'test-public-key',
            ip: '127.0.0.1',
            port: 4000,
          },
        ]),
      })

      const type = 'hashes'
      const payload = { data: 'test-payload' }

      await Gossip.sendGossip(type, payload)

      // Check that P2P.postJson was not called
      expect(postJsonSpy).not.toHaveBeenCalled()

      // Check that log message was created
      expect(loggerDebugSpy).toHaveBeenCalledWith('There is no other archivers to send our gossip')
    })

    it('should attempt to call postJson even if it might fail', async () => {
      const type = 'hashes'
      const payload = { data: 'test-payload' }

      await Gossip.sendGossip(type, payload)

      // Check that postJson was called
      expect(postJsonSpy).toHaveBeenCalledTimes(2)
    })

    it('should handle postJson failures gracefully', async () => {
      // Mock postJson to reject
      postJsonSpy.mockRejectedValue(new Error('Network error'))

      const type = 'hashes'
      const payload = { data: 'test-payload' }

      // Should not throw even if postJson fails
      await expect(Gossip.sendGossip(type, payload)).resolves.not.toThrow()

      // Check that postJson was called
      expect(postJsonSpy).toHaveBeenCalledTimes(2)
    })

    it('should handle mixed success and failure responses', async () => {
      // Mock postJson to succeed for first call, fail for second
      postJsonSpy.mockResolvedValueOnce({ success: true } as any).mockRejectedValueOnce(new Error('Network error'))

      const type = 'hashes'
      const payload = { data: 'test-payload' }

      // Should not throw
      await expect(Gossip.sendGossip(type, payload)).resolves.not.toThrow()

      // Check that both calls were made
      expect(postJsonSpy).toHaveBeenCalledTimes(2)
    })

    it('should send gossip with correct payload structure', async () => {
      const type = 'metadata'
      const payload = {
        cycleNumber: 100,
        metadata: { someKey: 'someValue' },
      }

      await Gossip.sendGossip(type, payload)

      // Verify the payload structure
      expect(postJsonSpy).toHaveBeenCalledWith(expect.any(String), {
        type: 'metadata',
        data: payload,
        sender: 'test-public-key',
      })
    })
  })

  describe('convertStateMetadataToHashArray', () => {
    it('should convert state metadata to hash array', () => {
      const stateMetadata = {
        stateHashes: [
          {
            counter: 1,
            partitionHashes: {},
            networkHash: 'hash1',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt1',
          },
          {
            counter: 2,
            partitionHashes: {},
            networkHash: 'hash2',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt2',
          },
        ],
        receiptHashes: [
          {
            counter: 1,
            partitionHashes: {},
            networkHash: 'hash3',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt3',
          },
          {
            counter: 3,
            partitionHashes: {},
            networkHash: 'hash4',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt4',
          },
        ],
        summaryHashes: [
          {
            counter: 2,
            partitionHashes: {},
            networkHash: 'hash5',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt5',
          },
          {
            counter: 3,
            partitionHashes: {},
            networkHash: 'hash6',
            receiptMapHashes: {},
            networkReceiptHash: 'receipt6',
          },
        ],
      }

      const result = Gossip.convertStateMetadataToHashArray(stateMetadata)

      // Check that the result has the correct structure
      expect(result).toHaveLength(3)

      // Check for counter 1
      const counter1 = result.find((item) => item.counter === 1)
      expect(counter1).toBeDefined()
      expect(counter1?.stateHashes).toEqual(stateMetadata.stateHashes[0])
      expect(counter1?.receiptHashes).toEqual(stateMetadata.receiptHashes[0])
      expect(counter1?.summaryHashes).toBeUndefined()

      // Check for counter 2
      const counter2 = result.find((item) => item.counter === 2)
      expect(counter2).toBeDefined()
      expect(counter2?.stateHashes).toEqual(stateMetadata.stateHashes[1])
      expect(counter2?.receiptHashes).toBeUndefined()
      expect(counter2?.summaryHashes).toEqual(stateMetadata.summaryHashes[0])

      // Check for counter 3
      const counter3 = result.find((item) => item.counter === 3)
      expect(counter3).toBeDefined()
      expect(counter3?.stateHashes).toBeUndefined()
      expect(counter3?.receiptHashes).toEqual(stateMetadata.receiptHashes[1])
      expect(counter3?.summaryHashes).toEqual(stateMetadata.summaryHashes[1])
    })

    it('should handle empty state metadata', () => {
      const stateMetadata = {
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      const result = Gossip.convertStateMetadataToHashArray(stateMetadata)

      expect(result).toEqual([])
    })
  })

  describe('addHashesGossip', () => {
    let setTimeoutSpy: SpyInstance

    beforeEach(() => {
      jest.useFakeTimers()
      setTimeoutSpy = jest.spyOn(global, 'setTimeout')
    })

    afterEach(() => {
      jest.useRealTimers()
      setTimeoutSpy.mockRestore()
    })

    it('should add gossip from a sender', () => {
      const gossip = {
        counter: 1,
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add single gossip
      Gossip.addHashesGossip('archiver1', gossip)

      // Should not trigger processing yet (below threshold)
      expect(setTimeoutSpy).not.toHaveBeenCalled()
    })

    it('should trigger processing when threshold is reached', () => {
      // Setup state with 4 archivers (threshold > 0.5 * 4 = 2)
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
        ]),
      })

      const gossip = {
        counter: 1,
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add gossips from different senders
      Gossip.addHashesGossip('archiver1', gossip)
      expect(setTimeoutSpy).not.toHaveBeenCalled()

      Gossip.addHashesGossip('archiver2', gossip)
      expect(setTimeoutSpy).not.toHaveBeenCalled()

      // This should trigger processing (3 > 0.5 * 4)
      Gossip.addHashesGossip('archiver3', gossip)
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500)
    })

    it('should handle multiple counters independently', () => {
      // Clear any existing timers from previous tests
      jest.clearAllTimers()
      setTimeoutSpy.mockClear()

      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
        ]),
      })

      const gossip1 = {
        counter: 10, // Use different counters to avoid collision
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      const gossip2 = {
        counter: 20, // Use different counters to avoid collision
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add gossips for different counters
      Gossip.addHashesGossip('archiver1', gossip1)
      Gossip.addHashesGossip('archiver1', gossip2)
      Gossip.addHashesGossip('archiver2', gossip1)

      // Neither should trigger yet
      expect(setTimeoutSpy).not.toHaveBeenCalled()

      // Trigger counter 1
      Gossip.addHashesGossip('archiver3', gossip1)
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1)

      // Trigger counter 2
      Gossip.addHashesGossip('archiver2', gossip2)
      Gossip.addHashesGossip('archiver3', gossip2)
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2)
    })

    it('should process gossip and call processStateMetaData when our hash differs', async () => {
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
        ]),
      })

      // Mock our stored hashes
      const ourHashes = {
        counter: 1,
        stateHashes: [
          {
            counter: 1,
            networkHash: 'our-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'receipt-hash',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }
      stateMetaDataMapGetSpy.mockReturnValue(ourHashes)

      // Mock hashObj to return different hashes
      hashObjSpy.mockImplementation((obj: any) => {
        if (obj === ourHashes) return 'our-hash-string'
        return 'different-hash-string'
      })

      const differentGossip = {
        counter: 1,
        stateHashes: [
          {
            counter: 1,
            networkHash: 'different-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'different-receipt-hash',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add gossips from multiple senders with same (different) hash
      Gossip.addHashesGossip('archiver1', differentGossip)
      Gossip.addHashesGossip('archiver2', differentGossip)
      Gossip.addHashesGossip('archiver3', differentGossip)

      // Run the timer
      jest.runAllTimers()

      // Verify processStateMetaData was called
      expect(processStateMetaDataSpy).toHaveBeenCalledWith({
        gossipWithHighestCount: expect.any(Object),
      })
    })

    it('should not process if our hash matches the majority', async () => {
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
        ]),
      })

      const sameHashes = {
        counter: 1,
        stateHashes: [
          {
            counter: 1,
            networkHash: 'same-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'same-receipt-hash',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      stateMetaDataMapGetSpy.mockReturnValue(sameHashes)
      hashObjSpy.mockReturnValue('same-hash-string')

      // Add gossips with same hash
      Gossip.addHashesGossip('archiver1', sameHashes)
      Gossip.addHashesGossip('archiver2', sameHashes)
      Gossip.addHashesGossip('archiver3', sameHashes)

      // Run the timer
      jest.runAllTimers()

      // Verify processStateMetaData was NOT called
      expect(processStateMetaDataSpy).not.toHaveBeenCalled()
    })

    it('should handle case when StateMetaDataMap returns undefined', () => {
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
        ]),
      })

      // Mock StateMetaDataMap to return undefined
      stateMetaDataMapGetSpy.mockReturnValue(undefined)

      const gossip = {
        counter: 1,
        stateHashes: [],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add gossips to trigger processing
      Gossip.addHashesGossip('archiver1', gossip)
      Gossip.addHashesGossip('archiver2', gossip)
      Gossip.addHashesGossip('archiver3', gossip)

      // Run the timer
      jest.runAllTimers()

      // Verify processStateMetaData was not called
      expect(processStateMetaDataSpy).not.toHaveBeenCalled()

      // Verify error was logged
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unable to find our stored statemetadata hashes')
      )
    })

    it('should update existing gossip from same sender', () => {
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [{ publicKey: 'archiver1' }, { publicKey: 'archiver2' }]),
      })

      const gossip1 = {
        counter: 1,
        stateHashes: [
          {
            counter: 1,
            networkHash: 'hash1',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'receipt1',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      const gossip2 = {
        counter: 1,
        stateHashes: [
          {
            counter: 1,
            networkHash: 'hash2',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'receipt2',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      // Add initial gossip
      Gossip.addHashesGossip('archiver1', gossip1)

      // Update gossip from same sender
      Gossip.addHashesGossip('archiver1', gossip2)

      // Should still only count as one sender
      expect(setTimeoutSpy).not.toHaveBeenCalled()
    })
  })

  describe('Integration tests', () => {
    it('should handle complete gossip flow with network consensus', async () => {
      jest.useFakeTimers()
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      // Setup network with 5 archivers
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'archiver4' },
          { publicKey: 'test-public-key' }, // our archiver
        ]),
      })

      // Mock our stored hashes (minority)
      const ourHashes = {
        counter: 100,
        stateHashes: [
          {
            counter: 100,
            networkHash: 'minority-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'minority-receipt',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }
      stateMetaDataMapGetSpy.mockReturnValue(ourHashes)

      // Mock hashObj to simulate consensus
      const majorityGossip = {
        counter: 100,
        stateHashes: [
          {
            counter: 100,
            networkHash: 'majority-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'majority-receipt',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      hashObjSpy.mockImplementation((obj: any) => {
        if (obj === ourHashes) return 'minority-hash-string'
        if (JSON.stringify(obj) === JSON.stringify(majorityGossip)) return 'majority-hash-string'
        return 'other-hash-string'
      })

      // Simulate gossips from other archivers (3 with majority, 1 with different)
      Gossip.addHashesGossip('archiver1', majorityGossip)
      Gossip.addHashesGossip('archiver2', majorityGossip)

      // One archiver has a different hash
      const differentGossip = {
        counter: 100,
        stateHashes: [
          {
            counter: 100,
            networkHash: 'different-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'different-receipt',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }
      Gossip.addHashesGossip('archiver3', differentGossip)

      // This should trigger processing (> 0.5 * 5 = 2.5)
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 500)

      // Run the timer to process gossip
      jest.runAllTimers()

      // Verify that we detected the discrepancy and called processStateMetaData
      expect(processStateMetaDataSpy).toHaveBeenCalledWith({
        gossipWithHighestCount: expect.arrayContaining([majorityGossip]),
      })

      // Verify replaceDataSender was called
      expect(StateMetaData.replaceDataSender).toHaveBeenCalledWith('test-sender')

      // Verify error logging
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'our hash is different from other archivers hashes. Storing the correct hashes'
      )

      jest.useRealTimers()
    })

    it('should handle gossip when all archivers agree', async () => {
      jest.useFakeTimers()

      // Setup network
      Object.defineProperty(State, 'activeArchivers', {
        get: jest.fn(() => [
          { publicKey: 'archiver1' },
          { publicKey: 'archiver2' },
          { publicKey: 'archiver3' },
          { publicKey: 'test-public-key' },
        ]),
      })

      const consensusGossip = {
        counter: 200,
        stateHashes: [
          {
            counter: 200,
            networkHash: 'consensus-hash',
            partitionHashes: {},
            receiptMapHashes: {},
            networkReceiptHash: 'consensus-receipt',
          },
        ],
        receiptHashes: [],
        summaryHashes: [],
      }

      stateMetaDataMapGetSpy.mockReturnValue(consensusGossip)
      hashObjSpy.mockReturnValue('consensus-hash-string')

      // All archivers send the same gossip
      Gossip.addHashesGossip('archiver1', consensusGossip)
      Gossip.addHashesGossip('archiver2', consensusGossip)
      Gossip.addHashesGossip('archiver3', consensusGossip)

      // Run the timer
      jest.runAllTimers()

      // Verify processStateMetaData was NOT called (we're in consensus)
      expect(processStateMetaDataSpy).not.toHaveBeenCalled()

      // Verify no error was logged
      expect(Logger.mainLogger.error).not.toHaveBeenCalledWith(expect.stringContaining('our hash is different'))

      jest.useRealTimers()
    })
  })
})
