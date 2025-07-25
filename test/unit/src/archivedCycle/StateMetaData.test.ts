import { P2P as P2PTypes } from '@shardeum-foundation/lib-types'

// Global mocks that need to be in place before any module loading
jest.mock('../../../../src/Config', () => ({
  config: {
    ARCHIVER_PUBLIC_KEY: 'test-archiver-key',
    VERBOSE: false,
    DATASENDER_TIMEOUT: 60000,
    experimentalSnapshot: false,
    REQUEST_LIMIT: {
      MAX_CYCLES_PER_REQUEST: 100,
    },
    checkpoint: {
      enable: false,
      statusArraySize: 1000,
      bucketConfig: {
        lastFailedBucketDuration: 300000,
      },
    },
    tickets: {
      allowedTicketSigners: ['signer1', 'signer2'],
      minSigRequired: 2,
      requiredSecurityLevel: 5,
    },
  },
}))

jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn(),
  },
}))

jest.mock('../../../../src/profiler/profiler', () => ({
  profilerInstance: {
    profileSectionStart: jest.fn(),
    profileSectionEnd: jest.fn(),
  },
}))

describe('StateMetaData - Utility Functions', () => {
  describe('calculateNetworkHash', () => {
    let calculateNetworkHash: any
    let mockHashObj: jest.Mock

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      // Mock dependencies
      jest.doMock('../../../../src/Crypto', () => ({
        hashObj: jest.fn((data) => 'hashed-' + JSON.stringify(data)),
      }))

      // Import function after mocking
      const module = require('../../../../src/archivedCycle/StateMetaData')
      calculateNetworkHash = module.calculateNetworkHash
      mockHashObj = require('../../../../src/Crypto').hashObj
    })

    it('should calculate network hash from partition hashes', () => {
      const partitionHashes = {
        '0': 'hash0',
        '1': 'hash1',
        '2': 'hash2',
      }

      const result = calculateNetworkHash(partitionHashes)

      expect(mockHashObj).toHaveBeenCalledWith(['hash0', 'hash1', 'hash2'])
      expect(result).toBe('hashed-["hash0","hash1","hash2"]')
    })

    it('should handle empty data', () => {
      const result = calculateNetworkHash({})

      expect(mockHashObj).toHaveBeenCalledWith([])
      expect(result).toBe('hashed-[]')
    })

    it('should handle null data', () => {
      const result = calculateNetworkHash(null)

      expect(mockHashObj).toHaveBeenCalledWith([])
      expect(result).toBe('hashed-[]')
    })

    it('should sort hashes before calculating', () => {
      const partitionHashes = {
        '2': 'hash2',
        '0': 'hash0',
        '1': 'hash1',
      }

      calculateNetworkHash(partitionHashes)

      // Verify the array passed to hashObj is sorted
      expect(mockHashObj).toHaveBeenCalledWith(['hash0', 'hash1', 'hash2'])
    })
  })

  describe('createDataRequest', () => {
    let createDataRequest: any
    let mockTag: jest.Mock

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      // Mock dependencies
      jest.doMock('../../../../src/Crypto', () => ({
        tag: jest.fn((data, recipient) => ({ ...data, recipient, sign: { owner: 'test', sig: 'test-sig' } })),
      }))

      // Import function after mocking
      const module = require('../../../../src/archivedCycle/StateMetaData')
      createDataRequest = module.createDataRequest
      mockTag = require('../../../../src/Crypto').tag
    })

    it('should create a tagged data request for CYCLE type', () => {
      const result = createDataRequest(P2PTypes.SnapshotTypes.TypeNames.CYCLE, 5, 'recipient-key')

      expect(mockTag).toHaveBeenCalledWith(
        {
          type: 'CYCLE',
          lastData: 5,
        },
        'recipient-key'
      )
      expect(result).toHaveProperty('type', 'CYCLE')
      expect(result).toHaveProperty('lastData', 5)
      expect(result).toHaveProperty('recipient', 'recipient-key')
    })

    it('should create a tagged data request for STATE_METADATA type', () => {
      const result = createDataRequest(P2PTypes.SnapshotTypes.TypeNames.STATE_METADATA, 10, 'another-recipient')

      expect(mockTag).toHaveBeenCalledWith(
        {
          type: 'STATE_METADATA',
          lastData: 10,
        },
        'another-recipient'
      )
      expect(result).toHaveProperty('type', 'STATE_METADATA')
      expect(result).toHaveProperty('lastData', 10)
    })
  })

  describe('createQueryRequest', () => {
    let createQueryRequest: any
    let mockTag: jest.Mock

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      // Mock dependencies
      jest.doMock('../../../../src/Crypto', () => ({
        tag: jest.fn((data, recipient) => ({ ...data, recipient, sign: { owner: 'test', sig: 'test-sig' } })),
      }))

      // Import function after mocking
      const module = require('../../../../src/archivedCycle/StateMetaData')
      createQueryRequest = module.createQueryRequest
      mockTag = require('../../../../src/Crypto').tag
    })

    it('should create a tagged query request', () => {
      const result = createQueryRequest('RECEIPT_MAP', 10, 'recipient-key')

      expect(mockTag).toHaveBeenCalledWith(
        {
          type: 'RECEIPT_MAP',
          lastData: 10,
        },
        'recipient-key'
      )
      expect(result).toHaveProperty('type', 'RECEIPT_MAP')
      expect(result).toHaveProperty('lastData', 10)
    })

    it('should handle different query types', () => {
      const result = createQueryRequest('SUMMARY_BLOB', 20, 'node-key')

      expect(mockTag).toHaveBeenCalledWith(
        {
          type: 'SUMMARY_BLOB',
          lastData: 20,
        },
        'node-key'
      )
      expect(result).toHaveProperty('type', 'SUMMARY_BLOB')
      expect(result).toHaveProperty('lastData', 20)
    })
  })

  describe('ArchivedCycle class', () => {
    let ArchivedCycle: any

    beforeEach(() => {
      jest.resetModules()
      jest.clearAllMocks()

      // Mock BaseModel
      jest.doMock('tydb', () => ({
        BaseModel: class {
          _id: string | undefined
          constructor() {
            this._id = 'test-id'
          }
        },
      }))

      // Import class after mocking
      const module = require('../../../../src/archivedCycle/StateMetaData')
      ArchivedCycle = module.ArchivedCycle
    })

    it('should create an ArchivedCycle instance', () => {
      const instance = new ArchivedCycle()

      expect(instance).toBeDefined()
      expect(instance).toBeInstanceOf(ArchivedCycle)
      expect(instance._id).toBe('test-id')
    })
  })
})
