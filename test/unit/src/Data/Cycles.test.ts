import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { P2P as P2PTypes, StateManager } from '@shardeum-foundation/lib-types'
import * as Cycles from '../../../../src/Data/Cycles'
import * as NodeList from '../../../../src/NodeList'
import * as State from '../../../../src/State'
import * as ServiceQueue from '../../../../src/ServiceQueue'
import * as Crypto from '../../../../src/Crypto'
import * as Utils from '../../../../src/Utils'
import * as Logger from '../../../../src/Logger'
import * as P2P from '../../../../src/P2P'
import { ArchiverLogging } from '../../../../src/profiler/archiverLogging'
import * as GossipData from '../../../../src/Data/GossipData'
import * as Collector from '../../../../src/Data/Collector'
import * as AccountDataProvider from '../../../../src/Data/AccountDataProvider'
import * as LostArchivers from '../../../../src/LostArchivers'
import ShardFunctions from '../../../../src/ShardFunctions'
import * as API from '../../../../src/API'
import * as cycleDataCache from '../../../../src/cache/cycleRecordsCache'
import * as dbCycles from '../../../../src/dbstore/cycles'
import * as GlobalAccount from '../../../../src/GlobalAccount'
import * as syncV2 from '../../../../src/sync-v2'
import { config } from '../../../../src/Config'

// Mock all dependencies
jest.mock('../../../../src/NodeList', () => ({
  NodeStatus: {
    SYNCING: 'syncing',
    ACTIVE: 'active',
  },
  activeListByIdSorted: [],
  realUpdatedTimes: new Map(),
  getNodeInfoById: jest.fn(),
  addNodes: jest.fn(),
  setStatus: jest.fn(),
  refreshNodes: jest.fn(),
  addStandbyNodes: jest.fn(),
  removeStandbyNodes: jest.fn(),
  removeNodes: jest.fn(),
  clearNodeLists: jest.fn(),
  toggleFirstNode: jest.fn(),
  changeNodeListInRestore: jest.fn(),
  getActiveList: jest.fn().mockReturnValue([]),
}))
jest.mock('../../../../src/State', () => ({
  isActive: false,
  isSyncing: false,
  activeArchivers: [],
  otherArchivers: [],
  archiversReputation: {
    set: jest.fn(),
    get: jest.fn(),
    has: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  },
  cycleRecordWithShutDownMode: null,
  addArchiver: jest.fn(),
  removeActiveArchiver: jest.fn(),
  updateOtherArchivers: jest.fn(),
}))
jest.mock('../../../../src/ServiceQueue')
jest.mock('../../../../src/Crypto')
jest.mock('../../../../src/Utils')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('../../../../src/P2P')
jest.mock('../../../../src/profiler/archiverLogging')
jest.mock('../../../../src/Data/GossipData')
jest.mock('../../../../src/Data/Collector')
jest.mock('../../../../src/Data/AccountDataProvider')
jest.mock('../../../../src/LostArchivers')
jest.mock('../../../../src/ShardFunctions')
jest.mock('../../../../src/API')
jest.mock('../../../../src/cache/cycleRecordsCache')
jest.mock('../../../../src/dbstore/cycles')
jest.mock('../../../../src/GlobalAccount')
jest.mock('../../../../src/sync-v2', () => ({
  syncTxList: jest.fn().mockReturnValue({
    match: (onSuccess: Function) => {
      onSuccess([])
      return { isOk: () => true, isErr: () => false }
    },
  }),
}))
jest.mock('../../../../src/Data/Data', () => ({
  clearDataSenders: jest.fn(),
  dataSenders: new Map(),
  getConsensusRadius: jest.fn(),
  nodesPerConsensusGroup: 2,
  nodesPerEdge: 2,
  subscribeConsensorsByConsensusRadius: jest.fn(),
  subscriptionCycleData: {},
  unsubscribeDataSender: jest.fn(),
}))
jest.mock('../../../../src/utils/customHttpFunctions', () => ({
  customFetch: jest.fn(),
}))
jest.mock('../../../../src/Config', () => ({
  config: {
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PUBLIC_KEY: 'test-archiver-public-key',
    VERBOSE: false,
    maxCyclesShardDataToKeep: 10,
    cycleRecordsCache: {
      enabled: false,
    },
    checkpoint: {
      bucketConfig: {
        BucketMatureAge: 11 * 60,
        cycleAge: 60,
        GiveUpAge: 20 * 60,
        lastFailedBucketDuration: 5 * 60 * 1000,
        RadixDepth: 2,
        allowCheckpointUpdates: false,
        allowCheckpointStorage: false,
      },
      batchSize: 100,
      updateInterval: 60 * 1000,
      syncInterval: 10000,
      maxCyclesToSync: 100,
      statusArraySize: 5000,
      syncOnStartup: false,
      syncCycleBuffer: 50,
    },
    tickets: {
      allowedTicketSigners: {},
      minSigRequired: 1,
      requiredSecurityLevel: 1,
    },
    REQUEST_LIMIT: {
      MAX_ACCOUNTS_PER_REQUEST: 10000,
      MAX_RECEIPTS_PER_REQUEST: 1000,
      MAX_ORIGINAL_TXS_PER_REQUEST: 1000,
      MAX_CYCLES_PER_REQUEST: 100,
      MAX_BETWEEN_CYCLES_PER_REQUEST: 100,
    },
  },
}))
jest.mock('../../../../src/profiler/profiler', () => ({
  profilerInstance: null,
}))
jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: null,
}))

describe('Data/Cycles', () => {
  // Mock data
  const mockCycle: P2PTypes.CycleCreatorTypes.CycleData = {
    activated: [],
    activatedPublicKeys: ['pk1', 'pk2'],
    active: 10,
    apoptosized: ['node3'],
    archiverListHash: 'archiver-hash',
    counter: 100,
    desired: 10,
    target: 10,
    duration: 60,
    joinedArchivers: [
      {
        ip: '192.168.1.1',
        port: 4000,
        publicKey: 'archiver1-pk',
        curvePk: 'archiver1-curve',
      },
    ],
    joinedConsensors: [
      {
        id: 'node1',
        publicKey: 'node1-pk',
        externalIp: '10.0.0.1',
        externalPort: 9001,
        internalIp: '10.0.0.1',
        internalPort: 10001,
        address: 'address1',
        joinRequestTimestamp: 1000,
        activeTimestamp: 2000,
        cycleJoined: 'cycle-99',
        counterRefreshed: 1,
        activeCycle: 100,
        syncingTimestamp: 1500,
        readyTimestamp: 1800,
      },
    ],
    leavingArchivers: [
      {
        ip: '192.168.1.2',
        port: 4000,
        publicKey: 'archiver2-pk',
        curvePk: 'archiver2-curve',
      },
    ],
    lost: [],
    lostSyncing: [],
    marker: 'cycle-marker-100',
    maxSyncTime: 120,
    mode: 'processing',
    networkId: 'test-network',
    nodeListHash: 'validator-hash',
    previous: 'cycle-marker-99',
    refreshedArchivers: [],
    refreshedConsensors: [],
    refuted: [],
    removed: ['node4'],
    returned: [],
    safetyMode: false,
    safetyNum: 0,
    networkStateHash: 'state-hash',
    start: 1000000,
    syncing: 5,
    standbyNodeListHash: 'standby-hash',
    standbyAdd: [
      {
        nodeInfo: {
          publicKey: 'standby1-pk',
          externalIp: '10.0.0.3',
          externalPort: 9001,
          internalIp: '10.0.0.3',
          internalPort: 10001,
          address: 'address3',
          joinRequestTimestamp: 1000,
          activeTimestamp: 0,
          activeCycle: 0,
          syncingTimestamp: 0,
          readyTimestamp: 0,
        },
        cycleMarker: 'cycle-marker-99',
        sign: {
          owner: 'standby1-pk',
          sig: 'signature1',
        },
        version: '1.0.0',
        selectionNum: '1234567890',
        proofOfWork: 'proof-hash',
      },
    ],
    standbyRemove: ['standby2-pk'],
    appRemoved: ['node5'],
    expired: 0,
    joined: [],
    networkConfigHash: 'config-hash',
    standby: 1,
    archiversAtShutdown: [],
    random: 0,
    txlisthash: 'tx-list-hash',
    txadd: [
      {
        hash: 'tx1',
        type: 'transfer',
        txData: {},
        cycle: 100,
        priority: 1,
      },
    ],
    txremove: [
      {
        txHash: 'tx2',
        cycle: 99,
      },
    ],
    networkDataHash: [],
    networkReceiptHash: [],
    networkSummaryHash: [],
    lostArchivers: [],
    refutedArchivers: [],
    removedArchivers: [],
    certificate: {
      marker: 'cycle-marker-100',
      score: 100,
      sign: {
        owner: 'node-pk',
        sig: 'signature',
      },
    },
    lostAfterSelection: [],
  }

  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    // Reset module state
    Cycles.setCurrentCycleCounter(-1)
    Cycles.setCurrentCycleMarker('0'.repeat(32))
    Cycles.setLastProcessedMetaDataCounter(-1)
    Cycles.CycleChain.clear()
    Cycles.removedAndApopedNodes.length = 0
    Cycles.shardValuesByCycle.clear()
    // @ts-ignore - accessing private module variable
    Cycles.cycleRecordWithShutDownMode = null
    // @ts-ignore - accessing private module variable
    Cycles.currentNetworkMode = 'forming'
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('processCycles', () => {
    beforeEach(() => {
      jest.mocked(NodeList.getNodeInfoById).mockReturnValue({
        id: 'node-id',
        publicKey: 'node-pk',
        ip: '10.0.0.1',
        port: 9001,
      })
      jest.mocked(GossipData.getAdjacentLeftAndRightArchivers).mockImplementation(() => {})
      jest.mocked(LostArchivers.handleLostArchivers).mockImplementation(() => {})
      jest.mocked(cycleDataCache.addCyclesToCache).mockResolvedValue()
      jest.mocked(Collector.storeCycleData).mockResolvedValue()
      jest.mocked(GlobalAccount.updateGlobalNetworkAccount).mockResolvedValue()
      jest.mocked(Collector.cleanOldOriginalTxsMap).mockImplementation(() => {})
      jest.mocked(Collector.cleanOldReceiptsMap).mockImplementation(() => {})
      jest.mocked(ServiceQueue.addTxs).mockImplementation(() => true)
      jest.mocked(ServiceQueue.removeTxs).mockImplementation(() => true)
      jest.mocked(ServiceQueue.getNetworkTxsListHash).mockReturnValue('tx-list-hash')
      // @ts-ignore - accessing module variable
      State.isActive = false
      // @ts-ignore - accessing module variable
      State.isSyncing = false
    })

    it('should process new cycles and update state', async () => {
      await Cycles.processCycles([mockCycle])

      expect(Cycles.getCurrentCycleCounter()).toBe(100)
      expect(NodeList.addNodes).toHaveBeenCalledWith(
        NodeList.NodeStatus.SYNCING,
        expect.arrayContaining([
          expect.objectContaining({
            id: 'node1',
            publicKey: 'node1-pk',
          }),
        ])
      )
      expect(NodeList.setStatus).toHaveBeenCalledWith(NodeList.NodeStatus.ACTIVE, ['pk1', 'pk2'])
      expect(State.addArchiver).toHaveBeenCalledWith(mockCycle.joinedArchivers[0])
      expect(State.removeActiveArchiver).toHaveBeenCalledWith('archiver2-pk')
      expect(cycleDataCache.addCyclesToCache).toHaveBeenCalledWith([mockCycle])
      expect(Collector.storeCycleData).toHaveBeenCalledWith([mockCycle])
    })

    it('should skip already processed cycles', async () => {
      Cycles.setCurrentCycleCounter(100)
      await Cycles.processCycles([mockCycle])

      expect(NodeList.addNodes).not.toHaveBeenCalled()
      expect(cycleDataCache.addCyclesToCache).not.toHaveBeenCalled()
    })

    it('should handle shutdown mode', async () => {
      const shutdownCycle = { ...mockCycle, mode: 'shutdown' as P2PTypes.ModesTypes.Record['mode'] }
      jest.mocked(Utils.sleep).mockResolvedValue(undefined)
      jest.mocked(NodeList.clearNodeLists).mockImplementation(() => {})
      jest.mocked(NodeList.toggleFirstNode).mockImplementation(() => {})

      await Cycles.processCycles([shutdownCycle])

      expect(Utils.sleep).toHaveBeenCalledWith(60000)
      expect(NodeList.clearNodeLists).toHaveBeenCalled()
      expect(NodeList.toggleFirstNode).toHaveBeenCalled()
      expect(Cycles.cycleRecordWithShutDownMode).toEqual(shutdownCycle)
    })

    it('should update consensus radius when syncing with low consensus group', async () => {
      // @ts-ignore - accessing module variable
      State.isSyncing = true
      // @ts-ignore - accessing module variable
      const { getConsensusRadius } = require('../../../../src/Data/Data')
      getConsensusRadius.mockResolvedValue()
      // @ts-ignore - accessing module variable
      require('../../../../src/Data/Data').nodesPerConsensusGroup = 2

      await Cycles.processCycles([mockCycle])

      expect(getConsensusRadius).toHaveBeenCalled()
    })

    it('should send data to adjacent archivers when active', async () => {
      // @ts-ignore - accessing module variable
      State.isActive = true
      jest.mocked(GossipData.sendDataToAdjacentArchivers).mockImplementation(async () => {})
      jest.mocked(State.updateOtherArchivers).mockImplementation(() => {})

      await Cycles.processCycles([mockCycle])

      expect(GossipData.sendDataToAdjacentArchivers).toHaveBeenCalledWith(GossipData.DataType.CYCLE, [mockCycle])
      expect(State.updateOtherArchivers).toHaveBeenCalled()
    })

    it('should clean old shard cycle data', async () => {
      const cleanShardCycleDataSpy = jest.spyOn(Cycles, 'cleanShardCycleData')

      await Cycles.processCycles([mockCycle])

      expect(cleanShardCycleDataSpy).toHaveBeenCalledWith(90) // 100 - 10
    })

    it('should update network mode', async () => {
      const restoreCycle = { ...mockCycle, mode: 'restore' as P2PTypes.ModesTypes.Record['mode'] }

      await Cycles.processCycles([restoreCycle])

      expect(Cycles.currentNetworkMode).toBe('restore')
    })
  })

  describe('validateCycle', () => {
    it('should validate cycle with correct previous marker', () => {
      const prevCycle = { ...mockCycle, counter: 99, marker: 'cycle-marker-99' }
      const hashedMarker = 'computed-hash'
      jest.mocked(Crypto.hashObj).mockReturnValue(hashedMarker)

      const nextCycle = { ...mockCycle, counter: 100, previous: hashedMarker }

      const result = Cycles.validateCycle(prevCycle, nextCycle)

      expect(result).toBe(true)
      expect(Crypto.hashObj).toHaveBeenCalledWith(expect.not.objectContaining({ marker: expect.anything() }))
    })

    it('should fail validation with incorrect previous marker', () => {
      const prevCycle = { ...mockCycle, counter: 99 }
      jest.mocked(Crypto.hashObj).mockReturnValue('computed-hash')

      const nextCycle = { ...mockCycle, counter: 100, previous: 'wrong-hash' }

      const result = Cycles.validateCycle(prevCycle, nextCycle)

      expect(result).toBe(false)
    })
  })

  describe('validateCycleData', () => {
    beforeEach(() => {
      jest.mocked(Utils.validateTypes).mockReturnValue(null)
      jest.mocked(Crypto.hashObj).mockReturnValue('cycle-marker-100')
    })

    it('should validate correct cycle data', () => {
      const result = Cycles.validateCycleData(mockCycle)

      expect(result).toBe(true)
      expect(Utils.validateTypes).toHaveBeenCalledWith(mockCycle, expect.any(Object))
      expect(Crypto.hashObj).toHaveBeenCalledWith(expect.not.objectContaining({ marker: expect.anything() }))
    })

    it('should fail validation with type errors', () => {
      jest.mocked(Utils.validateTypes).mockReturnValue('Type validation error')

      const result = Cycles.validateCycleData(mockCycle)

      expect(result).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid Cycle Record', 'Type validation error')
    })

    it('should fail validation with incorrect marker', () => {
      jest.mocked(Crypto.hashObj).mockReturnValue('wrong-marker')

      const result = Cycles.validateCycleData(mockCycle)

      expect(result).toBe(false)
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Invalid Cycle Record: cycle marker does not match with the computed marker'
      )
    })
  })

  describe('computeCycleMarker', () => {
    it('should compute cycle marker hash', () => {
      const expectedHash = 'computed-cycle-hash'
      jest.mocked(Crypto.hashObj).mockReturnValue(expectedHash)

      const result = Cycles.computeCycleMarker(mockCycle)

      expect(result).toBe(expectedHash)
      expect(Crypto.hashObj).toHaveBeenCalledWith(mockCycle)
    })
  })

  describe('state management functions', () => {
    it('should get and set current cycle counter', () => {
      expect(Cycles.getCurrentCycleCounter()).toBe(-1)

      Cycles.setCurrentCycleCounter(100)

      expect(Cycles.getCurrentCycleCounter()).toBe(100)
    })

    it('should get and set current cycle marker', () => {
      expect(Cycles.getCurrentCycleMarker()).toBe('0'.repeat(32))

      Cycles.setCurrentCycleMarker('new-marker')

      expect(Cycles.getCurrentCycleMarker()).toBe('new-marker')
    })

    it('should set current cycle duration', () => {
      Cycles.setCurrentCycleDuration(60)

      expect(Cycles.currentCycleDuration).toBe(60000)
    })

    it('should set last processed metadata counter', () => {
      Cycles.setLastProcessedMetaDataCounter(50)

      expect(Cycles.lastProcessedMetaData).toBe(50)
    })

    it('should set shutdown cycle record', () => {
      Cycles.setShutdownCycleRecord(mockCycle)

      expect(Cycles.cycleRecordWithShutDownMode).toEqual(mockCycle)
    })
  })

  describe('changeNetworkMode', () => {
    beforeEach(() => {
      jest.mocked(AccountDataProvider.clearServingValidatorsInterval).mockImplementation(() => {})
      jest.mocked(AccountDataProvider.initServingValidatorsInterval).mockImplementation(() => {})
      jest.mocked(NodeList.changeNodeListInRestore).mockImplementation(() => {})
    })

    it('should not change if mode is the same', () => {
      Cycles.changeNetworkMode('forming')

      expect(Logger.mainLogger.info).not.toHaveBeenCalled()
    })

    it('should change from restore to processing and clear interval', () => {
      // @ts-ignore - accessing private module variable
      Cycles.currentNetworkMode = 'restore'

      Cycles.changeNetworkMode('processing')

      expect(AccountDataProvider.clearServingValidatorsInterval).toHaveBeenCalled()
      expect(Cycles.currentNetworkMode).toBe('processing')
    })

    it('should change from restart to restore and init interval', () => {
      // @ts-ignore - accessing private module variable
      Cycles.currentNetworkMode = 'restart'

      Cycles.changeNetworkMode('restore')

      expect(NodeList.changeNodeListInRestore).toHaveBeenCalled()
      expect(AccountDataProvider.initServingValidatorsInterval).toHaveBeenCalled()
      expect(Cycles.currentNetworkMode).toBe('restore')
    })

    it('should clear shutdown cycle record when changing from shutdown', () => {
      Cycles.setShutdownCycleRecord(mockCycle)
      // @ts-ignore - accessing private module variable
      Cycles.currentNetworkMode = 'shutdown'

      Cycles.changeNetworkMode('processing')

      expect(Cycles.cycleRecordWithShutDownMode).toBeNull()
    })
  })

  describe('fetchCycleRecords', () => {
    it('should fetch cycle records from archivers', async () => {
      const mockResponse = {
        cycleInfo: [mockCycle],
        sign: { owner: 'archiver', sig: 'signature' },
      }
      jest.mocked(API.queryFromArchivers).mockResolvedValue(mockResponse)

      const result = await Cycles.fetchCycleRecords(1, 10)

      expect(result).toEqual([mockCycle])
      expect(API.queryFromArchivers).toHaveBeenCalledWith(API.RequestDataType.CYCLE, { start: 1, end: 10 })
    })

    it('should return empty array when no response', async () => {
      jest.mocked(API.queryFromArchivers).mockResolvedValue(null)

      const result = await Cycles.fetchCycleRecords(1, 10)

      expect(result).toEqual([])
    })
  })

  describe('getNewestCycleFromConsensors', () => {
    it('should get newest cycle from consensus nodes', async () => {
      const mockNodes = [{ id: 'node1', ip: '10.0.0.1', port: 9001, publicKey: 'pk1' }]
      jest.mocked(P2P.getJson).mockResolvedValue({ newestCycle: mockCycle })
      jest.mocked(Utils.robustQuery).mockResolvedValue({ value: mockCycle } as any)

      const result = await Cycles.getNewestCycleFromConsensors(mockNodes)

      expect(result).toEqual(mockCycle)
      expect(Utils.robustQuery).toHaveBeenCalledWith(mockNodes, expect.any(Function))
    })
  })

  describe('getNewestCycleFromArchivers', () => {
    it('should get newest cycle from archivers', async () => {
      const mockArchivers = [{ ip: '192.168.1.1', port: 4000, publicKey: 'archiver1-pk', curvePk: 'curve1' }]
      // @ts-ignore - accessing module variable
      State.otherArchivers = mockArchivers
      jest.mocked(Utils.getRandomItemFromArr).mockReturnValue([mockArchivers[0]])
      jest.mocked(P2P.postJson).mockResolvedValue({ cycleInfo: [mockCycle] } as any)
      jest.mocked(Crypto.sign).mockReturnValue({ data: {}, sign: { owner: 'test', sig: 'sig' } } as any)

      // Mock the robustQuery to actually call the queryFn
      jest.mocked(Utils.robustQuery).mockImplementation(async (nodes, queryFn) => {
        const result = await queryFn(nodes[0])
        return { value: result } as any
      })

      const result = await Cycles.getNewestCycleFromArchivers()

      expect(result).toEqual(mockCycle)
      expect(Crypto.sign).toHaveBeenCalledWith({
        count: 1,
        sender: 'test-archiver-public-key',
      })
    })
  })

  describe('recordArchiversReputation', () => {
    it('should record archiver reputation based on cycle info', async () => {
      const mockArchivers = [
        { ip: '192.168.1.1', port: 4000, publicKey: 'archiver1-pk', curvePk: 'curve1' },
        { ip: '192.168.1.2', port: 4000, publicKey: 'archiver2-pk', curvePk: 'curve2' },
      ]
      // @ts-ignore - accessing module variable
      State.activeArchivers = mockArchivers
      Cycles.setCurrentCycleCounter(100)

      // Mock fetch responses
      const { customFetch } = require('../../../../src/utils/customHttpFunctions')
      ;(customFetch as any)
        .mockResolvedValueOnce({
          json: (jest.fn() as any).mockResolvedValue({ cycleInfo: [{ counter: 95 }] }),
        })
        .mockResolvedValueOnce({
          json: (jest.fn() as any).mockResolvedValue({ cycleInfo: [{ counter: 80 }] }),
        })

      await Cycles.recordArchiversReputation()

      // Wait for promises to settle
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(State.archiversReputation.set).toHaveBeenCalledWith('archiver1-pk', 'up')
      expect(State.archiversReputation.set).toHaveBeenCalledWith('archiver2-pk', 'down')
    })

    it('should mark archiver as down when not responding', async () => {
      const mockArchivers = [{ ip: '192.168.1.1', port: 4000, publicKey: 'archiver1-pk', curvePk: 'curve1' }]
      // @ts-ignore - accessing module variable
      State.activeArchivers = mockArchivers

      const { customFetch } = require('../../../../src/utils/customHttpFunctions')
      ;(customFetch as any).mockRejectedValue(new Error('Network error'))

      await Cycles.recordArchiversReputation()

      // Wait for promises to settle
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(State.archiversReputation.set).toHaveBeenCalledWith('archiver1-pk', 'down')
    })
  })

  describe('cleanShardCycleData', () => {
    it('should clean old shard cycle data', () => {
      Cycles.shardValuesByCycle.set(90, {} as StateManager.shardFunctionTypes.CycleShardData)
      Cycles.shardValuesByCycle.set(95, {} as StateManager.shardFunctionTypes.CycleShardData)
      Cycles.shardValuesByCycle.set(100, {} as StateManager.shardFunctionTypes.CycleShardData)

      Cycles.cleanShardCycleData(95)

      expect(Cycles.shardValuesByCycle.has(90)).toBe(false)
      expect(Cycles.shardValuesByCycle.has(95)).toBe(true)
      expect(Cycles.shardValuesByCycle.has(100)).toBe(true)
    })
  })

  describe('getLatestCycleRecords', () => {
    it('should get from cache when enabled', async () => {
      // @ts-ignore - modifying readonly config
      config.cycleRecordsCache.enabled = true
      const mockResponse = { cycleInfo: [mockCycle], sign: { owner: 'test', sig: 'sig' } }
      jest.mocked(cycleDataCache.getLatestCycleRecordsFromCache).mockResolvedValue(mockResponse)

      const result = await Cycles.getLatestCycleRecords(10)

      expect(result).toEqual(mockResponse)
      expect(cycleDataCache.getLatestCycleRecordsFromCache).toHaveBeenCalledWith(10)
      expect(dbCycles.queryLatestCycleRecords).not.toHaveBeenCalled()
    })

    it('should get from database when cache disabled', async () => {
      // @ts-ignore - modifying readonly config
      config.cycleRecordsCache.enabled = false
      jest.mocked(dbCycles.queryLatestCycleRecords).mockResolvedValue([mockCycle])
      jest.mocked(Crypto.sign).mockReturnValue({ cycleInfo: [mockCycle], sign: { owner: 'test', sig: 'sig' } })

      const result = await Cycles.getLatestCycleRecords(10)

      expect(result).toEqual({ cycleInfo: [mockCycle], sign: { owner: 'test', sig: 'sig' } })
      expect(dbCycles.queryLatestCycleRecords).toHaveBeenCalledWith(10)
      expect(Crypto.sign).toHaveBeenCalledWith({ cycleInfo: [mockCycle] })
    })
  })

  describe('edge cases', () => {
    it('should handle empty joined/removed lists', async () => {
      const cycleWithEmptyLists = {
        ...mockCycle,
        joinedConsensors: [],
        activatedPublicKeys: [],
        removed: [],
        apoptosized: [],
        joinedArchivers: [],
        leavingArchivers: [],
        standbyAdd: [],
        standbyRemove: [],
      }

      await Cycles.processCycles([cycleWithEmptyLists])

      expect(NodeList.addNodes).toHaveBeenCalledWith(NodeList.NodeStatus.SYNCING, [])
      expect(NodeList.setStatus).toHaveBeenCalledWith(NodeList.NodeStatus.ACTIVE, [])
      expect(State.addArchiver).not.toHaveBeenCalled()
      expect(State.removeActiveArchiver).not.toHaveBeenCalled()
    })

    it('should handle missing node info during removal', async () => {
      jest.mocked(NodeList.getNodeInfoById).mockReturnValue(null)

      await Cycles.processCycles([mockCycle])

      expect(NodeList.removeNodes).toHaveBeenCalledWith([])
    })

    it('should handle network tx list hash mismatch', async () => {
      jest.mocked(ServiceQueue.getNetworkTxsListHash).mockReturnValue('different-hash')
      jest.mocked(ArchiverLogging.generateOperationId).mockReturnValue('test-op-id')
      jest.mocked(syncV2.syncTxList).mockReturnValue({
        match: (onSuccess: Function, onError: Function) => {
          onSuccess(['tx1', 'tx2'])
          return { isOk: () => true, isErr: () => false }
        },
      } as any)
      jest.mocked(ServiceQueue.setTxList).mockImplementation(() => {})

      await Cycles.processCycles([mockCycle])

      expect(console.error).toHaveBeenCalledWith(
        'txList hash from cycle record does not match the calculated txList hash'
      )
      expect(syncV2.syncTxList).toHaveBeenCalled()
      expect(ServiceQueue.setTxList).toHaveBeenCalledWith(['tx1', 'tx2'])
    })

    it('should handle sync tx list failure', async () => {
      jest.mocked(ServiceQueue.getNetworkTxsListHash).mockReturnValue('different-hash')
      jest.mocked(syncV2.syncTxList).mockReturnValue({
        match: (onSuccess: Function, onError: Function) => {
          onError(new Error('Sync failed'))
          return { isOk: () => false, isErr: () => true }
        },
      } as any)

      await Cycles.processCycles([mockCycle])

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to synchronize transaction list:', 'Sync failed')
    })

    it('should limit removed and apoptosized nodes history to 10', async () => {
      // Mock getNodeInfoById to return node info for apoptosized and removed nodes
      jest.mocked(NodeList.getNodeInfoById).mockImplementation((id) => {
        if (id === 'node3') return { publicKey: 'node3-pk', id, ip: '10.0.0.3', port: 9001 }
        if (id === 'node4') return { publicKey: 'node4-pk', id, ip: '10.0.0.4', port: 9001 }
        return null
      })

      // Fill the array with 10 items
      for (let i = 0; i < 10; i++) {
        Cycles.removedAndApopedNodes.push({
          cycle: i,
          removed: [],
          apoptosized: [],
          lostAfterSelection: [],
        })
      }

      await Cycles.processCycles([mockCycle])

      expect(Cycles.removedAndApopedNodes).toHaveLength(10)
      expect(Cycles.removedAndApopedNodes[0].cycle).toBe(1) // First item shifted out
      expect(Cycles.removedAndApopedNodes[9].cycle).toBe(100) // New item added
    })
  })

  describe('shard values update', () => {
    beforeEach(() => {
      jest.mocked(ShardFunctions.calculateShardGlobals).mockReturnValue({
        numPartitions: 10,
        nodesPerPartition: 5,
        partitionsCovered: 3,
      } as any)
      jest.mocked(ShardFunctions.computePartitionShardDataMap).mockImplementation(() => {})
      jest.mocked(ShardFunctions.computeNodePartitionDataMap).mockImplementation(() => {})
      // @ts-ignore - accessing module variable
      NodeList.activeListByIdSorted = [
        { id: 'node1', ip: '10.0.0.1', port: 9001 },
        { id: 'node2', ip: '10.0.0.2', port: 9001 },
      ] as any
    })

    it('should update shard values for cycle', async () => {
      await Cycles.processCycles([mockCycle])

      expect(ShardFunctions.calculateShardGlobals).toHaveBeenCalledWith(2, 2, 2)
      expect(ShardFunctions.computePartitionShardDataMap).toHaveBeenCalled()
      expect(ShardFunctions.computeNodePartitionDataMap).toHaveBeenCalledTimes(2)
      expect(Cycles.shardValuesByCycle.has(100)).toBe(true)
    })

    it('should skip shard calculation when no active nodes', async () => {
      // @ts-ignore - accessing module variable
      NodeList.activeListByIdSorted = []

      await Cycles.processCycles([mockCycle])

      expect(ShardFunctions.calculateShardGlobals).not.toHaveBeenCalled()
      expect(Cycles.shardValuesByCycle.has(100)).toBe(false)
    })
  })

  describe('subscription management', () => {
    it('should subscribe to consensus nodes when active', async () => {
      // @ts-ignore - accessing module variable
      State.isActive = true
      const subscribeConsensorsByConsensusRadius =
        require('../../../../src/Data/Data').subscribeConsensorsByConsensusRadius

      await Cycles.processCycles([mockCycle])

      expect(subscribeConsensorsByConsensusRadius).toHaveBeenCalled()
    })

    it('should unsubscribe from removed nodes', async () => {
      const unsubscribeDataSender = require('../../../../src/Data/Data').unsubscribeDataSender
      const dataSenders = require('../../../../src/Data/Data').dataSenders
      dataSenders.set('node3-pk', {})
      dataSenders.set('node4-pk', {})

      jest.mocked(NodeList.getNodeInfoById).mockImplementation((id) => {
        if (id === 'node3') return { publicKey: 'node3-pk', id, ip: '10.0.0.3', port: 9001 }
        if (id === 'node4') return { publicKey: 'node4-pk', id, ip: '10.0.0.4', port: 9001 }
        return null
      })

      await Cycles.processCycles([mockCycle])

      expect(unsubscribeDataSender).toHaveBeenCalledWith('node3-pk')
      expect(unsubscribeDataSender).toHaveBeenCalledWith('node4-pk')
    })
  })
})

