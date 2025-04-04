import * as path from 'path'
import * as fs from 'fs'
import { ethers } from 'ethers'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { allowedArchiversManager } from '../../../../src/shardeum/allowedArchiversManager'
import * as Logger from '../../../../src/Logger'
import { DevSecurityLevel } from '../../../../src/types/security'
import { verifyMultiSigs } from '../../../../src/services/ticketVerification'

// Mock external dependencies
jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  watchFile: jest.fn((filename, options, listener) => {
    // Store the listener in a special property so we can access it in tests
    (jest.mocked(fs.watchFile) as any)._listener = listener;
  }),
  unwatchFile: jest.fn(),
  existsSync: jest.fn(),
}))

jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    error: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
  },
}))

jest.mock('../../../../src/services/ticketVerification', () => ({
  verifyMultiSigs: jest.fn(),
}))

describe('AllowedArchiversManager', () => {
  // Test data
  const wallet1 = ethers.Wallet.createRandom()
  const wallet2 = ethers.Wallet.createRandom()
  
  const testPayload = {
    allowedArchivers: [
      { ip: '192.168.1.1', port: 4000, publicKey: '0a1b2c3d4e5f' },
      { ip: '192.168.1.2', port: 4001, publicKey: '5f4e3d2c1b0a' }
    ]
  }
  
  const testConfig = {
    allowedArchivers: [
      { ip: '192.168.1.1', port: 4000, publicKey: '0a1b2c3d4e5f' },
      { ip: '192.168.1.2', port: 4001, publicKey: '5f4e3d2c1b0a' }
    ],
    signatures: [
      {
        owner: wallet1.address,
        sig: wallet1.signMessageSync(StringUtils.safeStringify(testPayload))
      }
    ]
  }
  
  const configPath = path.resolve(__dirname, '../../../../allowed-archivers.json')
  
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Default mocks
    jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(testConfig))
    jest.mocked(fs.existsSync).mockReturnValue(true)
    jest.mocked(verifyMultiSigs).mockReturnValue({ isValid: true, validCount: 1 })
    
    // Reset the manager state before each test
    allowedArchiversManager.stopWatching()
    
    // Directly access and reset the internal state for testing
    // This is necessary since we're using the singleton instance
    allowedArchiversManager['currentConfig'] = null
    allowedArchiversManager['isInitialized'] = false
    allowedArchiversManager['configPath'] = ''
    
    // Set up default global account config
    const mockAllowedSigners = { [wallet1.address]: DevSecurityLevel.HIGH }
    allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners, 1)
  })
  
  afterEach(() => {
    allowedArchiversManager.stopWatching()
  })
  
  describe('Initialization', () => {
    it('should initialize successfully with valid config path', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(fs.readFileSync).toHaveBeenCalledWith(expect.any(String), 'utf8')
      expect(fs.watchFile).toHaveBeenCalledWith(
        expect.any(String),
        { persistent: true },
        expect.any(Function)
      )
      expect(allowedArchiversManager['isInitialized']).toBe(true)
      expect(allowedArchiversManager.getCurrentConfig()).toEqual(testConfig)
    })
    
    it('should handle empty config path', () => {
      allowedArchiversManager.initialize('')
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Config path is required')
      expect(allowedArchiversManager['isInitialized']).toBe(false)
    })
    
    it('should handle non-existent config file', () => {
      jest.mocked(fs.existsSync).mockReturnValue(false)
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Config file does not exist')
      expect(allowedArchiversManager['isInitialized']).toBe(false)
    })
    
    it('should not reinitialize if already initialized', () => {
      allowedArchiversManager.initialize(configPath)
      const firstCallCount = jest.mocked(fs.watchFile).mock.calls.length
      
      allowedArchiversManager.initialize(configPath)
      
      expect(jest.mocked(fs.watchFile).mock.calls.length).toBe(firstCallCount)
    })
    
    it('should handle initialization errors gracefully', () => {
      jest.mocked(fs.existsSync).mockImplementation(() => {
        throw new Error('Unexpected error')
      })
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Failed to initialize AllowedArchiversManager:',
        expect.any(Error)
      )
      expect(allowedArchiversManager['isInitialized']).toBe(false)
    })
  })
  
  describe('Configuration Loading and Verification', () => {
    it('should load and verify config successfully', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(verifyMultiSigs).toHaveBeenCalledWith(
        testPayload,
        testConfig.signatures,
        allowedArchiversManager['globalAccountAllowedSigners'],
        allowedArchiversManager['globalAccountMinSigRequired'],
        DevSecurityLevel.HIGH
      )
      expect(allowedArchiversManager.getCurrentConfig()).toEqual(testConfig)
    })
    
    it('should log error when config has invalid structure', () => {
      const invalidConfig = { invalidProperty: 'value' }
      jest.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidConfig))
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid config structure')
      // Config will remain null because loadAndVerifyConfig returns early without setting it
      expect(allowedArchiversManager.getCurrentConfig()).toBeNull()
    })
    
    it('should log error when config file has invalid JSON', () => {
      jest.mocked(fs.readFileSync).mockReturnValue('invalid json')
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Failed to read configuration:',
        expect.any(SyntaxError)
      )
      // Config will remain null because getArchiverWhitelistConfig returns null
      expect(allowedArchiversManager.getCurrentConfig()).toBeNull()
    })
    
    it('should log error when config has invalid signatures', () => {
      jest.mocked(verifyMultiSigs).mockReturnValue({ isValid: false, validCount: 0 })
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith('Invalid signatures in new config')
      // The currentConfig will remain null because loadAndVerifyConfig returns early
      expect(allowedArchiversManager.getCurrentConfig()).toBeNull()
    })
    
    it('should log error when file read fails', () => {
      jest.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File read error')
      })
      
      allowedArchiversManager.initialize(configPath)
      
      expect(Logger.mainLogger.error).toHaveBeenCalledWith(
        'Failed to read configuration:',
        expect.any(Error)
      )
      // Config will remain null because getArchiverWhitelistConfig returns null
      expect(allowedArchiversManager.getCurrentConfig()).toBeNull()
    })
  })
  
  describe('Global Account Configuration', () => {
    it('should set globalAccountAllowedSigners and globalAccountMinSigRequired', () => {
      const mockAllowedSigners = { 
        [wallet1.address]: DevSecurityLevel.HIGH,
        [wallet2.address]: DevSecurityLevel.MEDIUM 
      }
      const mockMinSigRequired = 2
      
      allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners, mockMinSigRequired)
      
      expect(allowedArchiversManager['globalAccountAllowedSigners']).toEqual(mockAllowedSigners)
      expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(mockMinSigRequired)
    })
    
    it('should set only globalAccountAllowedSigners if minSigRequired is not provided', () => {
      const initialMinSigRequired = allowedArchiversManager['globalAccountMinSigRequired']
      const mockAllowedSigners = { [wallet2.address]: DevSecurityLevel.LOW }
      
      allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners)
      
      expect(allowedArchiversManager['globalAccountAllowedSigners']).toEqual(mockAllowedSigners)
      expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(initialMinSigRequired)
    })
    
    it('should set only globalAccountMinSigRequired if allowedSigners is not provided', () => {
      const initialAllowedSigners = { ...allowedArchiversManager['globalAccountAllowedSigners'] }
      const mockMinSigRequired = 3
      
      allowedArchiversManager.setGlobalAccountConfig(undefined, mockMinSigRequired)
      
      expect(allowedArchiversManager['globalAccountAllowedSigners']).toEqual(initialAllowedSigners)
      expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(mockMinSigRequired)
    })
    
    it('should not change configuration if no parameters are provided', () => {
      const initialAllowedSigners = { ...allowedArchiversManager['globalAccountAllowedSigners'] }
      const initialMinSigRequired = allowedArchiversManager['globalAccountMinSigRequired']
      
      allowedArchiversManager.setGlobalAccountConfig()
      
      expect(allowedArchiversManager['globalAccountAllowedSigners']).toEqual(initialAllowedSigners)
      expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(initialMinSigRequired)
    })
    
    it('should ignore minSigRequired if less than 1', () => {
      const initialMinSigRequired = allowedArchiversManager['globalAccountMinSigRequired']
      
      allowedArchiversManager.setGlobalAccountConfig(undefined, 0)
      
      expect(allowedArchiversManager['globalAccountMinSigRequired']).toBe(initialMinSigRequired)
    })
    
    it('should reload config after setting global account config', () => {
      // First initialize with default config
      allowedArchiversManager.initialize(configPath)
      jest.clearAllMocks() // Clear previous mocks
      
      // Now set new global account config
      const mockAllowedSigners = { [wallet2.address]: DevSecurityLevel.HIGH }
      allowedArchiversManager.setGlobalAccountConfig(mockAllowedSigners, 1)
      
      // Verify that loadAndVerifyConfig was called
      expect(verifyMultiSigs).toHaveBeenCalled()
    })
  })
  
  describe('Archiver Authorization', () => {
    it('should correctly identify allowed archivers', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(allowedArchiversManager.isArchiverAllowed('0a1b2c3d4e5f')).toBe(true)
      expect(allowedArchiversManager.isArchiverAllowed('5f4e3d2c1b0a')).toBe(true)
    })
    
    it('should correctly identify non-allowed archivers', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(allowedArchiversManager.isArchiverAllowed('unknown')).toBe(false)
    })
    
    it('should return false for empty or null publicKey', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(allowedArchiversManager.isArchiverAllowed('')).toBe(false)
      expect(allowedArchiversManager.isArchiverAllowed(null as any)).toBe(false)
    })
    
    it('should return false if currentConfig is null', () => {
      // Make sure currentConfig is null
      allowedArchiversManager['currentConfig'] = null
      
      expect(allowedArchiversManager.isArchiverAllowed('0a1b2c3d4e5f')).toBe(false)
    })
  })
  
  describe('File Watching', () => {
    it('should properly stop watching the config file', () => {
      allowedArchiversManager.initialize(configPath)
      
      allowedArchiversManager.stopWatching()
      
      expect(fs.unwatchFile).toHaveBeenCalledWith(configPath)
      expect(allowedArchiversManager['isInitialized']).toBe(false)
    })
    
    it('should not attempt to stop watching if not initialized', () => {
      // Ensure not initialized
      allowedArchiversManager['isInitialized'] = false
      
      allowedArchiversManager.stopWatching()
      
      expect(fs.unwatchFile).not.toHaveBeenCalled()
    })
    
    it('should reload config when file changes', () => {
      allowedArchiversManager.initialize(configPath)
      
      // Clear mocks before triggering the callback
      jest.clearAllMocks()
      
      // Get the stored listener from our mock implementation
      const listener = (jest.mocked(fs.watchFile) as any)._listener
      
      if (listener) {
        // Simulate file change with different modification times
        listener(
          { mtime: new Date(2022, 1, 1) },
          { mtime: new Date(2021, 1, 1) }
        )
        
        // Verify loadAndVerifyConfig was called
        expect(fs.readFileSync).toHaveBeenCalled()
        expect(verifyMultiSigs).toHaveBeenCalled()
      }
    })
    
    it('should not reload config when file mtime is unchanged', () => {
      allowedArchiversManager.initialize(configPath)
      
      // Clear mocks before triggering the callback
      jest.clearAllMocks()
      
      // Get the stored listener from our mock implementation
      const listener = (jest.mocked(fs.watchFile) as any)._listener
      
      if (listener) {
        // Simulate file check with same modification time
        const sameTime = new Date(2022, 1, 1)
        listener(
          { mtime: sameTime },
          { mtime: sameTime }
        )
        
        // Verify loadAndVerifyConfig was not called
        expect(fs.readFileSync).not.toHaveBeenCalled()
        expect(verifyMultiSigs).not.toHaveBeenCalled()
      }
    })
  })
  
  describe('getCurrentConfig', () => {
    it('should return the current config', () => {
      allowedArchiversManager.initialize(configPath)
      
      expect(allowedArchiversManager.getCurrentConfig()).toEqual(testConfig)
    })
    
    it('should return null if no config is loaded', () => {
      // Directly set currentConfig to null
      allowedArchiversManager['currentConfig'] = null
      
      expect(allowedArchiversManager.getCurrentConfig()).toBeNull()
    })
  })
})
