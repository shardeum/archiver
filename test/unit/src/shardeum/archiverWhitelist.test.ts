import * as path from 'path'
import * as fs from 'fs'
import { ethers } from 'ethers'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { allowedArchiversManager } from '../../../../src/shardeum/allowedArchiversManager'
import * as Logger from '../../../../src/Logger'

// Mock the fs module
jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    watchFile: jest.fn(),
    unwatchFile: jest.fn(),
}))

// Mock the Logger to prevent actual logging during tests
jest.mock('../../../../src/Logger', () => ({
    mainLogger: {
        error: jest.fn(),
        debug: jest.fn(),
    },
}))

// Helper function to create mock Stats object
function createMockStats(mtime: Date): fs.Stats {
    return {
        mtime,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        dev: 0,
        ino: 0,
        mode: 0,
        nlink: 0,
        uid: 0,
        gid: 0,
        rdev: 0,
        size: 0,
        blksize: 0,
        blocks: 0,
        atimeMs: 0,
        mtimeMs: 0,
        ctimeMs: 0,
        birthtimeMs: 0,
        atime: new Date(),
        ctime: new Date(),
        birthtime: new Date()
    } as fs.Stats
}

describe('AllowedArchiversManager', () => {
    // Generate random wallet for testing
    const wallet = ethers.Wallet.createRandom()

    const rawPayload = {
        allowedArchivers: [
            { ip: '127.0.0.1', port: 4000, publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3' },
            { ip: '127.0.0.1', port: 4001, publicKey: 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' },
        ],
        counter: 1
    }

    // Generate hash and signature
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(StringUtils.safeStringify(rawPayload)))
    const actualConfig = {
        allowedArchivers: [
            { ip: '127.0.0.1', port: 4000, publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3' },
            { ip: '127.0.0.1', port: 4001, publicKey: 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' },
        ],
        allowedAccounts: {
            [wallet.address]: 3
        },
        counter: rawPayload.counter,
        minSigRequired: 1,
        signatures: [{
            owner: wallet.address,
            sig: wallet.signMessageSync(payloadHash)
        }]
    }

    const configPath = path.resolve(__dirname, '../../../../allowed-archivers.json')
    beforeEach(() => {
        jest.clearAllMocks()
        // Mock readFileSync to return our test config
        jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(actualConfig))
    })

    afterEach(() => {
        // Stop watching the config file
        allowedArchiversManager.stopWatching()
    })

    test('should initialize and load config', () => {
        allowedArchiversManager.initialize(configPath)
        expect(allowedArchiversManager.getCurrentConfig()).toEqual(actualConfig)
        expect(fs.readFileSync).toHaveBeenCalledWith(expect.any(String), 'utf8')
    })

    test('should verify if an archiver is allowed', () => {
        allowedArchiversManager.initialize(configPath)
        expect(allowedArchiversManager.isArchiverAllowed('758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3')).toBe(true)
        expect(allowedArchiversManager.isArchiverAllowed('publicKey3')).toBe(false)
    })

    test('should log error if config has invalid signatures', () => {
        const invalidConfig = { ...actualConfig, signatures: [] }
        jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig))
        allowedArchiversManager.initialize(configPath)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid signatures in new config')
    })

    test('should reject config with invalid signatures when counter is modified', () => {
        allowedArchiversManager.initialize(configPath)
        const newConfig = {
            ...actualConfig,
            counter: actualConfig.counter + 1,
        }
        jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(newConfig))
        // Simulate file change
        const watchCallback = jest.mocked(fs.watchFile).mock.calls[0][1]
        watchCallback(
            createMockStats(new Date()),
            createMockStats(new Date(Date.now() - 1000))
        )
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid signatures in new config')
    })

    test('should reject config update with non-incrementing counter', () => {
        allowedArchiversManager.initialize(configPath)
        const newPayload = {
            ...rawPayload,
            counter: rawPayload.counter - 1
        }
        const newPayloadHash = ethers.keccak256(ethers.toUtf8Bytes(StringUtils.safeStringify(newPayload)))
        const newConfig = {
            ...newPayload,
            signatures: [{
                owner: wallet.address,
                sig: wallet.signMessageSync(newPayloadHash)
            }]
        }
        jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(newConfig))
        // Simulate file change
        const watchCallback = jest.mocked(fs.watchFile).mock.calls[0][1]
        watchCallback(
            createMockStats(new Date()),
            createMockStats(new Date(Date.now() - 1000))
        )
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid signatures in new config')
    })

    test('should accept valid config update with incremented counter', () => {
        allowedArchiversManager.initialize(configPath)
        const newPayload = {
            ...rawPayload,
            counter: rawPayload.counter + 1
        }
        const newPayloadHash = ethers.keccak256(ethers.toUtf8Bytes(StringUtils.safeStringify(newPayload)))
        const newConfig = {
            ...actualConfig,
            counter: newPayload.counter,
            signatures: [{
                owner: wallet.address,
                sig: wallet.signMessageSync(newPayloadHash)
            }]
        }
        jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(newConfig))
        // Simulate file change
        const watchCallback = jest.mocked(fs.watchFile).mock.calls[0][1]
        watchCallback(
            createMockStats(new Date()),
            createMockStats(new Date(Date.now() - 1000))
        )
        expect(allowedArchiversManager.getCurrentConfig()).toEqual(newConfig)
    })

    test('should handle file read errors gracefully', () => {
        jest.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error('File read error')
        })
        allowedArchiversManager.initialize(configPath)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error loading/verifying config:', expect.any(Error))
    })

    test('should handle invalid JSON in config file', () => {
        jest.mocked(fs.readFileSync).mockReturnValue('invalid json')
        allowedArchiversManager.initialize(configPath)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Error loading/verifying config:', expect.any(Error))
    })

    test('should not reinitialize if already initialized', () => {
        allowedArchiversManager.initialize(configPath)
        const firstCallCount = jest.mocked(fs.watchFile).mock.calls.length
        allowedArchiversManager.initialize(configPath)
        expect(jest.mocked(fs.watchFile).mock.calls.length).toBe(firstCallCount)
    })

    test('should properly clean up watchers when stopping', () => {
        allowedArchiversManager.initialize(configPath)
        allowedArchiversManager.stopWatching()
        expect(fs.unwatchFile).toHaveBeenCalled()
    })
})