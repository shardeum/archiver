import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import { P2P } from '@shardeum-foundation/lib-types'
import { ok, err } from 'neverthrow'
import * as Utils from '../../../../src/Utils'
import * as P2PModule from '../../../../src/P2P'

// Mock dependencies
jest.mock('../../../../src/Utils', () => ({
  attempt: jest.fn(),
  robustQuery: jest.fn(),
}))

jest.mock('../../../../src/P2P', () => ({
  get: jest.fn(),
}))

// Import after mocks
import {
  robustQueryForCycleRecordHash,
  robustQueryForValidatorListHash,
  robustQueryForArchiverListHash,
  robustQueryForStandbyNodeListHash,
  robustQueryForTxListHash,
  getCurrentCycleDataFromNode,
  getValidatorListFromNode,
  getArchiverListFromNode,
  getStandbyNodeListFromNode,
  getTxListFromNode,
} from '../../../../src/sync-v2/queries'

describe('sync-v2/queries', () => {
  // Type aliases
  type ActiveNode = P2P.SyncTypes.ActiveNode
  type Validator = P2P.NodeListTypes.Node
  type Archiver = P2P.ArchiversTypes.JoinedArchiver
  type CycleRecord = P2P.CycleCreatorTypes.CycleRecord
  type JoinRequest = P2P.JoinTypes.JoinRequest

  // Mock data
  const mockNode: ActiveNode = {
    publicKey: 'pubkey1',
    ip: '127.0.0.1',
    port: 8080,
  }

  const mockNodes: ActiveNode[] = [
    mockNode,
    { publicKey: 'pubkey2', ip: '127.0.0.2', port: 8080 },
    { publicKey: 'pubkey3', ip: '127.0.0.3', port: 8080 },
  ]

  // Cast mocked functions
  const mockedAttempt = Utils.attempt as jest.MockedFunction<typeof Utils.attempt>
  const mockedRobustQuery = Utils.robustQuery as jest.MockedFunction<typeof Utils.robustQuery>
  const mockedGet = P2PModule.get as jest.MockedFunction<typeof P2PModule.get>

  // Spy on console methods
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>

  beforeEach(() => {
    jest.clearAllMocks()
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
  })

  describe('robustQueryForCycleRecordHash', () => {
    it('should return cycle record hash on successful robust query', async () => {
      const mockResult = { currentCycleHash: 'abc123' }

      mockedAttempt.mockResolvedValueOnce({
        count: 3,
        nodes: mockNodes,
        value: ok(mockResult),
      })

      const result = await robustQueryForCycleRecordHash(mockNodes)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.value).toEqual(mockResult)
        expect(result.value.winningNodes).toEqual(mockNodes)
      }
    })

    it('should return error if robust query fails', async () => {
      mockedAttempt.mockRejectedValueOnce(new Error('Network error'))

      const result = await robustQueryForCycleRecordHash(mockNodes)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('robust query failed for current-cycle-hash')
      }
    })

    it('should return error if result is not robust', async () => {
      mockedAttempt.mockResolvedValueOnce({
        count: 1, // Less than REDUNDANCY (3)
        nodes: [mockNode],
        value: ok({ currentCycleHash: 'abc123' }),
      })

      const result = await robustQueryForCycleRecordHash(mockNodes)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain("result of current-cycle-hash wasn't robust")
      }
    })

    it('should handle empty nodes array', async () => {
      // With empty nodes, robustQuery would likely fail
      mockedAttempt.mockRejectedValueOnce(new Error('No nodes available'))

      const result = await robustQueryForCycleRecordHash([])

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('robust query failed')
      }
    })
  })

  describe('robustQueryForValidatorListHash', () => {
    it('should return validator list hash and timestamp on success', async () => {
      const mockResult = { nodeListHash: 'hash123', nextCycleTimestamp: 1234567890 }

      mockedAttempt.mockResolvedValueOnce({
        count: 3,
        nodes: mockNodes,
        value: ok(mockResult),
      })

      const result = await robustQueryForValidatorListHash(mockNodes)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.value).toEqual(mockResult)
        expect(result.value.winningNodes).toEqual(mockNodes)
      }
    })

    it('should return error on query failure', async () => {
      mockedAttempt.mockRejectedValueOnce(new Error('Connection timeout'))

      const result = await robustQueryForValidatorListHash(mockNodes)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('robust query failed for validator-list-hash')
      }
    })
  })

  describe('robustQueryForArchiverListHash', () => {
    it('should return archiver list hash on success', async () => {
      const mockResult = { archiverListHash: 'archiverhash456' }

      mockedAttempt.mockResolvedValueOnce({
        count: 3,
        nodes: mockNodes,
        value: ok(mockResult),
      })

      const result = await robustQueryForArchiverListHash(mockNodes)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.value).toEqual(mockResult)
      }
    })
  })

  describe('robustQueryForStandbyNodeListHash', () => {
    it('should return standby node list hash on success', async () => {
      const mockResult = { standbyNodeListHash: 'standbyhash789' }

      mockedAttempt.mockResolvedValueOnce({
        count: 3,
        nodes: mockNodes,
        value: ok(mockResult),
      })

      const result = await robustQueryForStandbyNodeListHash(mockNodes)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.value).toEqual(mockResult)
      }
    })
  })

  describe('robustQueryForTxListHash', () => {
    it('should return tx list hash on success', async () => {
      const mockResult = { txListHash: 'txhash000' }

      mockedAttempt.mockResolvedValueOnce({
        count: 3,
        nodes: mockNodes,
        value: ok(mockResult),
      })

      const result = await robustQueryForTxListHash(mockNodes)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.value).toEqual(mockResult)
      }
    })
  })

  describe('getCurrentCycleDataFromNode', () => {
    it('should fetch cycle data successfully', async () => {
      const mockCycle = {
        networkId: 'network1',
        counter: 100,
        previous: 'prevmarker',
        start: 1234567890,
        duration: 60,
        networkConfigHash: 'confighash',
        mode: 'forming',
        safetyMode: false,
        safetyNum: 0,
        refreshedArchivers: [],
        refreshedConsensors: [],
        joinedArchivers: [],
        leavingArchivers: [],
        archiversAtShutdown: [],
        standbyAdd: [],
        standbyRemove: [],
        standbyNodeListHash: 'standbyhash',
        archiverListHash: 'archiverhash',
        lostArchivers: [],
        refutedArchivers: [],
        active: 10,
        syncing: 0,
        activated: [],
        activatedPublicKeys: [],
        maxSyncTime: 0,
        joined: ['node2'],
        returned: [],
        lost: [],
        refuted: [],
        appRemoved: [],
        apoptosized: ['node1'],
        expired: 0,
        removed: [],
        random: 123456,
        desired: 20,
        nodeListHash: 'nodehash',
        txadd: [],
        txremove: [],
        txlisthash: 'txlisthash',
        networkStateHash: 'statehash',
      } as unknown as CycleRecord

      mockedAttempt.mockResolvedValueOnce(mockCycle)
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => mockCycle,
      } as any)

      const result = await getCurrentCycleDataFromNode(mockNode, 'marker123')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockCycle)
      }
      expect(mockedAttempt).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxRetries: 3,
          logPrefix: 'syncv2-simple-fetch-cycle-by-marker',
        })
      )
    })

    it('should handle fetch errors', async () => {
      mockedAttempt.mockRejectedValueOnce(new Error('Fetch failed'))

      const result = await getCurrentCycleDataFromNode(mockNode, 'marker123')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('simple fetch failed for cycle-by-marker')
      }
    })

    it('should handle HTTP errors', async () => {
      mockedGet.mockResolvedValueOnce({
        ok: false,
        statusText: 'Not Found',
      } as any)

      mockedAttempt.mockRejectedValueOnce(new Error('get failed with status Not Found'))

      const result = await getCurrentCycleDataFromNode(mockNode, 'marker123')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('simple fetch failed')
      }
    })
  })

  describe('getValidatorListFromNode', () => {
    it('should fetch validator list successfully', async () => {
      const mockValidators: Validator[] = [
        {
          publicKey: 'pubkey1',
          id: 'id1',
          externalIp: '1.1.1.1',
          externalPort: 8080,
          internalIp: '192.168.1.1',
          internalPort: 8081,
          address: 'address1',
          joinRequestTimestamp: 1234567890,
          activeTimestamp: 1234567891,
          activeCycle: 100,
          syncingTimestamp: 0,
          readyTimestamp: 0,
          refreshedCounter: 0,
          cycleJoined: 'cycle1',
          counterRefreshed: 100,
          curvePublicKey: 'curvepub1',
          status: 'active' as any,
        },
      ]

      mockedAttempt.mockResolvedValueOnce(mockValidators)
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => mockValidators,
      } as any)

      const result = await getValidatorListFromNode(mockNode, 'hash123')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockValidators)
      }
      expect(consoleLogSpy).toHaveBeenCalledWith('getting validator list from 127.0.0.1:8080 with hash hash123')
    })

    it('should handle empty validator list', async () => {
      mockedAttempt.mockResolvedValueOnce([])
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as any)

      const result = await getValidatorListFromNode(mockNode, 'hash123')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual([])
      }
    })
  })

  describe('getArchiverListFromNode', () => {
    it('should fetch archiver list successfully', async () => {
      const mockArchivers: Archiver[] = [
        {
          publicKey: 'archiverpub1',
          ip: '2.2.2.2',
          port: 9090,
          curvePk: 'curvepk1',
        },
      ]

      mockedAttempt.mockResolvedValueOnce(mockArchivers)
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => mockArchivers,
      } as any)

      const result = await getArchiverListFromNode(mockNode, 'archiverhash')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockArchivers)
      }
      expect(consoleLogSpy).toHaveBeenCalledWith('getting archiver list from 127.0.0.1:8080 with hash archiverhash')
    })
  })

  describe('getStandbyNodeListFromNode', () => {
    it('should fetch standby node list successfully', async () => {
      const mockStandbyNodes: JoinRequest[] = [
        {
          nodeInfo: {
            publicKey: 'standbypub1',
            externalIp: '3.3.3.3',
            externalPort: 7070,
            internalIp: '192.168.1.3',
            internalPort: 7071,
            address: 'standbyaddr1',
            joinRequestTimestamp: 1234567890,
            activeTimestamp: 0,
            activeCycle: 0,
            syncingTimestamp: 0,
            readyTimestamp: 0,
            refreshedCounter: 0,
          },
          selectionNum: 'sel123',
          cycleMarker: 'marker123',
          proofOfWork: 'pow123',
          version: '1.0.0',
          sign: { owner: 'owner', sig: 'sig' },
        },
      ]

      mockedAttempt.mockResolvedValueOnce(mockStandbyNodes)
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => mockStandbyNodes,
      } as any)

      const result = await getStandbyNodeListFromNode(mockNode, 'standbyhash')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockStandbyNodes)
      }
    })
  })

  describe('getTxListFromNode', () => {
    it('should fetch tx list successfully', async () => {
      const mockTxList: P2P.ServiceQueueTypes.NetworkTxEntry[] = [
        {
          hash: 'txhash1',
          tx: {
            hash: 'txhash1',
            type: 'transfer',
            txData: {
              from: 'addr1',
              to: 'addr2',
              amount: 100,
            },
            cycle: 100,
            priority: 1,
          },
        },
      ]

      mockedAttempt.mockResolvedValueOnce(mockTxList)
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTxList,
      } as any)

      const result = await getTxListFromNode(mockNode, 'txlisthash')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockTxList)
      }
    })

    it('should handle network errors', async () => {
      mockedAttempt.mockRejectedValueOnce(new Error('Network unreachable'))

      const result = await getTxListFromNode(mockNode, 'txlisthash')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('simple fetch failed for tx-list')
      }
    })
  })

  describe('edge cases', () => {
    it('should handle node with different port', async () => {
      const customNode: ActiveNode = {
        ...mockNode,
        port: 3000,
      }

      mockedAttempt.mockImplementationOnce(async (fn) => {
        mockedGet.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ currentCycleHash: 'hash' }),
        } as any)
        return fn()
      })

      await getCurrentCycleDataFromNode(customNode, 'marker')

      expect(mockedGet).toHaveBeenCalledWith(expect.stringContaining(':3000/'))
    })

    it('should handle malformed JSON response', async () => {
      mockedGet.mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON')
        },
      } as any)

      mockedAttempt.mockRejectedValueOnce(new Error('Invalid JSON'))

      const result = await getCurrentCycleDataFromNode(mockNode, 'marker')

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('simple fetch failed')
      }
    })

    it('should retry on failure up to MAX_RETRIES', async () => {
      mockedAttempt.mockRejectedValueOnce(new Error('Retry error'))

      const result = await getCurrentCycleDataFromNode(mockNode, 'marker')

      expect(result.isErr()).toBe(true)
      expect(mockedAttempt).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ maxRetries: 3 }))
    })
  })
})
