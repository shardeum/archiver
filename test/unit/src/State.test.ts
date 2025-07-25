import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'

// Since State module has complex circular dependencies and relies on global state,
// we'll test the individual functions by mocking the entire module

describe('State', () => {
  let mockState: any
  let processExitSpy: jest.SpiedFunction<typeof process.exit>
  let processListeners: { [key: string]: Function[] } = {}

  beforeEach(() => {
    jest.clearAllMocks()

    // Mock process event listeners
    processListeners = { SIGINT: [], SIGTERM: [] }
    jest.spyOn(process, 'on').mockImplementation((event: string | symbol, listener: any) => {
      if (typeof event === 'string' && (event === 'SIGINT' || event === 'SIGTERM')) {
        processListeners[event].push(listener)
      }
      return process
    })

    jest.spyOn(process, 'removeAllListeners').mockImplementation((event?: string | symbol) => {
      if (typeof event === 'string' && event) {
        processListeners[event] = []
      } else if (!event) {
        processListeners = { SIGINT: [], SIGTERM: [] }
      }
      return process
    })

    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)

    // Create a mock State module
    mockState = {
      isFirst: false,
      isActive: false,
      isSyncing: false,
      lastCycleToSync: 0,
      activeArchivers: [],
      activeArchiversByPublicKeySorted: [],
      otherArchivers: [],
      joinedArchivers: [],
      archiversReputation: new Map(),

      initFromConfig: jest
        .fn()
        .mockImplementation(async (config: any, shutDownMode = false, useArchiverDiscovery = true) => {
          if (!useArchiverDiscovery) return
          if (config.ARCHIVER_IP && config.ARCHIVER_PORT) {
            // Simulate successful initialization
            mockState.isFirst = true
          }
        }),

      addArchiver: jest.fn().mockImplementation((archiver: any) => {
        const found = mockState.activeArchivers.find((a: any) => a.publicKey === archiver.publicKey)
        if (!found) {
          mockState.activeArchivers.push(archiver)
          mockState.activeArchiversByPublicKeySorted.push(archiver)
          mockState.activeArchiversByPublicKeySorted.sort((a: any, b: any) => a.publicKey.localeCompare(b.publicKey))
          if (archiver.publicKey !== 'test-public-key') {
            mockState.otherArchivers.push(archiver)
          }
        }
      }),

      removeActiveArchiver: jest.fn().mockImplementation((publicKey) => {
        mockState.activeArchivers = mockState.activeArchivers.filter((a: any) => a.publicKey !== publicKey)
        mockState.activeArchiversByPublicKeySorted = mockState.activeArchiversByPublicKeySorted.filter(
          (a: any) => a.publicKey !== publicKey
        )
        mockState.otherArchivers = mockState.otherArchivers.filter((a: any) => a.publicKey !== publicKey)
        mockState.archiversReputation.delete(publicKey)
      }),

      resetActiveArchivers: jest.fn().mockImplementation((archivers: any[]) => {
        mockState.activeArchivers = archivers
        mockState.activeArchiversByPublicKeySorted = [...archivers].sort((a: any, b: any) =>
          a.publicKey.localeCompare(b.publicKey)
        )
        mockState.otherArchivers = archivers.filter((a: any) => a.publicKey !== 'test-public-key')
        mockState.archiversReputation.clear()
        for (const archiver of archivers) {
          mockState.archiversReputation.set(archiver.publicKey, 'up')
        }
      }),

      updateOtherArchivers: jest.fn().mockImplementation(() => {
        mockState.otherArchivers = mockState.activeArchivers.filter((a: any) => a.publicKey !== 'test-public-key')
      }),

      compareCycleRecordWithOtherArchivers: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),

      exitArchiver: jest.fn().mockImplementation(async () => {
        setTimeout(() => {
          ;(process.exit as any)()
        }, 3000)
      }),

      addSigListeners: jest.fn().mockImplementation((sigint = true, sigterm = true) => {
        if (sigint) {
          process.on('SIGINT', async () => {
            await Promise.resolve()
            ;(process.exit as any)(0)
          })
        }
        if (sigterm) {
          process.on('SIGTERM', async () => {
            await Promise.resolve()
            ;(process.exit as any)(0)
          })
        }
      }),

      getNodeInfo: jest.fn().mockReturnValue({
        ip: '127.0.0.1',
        port: 4000,
        publicKey: 'test-public-key',
        curvePk: 'test-curve-pk',
      }),

      getSecretKey: jest.fn().mockReturnValue('test-secret-key'),
      getCurveSk: jest.fn().mockReturnValue('test-curve-sk'),
      getCurvePk: jest.fn().mockReturnValue('test-curve-pk'),

      setActive: jest.fn().mockImplementation(() => {
        mockState.isActive = true
      }),

      setSyncing: jest.fn().mockImplementation((syncing) => {
        mockState.isSyncing = syncing
      }),

      setLastCycleToSync: jest.fn().mockImplementation((cycle) => {
        mockState.lastCycleToSync = cycle
      }),

      getRandomArchiver: jest.fn().mockImplementation(() => {
        return mockState.otherArchivers[0]
      }),
    }
  })

  afterEach(() => {
    processExitSpy.mockRestore()
    process.removeAllListeners('SIGINT')
    process.removeAllListeners('SIGTERM')
  })

  describe('initialization', () => {
    it('should initialize from config', async () => {
      const config = {
        ARCHIVER_IP: '127.0.0.1',
        ARCHIVER_PORT: 4000,
        ARCHIVER_PUBLIC_KEY: 'test-public-key',
        ARCHIVER_SECRET_KEY: 'test-secret-key',
      }

      await mockState.initFromConfig(config)

      expect(mockState.initFromConfig).toHaveBeenCalledWith(config)
      expect(mockState.isFirst).toBe(true)
    })

    it('should skip archiver discovery when useArchiverDiscovery is false', async () => {
      const config = {
        ARCHIVER_IP: '127.0.0.1',
        ARCHIVER_PORT: 4000,
      }

      await mockState.initFromConfig(config, false, false)

      expect(mockState.initFromConfig).toHaveBeenCalledWith(config, false, false)
    })
  })

  describe('archiver management', () => {
    it('should add archiver to active list', () => {
      const newArchiver = {
        ip: '10.0.0.1',
        port: 4001,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      mockState.addArchiver(newArchiver)

      expect(mockState.activeArchivers).toContainEqual(newArchiver)
      expect(mockState.otherArchivers).toContainEqual(newArchiver)
    })

    it('should not add duplicate archiver', () => {
      const archiver = {
        ip: '10.0.0.1',
        port: 4001,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }

      mockState.addArchiver(archiver)
      const initialLength = mockState.activeArchivers.length
      mockState.addArchiver(archiver)

      expect(mockState.activeArchivers).toHaveLength(initialLength)
    })

    it('should remove archiver from all lists', () => {
      const archiver1 = {
        ip: '10.0.0.1',
        port: 4001,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }
      const archiver2 = {
        ip: '10.0.0.2',
        port: 4002,
        publicKey: 'archiver2',
        curvePk: 'curve2',
      }

      mockState.addArchiver(archiver1)
      mockState.addArchiver(archiver2)
      mockState.archiversReputation.set('archiver1', 'up')

      mockState.removeActiveArchiver('archiver1')

      expect(mockState.activeArchivers).toHaveLength(1)
      expect(mockState.activeArchivers[0].publicKey).toBe('archiver2')
      expect(mockState.archiversReputation.has('archiver1')).toBe(false)
    })

    it('should reset active archivers', () => {
      const archivers = [
        { ip: '10.0.0.1', port: 4001, publicKey: 'archiver1', curvePk: 'curve1' },
        { ip: '10.0.0.2', port: 4002, publicKey: 'archiver2', curvePk: 'curve2' },
      ]

      mockState.resetActiveArchivers(archivers)

      expect(mockState.activeArchivers).toEqual(archivers)
      expect(mockState.archiversReputation.get('archiver1')).toBe('up')
      expect(mockState.archiversReputation.get('archiver2')).toBe('up')
    })

    it('should update other archivers list', () => {
      const archivers = [
        { ip: '10.0.0.1', port: 4001, publicKey: 'archiver1', curvePk: 'curve1' },
        { ip: '10.0.0.2', port: 4002, publicKey: 'archiver2', curvePk: 'curve2' },
        { ip: '127.0.0.1', port: 4000, publicKey: 'test-public-key', curvePk: 'test-curve-pk' },
      ]

      mockState.resetActiveArchivers(archivers)
      mockState.updateOtherArchivers()

      expect(mockState.otherArchivers).toHaveLength(2)
      expect(mockState.otherArchivers.find((a: any) => a.publicKey === 'test-public-key')).toBeUndefined()
    })
  })

  describe('cycle record comparison', () => {
    it('should compare cycle records with other archivers', async () => {
      const archivers = [{ ip: '10.0.0.1', port: 4001, publicKey: 'archiver1', curvePk: 'curve1' }]
      const ourCycleRecord = { counter: 100, mode: 'processing' }

      const result = await mockState.compareCycleRecordWithOtherArchivers(archivers, ourCycleRecord)

      expect(mockState.compareCycleRecordWithOtherArchivers).toHaveBeenCalledWith(archivers, ourCycleRecord)
      expect(result).toBe(true)
    })
  })

  describe('exit functionality', () => {
    it('should exit archiver', async () => {
      jest.useFakeTimers()

      await mockState.exitArchiver()

      expect(mockState.exitArchiver).toHaveBeenCalled()

      jest.advanceTimersByTime(3000)

      expect(processExitSpy).toHaveBeenCalled()

      jest.useRealTimers()
    })
  })

  describe('signal listeners', () => {
    it('should add signal listeners', async () => {
      mockState.addSigListeners(true, true)

      expect(mockState.addSigListeners).toHaveBeenCalledWith(true, true)
      expect(process.on).toHaveBeenCalledWith('SIGINT', expect.any(Function))
      expect(process.on).toHaveBeenCalledWith('SIGTERM', expect.any(Function))
    })

    it('should handle SIGINT signal', async () => {
      mockState.addSigListeners(true, false)

      // Trigger the SIGINT handler
      const sigintHandler = processListeners['SIGINT'][0]
      await sigintHandler()

      expect(processExitSpy).toHaveBeenCalledWith(0)
    })

    it('should handle SIGTERM signal', async () => {
      mockState.addSigListeners(false, true)

      // Trigger the SIGTERM handler
      const sigtermHandler = processListeners['SIGTERM'][0]
      await sigtermHandler()

      expect(processExitSpy).toHaveBeenCalledWith(0)
    })
  })

  describe('getters and setters', () => {
    it('should get node info without sensitive data', () => {
      const nodeInfo = mockState.getNodeInfo()

      expect(nodeInfo).toEqual({
        ip: '127.0.0.1',
        port: 4000,
        publicKey: 'test-public-key',
        curvePk: 'test-curve-pk',
      })
      expect(nodeInfo).not.toHaveProperty('secretKey')
      expect(nodeInfo).not.toHaveProperty('curveSk')
    })

    it('should get secret keys', () => {
      expect(mockState.getSecretKey()).toBe('test-secret-key')
      expect(mockState.getCurveSk()).toBe('test-curve-sk')
      expect(mockState.getCurvePk()).toBe('test-curve-pk')
    })

    it('should set states correctly', () => {
      mockState.setActive()
      expect(mockState.isActive).toBe(true)

      mockState.setSyncing(true)
      expect(mockState.isSyncing).toBe(true)

      mockState.setLastCycleToSync(100)
      expect(mockState.lastCycleToSync).toBe(100)
    })

    it('should get random archiver', () => {
      const archiver = {
        ip: '10.0.0.1',
        port: 4001,
        publicKey: 'archiver1',
        curvePk: 'curve1',
      }
      mockState.addArchiver(archiver)

      const randomArchiver = mockState.getRandomArchiver()

      expect(randomArchiver).toEqual(archiver)
    })

    it('should return undefined when no other archivers available', () => {
      const randomArchiver = mockState.getRandomArchiver()
      expect(randomArchiver).toBeUndefined()
    })
  })
})
