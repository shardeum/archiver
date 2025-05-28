import { 
  NodeStatus, 
  Node, 
  Update, 
  Change, 
  reversed, 
  ChangeSquasher, 
  parseRecord, 
  parse, 
  applyNodeListChange,
  activeNodeCount,
  totalNodeCount
} from '../../../../src/Data/CycleParser'
import * as NodeList from '../../../../src/NodeList'
import { P2P } from '@shardeum-foundation/lib-types'

// Mock dependencies
jest.mock('../../../../src/NodeList')

describe('CycleParser', () => {
  const mockNodeList = NodeList as jest.Mocked<typeof NodeList>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('NodeStatus enum', () => {
    it('should have correct status values', () => {
      expect(NodeStatus.ACTIVE).toBe('active')
      expect(NodeStatus.SYNCING).toBe('syncing')
      expect(NodeStatus.REMOVED).toBe('removed')
    })
  })

  describe('reversed function', () => {
    it('should reverse an array', () => {
      const arr = [1, 2, 3, 4, 5]
      const result = Array.from(reversed(arr))
      expect(result).toEqual([5, 4, 3, 2, 1])
    })

    it('should reverse an empty array', () => {
      const arr: number[] = []
      const result = Array.from(reversed(arr))
      expect(result).toEqual([])
    })

    it('should reverse a single element array', () => {
      const arr = [1]
      const result = Array.from(reversed(arr))
      expect(result).toEqual([1])
    })

    it('should work with iterables that are not arrays', () => {
      const set = new Set([1, 2, 3])
      const result = Array.from(reversed(set))
      expect(result).toEqual([3, 2, 1])
    })

    it('should work with strings', () => {
      const str = 'hello'
      const result = Array.from(reversed(str))
      expect(result).toEqual(['o', 'l', 'l', 'e', 'h'])
    })
  })

  describe('ChangeSquasher', () => {
    let squasher: ChangeSquasher

    beforeEach(() => {
      squasher = new ChangeSquasher()
    })

    it('should initialize with empty change object', () => {
      expect(squasher.final).toEqual({
        added: [],
        removed: [],
        updated: []
      })
      expect(squasher.addedIds.size).toBe(0)
      expect(squasher.removedIds.size).toBe(0)
      expect(squasher.seenUpdates.size).toBe(0)
    })

    it('should add removed nodes', () => {
      const change: Change = {
        added: [],
        removed: ['node1', 'node2'],
        updated: []
      }

      squasher.addChange(change)

      expect(squasher.removedIds.has('node1')).toBe(true)
      expect(squasher.removedIds.has('node2')).toBe(true)
    })

    it('should ignore duplicate removed nodes', () => {
      const change1: Change = {
        added: [],
        removed: ['node1'],
        updated: []
      }
      const change2: Change = {
        added: [],
        removed: ['node1', 'node2'],
        updated: []
      }

      squasher.addChange(change1)
      squasher.addChange(change2)

      expect(squasher.removedIds.size).toBe(2)
    })

    it('should add updated nodes', () => {
      const update: Update = {
        id: 'node1',
        status: NodeStatus.ACTIVE
      }
      const change: Change = {
        added: [],
        removed: [],
        updated: [update]
      }

      squasher.addChange(change)

      expect(squasher.seenUpdates.get('node1')).toEqual(update)
    })

    it('should ignore updates for removed nodes', () => {
      const change1: Change = {
        added: [],
        removed: ['node1'],
        updated: []
      }
      const change2: Change = {
        added: [],
        removed: [],
        updated: [{ id: 'node1', status: NodeStatus.ACTIVE }]
      }

      squasher.addChange(change1)
      squasher.addChange(change2)

      expect(squasher.seenUpdates.has('node1')).toBe(false)
    })

    it('should skip duplicate updates', () => {
      const update1: Update = { id: 'node1', status: NodeStatus.ACTIVE }
      const update2: Update = { id: 'node1', status: NodeStatus.SYNCING }
      
      const change1: Change = {
        added: [],
        removed: [],
        updated: [update1]
      }
      const change2: Change = {
        added: [],
        removed: [],
        updated: [update2]
      }

      squasher.addChange(change1)
      squasher.addChange(change2)

      expect(squasher.seenUpdates.get('node1')).toEqual(update1)
    })

    it('should add joined consensors in reverse order', () => {
      const node1: NodeList.JoinedConsensor = {
        id: 'node1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }
      const node2: NodeList.JoinedConsensor = {
        id: 'node2',
        publicKey: 'pk2',
        ip: '127.0.0.2',
        port: 8000,
        externalIp: '127.0.0.2',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }

      const change: Change = {
        added: [node1, node2],
        removed: [],
        updated: []
      }

      squasher.addChange(change)

      expect(squasher.final.added).toEqual([node1, node2])
      expect(squasher.addedIds.has('node1')).toBe(true)
      expect(squasher.addedIds.has('node2')).toBe(true)
    })

    it('should ignore duplicate added nodes', () => {
      const node: NodeList.JoinedConsensor = {
        id: 'node1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }

      const change: Change = {
        added: [node, node],
        removed: [],
        updated: []
      }

      squasher.addChange(change)

      expect(squasher.final.added.length).toBe(1)
    })

    it('should ignore added nodes that are already removed', () => {
      const node: NodeList.JoinedConsensor = {
        id: 'node1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }

      const change1: Change = {
        added: [],
        removed: ['node1'],
        updated: []
      }
      const change2: Change = {
        added: [node],
        removed: [],
        updated: []
      }

      squasher.addChange(change1)
      squasher.addChange(change2)

      expect(squasher.final.added.length).toBe(0)
    })

    it('should move updates to final when adding nodes with updates', () => {
      const node: NodeList.JoinedConsensor = {
        id: 'node1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }
      const update: Update = {
        id: 'node1',
        status: NodeStatus.ACTIVE
      }

      const change1: Change = {
        added: [],
        removed: [],
        updated: [update]
      }
      const change2: Change = {
        added: [node],
        removed: [],
        updated: []
      }

      squasher.addChange(change1)
      squasher.addChange(change2)

      expect(squasher.final.updated).toEqual([update])
      expect(squasher.seenUpdates.has('node1')).toBe(false)
    })
  })

  describe('parseRecord', () => {
    const createMockCycleRecord = (): P2P.CycleCreatorTypes.CycleRecord => ({
      activated: ['node1', 'node2'],
      active: 10,
      apoptosized: ['node3'],
      appRemoved: ['node4'],
      archiverWeight: 1,
      counter: 5,
      desired: 20,
      duration: 60,
      expired: 0,
      joined: [],
      joinedArchivers: [],
      joinedConsensors: [],
      leaving: [],
      leavingArchivers: [],
      lost: [],
      lostArchivers: [],
      lostSyncing: [],
      marker: 'test',
      maxSyncTime: 300,
      mode: 'processing',
      networkId: 'test-network',
      networkConfigHash: 'hash',
      previous: 'prev-hash',
      refreshedArchivers: [],
      refreshedConsensors: [],
      removed: ['node5'],
      returned: [],
      start: 1000,
      syncing: 5,
      target: 20,
      toDelete: [],
      witnesses: [],
      safetyMode: false,
      safetyNum: 0,
      networkStateHash: 'state-hash',
      archiversAtShutdown: []
    } as unknown as P2P.CycleCreatorTypes.CycleRecord)

    beforeEach(() => {
      mockNodeList.getNodeInfoById.mockReturnValue(null)
      mockNodeList.fromP2PTypesNode.mockImplementation((node: any) => ({
        id: node.id,
        publicKey: node.publicKey,
        ip: node.ip || node.externalIp,
        port: node.port || node.externalPort,
        externalIp: node.ip || node.externalIp,
        externalPort: node.port || node.externalPort,
        counterRefreshed: 0,
        cycleJoined: '0',
      }))
      mockNodeList.fromP2PTypesJoinedConsensor.mockImplementation((node: any) => ({
        id: node.id,
        publicKey: node.publicKey,
        ip: node.ip || node.externalIp,
        port: node.port || node.externalPort,
        externalIp: node.ip || node.externalIp,
        externalPort: node.port || node.externalPort,
        counterRefreshed: 0,
        cycleJoined: String(node.cycleJoined || 0),
      }))
    })

    it('should parse activated nodes', () => {
      const record = createMockCycleRecord()
      const result = parseRecord(record)

      expect(result.updated).toContainEqual({
        id: 'node1',
        activeTimestamp: 1000,
        status: NodeStatus.ACTIVE
      })
      expect(result.updated).toContainEqual({
        id: 'node2',
        activeTimestamp: 1000,
        status: NodeStatus.ACTIVE
      })
    })

    it('should parse removed nodes', () => {
      const record = createMockCycleRecord()
      const result = parseRecord(record)

      expect(result.removed).toContain('node3')
      expect(result.removed).toContain('node4')
      expect(result.removed).toContain('node5')
    })

    it('should handle refreshed consensors that exist in node list', () => {
      const existingNode: NodeList.JoinedConsensor = {
        id: 'refresh1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 3,
        cycleJoined: '1',
      }
      
      mockNodeList.getNodeInfoById.mockReturnValueOnce(existingNode)

      const record = createMockCycleRecord()
      record.refreshedConsensors = [{
        id: 'refresh1',
        ip: '127.0.0.1',
        port: 8000,
        publicKey: 'pk1',
        curvePublicKey: 'curve_pk1',
        externalIp: '127.0.0.1',
        externalPort: 8000,
        internalIp: '127.0.0.1',
        internalPort: 8000
      }] as any

      const result = parseRecord(record)

      expect(result.updated).toContainEqual({
        id: 'refresh1',
        counterRefreshed: 5
      })
    })

    it('should not update counterRefreshed if record counter is lower', () => {
      const existingNode: NodeList.JoinedConsensor = {
        id: 'refresh1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 10,
        cycleJoined: '1',
      }
      
      mockNodeList.getNodeInfoById.mockReturnValueOnce(existingNode)

      const record = createMockCycleRecord()
      record.refreshedConsensors = [{
        id: 'refresh1',
        ip: '127.0.0.1',
        port: 8000,
        publicKey: 'pk1',
        curvePublicKey: 'curve_pk1',
        externalIp: '127.0.0.1',
        externalPort: 8000,
        internalIp: '127.0.0.1',
        internalPort: 8000
      }] as any

      const result = parseRecord(record)

      const refreshUpdate = result.updated.find(u => u.id === 'refresh1' && u.counterRefreshed)
      expect(refreshUpdate).toBeUndefined()
    })

    it('should handle refreshed consensors not in node list', () => {
      const record = createMockCycleRecord()
      record.refreshedConsensors = [{
        id: 'refresh2',
        ip: '127.0.0.2',
        port: 8000,
        publicKey: 'pk2',
        curvePublicKey: 'curve_pk2',
        externalIp: '127.0.0.2',
        externalPort: 8000,
        internalIp: '127.0.0.2',
        internalPort: 8000
      }] as any

      const result = parseRecord(record)

      expect(result.added.length).toBe(1)
      expect(result.added[0].id).toBe('refresh2')
      
      expect(result.updated).toContainEqual({
        id: 'refresh2',
        status: NodeStatus.ACTIVE,
        counterRefreshed: 5
      })
    })

    it('should parse joined consensors', () => {
      const record = createMockCycleRecord()
      record.joinedConsensors = [{
        id: 'joined1',
        publicKey: 'pk1',
        externalIp: '127.0.0.1',
        externalPort: 8000,
        cycleJoined: 5,
        counterRefreshed: 0,
        internalIp: '127.0.0.1',
        internalPort: 8000,
        address: '0x123',
        joinRequestTimestamp: 0,
      } as unknown as P2P.JoinTypes.JoinedConsensor]

      const result = parseRecord(record)

      expect(result.added.length).toBe(1)
      expect(result.added[0].id).toBe('joined1')
    })

    it('should handle empty arrays', () => {
      const record = createMockCycleRecord()
      record.activated = []
      record.apoptosized = []
      record.removed = []
      record.appRemoved = []
      record.joinedConsensors = []
      record.refreshedConsensors = []

      const result = parseRecord(record)

      expect(result.added).toEqual([])
      expect(result.removed).toEqual([])
      expect(result.updated).toEqual([])
    })
  })

  describe('parse', () => {
    it('should call parseRecord and return the result', () => {
      const record = {
        activated: [],
        active: 0,
        apoptosized: [],
        appRemoved: [],
        joinedConsensors: [],
        refreshedConsensors: [],
        removed: [],
        counter: 1,
        start: 1000,
        archiversAtShutdown: []
      } as unknown as P2P.CycleCreatorTypes.CycleRecord

      const result = parse(record)

      expect(result).toEqual({
        added: [],
        removed: [],
        updated: []
      })
    })
  })

  describe('applyNodeListChange', () => {
    beforeEach(() => {
      mockNodeList.getNodeInfoById.mockReturnValue(null)
    })

    it('should add nodes grouped by cycle', () => {
      const nodes: NodeList.JoinedConsensor[] = [
        {
          id: 'node1',
          publicKey: 'pk1',
          ip: '127.0.0.1',
          port: 8000,
          externalIp: '127.0.0.1',
          externalPort: 8000,
          counterRefreshed: 0,
          cycleJoined: '1',
          },
        {
          id: 'node2',
          publicKey: 'pk2',
          ip: '127.0.0.2',
          port: 8000,
          externalIp: '127.0.0.2',
          externalPort: 8000,
          counterRefreshed: 0,
          cycleJoined: '1',
          },
        {
          id: 'node3',
          publicKey: 'pk3',
          ip: '127.0.0.3',
          port: 8000,
          externalIp: '127.0.0.3',
          externalPort: 8000,
          counterRefreshed: 0,
          cycleJoined: '2',
          }
      ]

      const change: Change = {
        added: nodes,
        removed: [],
        updated: []
      }

      applyNodeListChange(change)

      expect(mockNodeList.addNodes).toHaveBeenCalledTimes(2)
      expect(mockNodeList.addNodes).toHaveBeenCalledWith(
        NodeList.NodeStatus.SYNCING,
        [
          { ip: '127.0.0.1', port: 8000, publicKey: 'pk1', id: 'node1' },
          { ip: '127.0.0.2', port: 8000, publicKey: 'pk2', id: 'node2' }
        ]
      )
      expect(mockNodeList.addNodes).toHaveBeenCalledWith(
        NodeList.NodeStatus.SYNCING,
        [{ ip: '127.0.0.3', port: 8000, publicKey: 'pk3', id: 'node3' }]
      )
    })

    it('should update node status to active', () => {
      const nodeInfo: NodeList.JoinedConsensor = {
        id: 'node1',
        publicKey: 'pk1',
        ip: '127.0.0.1',
        port: 8000,
        externalIp: '127.0.0.1',
        externalPort: 8000,
        counterRefreshed: 0,
        cycleJoined: '1',
      }

      mockNodeList.getNodeInfoById.mockReturnValueOnce(nodeInfo)

      const change: Change = {
        added: [],
        removed: [],
        updated: [{ id: 'node1', status: NodeStatus.ACTIVE }]
      }

      applyNodeListChange(change)

      expect(mockNodeList.setStatus).toHaveBeenCalledWith(
        NodeList.NodeStatus.ACTIVE,
        ['pk1']
      )
    })

    it('should skip updates for nodes not in list', () => {
      const change: Change = {
        added: [],
        removed: [],
        updated: [{ id: 'node1', status: NodeStatus.ACTIVE }]
      }

      applyNodeListChange(change)

      expect(mockNodeList.setStatus).toHaveBeenCalledWith(
        NodeList.NodeStatus.ACTIVE,
        []
      )
    })

    it('should handle empty changes', () => {
      const change: Change = {
        added: [],
        removed: [],
        updated: []
      }

      applyNodeListChange(change)

      expect(mockNodeList.addNodes).not.toHaveBeenCalled()
      expect(mockNodeList.setStatus).not.toHaveBeenCalled()
    })
  })

  describe('activeNodeCount', () => {
    it('should calculate active node count correctly', () => {
      const cycle = {
        active: 100,
        activated: ['n1', 'n2'],
        apoptosized: ['n3'],
        removed: ['n4', 'n5'],
        appRemoved: ['n6'],
        lost: ['n7', 'n8']
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = activeNodeCount(cycle)

      expect(result).toBe(100 + 2 - 1 - 2 - 1 - 2) // 96
    })

    it('should handle empty arrays', () => {
      const cycle = {
        active: 50,
        activated: [],
        apoptosized: [],
        removed: [],
        appRemoved: [],
        lost: []
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = activeNodeCount(cycle)

      expect(result).toBe(50)
    })

    it('should handle all nodes being removed', () => {
      const cycle = {
        active: 10,
        activated: [],
        apoptosized: ['n1', 'n2', 'n3'],
        removed: ['n4', 'n5'],
        appRemoved: ['n6', 'n7'],
        lost: ['n8', 'n9', 'n10']
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = activeNodeCount(cycle)

      expect(result).toBe(0)
    })
  })

  describe('totalNodeCount', () => {
    it('should calculate total node count correctly', () => {
      const cycle = {
        syncing: 20,
        joinedConsensors: [{}, {}, {}],
        active: 100,
        apoptosized: ['n1'],
        removed: ['n2', 'n3'],
        appRemoved: ['n4']
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = totalNodeCount(cycle)

      expect(result).toBe(20 + 3 + 100 - 1 - 2 - 1) // 119
    })

    it('should handle empty arrays', () => {
      const cycle = {
        syncing: 10,
        joinedConsensors: [],
        active: 50,
        apoptosized: [],
        removed: [],
        appRemoved: []
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = totalNodeCount(cycle)

      expect(result).toBe(60)
    })

    it('should not count activated nodes (already in syncing)', () => {
      const cycle = {
        syncing: 20,
        joinedConsensors: [],
        active: 100,
        activated: ['n1', 'n2', 'n3'], // These should not be counted
        apoptosized: [],
        removed: [],
        appRemoved: []
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = totalNodeCount(cycle)

      expect(result).toBe(120)
    })

    it('should handle negative result', () => {
      const cycle = {
        syncing: 5,
        joinedConsensors: [],
        active: 5,
        apoptosized: ['n1', 'n2', 'n3', 'n4', 'n5'],
        removed: ['n6', 'n7', 'n8', 'n9', 'n10'],
        appRemoved: ['n11', 'n12']
      } as P2P.CycleCreatorTypes.CycleRecord

      const result = totalNodeCount(cycle)

      expect(result).toBe(5 + 5 - 5 - 5 - 2) // -2
    })
  })
})