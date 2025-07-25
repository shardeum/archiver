import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as NodeList from '../../../src/NodeList'
import * as State from '../../../src/State'
import * as P2P from '../../../src/P2P'
import * as Utils from '../../../src/Utils'
import * as Logger from '../../../src/Logger'
import * as Crypto from '../../../src/Crypto'
import { config } from '../../../src/Config'

// Mock dependencies
jest.mock('../../../src/State', () => ({
  activeArchivers: [],
  ArchiverNodeInfo: jest.fn(),
}))
jest.mock('../../../src/P2P', () => ({
  getJson: jest.fn(),
}))
jest.mock('../../../src/Utils', () => ({
  insertSorted: jest.fn((arr: any[], item: any, compareFn: any) => {
    arr.push(item)
    arr.sort(compareFn)
  }),
  getRandomItemFromArr: jest.fn((arr: any[], rejectPercent: number, count?: number) => {
    if (count && count > 1) {
      return arr.slice(0, count)
    }
    return arr.length > 0 ? [arr[0]] : []
  }),
}))
jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}))
jest.mock('../../../src/Crypto', () => ({
  sign: jest.fn((obj: any) => ({ ...obj, sign: { owner: 'test-owner', sig: 'test-sig' } })),
  verify: jest.fn().mockReturnValue(true),
}))
jest.mock('../../../src/Config', () => ({
  config: {
    N_RANDOM_NODELIST_BUCKETS: 3,
    N_NODELIST: 10,
    N_NODE_REJECT_PERCENT: 0,
  },
}))

describe('NodeList', () => {
  // Cast mocked functions
  const mockedGetJson = P2P.getJson as jest.MockedFunction<typeof P2P.getJson>
  const mockedInsertSorted = Utils.insertSorted as jest.MockedFunction<typeof Utils.insertSorted>
  const mockedGetRandomItemFromArr = Utils.getRandomItemFromArr as jest.MockedFunction<
    typeof Utils.getRandomItemFromArr
  >
  const mockedSign = Crypto.sign as jest.MockedFunction<typeof Crypto.sign>
  const mockedVerify = Crypto.verify as jest.MockedFunction<typeof Crypto.verify>

  // Spy on console methods
  let consoleWarnSpy: jest.SpiedFunction<typeof console.warn>

  beforeEach(() => {
    jest.clearAllMocks()
    // Clear all internal state
    NodeList.clearNodeLists()
    // Clear standby nodes manually as clearNodeLists doesn't clear them
    const standbyNodes = NodeList.getStandbyList()
    if (standbyNodes.length > 0) {
      NodeList.removeStandbyNodes(standbyNodes.map((n) => n.publicKey))
    }
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('NodeStatus enum', () => {
    it('should have correct enum values', () => {
      expect(NodeList.NodeStatus.STANDBY).toBe('standby')
      expect(NodeList.NodeStatus.ACTIVE).toBe('active')
      expect(NodeList.NodeStatus.SYNCING).toBe('syncing')
    })
  })

  describe('isEmpty', () => {
    it('should return true when no nodes', () => {
      expect(NodeList.isEmpty()).toBe(true)
    })

    it('should return false when nodes exist', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }
      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      expect(NodeList.isEmpty()).toBe(false)
    })
  })

  describe('addNodes', () => {
    it('should add active nodes correctly', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      expect(NodeList.getActiveNodeCount()).toBe(2)
      expect(NodeList.getActiveList()).toHaveLength(2)
      expect(NodeList.byPublicKey.size).toBe(2)
    })

    it('should add syncing nodes correctly', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.SYNCING, [node])

      expect(NodeList.getSyncingList()).toHaveLength(1)
      expect(NodeList.byPublicKey.has('pk1')).toBe(true)
    })

    it('should move nodes between states correctly', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      // Add as syncing
      NodeList.addNodes(NodeList.NodeStatus.SYNCING, [node])
      expect(NodeList.getSyncingList()).toHaveLength(1)
      expect(NodeList.getActiveList()).toHaveLength(0)

      // Move to active using setStatus (addNodes won't move existing nodes)
      NodeList.setStatus(NodeList.NodeStatus.ACTIVE, ['pk1'])
      expect(NodeList.getSyncingList()).toHaveLength(0)
      expect(NodeList.getActiveList()).toHaveLength(1)
    })

    it('should not add duplicate nodes', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])
      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      expect(NodeList.getActiveList()).toHaveLength(1)
    })

    it('should handle empty node array', () => {
      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [])

      expect(NodeList.getActiveList()).toHaveLength(0)
    })

    it('should update node id when provided', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      const nodeWithId = { ...node, id: 'node1' }
      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [nodeWithId])

      const storedNode = NodeList.byPublicKey.get('pk1')
      expect(storedNode?.id).toBe('node1')
    })
  })

  describe('refreshNodes', () => {
    it('should add new nodes during refresh', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.refreshNodes(NodeList.NodeStatus.ACTIVE, nodes)

      expect(NodeList.getActiveList()).toHaveLength(2)
    })

    it('should handle empty refresh list', () => {
      NodeList.refreshNodes(NodeList.NodeStatus.ACTIVE, [])

      expect(NodeList.getActiveList()).toHaveLength(0)
    })

    it('should update existing nodes during refresh', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      const updatedNode = { ...node, id: 'updated-id' }
      NodeList.refreshNodes(NodeList.NodeStatus.ACTIVE, [updatedNode])

      const storedNode = NodeList.getNodeInfoById('updated-id')
      expect(storedNode?.publicKey).toBe('pk1')
    })
  })

  describe('removeNodes', () => {
    it('should remove nodes correctly', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)
      NodeList.removeNodes(['pk1'])

      expect(NodeList.getActiveList()).toHaveLength(1)
      expect(NodeList.byPublicKey.has('pk1')).toBe(false)
      expect(NodeList.byPublicKey.has('pk2')).toBe(true)
    })

    it('should warn when removing non-existent node', () => {
      NodeList.removeNodes(['non-existent'])

      expect(consoleWarnSpy).toHaveBeenCalledWith('removeNodes: publicKey non-existent not in nodelist')
    })

    it('should handle empty removal list', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])
      NodeList.removeNodes([])

      expect(NodeList.getActiveList()).toHaveLength(1)
    })
  })

  describe('standby node operations', () => {
    it('should add standby nodes', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2' },
      ]

      NodeList.addStandbyNodes(nodes)

      expect(NodeList.getStandbyList()).toHaveLength(2)
    })

    it('should not add duplicate standby nodes', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
      }

      NodeList.addStandbyNodes([node])
      NodeList.addStandbyNodes([node])

      expect(NodeList.getStandbyList()).toHaveLength(1)
    })

    it('should remove standby nodes', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2' },
      ]

      NodeList.addStandbyNodes(nodes)
      NodeList.removeStandbyNodes(['pk1'])

      expect(NodeList.getStandbyList()).toHaveLength(1)
      expect(NodeList.getStandbyList()[0].publicKey).toBe('pk2')
    })
  })

  describe('setStatus', () => {
    it('should change node status from syncing to active', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.SYNCING, [node])
      NodeList.setStatus(NodeList.NodeStatus.ACTIVE, ['pk1'])

      expect(NodeList.getSyncingList()).toHaveLength(0)
      expect(NodeList.getActiveList()).toHaveLength(1)
    })

    it('should change node status from active to syncing', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])
      NodeList.setStatus(NodeList.NodeStatus.SYNCING, ['pk1'])

      expect(NodeList.getActiveList()).toHaveLength(0)
      expect(NodeList.getSyncingList()).toHaveLength(1)
    })

    it('should warn when setting status for non-existent node', () => {
      NodeList.setStatus(NodeList.NodeStatus.ACTIVE, ['non-existent'])

      expect(consoleWarnSpy).toHaveBeenCalledWith('setStatus: publicKey non-existent not in nodelist')
    })

    it('should handle empty status update list', () => {
      NodeList.setStatus(NodeList.NodeStatus.ACTIVE, [])

      expect(Logger.mainLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('Updating status'))
    })
  })

  describe('node retrieval functions', () => {
    it('should get first node', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      const firstNode = NodeList.getFirstNode()
      expect(firstNode).toEqual(node)
    })

    it('should return undefined when no first node', () => {
      const firstNode = NodeList.getFirstNode()
      expect(firstNode).toBeUndefined()
    })

    it('should get active list sorted by id', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node2' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node1' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const activeList = NodeList.getActiveList(true)
      expect(activeList[0].id).toBe('node1')
      expect(activeList[1].id).toBe('node2')
    })

    it('should get active list unsorted', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const activeList = NodeList.getActiveList(false)
      expect(activeList).toHaveLength(2)
    })

    it('should get node info by id', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])

      const retrievedNode = NodeList.getNodeInfoById('node1')
      expect(retrievedNode).toEqual(node)
    })

    it('should return undefined for non-existent node id', () => {
      const retrievedNode = NodeList.getNodeInfoById('non-existent')
      expect(retrievedNode).toBeUndefined()
    })
  })

  describe('caching functions', () => {
    beforeEach(() => {
      // Reset cache-related maps
      NodeList.activeNodescache.clear()
      NodeList.fullNodesCache.clear()
      NodeList.cacheUpdatedTimes.clear()
      NodeList.realUpdatedTimes.clear()
    })

    it('should build cache when cold', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const cachedList = NodeList.getCachedNodeList()

      expect(cachedList).toBeDefined()
      expect(cachedList.nodeList).toBeDefined()
      expect(NodeList.activeNodescache.size).toBe(config.N_RANDOM_NODELIST_BUCKETS)
    })

    it('should return cached list when hot', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' }]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      // First call builds cache
      NodeList.getCachedNodeList()

      // Set cache as hot
      NodeList.realUpdatedTimes.set('/nodelist', Date.now() - 1000)
      NodeList.cacheUpdatedTimes.set('/nodelist', Date.now())

      // Second call should return cached value
      const cachedList = NodeList.getCachedNodeList()

      expect(cachedList).toBeDefined()
      expect(mockedSign).toHaveBeenCalledTimes(config.N_RANDOM_NODELIST_BUCKETS) // Only called during first build
    })

    it('should handle empty node list in cache', () => {
      const cachedList = NodeList.getCachedNodeList()

      expect(cachedList).toBeDefined()
      expect(cachedList.nodeList).toEqual([])
    })

    it('should get cached full node list', () => {
      const activeNodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' }]
      const syncingNodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' }]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, activeNodes)
      NodeList.addNodes(NodeList.NodeStatus.SYNCING, syncingNodes)

      const fullList = NodeList.getCachedFullNodeList(false, false, false)

      expect(fullList).toBeDefined()
      expect(fullList.nodeList).toHaveLength(2)
    })

    it('should get cached active only node list', () => {
      const activeNodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' }]
      const syncingNodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' }]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, activeNodes)
      NodeList.addNodes(NodeList.NodeStatus.SYNCING, syncingNodes)

      const activeOnlyList = NodeList.getCachedFullNodeList(true, false, false)

      expect(activeOnlyList).toBeDefined()
      expect(activeOnlyList.nodeList).toHaveLength(1)
      expect(activeOnlyList.nodeList[0].publicKey).toBe('pk1')
    })
  })

  describe('getActiveNodeListFromArchiver', () => {
    it('should get node list from archiver successfully', async () => {
      const archiver: State.ArchiverNodeInfo = {
        ip: '10.0.0.1',
        port: 4000,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      const mockResponse = {
        nodeList: [{ ip: '10.0.0.2', port: 9001, publicKey: 'pk1' }],
        sign: { owner: 'archiver1', sig: 'sig1' },
      }

      mockedGetJson.mockResolvedValueOnce(mockResponse)
      mockedVerify.mockReturnValueOnce(true)
      ;(State.activeArchivers as any) = [archiver]

      const result = await NodeList.getActiveNodeListFromArchiver(archiver)

      expect(result).toEqual(mockResponse.nodeList)
    })

    it('should return empty array when verification fails', async () => {
      const archiver: State.ArchiverNodeInfo = {
        ip: '10.0.0.1',
        port: 4000,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      const mockResponse = {
        nodeList: [{ ip: '10.0.0.2', port: 9001, publicKey: 'pk1' }],
        sign: { owner: 'archiver1', sig: 'sig1' },
      }

      mockedGetJson.mockResolvedValueOnce(mockResponse)
      mockedVerify.mockReturnValueOnce(false)

      const result = await NodeList.getActiveNodeListFromArchiver(archiver)

      expect(result).toEqual([])
    })

    it('should return empty array when response is invalid', async () => {
      const archiver: State.ArchiverNodeInfo = {
        ip: '10.0.0.1',
        port: 4000,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      mockedGetJson.mockResolvedValueOnce(null)

      const result = await NodeList.getActiveNodeListFromArchiver(archiver)

      expect(result).toEqual([])
    })

    it('should return empty array when archiver is not active', async () => {
      const archiver: State.ArchiverNodeInfo = {
        ip: '10.0.0.1',
        port: 4000,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      const mockResponse = {
        nodeList: [{ ip: '10.0.0.2', port: 9001, publicKey: 'pk1' }],
        sign: { owner: 'different-archiver', sig: 'sig1' },
      }

      mockedGetJson.mockResolvedValueOnce(mockResponse)
      mockedVerify.mockReturnValueOnce(true)
      ;(State.activeArchivers as any) = [archiver]

      const result = await NodeList.getActiveNodeListFromArchiver(archiver)

      expect(result).toEqual([])
    })
  })

  describe('getRandomActiveNodes', () => {
    it('should return random active nodes', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
        { ip: '10.0.0.3', port: 9003, publicKey: 'pk3', id: 'node3' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const randomNodes = NodeList.getRandomActiveNodes(2)

      expect(randomNodes).toHaveLength(2)
    })

    it('should return all nodes when requested count exceeds available', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [{ ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' }]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const randomNodes = NodeList.getRandomActiveNodes(5)

      expect(randomNodes).toHaveLength(1)
    })

    it('should handle single node request', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)

      const randomNodes = NodeList.getRandomActiveNodes(1)

      expect(randomNodes).toHaveLength(1)
    })
  })

  describe('changeNodeListInRestore', () => {
    it('should change active nodes to syncing in restore mode', () => {
      const nodes: NodeList.ConsensusNodeInfo[] = [
        { ip: '10.0.0.1', port: 9001, publicKey: 'pk1', id: 'node1' },
        { ip: '10.0.0.2', port: 9002, publicKey: 'pk2', id: 'node2' },
      ]

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, nodes)
      NodeList.changeNodeListInRestore()

      expect(NodeList.getActiveList()).toHaveLength(0)
      expect(NodeList.getSyncingList()).toHaveLength(2)
    })

    it('should do nothing when no active nodes', () => {
      NodeList.changeNodeListInRestore()

      expect(Logger.mainLogger.debug).not.toHaveBeenCalledWith(expect.stringContaining('changeNodeListInRestore'))
    })
  })

  describe('clearNodeLists', () => {
    it('should clear all node lists and caches', () => {
      const node: NodeList.ConsensusNodeInfo = {
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
      }

      NodeList.addNodes(NodeList.NodeStatus.ACTIVE, [node])
      NodeList.getCachedNodeList() // Build cache

      NodeList.clearNodeLists()

      expect(NodeList.isEmpty()).toBe(true)
      expect(NodeList.getActiveList()).toHaveLength(0)
      expect(NodeList.activeNodescache.size).toBe(0)
      expect(NodeList.fullNodesCache.size).toBe(0)
    })

    it('should handle errors during clearing', () => {
      // Mock an error
      jest.spyOn(NodeList.activeNodescache, 'clear').mockImplementationOnce(() => {
        throw new Error('Test error')
      })

      NodeList.clearNodeLists()

      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error thrown in clearNodeListCache', expect.any(Error))
    })
  })

  describe('toggleFirstNode', () => {
    it('should toggle foundFirstNode flag', () => {
      // Store initial state
      const initialState = NodeList.foundFirstNode

      NodeList.toggleFirstNode()
      expect(NodeList.foundFirstNode).toBe(!initialState)

      NodeList.toggleFirstNode()
      expect(NodeList.foundFirstNode).toBe(initialState)
    })
  })

  describe('conversion functions', () => {
    it('should convert P2P joined consensor to NodeList format', () => {
      const p2pJoinedConsensor = {
        internalIp: '10.0.0.1',
        internalPort: 9001,
        publicKey: 'pk1',
        id: 'node1',
        externalIp: '1.2.3.4',
        externalPort: 9001,
        cycleJoined: 'cycle1',
        counterRefreshed: 100,
      }

      const result = NodeList.fromP2PTypesJoinedConsensor(p2pJoinedConsensor as any)

      expect(result).toEqual({
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
        externalIp: '1.2.3.4',
        externalPort: 9001,
        cycleJoined: 'cycle1',
        counterRefreshed: 100,
      })
    })

    it('should convert P2P node to NodeList format', () => {
      const p2pNode = {
        internalIp: '10.0.0.1',
        internalPort: 9001,
        publicKey: 'pk1',
        id: 'node1',
        externalIp: '1.2.3.4',
        externalPort: 9001,
        cycleJoined: 'cycle1',
        counterRefreshed: 100,
      }

      const result = NodeList.fromP2PTypesNode(p2pNode as any)

      expect(result).toEqual({
        ip: '10.0.0.1',
        port: 9001,
        publicKey: 'pk1',
        id: 'node1',
        externalIp: '1.2.3.4',
        externalPort: 9001,
        cycleJoined: 'cycle1',
        counterRefreshed: 100,
      })
    })
  })

  describe('sorting functions', () => {
    it('should sort by ascending public key', () => {
      const a = { publicKey: 'aaa' } as State.ArchiverNodeInfo
      const b = { publicKey: 'bbb' } as State.ArchiverNodeInfo

      expect(NodeList.byAscendingPublicKey(a, b)).toBe(-1)
      expect(NodeList.byAscendingPublicKey(b, a)).toBe(1)
      expect(NodeList.byAscendingPublicKey(a, a)).toBe(-1)
    })
  })
})
