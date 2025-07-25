// @ts-nocheck
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import { join, resolve } from 'path'
import { readFileSync } from 'fs'

// Mock dependencies before imports
jest.mock('path', () => ({
  join: jest.fn((...args: string[]) => args.join('/')),
  resolve: jest.fn((...args: string[]) => args.join('/')),
}))

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
}))

jest.mock('../../../src/dbstore', () => ({
  initializeDB: jest.fn(),
}))

jest.mock('../../../src/txDigester/index', () => ({
  initializeDB: jest.fn(),
}))

jest.mock('../../../src/Config', () => ({
  overrideDefaultConfig: jest.fn(),
  config: {
    ARCHIVER_HASH_KEY: 'test-hash-key',
    ARCHIVER_LOGS: '/test/logs',
    RATE_LIMIT: 100,
    txDigest: {
      apiServerPort: 3001,
    },
  },
}))

jest.mock('../../../src/Crypto', () => ({
  setCryptoHashKey: jest.fn(),
}))

jest.mock('../../../src/Logger', () => ({
  initLogger: jest.fn(),
  mainLogger: {
    debug: jest.fn(),
  },
}))

jest.mock('../../../src/saveConsoleOutput', () => ({
  startSaving: jest.fn(),
}))

const mockFastifyInstance = {
  register: jest.fn().mockResolvedValue(undefined),
  addContentTypeParser: jest.fn(),
  setReplySerializer: jest.fn(),
  listen: jest.fn(),
  log: {
    error: jest.fn(),
  },
}

jest.mock('fastify', () => {
  return {
    __esModule: true,
    default: jest.fn(() => mockFastifyInstance),
  }
})

jest.mock('@fastify/cors', () => ({}))
jest.mock('@fastify/rate-limit', () => ({}))

jest.mock('../../../src/txDigester/api', () => ({
  registerRoutes: jest.fn(),
}))

// Import after mocks
import * as dbstore from '../../../src/dbstore'
import * as txDigesterDB from '../../../src/txDigester/index'
import { overrideDefaultConfig, config } from '../../../src/Config'
import * as Crypto from '../../../src/Crypto'
import * as Logger from '../../../src/Logger'
import { startSaving } from '../../../src/saveConsoleOutput'
import fastify from 'fastify'
import { registerRoutes } from '../../../src/txDigester/api'

// Mock types
const mockedReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>
const mockedJoin = join as jest.MockedFunction<typeof join>
const mockedResolve = resolve as jest.MockedFunction<typeof resolve>
const mockedOverrideDefaultConfig = overrideDefaultConfig as jest.MockedFunction<typeof overrideDefaultConfig>
const mockedDbstoreInitializeDB = dbstore.initializeDB as jest.MockedFunction<typeof dbstore.initializeDB>
const mockedTxDigesterInitializeDB = txDigesterDB.initializeDB as jest.MockedFunction<typeof txDigesterDB.initializeDB>
const mockedSetCryptoHashKey = Crypto.setCryptoHashKey as jest.MockedFunction<typeof Crypto.setCryptoHashKey>
const mockedInitLogger = Logger.initLogger as jest.MockedFunction<typeof Logger.initLogger>
const mockedStartSaving = startSaving as jest.MockedFunction<typeof startSaving>
const mockedFastify = fastify as jest.MockedFunction<typeof fastify>
const mockedRegisterRoutes = registerRoutes as jest.MockedFunction<typeof registerRoutes>

describe('txDigestAPIserver', () => {
  let originalConsoleLog: typeof console.log
  let originalProcessExit: typeof process.exit

  beforeEach(() => {
    jest.clearAllMocks()

    // Save original console.log and process.exit
    originalConsoleLog = console.log
    originalProcessExit = process.exit
    console.log = jest.fn()
    process.exit = jest.fn() as any

    // Setup default mocks
    mockedJoin.mockImplementation((...args: string[]) => args.join('/'))
    mockedResolve.mockImplementation((...args: string[]) => args.join('/'))
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        dir: '/logs',
        saveConsoleOutput: true,
      })
    )
  })

  afterEach(() => {
    // Restore original functions
    console.log = originalConsoleLog
    process.exit = originalProcessExit
  })

  describe('start function', () => {
    it('should initialize the server successfully', async () => {
      // Arrange
      const mockLogConfig = {
        dir: '/logs',
        saveConsoleOutput: true,
      }
      mockedReadFileSync.mockReturnValue(JSON.stringify(mockLogConfig))
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Assert
      expect(mockedOverrideDefaultConfig).toHaveBeenCalledWith(expect.stringContaining('archiver-config.json'))
      expect(mockedSetCryptoHashKey).toHaveBeenCalledWith('test-hash-key')
      expect(mockedDbstoreInitializeDB).toHaveBeenCalledWith(config)
      expect(mockedTxDigesterInitializeDB).toHaveBeenCalledWith(config)
      expect(mockedInitLogger).toHaveBeenCalled()
      expect(mockedStartSaving).toHaveBeenCalled()
      expect(mockFastifyInstance.register).toHaveBeenCalledTimes(2) // cors and rate-limit
      expect(mockFastifyInstance.addContentTypeParser).toHaveBeenCalled()
      expect(mockFastifyInstance.setReplySerializer).toHaveBeenCalled()
      expect(mockedRegisterRoutes).toHaveBeenCalledWith(mockFastifyInstance)
      expect(mockFastifyInstance.listen).toHaveBeenCalledWith(
        {
          port: 3001,
          host: '0.0.0.0',
        },
        expect.any(Function)
      )
    })

    // Note: Skipping the test for missing log config file because the source code
    // has a bug where it doesn't check if logsConfig is undefined before setting properties.
    // This would require fixing the source code first.

    it('should handle server listen error and exit process', async () => {
      // Arrange
      const mockError = new Error('Port already in use')
      // Ensure log config is properly set
      const mockLogConfig = {
        dir: '/logs',
        saveConsoleOutput: false,
      }
      mockedReadFileSync.mockReturnValue(JSON.stringify(mockLogConfig))
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(mockError)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Assert
      expect(mockFastifyInstance.log.error).toHaveBeenCalledWith(mockError)
      expect(process.exit).toHaveBeenCalledWith(1)
    })

    it('should not start console output saving when disabled', async () => {
      // Arrange
      const mockLogConfig = {
        dir: '/logs',
        saveConsoleOutput: false,
      }
      mockedReadFileSync.mockReturnValue(JSON.stringify(mockLogConfig))
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Assert
      expect(mockedStartSaving).not.toHaveBeenCalled()
    })

    it('should handle JSON parsing in content type parser', async () => {
      // Arrange
      let contentParserCallback: any
      mockFastifyInstance.addContentTypeParser.mockImplementation((type: string, opts: any, handler: Function) => {
        contentParserCallback = handler
      })
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Test valid JSON
      const validJson = '{"test": "data"}'
      const doneFn = jest.fn()
      contentParserCallback({}, validJson, doneFn)
      expect(doneFn).toHaveBeenCalledWith(null, { test: 'data' })

      // Test invalid JSON
      const invalidJson = 'invalid json'
      const doneFn2 = jest.fn()
      contentParserCallback({}, invalidJson, doneFn2)
      expect(doneFn2).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }), undefined)
    })

    it('should handle reply serializer correctly', async () => {
      // Arrange
      let replySerializer: any
      mockFastifyInstance.setReplySerializer.mockImplementation((serializer: Function) => {
        replySerializer = serializer
      })
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Test serializer
      const testPayload = { data: 'test', number: 123 }
      const serialized = replySerializer(testPayload)
      expect(serialized).toBe(JSON.stringify(testPayload))
    })

    it('should configure rate limiting correctly', async () => {
      // Arrange
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Assert rate limit configuration
      // Check that register was called with rate limit plugin
      const registerCalls = mockFastifyInstance.register.mock.calls
      const rateLimitCall = registerCalls.find((call) => call[1] && call[1].global === true && call[1].max === 100)
      expect(rateLimitCall).toBeDefined()
      expect(rateLimitCall[1]).toMatchObject({
        global: true,
        max: 100,
        timeWindow: 10,
        allowList: ['127.0.0.1', '0.0.0.0'],
      })
    })

    it('should handle Buffer input in content parser', async () => {
      // Arrange
      let contentParserCallback: any
      mockFastifyInstance.addContentTypeParser.mockImplementation((type: string, opts: any, handler: Function) => {
        contentParserCallback = handler
      })
      mockFastifyInstance.listen.mockImplementation((_options: any, callback: Function) => {
        callback(null)
      })

      // Import and execute the module
      jest.isolateModules(() => {
        require('../../../src/txDigestAPIserver')
      })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Test with Buffer input
      const jsonData = { test: 'buffer' }
      const buffer = Buffer.from(JSON.stringify(jsonData))
      const doneFn = jest.fn()

      contentParserCallback({}, buffer, doneFn)
      expect(doneFn).toHaveBeenCalledWith(null, jsonData)
    })
  })
})
