import { describe, expect, it, beforeEach, jest } from '@jest/globals'
import { okAsync, errAsync, ResultAsync, ok, err } from 'neverthrow'
import { P2P as P2PTypes } from '@shardeum-foundation/lib-types'
import { syncV2, syncTxList } from '../../../../src/sync-v2/index'
import * as queries from '../../../../src/sync-v2/queries'
import * as verify from '../../../../src/sync-v2/verify'
import * as State from '../../../../src/State'
import * as NodeList from '../../../../src/NodeList'
import * as ServiceQueue from '../../../../src/ServiceQueue'
import * as Logger from '../../../../src/Logger'
import { ArchiverLogging } from '../../../../src/profiler/archiverLogging'
import { config } from '../../../../src/Config'

// Mock all dependencies
jest.mock('../../../../src/sync-v2/queries')
jest.mock('../../../../src/sync-v2/verify')
jest.mock('../../../../src/State')
jest.mock('../../../../src/NodeList')
jest.mock('../../../../src/ServiceQueue')
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('../../../../src/profiler/archiverLogging')
jest.mock('../../../../src/Config', () => ({
  config: {
    ARCHIVER_IP: '127.0.0.1',
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
    restoreNGTsFromSnapshot: false,
  },
}))

describe('sync-v2/index', () => {
  // Mock data
  const mockArchivers: State.ArchiverNodeInfo[] = [
    {
      ip: '192.168.1.1',
      port: 4000,
      publicKey: 'archiver1-public-key',
      curvePk: 'archiver1-curve-pk',
    },
    {
      ip: '192.168.1.2',
      port: 4000,
      publicKey: 'archiver2-public-key',
      curvePk: 'archiver2-curve-pk',
    },
  ]

  const mockActiveNodes: P2PTypes.SyncTypes.ActiveNode[] = [
    {
      ip: '10.0.0.1',
      port: 9001,
      publicKey: 'node1-public-key',
    },
    {
      ip: '10.0.0.2',
      port: 9001,
      publicKey: 'node2-public-key',
    },
  ]

  const mockValidatorList: P2PTypes.NodeListTypes.Node[] = [
    {
      id: 'validator1',
      publicKey: 'validator1-public-key',
      curvePublicKey: 'validator1-curve-key',
      externalIp: '10.0.0.1',
      externalPort: 9001,
      internalIp: '10.0.0.1',
      internalPort: 10001,
      address: 'address1',
      joinRequestTimestamp: 1000,
      activeTimestamp: 2000,
      syncingTimestamp: 1500,
      readyTimestamp: 1800,
      status: P2PTypes.P2PTypes.NodeStatus.ACTIVE,
      cycleJoined: 'cycle-marker-1',
      counterRefreshed: 100,
    } as P2PTypes.NodeListTypes.Node,
    {
      id: 'validator2',
      publicKey: 'validator2-public-key',
      curvePublicKey: 'validator2-curve-key',
      externalIp: '10.0.0.2',
      externalPort: 9001,
      internalIp: '10.0.0.2',
      internalPort: 10001,
      address: 'address2',
      joinRequestTimestamp: 1100,
      activeTimestamp: 2100,
      syncingTimestamp: 1600,
      readyTimestamp: 1900,
      status: P2PTypes.P2PTypes.NodeStatus.SYNCING,
      cycleJoined: 'cycle-marker-2',
      counterRefreshed: 101,
    } as P2PTypes.NodeListTypes.Node,
  ]

  const mockStandbyList: P2PTypes.JoinTypes.JoinRequest[] = [
    {
      nodeInfo: {
        publicKey: 'standby1-public-key',
        externalIp: '10.0.0.3',
        externalPort: 9001,
        internalIp: '10.0.0.3',
        internalPort: 10001,
        address: 'address3',
        joinRequestTimestamp: 1000,
        activeTimestamp: 0,
        syncingTimestamp: 0,
        readyTimestamp: 0,
        activeCycle: 0,
      } as P2PTypes.P2PTypes.P2PNode,
      cycleMarker: 'cycle-marker-1',
      sign: {
        owner: 'standby1-public-key',
        sig: 'signature1',
      },
      version: '1.0.0',
      selectionNum: '1234567890',
      proofOfWork: 'proof-hash',
    } as P2PTypes.JoinTypes.JoinRequest,
  ]

  const mockArchiverList: P2PTypes.ArchiversTypes.JoinedArchiver[] = [
    {
      publicKey: 'archiver1-public-key',
      ip: '192.168.1.1',
      port: 4000,
      curvePk: 'curve-public-key-1',
    },
  ]

  const mockTxList: P2PTypes.ServiceQueueTypes.NetworkTxEntry[] = [
    {
      hash: 'tx-hash-1',
      tx: {
        hash: 'tx-hash-1',
        type: 'transfer',
        txData: {
          from: 'from-address',
          to: 'to-address',
          data: 'transaction-data',
          timestamp: 1000000,
        },
        cycle: 1,
        priority: 1,
      },
      noDropp: false,
    } as P2PTypes.ServiceQueueTypes.NetworkTxEntry,
  ]

  const mockCycleData: P2PTypes.CycleCreatorTypes.CycleData = {
    activated: [],
    activatedPublicKeys: [],
    active: 10,
    apoptosized: [],
    archiverListHash: 'archiver-hash',
    counter: 100,
    desired: 10,
    target: 10,
    duration: 60,
    joinedArchivers: [],
    joinedConsensors: [],
    leavingArchivers: [],
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
    removed: [],
    returned: [],
    safetyMode: false,
    safetyNum: 0,
    networkStateHash: 'state-hash',
    start: 1000000,
    syncing: 5,
    standbyNodeListHash: 'standby-hash',
    appRemoved: [],
    expired: 0,
    joined: [],
    networkConfigHash: 'config-hash',
    standby: 1,
    archiversAtShutdown: [],
    random: 0,
    txlisthash: 'tx-list-hash',
    txadd: [],
    txremove: [],
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
        owner: 'node-public-key',
        sig: 'signature',
      },
    },
  }

  const mockOperationId = 'test-operation-id'

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup default mocks
    jest.mocked(NodeList.getActiveNodeListFromArchiver).mockResolvedValue(mockActiveNodes)
    jest.mocked(ArchiverLogging.generateOperationId).mockReturnValue(mockOperationId)
    jest.mocked(ArchiverLogging.logDataSync).mockImplementation(() => {})
  })

  describe('syncV2', () => {
    beforeEach(() => {
      // Setup successful query mocks
      jest.mocked(queries.robustQueryForValidatorListHash).mockReturnValue(
        okAsync({
          value: { nodeListHash: 'validator-hash', nextCycleTimestamp: 2000000 },
          winningNodes: mockActiveNodes,
        })
      )
      jest.mocked(queries.robustQueryForStandbyNodeListHash).mockReturnValue(
        okAsync({
          value: { standbyNodeListHash: 'standby-hash' },
          winningNodes: mockActiveNodes,
        })
      )
      jest.mocked(queries.robustQueryForArchiverListHash).mockReturnValue(
        okAsync({
          value: { archiverListHash: 'archiver-hash' },
          winningNodes: mockActiveNodes,
        })
      )
      jest.mocked(queries.robustQueryForTxListHash).mockReturnValue(
        okAsync({
          value: { txListHash: 'tx-list-hash' },
          winningNodes: mockActiveNodes,
        })
      )
      jest.mocked(queries.robustQueryForCycleRecordHash).mockReturnValue(
        okAsync({
          value: { currentCycleHash: 'cycle-marker-100' },
          winningNodes: mockActiveNodes,
        })
      )

      // Setup get data mocks
      jest.mocked(queries.getValidatorListFromNode).mockReturnValue(okAsync(mockValidatorList))
      jest.mocked(queries.getStandbyNodeListFromNode).mockReturnValue(okAsync(mockStandbyList))
      jest.mocked(queries.getArchiverListFromNode).mockReturnValue(okAsync(mockArchiverList))
      jest.mocked(queries.getTxListFromNode).mockReturnValue(okAsync(mockTxList))
      jest.mocked(queries.getCurrentCycleDataFromNode).mockReturnValue(okAsync(mockCycleData))

      // Setup verify mocks
      jest.mocked(verify.verifyValidatorList).mockReturnValue(ok(true))
      jest.mocked(verify.verifyArchiverList).mockReturnValue(ok(true))
      jest.mocked(verify.verifyTxList).mockReturnValue(ok(true))
      jest.mocked(verify.verifyCycleRecord).mockReturnValue(ok(true))

      // Setup NodeList mocks
      jest.mocked(NodeList.addNodes).mockImplementation(() => {})
      jest.mocked(NodeList.addStandbyNodes).mockImplementation(() => {})

      // Setup ServiceQueue mock
      jest.mocked(ServiceQueue.setTxList).mockImplementation(() => {})

      // Setup State mock
      jest.mocked(State.resetActiveArchivers).mockImplementation(() => {})
    })

    it('should successfully sync all data when all queries succeed', async () => {
      const result = await syncV2(mockArchivers)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toMatchObject({
          ...mockCycleData,
          marker: 'cycle-marker-100',
        })
      }

      // Verify getActiveNodeListFromArchiver was called
      expect(NodeList.getActiveNodeListFromArchiver).toHaveBeenCalledWith(mockArchivers[0])

      // Verify all robust queries were made
      expect(queries.robustQueryForValidatorListHash).toHaveBeenCalledWith(mockActiveNodes)
      expect(queries.robustQueryForStandbyNodeListHash).toHaveBeenCalledWith(mockActiveNodes)
      expect(queries.robustQueryForArchiverListHash).toHaveBeenCalledWith(mockActiveNodes)
      expect(queries.robustQueryForTxListHash).toHaveBeenCalledWith(mockActiveNodes)
      expect(queries.robustQueryForCycleRecordHash).toHaveBeenCalledWith(mockActiveNodes)

      // Verify data was fetched from nodes
      expect(queries.getValidatorListFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'validator-hash')
      expect(queries.getStandbyNodeListFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'standby-hash')
      expect(queries.getArchiverListFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'archiver-hash')
      expect(queries.getTxListFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'tx-list-hash')
      expect(queries.getCurrentCycleDataFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'cycle-marker-100')

      // Verify all data was verified
      expect(verify.verifyValidatorList).toHaveBeenCalledWith(mockValidatorList, 'validator-hash')
      expect(verify.verifyArchiverList).toHaveBeenCalledWith(mockArchiverList, 'archiver-hash')
      expect(verify.verifyTxList).toHaveBeenCalledWith(mockTxList, 'tx-list-hash')
      expect(verify.verifyCycleRecord).toHaveBeenCalledWith(mockCycleData, 'cycle-marker-100')

      // Verify state updates
      expect(ServiceQueue.setTxList).toHaveBeenCalledWith(mockTxList)
      expect(State.resetActiveArchivers).toHaveBeenCalledWith(mockArchiverList)
    })

    it('should fail when no archiver can return an active node list', async () => {
      jest.mocked(NodeList.getActiveNodeListFromArchiver).mockRejectedValue(new Error('Connection failed'))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('no archiver could return an active node list')
      }

      // Verify it tried all archivers
      expect(NodeList.getActiveNodeListFromArchiver).toHaveBeenCalledTimes(mockArchivers.length)
    })

    it('should fail when validator list hash does not match cycle hash', async () => {
      // Make cycle data have different validator hash
      const modifiedCycleData = {
        ...mockCycleData,
        nodeListHash: 'different-validator-hash',
      }
      jest.mocked(queries.getCurrentCycleDataFromNode).mockReturnValue(okAsync(modifiedCycleData))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('validator list hash from received cycle')
        expect(result.error.message).toContain('does not match the hash received from robust query')
      }
    })

    it('should fail when standby list hash does not match cycle hash', async () => {
      // Make cycle data have different standby hash
      const modifiedCycleData = {
        ...mockCycleData,
        standbyNodeListHash: 'different-standby-hash',
      }
      jest.mocked(queries.getCurrentCycleDataFromNode).mockReturnValue(okAsync(modifiedCycleData))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('standby list hash from received cycle')
      }
    })

    it('should fail when archiver list hash does not match cycle hash', async () => {
      // Make cycle data have different archiver hash
      const modifiedCycleData = {
        ...mockCycleData,
        archiverListHash: 'different-archiver-hash',
      }
      jest.mocked(queries.getCurrentCycleDataFromNode).mockReturnValue(okAsync(modifiedCycleData))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toContain('archiver list hash from received cycle')
        expect(result.error.message).toContain('does not match the hash received from robust query')
      }
    })

    it('should properly categorize nodes by status', async () => {
      const mixedValidatorList: P2PTypes.NodeListTypes.Node[] = [
        { ...mockValidatorList[0], status: P2PTypes.P2PTypes.NodeStatus.ACTIVE },
        { ...mockValidatorList[1], status: P2PTypes.P2PTypes.NodeStatus.SYNCING },
        {
          ...mockValidatorList[0],
          id: 'validator3',
          publicKey: 'validator3-public-key',
          status: P2PTypes.P2PTypes.NodeStatus.READY,
        },
        {
          ...mockValidatorList[0],
          id: 'validator4',
          publicKey: 'validator4-public-key',
          status: P2PTypes.P2PTypes.NodeStatus.SELECTED,
        },
      ]

      jest.mocked(queries.getValidatorListFromNode).mockReturnValue(okAsync(mixedValidatorList))

      const result = await syncV2(mockArchivers)

      expect(result.isOk()).toBe(true)

      // Verify nodes were categorized correctly
      const syncingCall = jest
        .mocked(NodeList.addNodes)
        .mock.calls.find((call) => call[0] === NodeList.NodeStatus.SYNCING)
      const activeCall = jest
        .mocked(NodeList.addNodes)
        .mock.calls.find((call) => call[0] === NodeList.NodeStatus.ACTIVE)

      expect(syncingCall).toBeDefined()
      expect(syncingCall?.[1]).toHaveLength(3) // syncing, ready, selected

      expect(activeCall).toBeDefined()
      expect(activeCall?.[1]).toHaveLength(1) // active only
    })

    it('should handle empty lists gracefully', async () => {
      jest.mocked(queries.getValidatorListFromNode).mockReturnValue(okAsync([]))
      jest.mocked(queries.getStandbyNodeListFromNode).mockReturnValue(okAsync([]))
      jest.mocked(queries.getArchiverListFromNode).mockReturnValue(okAsync([]))
      jest.mocked(queries.getTxListFromNode).mockReturnValue(okAsync([]))

      const result = await syncV2(mockArchivers)

      expect(result.isOk()).toBe(true)

      expect(NodeList.addNodes).toHaveBeenCalledWith(NodeList.NodeStatus.SYNCING, [])
      expect(NodeList.addNodes).toHaveBeenCalledWith(NodeList.NodeStatus.ACTIVE, [])
      expect(NodeList.addStandbyNodes).toHaveBeenCalledWith([])
      expect(ServiceQueue.setTxList).toHaveBeenCalledWith([])
      expect(State.resetActiveArchivers).toHaveBeenCalledWith([])
    })

    it('should handle query failures', async () => {
      jest.mocked(queries.robustQueryForValidatorListHash).mockReturnValue(errAsync(new Error('Network error')))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Network error')
      }
    })

    it('should handle verification failures', async () => {
      jest.mocked(verify.verifyValidatorList).mockReturnValue(err(new Error('Invalid validator list')))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Invalid validator list')
      }
    })

    it('should log data sync events throughout the process', async () => {
      await syncV2(mockArchivers)

      // Verify logging was called multiple times
      expect(ArchiverLogging.logDataSync).toHaveBeenCalled()

      // Verify operation ID was generated
      expect(ArchiverLogging.generateOperationId).toHaveBeenCalled()
    })
  })

  describe('syncTxList', () => {
    beforeEach(() => {
      jest.mocked(queries.robustQueryForTxListHash).mockReturnValue(
        okAsync({
          value: { txListHash: 'tx-list-hash' },
          winningNodes: mockActiveNodes,
        })
      )
      jest.mocked(queries.getTxListFromNode).mockReturnValue(okAsync(mockTxList))
      jest.mocked(verify.verifyTxList).mockReturnValue(ok(true))
    })

    it('should successfully sync transaction list', async () => {
      const result = await syncTxList(mockActiveNodes, mockOperationId)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual(mockTxList)
      }

      expect(queries.robustQueryForTxListHash).toHaveBeenCalledWith(mockActiveNodes)
      expect(queries.getTxListFromNode).toHaveBeenCalledWith(mockActiveNodes[0], 'tx-list-hash')
      expect(verify.verifyTxList).toHaveBeenCalledWith(mockTxList, 'tx-list-hash')
    })

    it('should handle empty transaction list', async () => {
      jest.mocked(queries.getTxListFromNode).mockReturnValue(okAsync([]))

      const result = await syncTxList(mockActiveNodes, mockOperationId)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual([])
      }
    })

    it('should handle query failure', async () => {
      jest.mocked(queries.robustQueryForTxListHash).mockReturnValue(errAsync(new Error('Query failed')))

      const result = await syncTxList(mockActiveNodes, mockOperationId)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Query failed')
      }
    })

    it('should handle verification failure', async () => {
      jest.mocked(verify.verifyTxList).mockReturnValue(err(new Error('Verification failed')))

      const result = await syncTxList(mockActiveNodes, mockOperationId)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error.message).toBe('Verification failed')
      }
    })

    it('should log data sync events', async () => {
      await syncTxList(mockActiveNodes, mockOperationId)

      expect(ArchiverLogging.logDataSync).toHaveBeenCalledWith(
        expect.objectContaining({
          dataType: 'TX_LIST',
          operationId: mockOperationId,
        })
      )
    })
  })

  describe('error scenarios', () => {
    it('should handle partial archiver list when some fail', async () => {
      // First archiver fails, second succeeds
      jest
        .mocked(NodeList.getActiveNodeListFromArchiver)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(mockActiveNodes)

      const result = await syncV2(mockArchivers)

      expect(result.isOk()).toBe(true)
      expect(NodeList.getActiveNodeListFromArchiver).toHaveBeenCalledTimes(2)
    })

    it('should handle console.warn when archiver query fails', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      jest
        .mocked(NodeList.getActiveNodeListFromArchiver)
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce(mockActiveNodes)

      await syncV2(mockArchivers)

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('failed to get active node list from archiver'))

      consoleSpy.mockRestore()
    })

    it('should propagate errors through the ResultAsync chain', async () => {
      const testError = new Error('Test error in chain')
      jest.mocked(queries.robustQueryForStandbyNodeListHash).mockReturnValue(errAsync(testError))

      const result = await syncV2(mockArchivers)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error).toBe(testError)
      }
    })
  })
})

