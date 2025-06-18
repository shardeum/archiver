import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Signature } from '@shardeum-foundation/lib-crypto-utils'

// Mock all dependencies before importing the module
jest.mock('../../../src/Config', () => ({
  config: {
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PORT: 4000,
    ARCHIVER_PUBLIC_KEY: 'test-public-key',
    ARCHIVER_SECRET_KEY: 'test-secret-key',
    VERBOSE: false,
    limitToArchiversOnly: false,
    DevPublicKey: 'dev-public-key',
    experimentalSnapshot: false,
    restrictFirstNodeSelectionByPublicKey: false,
    firstNodePublicKey: 'first-node-public-key',
    maxRecordsPerRequest: 1000,
    REQUEST_LIMIT: {
      MAX_CYCLES_PER_REQUEST: 100,
      MAX_ORIGINAL_TXS_PER_REQUEST: 1000,
      MAX_RECEIPTS_PER_REQUEST: 1000,
      MAX_ACCOUNTS_PER_REQUEST: 1000,
      MAX_BETWEEN_CYCLES_PER_REQUEST: 100,
    },
    checkpoint: {
      bucketConfig: {
        allowCheckpointUpdates: false,
      },
      statusApiLimit: 100,
      statusArraySize: 5000,
    },
  },
  updateConfig: jest.fn(),
}))

jest.mock('../../../src/Crypto', () => ({
  sign: jest.fn((data: any) => ({ ...data, sign: { owner: 'test-owner', sig: 'test-sig' } })),
  verify: jest.fn(() => true),
}))

jest.mock('../../../src/State', () => ({
  isFirst: false,
  isActive: true,
  activeArchivers: [],
  archiversReputation: new Map(),
  otherArchivers: [],
}))

jest.mock('../../../src/NodeList', () => ({
  isEmpty: jest.fn(() => true),
  foundFirstNode: false,
  toggleFirstNode: jest.fn(),
  addNodes: jest.fn(),
  getCachedNodeList: jest.fn(() => ({ nodeList: [] })),
  getCachedFullNodeList: jest.fn(() => ({ nodeList: [] })),
  realUpdatedTimes: new Map(),
  NodeStatus: {
    SYNCING: 'syncing',
  },
}))

jest.mock('../../../src/P2P', () => ({
  createArchiverJoinRequest: jest.fn(() => ({ publicKey: 'test-public-key' })),
  postJson: jest.fn(() => Promise.resolve(null)),
}))

jest.mock('../../../src/archivedCycle/Storage')
jest.mock('../../../src/Data/Data', () => ({
  initSocketClient: jest.fn(),
  createContactTimeout: jest.fn(),
  addDataSender: jest.fn(),
  createDataRequest: jest.fn(),
  dataSenders: new Map(),
  socketClients: new Map(),
  sendLeaveRequest: jest.fn(),
}))
jest.mock('../../../src/Data/Cycles', () => ({
  getCurrentCycleCounter: jest.fn(() => 0),
  lastProcessedMetaData: {},
  removedAndApopedNodes: [],
  getLatestCycleRecords: jest.fn(),
}))
jest.mock('../../../src/Utils', () => ({
  validateTypes: jest.fn(() => null),
  getRandomItemFromArr: jest.fn(() => []),
}))
jest.mock('../../../src/archivedCycle/Gossip')
jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}))
jest.mock('../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn(),
  },
}))
jest.mock('../../../src/profiler/profiler', () => ({
  profilerInstance: {
    profileSectionStart: jest.fn(),
    profileSectionEnd: jest.fn(),
  },
}))
jest.mock('../../../src/dbstore/cycles', () => ({
  queryLatestCycleRecords: jest.fn(() => []),
  queryCycleRecordsBetween: jest.fn(() => []),
  queryCyleCount: jest.fn(() => 0),
}))
jest.mock('../../../src/dbstore/accounts', () => ({
  queryLatestAccounts: jest.fn(() => []),
  queryAccounts: jest.fn(() => []),
  queryAccountCountBetweenCycles: jest.fn(() => 0),
  queryAccountsBetweenCycles: jest.fn(() => []),
  queryAccountByAccountId: jest.fn(() => null),
  queryAccountCount: jest.fn(() => 0),
}))
jest.mock('../../../src/dbstore/transactions', () => ({
  queryLatestTransactions: jest.fn(() => []),
  queryTransactions: jest.fn(() => []),
  queryTransactionCountBetweenCycles: jest.fn(() => 0),
  queryTransactionsBetweenCycles: jest.fn(() => []),
  queryTransactionByTxId: jest.fn(() => null),
  queryTransactionByAccountId: jest.fn(() => null),
  queryTransactionCount: jest.fn(() => 0),
}))
jest.mock('../../../src/dbstore/receipts', () => ({
  queryLatestReceipts: jest.fn(() => []),
  queryReceiptByReceiptId: jest.fn(() => null),
  queryReceipts: jest.fn(() => []),
  queryReceiptCountByCycles: jest.fn(() => []),
  queryReceiptCountBetweenCycles: jest.fn(() => 0),
  queryReceiptsBetweenCycles: jest.fn(() => []),
  queryReceiptCount: jest.fn(() => 0),
}))
jest.mock('../../../src/dbstore/originalTxsData', () => ({
  queryLatestOriginalTxs: jest.fn(() => []),
  queryOriginalTxDataByTxId: jest.fn(() => null),
  queryOriginalTxsData: jest.fn(() => []),
  queryOriginalTxDataCountByCycles: jest.fn(() => []),
  queryOriginalTxDataCount: jest.fn(() => 0),
}))
jest.mock('../../../src/Data/Collector')
jest.mock('../../../src/Data/GossipData')
jest.mock('../../../src/Data/AccountDataProvider')
jest.mock('../../../src/GlobalAccount', () => ({
  getGlobalNetworkAccount: jest.fn(() => 'mock-network-account-hash'),
}))
jest.mock('../../../src/DebugMode', () => ({
  isDebugMiddleware: jest.fn((req, reply) => {}),
}))
jest.mock('../../../src/primary-process', () => ({
  receivedReceiptCount: 100,
  verifiedReceiptCount: 80,
  successReceiptCount: 70,
  failureReceiptCount: 10,
}))
jest.mock('../../../src/ServiceQueue', () => ({
  getTxList: jest.fn(() => []),
}))
jest.mock('../../../src/routes/tickets', () => ({
  default: jest.fn((fastify: any, opts: any, done: any) => done()),
}))
jest.mock('../../../src/shardeum/allowedArchiversManager', () => ({
  allowedArchiversManager: {
    getCurrentConfig: jest.fn(() => ({ allowedArchivers: [] })),
    isArchiverAllowed: jest.fn(() => true),
  },
}))
jest.mock('../../../src/checkpoint/CheckpointData', () => {
  const actualMap = new Map()
  const mockStatusMap = {
    entries: jest.fn(() => Array.from(actualMap.entries())),
    set: jest.fn((key, value) => actualMap.set(key, value)),
    getLatestCycles: jest.fn(() => []),
    _getActualMap: () => actualMap, // For test access
  }
  return {
    checkpointStatusMap: mockStatusMap,
    CheckpointBucket: jest.fn(),
    CheckpointType: {
      Cycle: 0,
      OriginalTx: 1,
      Receipt: 2,
    },
    CheckpointData: class MockCheckpointData {},
  }
})
jest.mock('../../../src/checkpoint/Utils', () => ({
  getCheckpointManager: jest.fn(),
}))
jest.mock('../../../src/dbstore/checkpointStatus', () => ({
  isBucketVerified: jest.fn(() => Promise.resolve(false)),
  CheckpointStatusType: {
    CYCLE: 0,
    RECEIPT: 1,
    ORIGINAL_TX: 2,
  },
}))
jest.mock('../../../src/profiler/archiverLogging', () => ({
  ArchiverLogging: {
    logValidatorConnection: jest.fn(),
  },
}))

// Import the functions to test after all mocks are set up
import { registerRoutes, validateRequestData, RequestDataType, queryFromArchivers } from '../../../src/API'
import * as Crypto from '../../../src/Crypto'
import * as State from '../../../src/State'
import * as NodeList from '../../../src/NodeList'
import * as Utils from '../../../src/Utils'
import * as P2P from '../../../src/P2P'
import { config } from '../../../src/Config'
import * as Cycles from '../../../src/Data/Cycles'
import { allowedArchiversManager } from '../../../src/shardeum/allowedArchiversManager'
import { getGlobalNetworkAccount } from '../../../src/GlobalAccount'
import * as Data from '../../../src/Data/Data'
import { isBucketVerified } from '../../../src/dbstore/checkpointStatus'
import { getCheckpointManager } from '../../../src/checkpoint/Utils'
import { checkpointStatusMap, CheckpointBucket, BucketHashes } from '../../../src/checkpoint/CheckpointData'

describe('API', () => {
  let mockFastify: FastifyInstance
  let mockRequest: FastifyRequest
  let mockReply: FastifyReply
  let registeredRoutes: Map<string, Map<string, Function>>

  beforeEach(() => {
    // Initialize route registry
    registeredRoutes = new Map()
    registeredRoutes.set('GET', new Map())
    registeredRoutes.set('POST', new Map())
    registeredRoutes.set('PATCH', new Map())

    // Setup mock reply
    mockReply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      headers: jest.fn().mockReturnThis(),
      code: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply

    // Setup mock request
    mockRequest = {
      raw: {
        socket: {
          remoteAddress: '192.168.1.1',
          remotePort: 12345,
          destroy: jest.fn(),
        },
      },
      query: {},
      params: {},
      body: {},
    } as unknown as FastifyRequest

    // Setup mock fastify instance
    mockFastify = {
      get: jest.fn((path: string, ...args: any[]) => {
        const handler = args[args.length - 1]
        const getRoutes = registeredRoutes.get('GET') || new Map()
        getRoutes.set(path, handler)
        registeredRoutes.set('GET', getRoutes)
      }),
      post: jest.fn((path: string, ...args: any[]) => {
        const handler = args[args.length - 1]
        const postRoutes = registeredRoutes.get('POST') || new Map()
        postRoutes.set(path, handler)
        registeredRoutes.set('POST', postRoutes)
      }),
      patch: jest.fn((path: string, ...args: any[]) => {
        const handler = args[args.length - 1]
        const patchRoutes = registeredRoutes.get('PATCH') || new Map()
        patchRoutes.set(path, handler)
        registeredRoutes.set('PATCH', patchRoutes)
      }),
      register: jest.fn(),
    } as unknown as FastifyInstance

    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('registerRoutes', () => {
    it('should register all routes', () => {
      registerRoutes(mockFastify)

      // Check that routes are registered
      expect(mockFastify.get).toHaveBeenCalled()
      expect(mockFastify.post).toHaveBeenCalled()
      expect(mockFastify.patch).toHaveBeenCalled()
      expect(mockFastify.register).toHaveBeenCalled()
    })
  })

  describe('GET /myip', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/myip')!
    })

    it('should return the client IP address', () => {
      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ ip: '192.168.1.1' })
    })

    it('should handle IPv6 addresses', () => {
      const ipv6Request = {
        ...mockRequest,
        raw: {
          socket: {
            remoteAddress: '::1',
            remotePort: 12345,
            destroy: jest.fn(),
          },
        },
      } as unknown as FastifyRequest
      handler(ipv6Request, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ ip: '::1' })
    })
  })

  describe('GET /nodeInfo', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/nodeInfo')!
    })

    it('should return node information when reachability is allowed', () => {
      const mockDate = 1234567890
      jest.spyOn(Date, 'now').mockReturnValue(mockDate)

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        publicKey: 'test-public-key',
        ip: '127.0.0.1',
        port: 4000,
        version: expect.any(String),
        time: mockDate,
      })
    })
  })

  describe('GET /status', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/status')!
    })

    it('should return signed status with isActive', async () => {
      ;(State as any).isActive = true
      ;(Crypto.sign as jest.Mock).mockReturnValue({
        status: { isActive: true },
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })

      await handler(mockRequest, mockReply)

      expect(Crypto.sign).toHaveBeenCalledWith({
        status: { isActive: true },
      })
      expect(mockReply.send).toHaveBeenCalledWith({
        status: { isActive: true },
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })
    })
  })

  describe('GET /archivers', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/archivers')!
    })

    it('should return active archivers with "up" reputation', () => {
      ;(State as any).activeArchivers = [
        { publicKey: 'archiver1', ip: '10.0.0.1', port: 4000 },
        { publicKey: 'archiver2', ip: '10.0.0.2', port: 4000 },
        { publicKey: 'archiver3', ip: '10.0.0.3', port: 4000 },
      ]
      ;(State as any).archiversReputation = new Map([
        ['archiver1', 'up'],
        ['archiver2', 'up'],
        ['archiver3', 'down'],
      ])

      handler(mockRequest, mockReply)

      expect(Crypto.sign).toHaveBeenCalledWith({
        activeArchivers: [
          { publicKey: 'archiver1', ip: '10.0.0.1', port: 4000 },
          { publicKey: 'archiver2', ip: '10.0.0.2', port: 4000 },
        ],
      })
    })

    it('should return empty array when no archivers are up', () => {
      ;(State as any).activeArchivers = [{ publicKey: 'archiver1', ip: '10.0.0.1', port: 4000 }]
      ;(State as any).archiversReputation = new Map([['archiver1', 'down']])

      handler(mockRequest, mockReply)

      expect(Crypto.sign).toHaveBeenCalledWith({
        activeArchivers: [],
      })
    })
  })

  describe('validateRequestData', () => {
    beforeEach(() => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should validate request data successfully', () => {
      const data = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'test-sig' },
        someData: 'test',
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o', someData: 's' })

      expect(result).toEqual({ success: true })
      expect(Utils.validateTypes).toHaveBeenCalledWith(data, { sender: 's', sign: 'o', someData: 's' })
      expect(Crypto.verify).toHaveBeenCalledWith(data)
    })

    it('should fail when data types are invalid', () => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue('Invalid type')

      const data = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' })

      expect(result).toEqual({ success: false, error: 'Invalid request data Invalid type' })
    })

    it('should fail when sender and sign owner do not match', () => {
      const data = {
        sender: 'test-sender',
        sign: { owner: 'different-owner', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' })

      expect(result).toEqual({ success: false, error: 'Data sender publicKey and sign owner key does not match' })
    })

    it('should fail when signature is invalid', () => {
      ;(Crypto.verify as jest.Mock).mockReturnValue(false)

      const data = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' })

      expect(result).toEqual({ success: false, error: 'Invalid signature' })
    })

    it('should check allowed archivers when limitToArchiversOnly is true', () => {
      ;(config as any).limitToArchiversOnly = true
      ;(allowedArchiversManager.isArchiverAllowed as jest.Mock).mockReturnValue(false)
      ;(State as any).activeArchivers = []

      const data = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' })

      expect(result).toEqual({ success: false, error: 'Data request sender is not an authorized archiver' })
      expect(allowedArchiversManager.isArchiverAllowed).toHaveBeenCalledWith('test-sender')

      // Reset
      ;(config as any).limitToArchiversOnly = false
    })

    it('should allow DevPublicKey even when not in allowed archivers', () => {
      ;(config as any).limitToArchiversOnly = true
      ;(config as any).DevPublicKey = 'dev-sender'
      ;(allowedArchiversManager.isArchiverAllowed as jest.Mock).mockReturnValue(false)

      const data = {
        sender: 'dev-sender',
        sign: { owner: 'dev-sender', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' })

      expect(result).toEqual({ success: true })

      // Reset
      ;(config as any).limitToArchiversOnly = false
      ;(config as any).DevPublicKey = 'dev-public-key'
    })

    it('should skip archiver check when skipArchiverCheck is true', () => {
      ;(config as any).limitToArchiversOnly = true
      ;(allowedArchiversManager.isArchiverAllowed as jest.Mock).mockReturnValue(false)

      const data = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'test-sig' },
      }

      const result = validateRequestData(data, { sender: 's', sign: 'o' }, true)

      expect(result).toEqual({ success: true })
      expect(allowedArchiversManager.isArchiverAllowed).not.toHaveBeenCalled()

      // Reset
      ;(config as any).limitToArchiversOnly = false
    })
  })

  describe('GET /config', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      // Find the handler with preHandler
      const calls = (mockFastify.get as jest.Mock).mock.calls
      const configCall = calls.find((call) => call[0] === '/config')
      if (configCall) {
        handler = configCall[configCall.length - 1] as Function
      }
    })

    it('should return config without secret key', () => {
      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          ARCHIVER_IP: '127.0.0.1',
          ARCHIVER_PORT: 4000,
          ARCHIVER_PUBLIC_KEY: 'test-public-key',
          ARCHIVER_SECRET_KEY: '',
          VERBOSE: false,
        })
      )
    })

    it('should always return empty string for ARCHIVER_SECRET_KEY', () => {
      ;(config as any).ARCHIVER_SECRET_KEY = 'super-secret-key'

      handler(mockRequest, mockReply)

      const sentConfig = (mockReply.send as jest.Mock).mock.calls[0][0] as any
      expect(sentConfig.ARCHIVER_SECRET_KEY).toBe('')

      // Reset
      ;(config as any).ARCHIVER_SECRET_KEY = 'test-secret-key'
    })
  })

  describe('GET /nodelist', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/nodelist')!
    })

    it('should return cached node list', () => {
      const mockNodeList = {
        nodeList: [
          { ip: '10.0.0.1', port: 9001, publicKey: 'node1' },
          { ip: '10.0.0.2', port: 9002, publicKey: 'node2' },
        ],
      }
      ;(NodeList.getCachedNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedNodeList).toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(mockNodeList)
    })
  })

  describe('GET /full-nodelist', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/full-nodelist')!
    })

    it('should return full node list without filters', () => {
      const mockNodeList = { nodeList: [] }
      ;(NodeList.getCachedFullNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedFullNodeList).toHaveBeenCalledWith(false, false, false)
      expect(mockReply.send).toHaveBeenCalledWith(mockNodeList)
    })

    it('should filter by activeOnly', () => {
      mockRequest.query = { activeOnly: 'true' }
      const mockNodeList = { nodeList: [] }
      ;(NodeList.getCachedFullNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedFullNodeList).toHaveBeenCalledWith(true, false, false)
    })

    it('should filter by syncingOnly', () => {
      mockRequest.query = { syncingOnly: 'true' }
      const mockNodeList = { nodeList: [] }
      ;(NodeList.getCachedFullNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedFullNodeList).toHaveBeenCalledWith(false, true, false)
    })

    it('should filter by standbyOnly', () => {
      mockRequest.query = { standbyOnly: 'true' }
      const mockNodeList = { nodeList: [] }
      ;(NodeList.getCachedFullNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedFullNodeList).toHaveBeenCalledWith(false, false, true)
    })

    it('should handle multiple filters', () => {
      mockRequest.query = { activeOnly: 'true', syncingOnly: 'true' }
      const mockNodeList = { nodeList: [] }
      ;(NodeList.getCachedFullNodeList as jest.Mock).mockReturnValue(mockNodeList)

      handler(mockRequest, mockReply)

      expect(NodeList.getCachedFullNodeList).toHaveBeenCalledWith(true, true, false)
    })
  })

  describe('GET /allowed-archivers', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/allowed-archivers')!
    })

    it('should return allowed archivers config', async () => {
      const mockConfig = {
        allowedArchivers: ['archiver1', 'archiver2'],
      }
      ;(allowedArchiversManager.getCurrentConfig as jest.Mock).mockReturnValue(mockConfig)

      await handler(mockRequest, mockReply)

      expect(allowedArchiversManager.getCurrentConfig).toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(mockConfig)
    })

    it('should return 500 when config is not available', async () => {
      ;(allowedArchiversManager.getCurrentConfig as jest.Mock).mockReturnValue(null)

      await handler(mockRequest, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Internal server error',
      })
    })

    it('should handle errors', async () => {
      ;(allowedArchiversManager.getCurrentConfig as jest.Mock).mockImplementation(() => {
        throw new Error('Config error')
      })

      await handler(mockRequest, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Internal server error',
      })
    })
  })

  describe('POST /nodelist', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/nodelist')!
      jest.clearAllMocks()
    })

    describe('when archiver is first and nodelist is empty', () => {
      beforeEach(() => {
        ;(State as any).isFirst = true
        ;(NodeList.isEmpty as jest.Mock).mockReturnValue(true)
        ;(NodeList as any).foundFirstNode = false
      })

      afterEach(() => {
        ;(State as any).isFirst = false
        ;(NodeList as any).foundFirstNode = false
      })

      it('should process valid first node info', () => {
        const firstNodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'first-node-key',
          },
          sign: {
            owner: 'first-node-key',
            sig: 'valid-signature',
          },
        }
        ;(Crypto.verify as jest.Mock).mockReturnValue(true)
        ;(Crypto.sign as jest.Mock).mockReturnValue({
          nodeList: [{ ip: '10.0.0.1', port: 9001, publicKey: 'first-node-key' }],
          joinRequest: { publicKey: 'test-public-key' },
          dataRequestCycle: {},
          dataRequestStateMetaData: {},
          sign: { owner: 'test-owner', sig: 'test-sig' },
        })

        handler({ ...mockRequest, body: firstNodeInfo }, mockReply)

        expect(NodeList.toggleFirstNode).toHaveBeenCalled()
        expect(NodeList.addNodes).toHaveBeenCalledWith('syncing', [
          {
            ip: '10.0.0.1',
            port: 9001,
            publicKey: 'first-node-key',
          },
        ])
        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            nodeList: expect.any(Array),
            joinRequest: expect.any(Object),
          })
        )
      })

      it('should reject invalid node info types', () => {
        const invalidNodeInfo = {
          nodeInfo: {
            externalIp: 123, // Should be string
            externalPort: 9001,
            publicKey: 'first-node-key',
          },
          sign: {
            owner: 'first-node-key',
            sig: 'valid-signature',
          },
        }
        ;(Utils.validateTypes as jest.Mock).mockReturnValue('Invalid type for externalIp')

        handler({ ...mockRequest, body: invalidNodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid type for externalIp',
        })
        expect(NodeList.toggleFirstNode).not.toHaveBeenCalled()
      })

      it('should reject when publicKey does not match owner', () => {
        const mismatchedNodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'first-node-key',
          },
          sign: {
            owner: 'different-key',
            sig: 'valid-signature',
          },
        }
        ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)

        handler({ ...mockRequest, body: mismatchedNodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          error: 'nodeInfo.publicKey does not match signature owner',
        })
      })

      it('should reject invalid signature', () => {
        const invalidSigNodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'first-node-key',
          },
          sign: {
            owner: 'first-node-key',
            sig: 'invalid-signature',
          },
        }
        ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)
        ;(Crypto.verify as jest.Mock).mockReturnValue(false)

        handler({ ...mockRequest, body: invalidSigNodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid signature',
        })
      })

      it('should reject wrong publicKey when restrictFirstNodeSelectionByPublicKey is true', () => {
        ;(config as any).restrictFirstNodeSelectionByPublicKey = true
        ;(config as any).firstNodePublicKey = 'expected-key'

        const wrongKeyNodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'wrong-key',
          },
          sign: {
            owner: 'wrong-key',
            sig: 'valid-signature',
          },
        }
        ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)
        ;(Crypto.verify as jest.Mock).mockReturnValue(true)

        handler({ ...mockRequest, body: wrongKeyNodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith({
          success: false,
          error: 'Invalid publicKey of first node info',
        })

        // Reset
        ;(config as any).restrictFirstNodeSelectionByPublicKey = false
      })

      it('should return cached nodelist if first node already found', () => {
        ;(NodeList as any).foundFirstNode = true
        const cachedNodeList = { nodeList: [{ ip: '10.0.0.1', port: 9001 }] }
        ;(NodeList.getCachedNodeList as jest.Mock).mockReturnValue(cachedNodeList)

        const nodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'first-node-key',
          },
          sign: {
            owner: 'first-node-key',
            sig: 'valid-signature',
          },
        }

        handler({ ...mockRequest, body: nodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith(cachedNodeList)
        expect(NodeList.toggleFirstNode).not.toHaveBeenCalled()
      })
    })

    describe('when archiver is not first or nodelist is not empty', () => {
      it('should return cached nodelist', () => {
        ;(State as any).isFirst = false
        const cachedNodeList = { nodeList: [] }
        ;(NodeList.getCachedNodeList as jest.Mock).mockReturnValue(cachedNodeList)

        const nodeInfo = {
          nodeInfo: {
            externalIp: '10.0.0.1',
            externalPort: 9001,
            publicKey: 'some-node-key',
          },
          sign: {
            owner: 'some-node-key',
            sig: 'valid-signature',
          },
        }

        handler({ ...mockRequest, body: nodeInfo }, mockReply)

        expect(mockReply.send).toHaveBeenCalledWith(cachedNodeList)
      })
    })
  })

  describe('GET /get-network-account', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/get-network-account')!
    })

    it('should return network account hash by default', () => {
      const mockNetworkHash = 'mock-network-account-hash'
      ;(Crypto.sign as jest.Mock).mockReturnValueOnce({
        networkAccountHash: mockNetworkHash,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        networkAccountHash: mockNetworkHash,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })
    })

    it('should return full network account when hash=false', () => {
      const mockNetworkAccount = { id: 'network-account', data: {} }
      ;(getGlobalNetworkAccount as jest.Mock).mockReturnValue(mockNetworkAccount)
      ;(Crypto.sign as jest.Mock).mockReturnValueOnce({
        networkAccount: mockNetworkAccount,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })

      mockRequest.query = { hash: 'false' }
      handler(mockRequest, mockReply)

      expect(getGlobalNetworkAccount).toHaveBeenCalledWith(false)
      expect(mockReply.send).toHaveBeenCalledWith({
        networkAccount: mockNetworkAccount,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      })
    })
  })

  describe('queryFromArchivers', () => {
    beforeEach(() => {
      jest.clearAllMocks()
      ;(P2P.postJson as jest.Mock).mockReset()
      ;(Utils.getRandomItemFromArr as jest.Mock).mockReturnValue([
        { ip: '10.0.0.1', port: 4000 },
        { ip: '10.0.0.2', port: 4000 },
        { ip: '10.0.0.3', port: 4000 },
      ])
      // Reset Crypto.sign to default behavior
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
    })

    it('should query cycle info from archivers', async () => {
      const mockResponse = {
        cycleInfo: [{ counter: 1 }, { counter: 2 }],
        sign: { owner: 'archiver1', sig: 'sig1' },
        sender: 'archiver1',
      }
      ;(P2P.postJson as jest.Mock<any>).mockResolvedValue(mockResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.CYCLE, { start: 1, end: 2 })

      expect(P2P.postJson).toHaveBeenCalledWith(
        'http://10.0.0.1:4000/cycleinfo',
        expect.objectContaining({
          start: 1,
          end: 2,
          sender: 'test-public-key',
        }),
        undefined
      )
      expect(result).toEqual(mockResponse)
    })

    it('should query receipt data from archivers', async () => {
      const mockResponse = {
        receipts: [{ receiptId: 'r1' }],
        sign: { owner: 'archiver1', sig: 'sig1' },
        sender: 'archiver1',
      }
      ;(P2P.postJson as jest.Mock<any>).mockResolvedValue(mockResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.RECEIPT, { count: 10 })

      expect(P2P.postJson).toHaveBeenCalledWith(
        'http://10.0.0.1:4000/receipt',
        expect.objectContaining({
          count: 10,
          sender: 'test-public-key',
        }),
        undefined
      )
      expect(result).toEqual(mockResponse)
    })

    it('should retry with different archivers on failure', async () => {
      ;(P2P.postJson as jest.Mock<any>)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({
          accounts: [],
          sign: { owner: 'archiver3', sig: 'sig3' },
          sender: 'archiver3',
        })
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.ACCOUNT, { count: 10 })

      expect(P2P.postJson).toHaveBeenCalledTimes(3)
      expect(result).toEqual({
        accounts: [],
        sign: { owner: 'archiver3', sig: 'sig3' },
        sender: 'archiver3',
      })
    })

    it('should return null when all archivers fail', async () => {
      ;(P2P.postJson as jest.Mock<any>).mockRejectedValue(new Error('Network error'))

      const result = await queryFromArchivers(RequestDataType.TRANSACTION, { count: 5 })

      expect(P2P.postJson).toHaveBeenCalledTimes(3)
      expect(result).toBeNull()
    })

    it('should use specific archiver when provided', async () => {
      const specificArchiver = { ip: '192.168.1.1', port: 5000, publicKey: 'specific-key', curvePk: 'curve-key' }
      ;(Utils.getRandomItemFromArr as jest.Mock).mockReturnValue([])
      const mockResponse = {
        originalTxs: [],
        sign: { owner: 'specific', sig: 'sig' },
        sender: 'specific',
      }
      ;(P2P.postJson as jest.Mock<any>).mockResolvedValue(mockResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.ORIGINALTX, { count: 5, archiver: specificArchiver }, 10)

      expect(P2P.postJson).toHaveBeenCalledWith('http://192.168.1.1:5000/originalTx', expect.any(Object), 10)
      expect(Utils.getRandomItemFromArr).not.toHaveBeenCalled()
      expect(result).toEqual(mockResponse)
    })

    it('should handle totalData request type', async () => {
      const mockResponse = {
        totalCycles: 100,
        totalAccounts: 1000,
        sign: { owner: 'archiver1', sig: 'sig1' },
        sender: 'archiver1',
      }
      ;(P2P.postJson as jest.Mock<any>).mockResolvedValue(mockResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.TOTALDATA, {})

      expect(P2P.postJson).toHaveBeenCalledWith(
        'http://10.0.0.1:4000/totalData',
        expect.objectContaining({
          sender: 'test-public-key',
        }),
        undefined
      )
      expect(result).toEqual(mockResponse)
    })

    it('should reject response with invalid signature', async () => {
      const mockResponse = {
        cycleInfo: [],
        sign: { owner: 'archiver1', sig: 'invalid' },
        sender: 'archiver1',
      }
      ;(P2P.postJson as jest.Mock<any>).mockResolvedValue(mockResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(false)

      const result = await queryFromArchivers(RequestDataType.CYCLE, { count: 1 })

      expect(P2P.postJson).toHaveBeenCalledTimes(3) // Retries all archivers
      expect(result).toBeNull()
    })

    it('should use bucket verification when checkpoint is enabled', async () => {
      ;(config.checkpoint.bucketConfig as any).allowCheckpointUpdates = true
      ;(isBucketVerified as jest.Mock<any>).mockResolvedValue(true)

      const mockVerificationResponse = {
        success: true,
        isVerified: true,
        sign: { owner: 'archiver1', sig: 'sig1' },
        sender: 'archiver1',
      }
      const mockDataResponse = {
        cycleInfo: [{ counter: 5 }],
        sign: { owner: 'archiver1', sig: 'sig1' },
        sender: 'archiver1',
      }
      ;(P2P.postJson as jest.Mock<any>)
        .mockResolvedValueOnce(mockVerificationResponse)
        .mockResolvedValueOnce(mockDataResponse)
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)

      const result = await queryFromArchivers(RequestDataType.CYCLE, { start: 5 })

      expect(P2P.postJson).toHaveBeenCalledWith(
        'http://10.0.0.1:4000/bucket-verification',
        expect.objectContaining({
          bucketID: '5',
          sender: 'test-public-key',
        }),
        undefined
      )
      expect(P2P.postJson).toHaveBeenCalledWith('http://10.0.0.1:4000/cycleinfo', expect.any(Object), undefined)
      expect(result).toEqual(mockDataResponse)

      // Reset
      ;(config.checkpoint.bucketConfig as any).allowCheckpointUpdates = false
    })
  })

  describe('POST /cycleinfo', () => {
    let handler: Function
    let CycleDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/cycleinfo')!
      CycleDB = await import('../../../src/dbstore/cycles')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should query latest cycles by count', async () => {
      const mockCycles = [{ counter: 10 }, { counter: 9 }, { counter: 8 }]
      ;(CycleDB.queryLatestCycleRecords as jest.Mock<any>).mockResolvedValue(mockCycles)

      const requestData = {
        count: 3,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(CycleDB.queryLatestCycleRecords).toHaveBeenCalledWith(3)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleInfo: mockCycles,
        })
      )
    })

    it('should query cycles between start and end', async () => {
      const mockCycles = [{ counter: 5 }, { counter: 6 }, { counter: 7 }]
      ;(CycleDB.queryCycleRecordsBetween as jest.Mock<any>).mockResolvedValue(mockCycles)

      const requestData = {
        start: 5,
        end: 7,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(CycleDB.queryCycleRecordsBetween).toHaveBeenCalledWith(5, 7)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleInfo: mockCycles,
        })
      )
    })

    it('should reject invalid count', async () => {
      const requestData = {
        count: -1,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid count',
        })
      )
    })

    it('should reject count exceeding maximum', async () => {
      const requestData = {
        count: 101,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Max count is 100.',
        })
      )
    })

    it('should reject invalid start and end counters', async () => {
      const requestData = {
        start: 10,
        end: 5,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid start and end counters',
        })
      )
    })

    it('should reject when exceeding maximum cycle range', async () => {
      const requestData = {
        start: 0,
        end: 101,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Exceed maximum limit of 100 cycles',
        })
      )
    })

    it('should reject request without valid signature', async () => {
      ;(Crypto.verify as jest.Mock).mockReturnValue(false)

      const requestData = {
        count: 5,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'invalid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid signature',
        })
      )
    })

    it('should handle download mode', async () => {
      const mockCycles = [{ counter: 1 }, { counter: 2 }]
      ;(CycleDB.queryCycleRecordsBetween as jest.Mock<any>).mockResolvedValue(mockCycles)

      // Mock the Readable.from to return a mock stream
      const mockStream = { pipe: jest.fn() }
      jest.spyOn(require('stream').Readable, 'from').mockReturnValue(mockStream)

      const requestData = {
        start: 1,
        end: 2,
        download: true,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.headers).toHaveBeenCalledWith({
        'content-disposition': 'attachment; filename="cycle_records_from_1_to_2"',
        'content-type': 'application/octet-stream',
      })
      expect(mockReply.send).toHaveBeenCalledWith(mockStream)
    })

    it('should reject when no query params specified', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'not specified which cycle to show',
        })
      )
    })
  })

  describe('POST /receipt', () => {
    let handler: Function
    let ReceiptDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/receipt')!
      ReceiptDB = await import('../../../src/dbstore/receipts')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should query latest receipts by count', async () => {
      const mockReceipts = [{ receiptId: 'r1' }, { receiptId: 'r2' }]
      ;(ReceiptDB.queryLatestReceipts as jest.Mock<any>).mockResolvedValue(mockReceipts)

      const requestData = {
        count: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryLatestReceipts).toHaveBeenCalledWith(2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: mockReceipts,
        })
      )
    })

    it('should query receipt by txId', async () => {
      const mockReceipt = { receiptId: '1234567890123456789012345678901234567890123456789012345678901234' }
      ;(ReceiptDB.queryReceiptByReceiptId as jest.Mock<any>).mockResolvedValue(mockReceipt)

      const requestData = {
        txId: '1234567890123456789012345678901234567890123456789012345678901234',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryReceiptByReceiptId).toHaveBeenCalledWith(
        '1234567890123456789012345678901234567890123456789012345678901234'
      )
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: [mockReceipt],
        })
      )
    })

    it('should reject invalid txId length', async () => {
      const requestData = {
        txId: 'short-id',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid txId short-id',
        })
      )
    })

    it('should query receipts by txIdList', async () => {
      const mockReceipt1 = { receiptId: '1234567890123456789012345678901234567890123456789012345678901234' }
      const mockReceipt2 = { receiptId: '2234567890123456789012345678901234567890123456789012345678901234' }
      ;(ReceiptDB.queryReceiptByReceiptId as jest.Mock<any>)
        .mockResolvedValueOnce(mockReceipt1)
        .mockResolvedValueOnce(mockReceipt2)

      const requestData = {
        txIdList: [
          ['1234567890123456789012345678901234567890123456789012345678901234', 123456],
          ['2234567890123456789012345678901234567890123456789012345678901234', 123457],
        ],
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryReceiptByReceiptId).toHaveBeenCalledTimes(2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: [mockReceipt1, mockReceipt2],
        })
      )
    })

    it('should reject txIdList exceeding maximum', async () => {
      const largeTxIdList = Array(1001).fill([
        '1234567890123456789012345678901234567890123456789012345678901234',
        123456,
      ])

      const requestData = {
        txIdList: largeTxIdList,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Exceed maximum limit of 1000 receipts',
        })
      )
    })

    it('should query receipts between cycles with pagination', async () => {
      const mockReceipts = [{ receiptId: 'r1' }, { receiptId: 'r2' }]
      ;(ReceiptDB.queryReceiptsBetweenCycles as jest.Mock<any>).mockResolvedValue(mockReceipts)

      const requestData = {
        startCycle: 10,
        endCycle: 20,
        page: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryReceiptsBetweenCycles).toHaveBeenCalledWith(1000, 1000, 10, 20)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: mockReceipts,
        })
      )
    })

    it('should query receipt count between cycles', async () => {
      ;(ReceiptDB.queryReceiptCountBetweenCycles as jest.Mock<any>).mockResolvedValue(500)

      const requestData = {
        startCycle: 10,
        endCycle: 20,
        type: 'count',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryReceiptCountBetweenCycles).toHaveBeenCalledWith(10, 20)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: 500,
        })
      )
    })

    it('should query receipt tally by cycles', async () => {
      const mockTally = [
        { cycle: 10, count: 50 },
        { cycle: 11, count: 60 },
      ]
      ;(ReceiptDB.queryReceiptCountByCycles as jest.Mock<any>).mockResolvedValue(mockTally)

      const requestData = {
        startCycle: 10,
        endCycle: 11,
        type: 'tally',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(ReceiptDB.queryReceiptCountByCycles).toHaveBeenCalledWith(10, 11)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          receipts: mockTally,
        })
      )
    })
  })

  describe('POST /account', () => {
    let handler: Function
    let AccountDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/account')!
      AccountDB = await import('../../../src/dbstore/accounts')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should query latest accounts by count', async () => {
      const mockAccounts = [
        { accountId: 'acc1', data: {} },
        { accountId: 'acc2', data: {} },
      ]
      ;(AccountDB.queryLatestAccounts as jest.Mock<any>).mockResolvedValue(mockAccounts)

      const requestData = {
        count: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDB.queryLatestAccounts).toHaveBeenCalledWith(2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: mockAccounts,
        })
      )
    })

    it('should query accounts by range', async () => {
      const mockAccounts = [{ accountId: 'acc1' }, { accountId: 'acc2' }]
      ;(AccountDB.queryAccounts as jest.Mock<any>).mockResolvedValue(mockAccounts)

      const requestData = {
        start: 0,
        end: 1,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDB.queryAccounts).toHaveBeenCalledWith(0, 2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: mockAccounts,
        })
      )
    })

    it('should query accounts between cycles with pagination', async () => {
      const mockAccounts = [{ accountId: 'acc1' }, { accountId: 'acc2' }]
      ;(AccountDB.queryAccountCountBetweenCycles as jest.Mock<any>).mockResolvedValue(100)
      ;(AccountDB.queryAccountsBetweenCycles as jest.Mock<any>).mockResolvedValue(mockAccounts)

      const requestData = {
        startCycle: 10,
        endCycle: 20,
        page: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDB.queryAccountCountBetweenCycles).toHaveBeenCalledWith(10, 20)
      expect(AccountDB.queryAccountsBetweenCycles).toHaveBeenCalledWith(1000, 1000, 10, 20)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: mockAccounts,
          totalAccounts: 100,
        })
      )
    })

    it('should query account by accountId', async () => {
      const mockAccount = { accountId: 'specific-account', data: {} }
      ;(AccountDB.queryAccountByAccountId as jest.Mock<any>).mockResolvedValue(mockAccount)

      const requestData = {
        accountId: 'specific-account',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDB.queryAccountByAccountId).toHaveBeenCalledWith('specific-account')
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          accounts: mockAccount,
        })
      )
    })

    it('should return only totalAccounts when no page specified', async () => {
      ;(AccountDB.queryAccountCountBetweenCycles as jest.Mock<any>).mockResolvedValue(500)

      const requestData = {
        startCycle: 10,
        endCycle: 20,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDB.queryAccountCountBetweenCycles).toHaveBeenCalledWith(10, 20)
      expect(AccountDB.queryAccountsBetweenCycles).not.toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          totalAccounts: 500,
        })
      )
    })

    it('should reject when no query params specified', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'not specified which account to show',
        })
      )
    })

    it('should reject invalid count', async () => {
      const requestData = {
        count: -1,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid count',
        })
      )
    })

    it('should reject count exceeding maximum', async () => {
      const requestData = {
        count: 1001,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Max count is 1000',
        })
      )
    })
  })

  describe('POST /transaction', () => {
    let handler: Function
    let TransactionDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/transaction')!
      TransactionDB = await import('../../../src/dbstore/transactions')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should query latest transactions by count', async () => {
      const mockTransactions = [
        { txId: 'tx1', timestamp: 123 },
        { txId: 'tx2', timestamp: 124 },
      ]
      ;(TransactionDB.queryLatestTransactions as jest.Mock<any>).mockResolvedValue(mockTransactions)

      const requestData = {
        count: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(TransactionDB.queryLatestTransactions).toHaveBeenCalledWith(2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: mockTransactions,
        })
      )
    })

    it('should query transaction by txId', async () => {
      const mockTransaction = { txId: 'specific-tx', timestamp: 123456 }
      ;(TransactionDB.queryTransactionByTxId as jest.Mock<any>).mockResolvedValue(mockTransaction)

      const requestData = {
        txId: 'specific-tx',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(TransactionDB.queryTransactionByTxId).toHaveBeenCalledWith('specific-tx')
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: mockTransaction,
        })
      )
    })

    it('should query transaction by appReceiptId', async () => {
      const mockTransactions = [{ txId: 'tx1', appReceiptId: 'receipt1' }]
      ;(TransactionDB.queryTransactionByAccountId as jest.Mock<any>).mockResolvedValue(mockTransactions)

      const requestData = {
        appReceiptId: 'receipt1',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(TransactionDB.queryTransactionByAccountId).toHaveBeenCalledWith('receipt1')
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: mockTransactions,
        })
      )
    })

    it('should query transactions between cycles with pagination', async () => {
      const mockTransactions = [{ txId: 'tx1' }, { txId: 'tx2' }]
      ;(TransactionDB.queryTransactionCountBetweenCycles as jest.Mock<any>).mockResolvedValue(200)
      ;(TransactionDB.queryTransactionsBetweenCycles as jest.Mock<any>).mockResolvedValue(mockTransactions)

      const requestData = {
        startCycle: 5,
        endCycle: 10,
        page: 3,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(TransactionDB.queryTransactionCountBetweenCycles).toHaveBeenCalledWith(5, 10)
      expect(TransactionDB.queryTransactionsBetweenCycles).toHaveBeenCalledWith(2000, 1000, 5, 10)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          transactions: mockTransactions,
          totalTransactions: 200,
        })
      )
    })

    it('should reject when no query params specified', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'not specified which transaction to show',
        })
      )
    })
  })

  describe('POST /originalTx', () => {
    let handler: Function
    let OriginalTxDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/originalTx')!
      OriginalTxDB = await import('../../../src/dbstore/originalTxsData')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should query latest original txs by count', async () => {
      const mockOriginalTxs = [
        { txId: 'tx1', timestamp: 123 },
        { txId: 'tx2', timestamp: 124 },
      ]
      ;(OriginalTxDB.queryLatestOriginalTxs as jest.Mock<any>).mockResolvedValue(mockOriginalTxs)

      const requestData = {
        count: 2,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(OriginalTxDB.queryLatestOriginalTxs).toHaveBeenCalledWith(2)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTxs: mockOriginalTxs,
        })
      )
    })

    it('should query original tx by txId', async () => {
      const mockOriginalTx = { txId: '1234567890123456789012345678901234567890123456789012345678901234', data: {} }
      ;(OriginalTxDB.queryOriginalTxDataByTxId as jest.Mock<any>).mockResolvedValue(mockOriginalTx)

      const requestData = {
        txId: '1234567890123456789012345678901234567890123456789012345678901234',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(OriginalTxDB.queryOriginalTxDataByTxId).toHaveBeenCalledWith(
        '1234567890123456789012345678901234567890123456789012345678901234'
      )
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTxs: [mockOriginalTx],
        })
      )
    })

    it('should query original txs between cycles with type tally', async () => {
      const mockTally = [
        { cycle: 10, count: 50 },
        { cycle: 11, count: 60 },
      ]
      ;(OriginalTxDB.queryOriginalTxDataCountByCycles as jest.Mock<any>).mockResolvedValue(mockTally)

      const requestData = {
        startCycle: 10,
        endCycle: 11,
        type: 'tally',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(OriginalTxDB.queryOriginalTxDataCountByCycles).toHaveBeenCalledWith(10, 11)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTxs: mockTally,
        })
      )
    })

    it('should query original tx count between cycles', async () => {
      ;(OriginalTxDB.queryOriginalTxDataCount as jest.Mock<any>).mockResolvedValue(150)

      const requestData = {
        startCycle: 10,
        endCycle: 15,
        type: 'count',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(OriginalTxDB.queryOriginalTxDataCount).toHaveBeenCalledWith(10, 15)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          originalTxs: 150,
        })
      )
    })

    it('should reject invalid txId length', async () => {
      const requestData = {
        txId: 'short-id',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Invalid txId short-id',
        })
      )
    })

    it('should reject txIdList exceeding maximum', async () => {
      const largeTxIdList = Array(1001).fill([
        '1234567890123456789012345678901234567890123456789012345678901234',
        123456,
      ])

      const requestData = {
        txIdList: largeTxIdList,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'Exceed maximum limit of 1000 original transactions',
        })
      )
    })
  })

  describe('POST /totalData', () => {
    let handler: Function
    let CycleDB: any
    let AccountDB: any
    let TransactionDB: any
    let ReceiptDB: any
    let OriginalTxDB: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/totalData')!
      CycleDB = await import('../../../src/dbstore/cycles')
      AccountDB = await import('../../../src/dbstore/accounts')
      TransactionDB = await import('../../../src/dbstore/transactions')
      ReceiptDB = await import('../../../src/dbstore/receipts')
      OriginalTxDB = await import('../../../src/dbstore/originalTxsData')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should return total counts for all data types', async () => {
      ;(CycleDB.queryCyleCount as jest.Mock<any>).mockResolvedValue(100)
      ;(AccountDB.queryAccountCount as jest.Mock<any>).mockResolvedValue(1000)
      ;(TransactionDB.queryTransactionCount as jest.Mock<any>).mockResolvedValue(5000)
      ;(ReceiptDB.queryReceiptCount as jest.Mock<any>).mockResolvedValue(5000)
      ;(OriginalTxDB.queryOriginalTxDataCount as jest.Mock<any>).mockResolvedValue(4500)

      const mockCheckpointManager = {
        hasLastFailedBucketExceededDuration: jest.fn().mockReturnValue(false),
      }
      ;(getCheckpointManager as jest.Mock).mockReturnValue(mockCheckpointManager)

      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(CycleDB.queryCyleCount).toHaveBeenCalled()
      expect(AccountDB.queryAccountCount).toHaveBeenCalled()
      expect(TransactionDB.queryTransactionCount).toHaveBeenCalled()
      expect(ReceiptDB.queryReceiptCount).toHaveBeenCalled()
      expect(OriginalTxDB.queryOriginalTxDataCount).toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCycles: 100,
          totalAccounts: 1000,
          totalTransactions: 5000,
          totalReceipts: 5000,
          totalOriginalTxs: 4500,
          cycleLastFiveMinutesGiveUpBucketStatus: false,
          originalTxLastFiveMinutesGiveUpBucketStatus: false,
          receiptLastFiveMinutesGiveUpBucketStatus: false,
        })
      )
    })

    it('should handle checkpoint manager not available', async () => {
      ;(CycleDB.queryCyleCount as jest.Mock<any>).mockResolvedValue(50)
      ;(AccountDB.queryAccountCount as jest.Mock<any>).mockResolvedValue(500)
      ;(TransactionDB.queryTransactionCount as jest.Mock<any>).mockResolvedValue(2500)
      ;(ReceiptDB.queryReceiptCount as jest.Mock<any>).mockResolvedValue(2500)
      ;(OriginalTxDB.queryOriginalTxDataCount as jest.Mock<any>).mockResolvedValue(2000)
      ;(getCheckpointManager as jest.Mock).mockReturnValue(null)

      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCycles: 50,
          totalAccounts: 500,
          totalTransactions: 2500,
          totalReceipts: 2500,
          totalOriginalTxs: 2000,
          cycleLastFiveMinutesGiveUpBucketStatus: undefined,
          originalTxLastFiveMinutesGiveUpBucketStatus: undefined,
          receiptLastFiveMinutesGiveUpBucketStatus: undefined,
        })
      )
    })
  })

  describe('POST /gossip-data', () => {
    let handler: Function
    let Collector: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/gossip-data')!
      Collector = await import('../../../src/Data/Collector')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
    })

    it('should process valid gossip data', async () => {
      const gossipData = {
        type: 'receipt',
        data: { receiptId: 'r1', result: true },
        sign: { owner: 'node1', sig: 'sig1' },
      }
      ;(Collector.validateGossipData as jest.Mock).mockReturnValue({ success: true })
      ;(Collector.processGossipData as jest.Mock).mockImplementation(() => {})

      await handler({ ...mockRequest, body: gossipData }, mockReply)

      expect(Collector.validateGossipData).toHaveBeenCalledWith(gossipData)
      expect(Collector.processGossipData).toHaveBeenCalledWith(gossipData)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      )
    })

    it('should reject invalid gossip data', async () => {
      const invalidGossipData = {
        type: 'invalid',
        data: {},
      }
      ;(Collector.validateGossipData as jest.Mock).mockReturnValue({
        success: false,
        error: 'Invalid gossip data type',
      })

      await handler({ ...mockRequest, body: invalidGossipData }, mockReply)

      expect(Collector.validateGossipData).toHaveBeenCalledWith(invalidGossipData)
      expect(Collector.processGossipData).not.toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid gossip data type',
      })
    })
  })

  describe('GET /network-txs-list', () => {
    let handler: Function
    let ServiceQueue: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/network-txs-list')!
      ServiceQueue = await import('../../../src/ServiceQueue')
      jest.clearAllMocks()
    })

    it('should return network transaction list', () => {
      const mockTxList = [
        { txId: 'tx1', timestamp: 123456 },
        { txId: 'tx2', timestamp: 123457 },
      ]
      ;(ServiceQueue.getTxList as jest.Mock).mockReturnValue(mockTxList)

      handler(mockRequest, mockReply)

      expect(ServiceQueue.getTxList).toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(mockTxList)
    })

    it('should return empty array when no transactions', () => {
      ;(ServiceQueue.getTxList as jest.Mock).mockReturnValue([])

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith([])
    })
  })

  describe('GET /checkpoint-status', () => {
    let handler: Function
    let getLatestCyclesSpy

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('GET')?.get('/checkpoint-status')!
      jest.clearAllMocks()
    })

    afterEach(() => {
      if (getLatestCyclesSpy) getLatestCyclesSpy.mockRestore()
    })

    it('should return checkpoint statuses', () => {
      getLatestCyclesSpy = jest.spyOn(checkpointStatusMap, 'getLatestCycles').mockReturnValue([
        [1, { cycleHash: 'hash1', receiptHash: 'rhash1', originalTxHash: 'othash1' }],
        [2, { cycleHash: 'hash2', receiptHash: 'rhash2', originalTxHash: 'othash2' }],
      ])

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: true,
        data: {
          '1': { cycleHash: 'hash1', receiptHash: 'rhash1', originalTxHash: 'othash1' },
          '2': { cycleHash: 'hash2', receiptHash: 'rhash2', originalTxHash: 'othash2' },
        },
      })
    })

    it('should return error when no checkpoint statuses found', () => {
      getLatestCyclesSpy = jest.spyOn(checkpointStatusMap, 'getLatestCycles').mockReturnValue([])

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'No checkpoint statuses found',
      })
    })

    it('should handle errors gracefully', () => {
      getLatestCyclesSpy = jest.spyOn(checkpointStatusMap, 'getLatestCycles').mockImplementation(() => {
        throw new Error('Map error')
      })

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error',
      })
    })
  })

  describe('POST /get_account_data_archiver', () => {
    let handler: Function
    let AccountDataProvider: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/get_account_data_archiver')!
      AccountDataProvider = await import('../../../src/Data/AccountDataProvider')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should provide account data for valid request', async () => {
      const requestData = {
        accountStart: '0000',
        accountEnd: 'ffff',
        maxRecords: 100,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      const mockAccountData = [
        { accountId: 'acc1', data: {} },
        { accountId: 'acc2', data: {} },
      ]

      ;(AccountDataProvider.validateAccountDataRequest as jest.Mock).mockReturnValue({ success: true })
      ;(AccountDataProvider.provideAccountDataRequest as jest.Mock<any>).mockResolvedValue(mockAccountData)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.validateAccountDataRequest).toHaveBeenCalledWith(requestData)
      expect(AccountDataProvider.provideAccountDataRequest).toHaveBeenCalledWith(requestData)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: mockAccountData,
        })
      )
    })

    it('should reject invalid account data request', async () => {
      const requestData = {
        accountStart: '0000',
        // missing accountEnd
        maxRecords: 100,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(AccountDataProvider.validateAccountDataRequest as jest.Mock).mockReturnValue({
        success: false,
        error: 'Missing required field: accountEnd',
      })

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.provideAccountDataRequest).not.toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Missing required field: accountEnd',
      })
    })

    it('should reject when maxRecords exceeds limit', async () => {
      const requestData = {
        accountStart: '0000',
        accountEnd: 'ffff',
        maxRecords: 2000,
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(AccountDataProvider.validateAccountDataRequest as jest.Mock).mockReturnValue({ success: true })
      ;(config as any).maxRecordsPerRequest = 1000

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid AccountBucket size. Size was 2000. Must be greater than 0 and less than 1000.',
      })
    })
  })

  describe('POST /get_account_data_by_list_archiver', () => {
    let handler: Function
    let AccountDataProvider: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/get_account_data_by_list_archiver')!
      AccountDataProvider = await import('../../../src/Data/AccountDataProvider')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should provide account data by list', async () => {
      const requestData = {
        accountIds: ['acc1', 'acc2', 'acc3'],
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      const mockAccountData = [
        { accountId: 'acc1', data: { balance: 100 } },
        { accountId: 'acc2', data: { balance: 200 } },
        { accountId: 'acc3', data: { balance: 300 } },
      ]

      ;(AccountDataProvider.validateAccountDataByListRequest as jest.Mock).mockReturnValue({ success: true })
      ;(AccountDataProvider.provideAccountDataByListRequest as jest.Mock<any>).mockResolvedValue(mockAccountData)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.validateAccountDataByListRequest).toHaveBeenCalledWith(requestData)
      expect(AccountDataProvider.provideAccountDataByListRequest).toHaveBeenCalledWith(requestData)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          accountData: mockAccountData,
        })
      )
    })

    it('should reject invalid account list request', async () => {
      const requestData = {
        // missing accountIds
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(AccountDataProvider.validateAccountDataByListRequest as jest.Mock).mockReturnValue({
        success: false,
        error: 'Missing required field: accountIds',
      })

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.provideAccountDataByListRequest).not.toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Missing required field: accountIds',
      })
    })
  })

  describe('POST /get_globalaccountreport_archiver', () => {
    let handler: Function
    let AccountDataProvider: any

    beforeEach(async () => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/get_globalaccountreport_archiver')!
      AccountDataProvider = await import('../../../src/Data/AccountDataProvider')
      jest.clearAllMocks()
      ;(Crypto.sign as jest.Mock).mockImplementation((data: any) => ({
        ...data,
        sign: { owner: 'test-owner', sig: 'test-sig' },
      }))
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
    })

    it('should provide global account report', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      const mockReport = {
        totalAccounts: 1000,
        totalBalance: '1000000000',
        timestamp: 123456789,
      }

      ;(AccountDataProvider.validateGlobalAccountReportRequest as jest.Mock).mockReturnValue({ success: true })
      ;(AccountDataProvider.provideGlobalAccountReportRequest as jest.Mock<any>).mockResolvedValue(mockReport)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.validateGlobalAccountReportRequest).toHaveBeenCalledWith(requestData)
      expect(AccountDataProvider.provideGlobalAccountReportRequest).toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          totalAccounts: 1000,
          totalBalance: '1000000000',
          timestamp: 123456789,
        })
      )
    })

    it('should reject invalid global account report request', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(AccountDataProvider.validateGlobalAccountReportRequest as jest.Mock).mockReturnValue({
        success: false,
        error: 'Invalid request format',
      })

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(AccountDataProvider.provideGlobalAccountReportRequest).not.toHaveBeenCalled()
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid request format',
      })
    })
  })

  describe('GET /verified-receipt-counter', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      const calls = (mockFastify.get as jest.Mock).mock.calls
      const counterCall = calls.find((call) => call[0] === '/verified-receipt-counter')
      if (counterCall) {
        handler = counterCall[counterCall.length - 1] as Function
      }
      jest.clearAllMocks()
    })

    it('should return receipt counters', () => {
      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        receivedReceiptCount: 100,
        verifiedReceiptCount: 80,
        successReceiptCount: 70,
        failureReceiptCount: 10,
      })
    })
  })

  describe('GET /cycleinfo/:count', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      const calls = (mockFastify.get as jest.Mock).mock.calls
      const cycleCall = calls.find((call) => call[0] === '/cycleinfo/:count')
      if (cycleCall) {
        handler = cycleCall[cycleCall.length - 1] as Function
      }
      jest.clearAllMocks()
    })

    it('should return latest cycle records for valid count', async () => {
      const mockCycles = [
        { counter: 1, mode: 'forming' },
        { counter: 2, mode: 'active' },
      ]

      ;(Cycles.getLatestCycleRecords as jest.Mock<any>).mockResolvedValue(mockCycles)

      await handler({ ...mockRequest, params: { count: '2' } }, mockReply)

      expect(Cycles.getLatestCycleRecords).toHaveBeenCalledWith(2)
      expect(mockReply.send).toHaveBeenCalledWith(mockCycles)
    })

    it('should limit count to MAX_CYCLES_PER_REQUEST', async () => {
      const mockCycles = Array(100).fill({ counter: 1, mode: 'active' })

      ;(Cycles.getLatestCycleRecords as jest.Mock<any>).mockResolvedValue(mockCycles)

      await handler({ ...mockRequest, params: { count: '200' } }, mockReply)

      expect(Cycles.getLatestCycleRecords).toHaveBeenCalledWith(100)
      expect(mockReply.send).toHaveBeenCalledWith(mockCycles)
    })

    it('should return error for invalid count parameter', async () => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue('Invalid type')

      await handler({ ...mockRequest, params: { count: null } }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ success: false, error: 'Invalid type' })
    })

    it('should return error for zero count', async () => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)

      await handler({ ...mockRequest, params: { count: '0' } }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ success: false, error: 'Invalid count' })
    })

    it('should return error for negative count', async () => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)

      await handler({ ...mockRequest, params: { count: '-5' } }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ success: false, error: 'Invalid count' })
    })

    it('should return error for NaN count', async () => {
      ;(Utils.validateTypes as jest.Mock).mockReturnValue(null)

      await handler({ ...mockRequest, params: { count: 'abc' } }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({ success: false, error: 'Invalid count' })
    })
  })

  describe('POST /shareCheckpointRadixDigests', () => {
    let handler: Function
    let mockManager: any
    let mockBucket: any

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/shareCheckpointRadixDigests')!
      jest.clearAllMocks()

      mockBucket = {
        checkpointBuckets: new Map(),
      }

      const mockCheckpointBuckets = new Map()
      mockCheckpointBuckets.set = jest.fn(mockCheckpointBuckets.set.bind(mockCheckpointBuckets))

      mockManager = {
        checkpointBuckets: mockCheckpointBuckets,
        validateData: jest.fn(),
        updateData: jest.fn(),
        checkpointType: 0,
        onHashDigestsReceived: jest.fn(),
      }
      ;(getCheckpointManager as jest.Mock).mockReturnValue(mockManager)
    })

    it('should process radix digests with existing bucket', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        senderAddress: 'sender-address',
        bucketID: 'bucket1',
        radixDigests: JSON.stringify([{ radix: '1', hash: 'hash1' }]),
        checkpointType: 0,
        startTime: 1000,
        endTime: 2000,
      }

      mockManager.checkpointBuckets.set('bucket1', mockBucket)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(getCheckpointManager).toHaveBeenCalledWith(0)
      expect(mockManager.onHashDigestsReceived).toHaveBeenCalledWith('sender-address', 'bucket1', [
        { radix: '1', hash: 'hash1' },
      ])
      expect(mockReply.status).toHaveBeenCalledWith(200)
      expect(mockReply.send).toHaveBeenCalledWith({ success: true })
    })

    it('should create missing bucket', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        senderAddress: 'sender-address',
        bucketID: 'bucket2',
        radixDigests: JSON.stringify([{ radix: '2', hash: 'hash2' }]),
        checkpointType: 1,
        startTime: 3000,
        endTime: 4000,
      }

      // Mock CheckpointBucket constructor
      const MockCheckpointBucket = jest.fn().mockImplementation(() => mockBucket)
      ;(CheckpointBucket as jest.Mock).mockImplementation(MockCheckpointBucket)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(getCheckpointManager).toHaveBeenCalledWith(1)
      expect(CheckpointBucket).toHaveBeenCalledWith(
        3000,
        4000,
        'bucket2',
        mockManager.validateData,
        mockManager.updateData,
        mockManager.checkpointType
      )
      expect(mockManager.checkpointBuckets.set).toHaveBeenCalledWith('bucket2', mockBucket)
      expect(mockManager.onHashDigestsReceived).toHaveBeenCalledWith('sender-address', 'bucket2', [
        { radix: '2', hash: 'hash2' },
      ])
    })

    it('should return error for invalid request data', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        // Missing required fields
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: expect.any(String),
      })
    })

    it('should handle error gracefully', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        senderAddress: 'sender-address',
        bucketID: 'bucket3',
        radixDigests: JSON.stringify([{ radix: '3', hash: 'hash3' }]),
        checkpointType: 2,
        startTime: 5000,
        endTime: 6000,
      }

      ;(getCheckpointManager as jest.Mock).mockImplementation(() => {
        throw new Error('Manager error')
      })

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Server error',
      })
    })
  })

  describe('POST /exchangeCheckpointRadixEntries', () => {
    let handler: Function
    let mockManager: any
    let mockBucket: any

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/exchangeCheckpointRadixEntries')!
      jest.clearAllMocks()

      mockBucket = {
        radixEntries: new Map(),
        onExchangeRadixEntries: jest.fn(),
      }

      mockManager = {
        checkpointBuckets: new Map(),
        checkpointType: 0,
      }
      ;(getCheckpointManager as jest.Mock).mockReturnValue(mockManager)
    })

    it('should exchange radix entries successfully', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        bucketID: 'bucket1',
        entries: JSON.stringify([
          { digest: { radix: '1' }, data: 'data1' },
          { digest: { radix: '2' }, data: 'data2' },
        ]),
        checkpointType: 0,
      }

      const ourEntry1 = {
        digest: { radix: '1' },
        data: 'ourData1',
        updateDigest: jest.fn(),
      }
      const ourEntry2 = {
        digest: { radix: '2' },
        data: 'ourData2',
        updateDigest: jest.fn(),
      }

      mockBucket.radixEntries.set('1', ourEntry1)
      mockBucket.radixEntries.set('2', ourEntry2)
      mockManager.checkpointBuckets.set('bucket1', mockBucket)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(getCheckpointManager).toHaveBeenCalledWith(0)
      expect(ourEntry1.updateDigest).toHaveBeenCalled()
      expect(ourEntry2.updateDigest).toHaveBeenCalled()
      expect(mockBucket.onExchangeRadixEntries).toHaveBeenCalledWith('bucket1', [
        { digest: { radix: '1' }, data: 'data1' },
        { digest: { radix: '2' }, data: 'data2' },
      ])
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          bucketID: 'bucket1',
          entries: [ourEntry1, ourEntry2],
          success: true,
          sign: expect.any(Object),
        })
      )
    })

    it('should return error when bucket not found', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        bucketID: 'nonexistent',
        entries: JSON.stringify([]),
        checkpointType: 0,
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(404)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Bucket not found for ID=nonexistent.',
      })
    })

    it('should return error for invalid request data', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        // Missing required fields
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: expect.any(String),
      })
    })

    it('should handle error gracefully', async () => {
      const requestData = {
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
        bucketID: 'bucket1',
        entries: JSON.stringify([]),
        checkpointType: 0,
      }

      ;(getCheckpointManager as jest.Mock).mockImplementation(() => {
        throw new Error('Manager error')
      })

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Server error in exchangeCheckpointRadixEntries for type 0',
      })
    })
  })

  describe('GET /dataSenders', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      const calls = (mockFastify.get as jest.Mock).mock.calls
      const senderCall = calls.find((call) => call[0] === '/dataSenders')
      if (senderCall) {
        handler = senderCall[senderCall.length - 1] as Function
      }
      jest.clearAllMocks()
    })

    it('should return dataSenders size info', () => {
      ;(Data.dataSenders as Map<any, any>).clear()
      ;(Data.dataSenders as Map<any, any>).set('sender1', { nodeInfo: { ip: '10.0.0.1', port: 9001 } })
      ;(Data.dataSenders as Map<any, any>).set('sender2', { nodeInfo: { ip: '10.0.0.2', port: 9002 } })
      ;(Data.socketClients as Map<any, any>).clear()
      ;(Data.socketClients as Map<any, any>).set('client1', {})

      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        dataSendersSize: 2,
        socketClientsSize: 1,
      })
    })

    it('should include dataSendersList when requested', () => {
      ;(Data.dataSenders as Map<any, any>).clear()
      ;(Data.dataSenders as Map<any, any>).set('sender1', { nodeInfo: { ip: '10.0.0.1', port: 9001 } })
      ;(Data.dataSenders as Map<any, any>).set('sender2', { nodeInfo: { ip: '10.0.0.2', port: 9002 } })
      ;(Data.socketClients as Map<any, any>).clear()

      mockRequest.query = { dataSendersList: 'true' }
      handler(mockRequest, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith({
        dataSendersSize: 2,
        socketClientsSize: 0,
        dataSendersList: ['10.0.0.1:9001', '10.0.0.2:9002'],
      })
    })
  })

  describe('POST /bucket-verification', () => {
    let handler: Function

    beforeEach(() => {
      registerRoutes(mockFastify)
      handler = registeredRoutes.get('POST')?.get('/bucket-verification')!
      jest.clearAllMocks()
    })

    it('should verify bucket successfully', async () => {
      const requestData = {
        bucketID: '10',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(isBucketVerified as jest.Mock<any>).mockResolvedValue(true)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(isBucketVerified).toHaveBeenCalledWith(10, undefined)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          isVerified: true,
          sign: expect.any(Object),
        })
      )
    })

    it('should verify bucket range', async () => {
      const requestData = {
        bucketID: '10',
        endBucketID: '20',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(isBucketVerified as jest.Mock<any>).mockResolvedValue(false)

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(isBucketVerified).toHaveBeenCalledWith(10, 20)
      expect(mockReply.send).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          isVerified: false,
          sign: expect.any(Object),
        })
      )
    })

    it('should return error for invalid bucketID', async () => {
      const requestData = {
        bucketID: 'invalid',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(400)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid bucketID. Must be a non-negative integer.',
      })
    })

    it('should return error for invalid endBucketID', async () => {
      const requestData = {
        bucketID: '10',
        endBucketID: '-5',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(400)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid endBucketID. Must be a non-negative integer.',
      })
    })

    it('should handle internal error gracefully', async () => {
      const requestData = {
        bucketID: '10',
        sender: 'test-sender',
        sign: { owner: 'test-sender', sig: 'valid-sig' },
      }

      ;(isBucketVerified as jest.Mock<any>).mockRejectedValue(new Error('DB error'))

      await handler({ ...mockRequest, body: requestData }, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(500)
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Internal server error while checking bucket verification status',
      })
    })
  })
})
