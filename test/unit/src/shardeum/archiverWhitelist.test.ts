import * as path from 'path'
import * as fs from 'fs'
import { ethers } from 'ethers'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { allowedArchiversManager } from '../../../../src/shardeum/allowedArchiversManager'
import * as Logger from '../../../../src/Logger'
import { DevSecurityLevel } from '../../../../src/types/security'

// Mock the fs module
jest.mock('fs', () => ({
    readFileSync: jest.fn(),
    writeFileSync: jest.fn(),
    unlinkSync: jest.fn(),
    watchFile: jest.fn(),
    unwatchFile: jest.fn(),
    existsSync: jest.fn(),
}))

// Mock the Logger to prevent actual logging during tests
jest.mock('../../../../src/Logger', () => ({
    mainLogger: {
        error: jest.fn(),
        debug: jest.fn(),
    },
}))

describe('AllowedArchiversManager', () => {
    // Generate random wallet for testing
    const wallet = ethers.Wallet.createRandom()

    const rawPayload = {
        allowedArchivers: [
            { ip: '127.0.0.1', port: 4000, publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3' },
            { ip: '127.0.0.1', port: 4001, publicKey: 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' },
        ]
    }

    // Generate hash and signature
    const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(StringUtils.safeStringify(rawPayload)))
    const actualConfig = {
        allowedArchivers: [
            { ip: '127.0.0.1', port: 4000, publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3' },
            { ip: '127.0.0.1', port: 4001, publicKey: 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' },
        ],
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
        jest.mocked(fs.existsSync).mockReturnValue(true)

        // Define mock values for global account config
        const mockAllowedSigners = { [wallet.address]: DevSecurityLevel.HIGH }
        const mockMinSigRequired = 1

        // Call the method with mock values
        allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners, mockMinSigRequired)
    })

    afterEach(() => {
        // Stop watching the config file
        allowedArchiversManager.stopWatching()
    })

    it('should set global account config with mock values', () => {
        // Mock the setGlobalAccountConfig method
        const mockSetGlobalAccountConfig = jest.spyOn(allowedArchiversManager, 'setGlobalAccountConfig')

        // Define mock values for global account config
        const mockAllowedSigners = { 'signer1': DevSecurityLevel.HIGH }
        const mockMinSigRequired = 1

        // Call the method with mock values
        allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners, mockMinSigRequired)

        // Assert that the method was called with the correct arguments
        expect(mockSetGlobalAccountConfig).toHaveBeenCalledWith(mockAllowedSigners, mockMinSigRequired)

        // verify internal state changes or other side effects
        expect(allowedArchiversManager['globalAccountAllowedSigners']).toEqual(mockAllowedSigners)
        expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(mockMinSigRequired)
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

    test('should handle file read errors gracefully', () => {
        jest.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error('File read error')
        })
        allowedArchiversManager.initialize(configPath)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to read configuration:', expect.any(Error))
    })

    test('should handle invalid JSON in config file', () => {
        jest.mocked(fs.readFileSync).mockReturnValue('invalid json')
        allowedArchiversManager.initialize(configPath)
        expect(Logger.mainLogger.error).toHaveBeenCalledWith('Failed to read configuration:', expect.any(SyntaxError))
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