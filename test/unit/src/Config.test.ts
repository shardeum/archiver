// Import required modules and mock dependencies
import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { config, overrideDefaultConfig, updateConfig, Config } from '../../../src/Config'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

// Mock filesystem, path, and utility modules
jest.mock('fs')
jest.mock('path')
jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeJsonParse: jest.fn(),
  },
}))
jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}))

// Main test suite for Config Module
describe('Config Module', () => {
  // Test configuration constants
  const mockConfig = {
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PORT: 4000,
    VERBOSE: true,
  }

  const tempConfigFile = 'tempConfig.json'

  // Reset mocks and config before each test
  beforeEach(() => {
    jest.resetAllMocks()
    jest.mocked(fs.existsSync).mockReturnValue(false)
    jest.mocked(path.join).mockImplementation((...args) => args.join('/'))
  })

  // Test default configuration values
  describe('Default config', () => {
    it('should have correct default values for all properties', () => {
      // Basic settings
      expect(config.ARCHIVER_IP).toBe('127.0.0.1')
      expect(config.ARCHIVER_PORT).toBe(4000)
      expect(config.ARCHIVER_DB).toBe('archiver-db')
      expect(config.ARCHIVER_LOGS).toBe('archiver-logs')
      expect(config.ARCHIVER_MODE).toBe('release')
      expect(config.VERBOSE).toBe(false)

      // Database paths
      expect(config.ARCHIVER_DATA).toEqual({
        cycleDB: 'cycles.sqlite3',
        accountDB: 'accounts.sqlite3',
        transactionDB: 'transactions.sqlite3',
        receiptDB: 'receipts.sqlite3',
        originalTxDataDB: 'originalTxsData.sqlite3',
        processedTxDB: 'processedTransactions.sqlite3',
        txDigestDB: 'txDigest.sqlite3',
        checkpointStatusDB: 'checkpointStatus.sqlite3',
      })

      // Network settings
      expect(config.DATASENDER_TIMEOUT).toBe(300000)
      expect(config.RATE_LIMIT).toBe(100)
      expect(config.N_NODE_REJECT_PERCENT).toBe(5)
      expect(config.N_NODELIST).toBe(10)
      expect(config.N_RANDOM_NODELIST_BUCKETS).toBe(100)
      expect(config.RECEIPT_CONFIRMATIONS).toBe(5)

      // Statistics
      expect(config.STATISTICS).toEqual({
        save: true,
        interval: 1,
      })

      // Checkpoint configuration
      expect(config.checkpoint).toEqual({
        bucketConfig: {
          BucketMatureAge: 660,
          cycleAge: 60,
          GiveUpAge: 1200,
          lastFailedBucketDuration: 300000,
          RadixDepth: 2,
          allowCheckpointUpdates: false,
          allowCheckpointStorage: false,
        },
        batchSize: 100,
        updateInterval: 60000,
        syncInterval: 10000,
        maxCyclesToSync: 100,
        syncOnStartup: false,
      })

      // Data logging
      expect(config.dataLogWrite).toBe(true)
      expect(config.dataLogWriter).toEqual({
        dirName: 'data-logs',
        maxLogFiles: 10,
        maxReceiptEntries: 10000,
        maxCycleEntries: 500,
        maxOriginalTxEntries: 10000,
      })

      // Feature flags
      expect(config.experimentalSnapshot).toBe(true)
      expect(config.useSerialization).toBe(true)
      expect(config.useSyncV2).toBe(true)
      expect(config.sendActiveMessage).toBe(false)
      expect(config.limitToArchiversOnly).toBe(true)
      expect(config.verifyReceiptData).toBe(true)
      expect(config.verifyReceiptSignaturesSeparately).toBe(true)
      expect(config.verifyAppReceiptData).toBe(true)
      expect(config.verifyAccountData).toBe(true)

      // Request limits
      expect(config.REQUEST_LIMIT).toEqual({
        MAX_ACCOUNTS_PER_REQUEST: 1000,
        MAX_RECEIPTS_PER_REQUEST: 100,
        MAX_ORIGINAL_TXS_PER_REQUEST: 100,
        MAX_CYCLES_PER_REQUEST: 100,
        MAX_BETWEEN_CYCLES_PER_REQUEST: 100,
      })

      // Cache settings
      expect(config.cycleRecordsCache).toEqual({
        enabled: false,
      })

      // Transaction settings
      expect(config.newPOQReceipt).toBe(false)
      expect(config.storeReceiptBeforeStates).toBe(true)
      expect(config.waitingTimeForMissingTxData).toBe(2000)

      // Gossip settings
      expect(config.gossipToMoreArchivers).toBe(true)
      expect(config.randomGossipArchiversCount).toBe(2)
      expect(config.subscribeToMoreConsensors).toBe(true)
      expect(config.extraConsensorsToSubscribe).toBe(1)
      expect(config.saveOnlyGossipData).toBe(false)
      expect(config.stopGossipTxData).toBe(false)

      // POQ settings
      expect(config.usePOQo).toBe(true)
      expect(config.requiredVotesPercentage).toBe(2 / 3)
      expect(config.requiredMajorityVotesPercentage).toBe(2 / 3)

      // Cycle settings
      expect(config.maxCyclesShardDataToKeep).toBe(10)
      expect(config.configChangeMaxCyclesToKeep).toBe(5)
      expect(config.configChangeMaxChangesToKeep).toBe(1000)

      // Activity tracking
      expect(config.receiptLoadTrakerInterval).toBe(10000)
      expect(config.receiptLoadTrakerLimit).toBe(10)
      expect(config.lastActivityCheckInterval).toBe(15000)
      expect(config.lastActivityCheckTimeout).toBe(30000)

      // TX Digest settings
      expect(config.txDigest).toEqual({
        cycleDiff: 10,
        syncDelay: 20,
        apiServerPort: 8084,
        txCronSchedule: '*/5 * * * *',
      })

      // Debug settings
      expect(config.workerProcessesDebugLog).toBe(false)
      expect(config.restrictFirstNodeSelectionByPublicKey).toBe(false)
      expect(config.firstNodePublicKey).toBe('')

      // Receipt handling
      expect(config.disableOffloadReceipt).toBe(false)
      expect(config.disableOffloadReceiptForGlobalModification).toBe(true)
      expect(config.restoreNGTsFromSnapshot).toBe(false)

      // Ticket configuration
      expect(config.tickets).toEqual({
        allowedTicketSigners: {
          '0x002D3a2BfE09E3E29b6d38d58CaaD16EEe4C9BC5': 5,
          '0x80aF8E195B56aCC3b4ec8e2C99EC38957258635a': 5,
          '0x7Efbb31431ac7C405E8eEba99531fF1254fCA3B6': 5,
          '0xCc74bf387F6C102b5a7F828796C57A6D2D19Cb00': 5,
          '0x4ed5C053BF2dA5F694b322EA93dce949F3276B85': 5,
          '0xd31aBC7497aD8bC9fe8555C9eDe45DFd7FB3Bf6F': 5,
          '0xe7e4cc292b424C6D50d16F1Bb5BAB2032c486980': 5,
          '0xD815DA50966c19261B34Ffa3bE50A30A67D97456': 5,
          '0xE856B2365641eba73Bc430AAC1E8F930dA513D9D': 5,
          '0x8282F755e784414697421D4b59232E5d194e2262': 5,
          '0x353Ad64Df4fAe5EffF717A1c41BE6dEBee543129': 5,
          '0x9Ce1C3c114538c625aA2488b97fEb3723fdBB07B': 5,
          '0x6A83e4e4eB0A2c8f562db6BB64b02a9A6237B314': 5,
          '0x92E375E0c76CaE76D9DfBab17EE7B3B4EE407715': 5,
          '0xBD79B430CA932e2D89bb77ACaE7367a07471c2eA': 5,
          '0xfF2b584A947182c55BBc039BEAB78BC201D3AdDe': 5,
          '0xCeA068d8DCB4B4020D30a9950C00cF8408611F67': 5,
          '0x52F8d3DaA7b5FF25ca2bF7417E059aFe0bD5fB0E': 5,
          '0xF82BDA6Ef512e4219C6DCEea896E50e8180a5bff': 5,
          '0xA04A1B214a2537139fE59488820D4dA06516933f': 5,
          '0x550817e7B91244BBeFE2AD621ccD555A16B00405': 5,
          '0x84C55a4bFfff1ADadb9C46e2B60979F519dAf874': 5,
          '0x4563303BCE96D3f8d9C7fB94b36dfFC9d831871d': 5,
          '0xdA058F9c7Ce86C1D21DD5DBDeBad5ab5c785520a': 5,
          '0x891DF765C855E9848A18Ed18984B9f57cb3a4d47': 5,
          '0x7Fb9b1C5E20bd250870F87659E46bED410221f17': 5,
          '0x1e5e12568b7103E8B22cd680A6fa6256DD66ED76': 5,
          '0xa58169308e7153B5Ce4ca5cA515cC4d0cBE7770B': 5,
        },
        minSigRequired: 1,
        requiredSecurityLevel: 5,
      })

      // Additional settings
      expect(config.maxRecordsPerRequest).toBe(200)
      expect(config.multisigKeysSyncFromNetworkInternal).toBe(600)
      expect(config.minCycleConfirmationsToSave).toBe(-1)
      expect(config.nerfNonFoundationCertScores).toBe(true)
      expect(config.formingNetworkCycleThreshold).toBe(30)
      expect(config.maxResponseSize).toBe(15 * 1024 * 1024)
    })
  })

  // Test negative scenarios
  describe('Negative test cases', () => {
    // Test malformed JSON handling
    it('should handle malformed JSON in config file', async () => {
      jest.mocked(fs.readFileSync).mockReturnValue('invalid json')
      jest.mocked(StringUtils.safeJsonParse).mockImplementation(() => {
        throw new Error('Invalid JSON')
      })
      await expect(overrideDefaultConfig(tempConfigFile)).resolves.not.toThrow()
    })

    // Test empty value handling
    it('should handle empty values for required string fields', async () => {
      const configWithEmptyValues = {
        ARCHIVER_IP: '',
        ARCHIVER_HASH_KEY: '',
      }
      jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(configWithEmptyValues))
      jest.mocked(StringUtils.safeJsonParse).mockReturnValue(configWithEmptyValues)
      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_IP).toBe('')
      expect(config.ARCHIVER_HASH_KEY).toBe('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
    })

    // Test undefined value handling
    it('should handle undefined values in config', () => {
      const newConfig = {
        ARCHIVER_IP: undefined,
      } as Partial<Config>
      expect(() => updateConfig(newConfig)).toThrow(/Value with incorrect type/)
    })

    // Test type mismatch rejection
    it('should reject updates with type mismatches', () => {
      const invalidUpdates = [
        { RATE_LIMIT: 'string-value' } as any,
        { VERBOSE: 'not-boolean' } as any,
        { STATISTICS: 'not-object' } as any,
      ]

      invalidUpdates.forEach((update) => {
        expect(() => updateConfig(update)).toThrow(/Value with incorrect type/)
      })
    })

    // Test missing config file
    it('should use defaults when config file is missing', async () => {
      // Simulate ENOENT error
      jest.mocked(fs.readFileSync).mockImplementation(() => {
        const error = new Error('File not found') as NodeJS.ErrnoException
        error.code = 'ENOENT'
        throw error
      })

      const origIp = config.ARCHIVER_IP
      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_IP).toBe(origIp) // Default value preserved
    })

    // Test invalid environment variables
    it('should handle invalid environment variable values', async () => {
      const origEnv = process.env
      process.env = {
        ...process.env,
        VERBOSE: 'not-a-boolean',
      }

      const origVerbose = config.VERBOSE
      try {
        await overrideDefaultConfig(tempConfigFile)
        expect(config.VERBOSE).toBe(false) // Invalid boolean strings interpreted as false
      } finally {
        process.env = origEnv
        config.VERBOSE = origVerbose
      }
    })
  })

  // Test configuration override functionality
  describe('overrideDefaultConfig', () => {
    // Test file loading
    it('should load config from a file', async () => {
      jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig))
      jest.mocked(StringUtils.safeJsonParse).mockReturnValue(mockConfig)
      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_IP).toBe(mockConfig.ARCHIVER_IP)
      expect(config.ARCHIVER_PORT).toBe(mockConfig.ARCHIVER_PORT)
      expect(config.VERBOSE).toBe(mockConfig.VERBOSE)
    })

    // Test environment variable override
    it('should override config from environment variables', async () => {
      const originalEnv = process.env
      const customArchiverData = {
        cycleDB: 'custom-cycles.sqlite3',
      }
      process.env = {
        ...process.env,
        ARCHIVER_IP: '192.168.1.1',
        ARCHIVER_PORT: '5000',
        VERBOSE: 'true',
        ARCHIVER_DATA: JSON.stringify(customArchiverData),
      }

      jest.mocked(StringUtils.safeJsonParse).mockImplementation((str) => {
        const parsed = JSON.parse(str)
        if (parsed.cycleDB) {
          return {
            ...config.ARCHIVER_DATA,
            ...parsed,
          }
        }
        return parsed
      })

      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_IP).toBe('192.168.1.1')
      expect(config.ARCHIVER_PORT).toBe(5000)
      expect(config.VERBOSE).toBe(true)
      expect(config.ARCHIVER_DATA.cycleDB).toBe('custom-cycles.sqlite3')
      expect(config.ARCHIVER_DATA.accountDB).toBe('accounts.sqlite3') // Original value preserved

      process.env = originalEnv
    })

    // Test CLI argument override
    it('should override config from CLI arguments', async () => {
      const originalArgv = process.argv
      process.argv = [
        ...process.argv.slice(0, 2),
        '--ARCHIVER_IP=192.168.1.2',
        '--ARCHIVER_PORT=6000',
        '--VERBOSE=true',
      ]

      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_IP).toBe('192.168.1.2')
      expect(config.ARCHIVER_PORT).toBe(6000)
      expect(config.VERBOSE).toBe(true)

      process.argv = originalArgv
    })

    // Test secrets loading
    it('should load secrets from .secrets file', async () => {
      jest.mocked(fs.existsSync).mockReturnValue(true)
      jest
        .mocked(fs.readFileSync)
        .mockReturnValue(
          'ARCHIVER_PUBLIC_KEY=testpubkey\nARCHIVER_SECRET_KEY=testsecretkey\nARCHIVER_HASH_KEY=testhashkey'
        )

      await overrideDefaultConfig(tempConfigFile)
      expect(config.ARCHIVER_PUBLIC_KEY).toBe('testpubkey')
      expect(config.ARCHIVER_SECRET_KEY).toBe('testsecretkey')
      expect(config.ARCHIVER_HASH_KEY).toBe('testhashkey')
    })
  })

  // Test configuration update functionality
  describe('updateConfig', () => {
    // Test comprehensive configuration updates
    it('should update all configuration categories', () => {
      const newConfig: Partial<Config> = {
        // Basic settings
        ARCHIVER_IP: '192.168.1.3',
        ARCHIVER_PORT: 7000,
        ARCHIVER_DB: 'new-archiver-db',
        VERBOSE: true,

        // Network settings
        DATASENDER_TIMEOUT: 600000,
        RATE_LIMIT: 200,
        N_NODE_REJECT_PERCENT: 10,
        N_NODELIST: 20,
        N_RANDOM_NODELIST_BUCKETS: 200,
        RECEIPT_CONFIRMATIONS: 10,

        // Statistics
        STATISTICS: {
          save: false,
          interval: 2,
        },

        // Feature flags
        experimentalSnapshot: false,
        useSerialization: false,
        useSyncV2: false,
        sendActiveMessage: true,

        // Gossip settings
        gossipToMoreArchivers: true,
        randomGossipArchiversCount: 2,
        subscribeToMoreConsensors: true,
        extraConsensorsToSubscribe: 1,

        // POQ settings
        usePOQo: false,
        requiredVotesPercentage: 3 / 4,
        requiredMajorityVotesPercentage: 3 / 4,

        // Ticket configuration
        tickets: {
          allowedTicketSigners: {
            '0xnewaddress': 5,
          },
          minSigRequired: 2,
          requiredSecurityLevel: 6,
        },

        // Additional settings
        maxRecordsPerRequest: 300,
        multisigKeysSyncFromNetworkInternal: 1200,
        minCycleConfirmationsToSave: 1,
        maxResponseSize: 20 * 1024 * 1024,
      }

      updateConfig(newConfig)

      // Verify all updates
      expect(config.ARCHIVER_IP).toBe('192.168.1.3')
      expect(config.ARCHIVER_PORT).toBe(7000)
      expect(config.ARCHIVER_DB).toBe('new-archiver-db')
      expect(config.VERBOSE).toBe(true)

      expect(config.DATASENDER_TIMEOUT).toBe(600000)
      expect(config.RATE_LIMIT).toBe(200)
      expect(config.N_NODE_REJECT_PERCENT).toBe(10)

      expect(config.STATISTICS.save).toBe(false)
      expect(config.STATISTICS.interval).toBe(2)

      expect(config.experimentalSnapshot).toBe(false)
      expect(config.useSerialization).toBe(false)
      expect(config.useSyncV2).toBe(false)

      expect(config.gossipToMoreArchivers).toBe(true)
      expect(config.randomGossipArchiversCount).toBe(2)

      expect(config.tickets.minSigRequired).toBe(2)
      expect(config.tickets.requiredSecurityLevel).toBe(6)
      expect(config.tickets.allowedTicketSigners['0xnewaddress']).toBe(5)

      expect(config.maxRecordsPerRequest).toBe(300)
      expect(config.multisigKeysSyncFromNetworkInternal).toBe(1200)
      expect(config.maxResponseSize).toBe(20 * 1024 * 1024)
    })
  })
})
