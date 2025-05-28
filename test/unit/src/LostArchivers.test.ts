import { Record } from '@shardeum-foundation/lib-types/build/src/p2p/LostArchiverTypes'

describe('LostArchivers', () => {
  let handleLostArchivers: any
  let mockExit: jest.SpyInstance
  let Logger: any
  let allowedArchiversManager: any
  
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    jest.useFakeTimers()
    
    // Mock process.exit
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit: ${code}`)
    })
    
    // Reset console mocks
    jest.spyOn(console, 'log').mockImplementation(() => {})
    
    // Mock all dependencies
    jest.doMock('../../../src/dbstore/cycles', () => ({
      queryLatestCycleRecords: jest.fn().mockResolvedValue([{
        counter: 1,
        cycleMarker: 'cycle-1',
        start: 1000,
        duration: 60
      }])
    }))
    
    jest.doMock('../../../src/Data/Cycles', () => ({
      getCurrentCycleMarker: jest.fn()
    }))
    
    jest.doMock('../../../src/Logger', () => ({
      mainLogger: {
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn()
      }
    }))
    
    jest.doMock('../../../src/NodeList', () => ({
      getRandomActiveNodes: jest.fn()
    }))
    
    jest.doMock('../../../src/Config', () => ({
      config: {
        ARCHIVER_PUBLIC_KEY: 'test-public-key'
      }
    }))
    
    jest.doMock('../../../src/Data/Data', () => ({
      calcIncomingTimes: jest.fn().mockReturnValue({
        quarterDuration: 15000,
        startQ1: Date.now() + 1000
      })
    }))
    
    jest.doMock('../../../src/P2P', () => ({
      postJson: jest.fn()
    }))
    
    jest.doMock('../../../src/Crypto', () => ({
      sign: jest.fn()
    }))
    
    jest.doMock('../../../src/shardeum/allowedArchiversManager', () => ({
      allowedArchiversManager: {
        stopWatching: jest.fn()
      }
    }))
    
    // Import mocked modules
    Logger = require('../../../src/Logger')
    const AllowedArchiversModule = require('../../../src/shardeum/allowedArchiversManager')
    allowedArchiversManager = AllowedArchiversModule.allowedArchiversManager
    
    // Import the module under test
    const LostArchiversModule = require('../../../src/LostArchivers')
    handleLostArchivers = LostArchiversModule.handleLostArchivers
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  describe('handleLostArchivers', () => {
    it('should do nothing if record is null', () => {
      handleLostArchivers(null as any)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('>> handleLostArchivers()')
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('<< handleLostArchivers()')
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should do nothing if record is missing required fields', () => {
      const incompleteRecord = {
        refutedArchivers: ['key1']
        // missing lostArchivers and removedArchivers
      } as any

      handleLostArchivers(incompleteRecord)
      
      expect(mockExit).not.toHaveBeenCalled()
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('>> handleLostArchivers()')
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('<< handleLostArchivers()')
    })

    it('should stop sending refutes if found in refutedArchivers', () => {
      const record: Record = {
        refutedArchivers: ['key1', 'test-public-key', 'key3'],
        lostArchivers: [],
        removedArchivers: []
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('archiver was found in `refutedArchivers` and will stop sending refutes')
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should schedule refute if found in lostArchivers', () => {
      const record: Record = {
        refutedArchivers: [],
        lostArchivers: ['key1', 'test-public-key', 'key3'],
        removedArchivers: []
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith("archiver was found in `lostArchivers` and will send a refute in the next cycle's Q1")
      expect(console.log).toHaveBeenCalledWith('scheduling refute')
    })

    it('should shut down if found in removedArchivers', () => {
      const record: Record = {
        refutedArchivers: [],
        lostArchivers: [],
        removedArchivers: ['key1', 'test-public-key', 'key3']
      } as any

      expect(() => handleLostArchivers(record)).toThrow('process.exit: 2')
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('archiver was found in `removedArchivers`, shutting down')
      expect(allowedArchiversManager.stopWatching).toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(2)
    })

    it('should prioritize refutedArchivers over lostArchivers', () => {
      const record: Record = {
        refutedArchivers: ['test-public-key'],
        lostArchivers: ['test-public-key'],
        removedArchivers: []
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('archiver was found in `refutedArchivers` and will stop sending refutes')
      expect(console.log).not.toHaveBeenCalledWith('scheduling refute')
    })

    it('should prioritize lostArchivers over removedArchivers', () => {
      const record: Record = {
        refutedArchivers: [],
        lostArchivers: ['test-public-key'],
        removedArchivers: ['test-public-key']
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith("archiver was found in `lostArchivers` and will send a refute in the next cycle's Q1")
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should prioritize refutedArchivers over removedArchivers', () => {
      const record: Record = {
        refutedArchivers: ['test-public-key'],
        lostArchivers: [],
        removedArchivers: ['test-public-key']
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('archiver was found in `refutedArchivers` and will stop sending refutes')
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should not do anything if public key is not in any list', () => {
      const record: Record = {
        refutedArchivers: ['other-key-1'],
        lostArchivers: ['other-key-2'],
        removedArchivers: ['other-key-3']
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('>> handleLostArchivers()')
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('<< handleLostArchivers()')
      expect(console.log).not.toHaveBeenCalledWith('scheduling refute')
      expect(mockExit).not.toHaveBeenCalled()
    })

    it('should handle empty arrays in record', () => {
      const record: Record = {
        refutedArchivers: [],
        lostArchivers: [],
        removedArchivers: []
      } as any

      handleLostArchivers(record)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('>> handleLostArchivers()')
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('<< handleLostArchivers()')
      expect(mockExit).not.toHaveBeenCalled()
    })
  })

  describe('die function behavior', () => {
    it('should stop watching and exit with code 2', () => {
      const record: Record = {
        refutedArchivers: [],
        lostArchivers: [],
        removedArchivers: ['test-public-key']
      } as any

      expect(() => handleLostArchivers(record)).toThrow('process.exit: 2')
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('Archiver was found in `removedArchivers` and will exit now without sending a leave request')
      expect(allowedArchiversManager.stopWatching).toHaveBeenCalled()
      expect(mockExit).toHaveBeenCalledWith(2)
    })

    it('should log debug message with correct ARCHIVER_PUBLIC_KEY', () => {
      handleLostArchivers({
        refutedArchivers: [],
        lostArchivers: [],
        removedArchivers: []
      } as any)
      
      expect(Logger.mainLogger.debug).toHaveBeenCalledWith('  config.ARCHIVER_PUBLIC_KEY: test-public-key')
    })
  })
})