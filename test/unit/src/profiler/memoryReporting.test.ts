import MemoryReporting, { setMemoryReportingInstance, memoryReportingInstance } from '../../../../src/profiler/memoryReporting'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as os from 'os'
import { spawn } from 'child_process'
import { statisticsInstance } from '../../../../src/statistics'

// Mock dependencies
jest.mock('../../../../src/statistics', () => ({
  statisticsInstance: {
    setManualStat: jest.fn(),
    getAverage: jest.fn(),
    getMultiStatReport: jest.fn()
  }
}))

jest.mock('../../../../src/NodeList', () => ({
  getActiveNodeCount: jest.fn()
}))

jest.mock('../../../../src/DebugMode', () => ({
  isDebugMiddleware: jest.fn()
}))

jest.mock('child_process', () => ({
  spawn: jest.fn()
}))

jest.mock('os')

// Mock process module
jest.mock('process', () => ({
  ...jest.requireActual('process'),
  resourceUsage: jest.fn()
}))

// Import mocked functions
import { getActiveNodeCount } from '../../../../src/NodeList'
import { isDebugMiddleware } from '../../../../src/DebugMode'
import { resourceUsage } from 'process'

describe('memoryReporting', () => {
  let mockServer: FastifyInstance
  let memoryReporting: MemoryReporting
  let mockRequest: FastifyRequest
  let mockReply: FastifyReply
  let originalMemoryUsage: any

  beforeEach(() => {
    // Setup mock server
    mockServer = {
      get: jest.fn()
    } as unknown as FastifyInstance

    // Setup mock request and reply
    mockRequest = {} as FastifyRequest
    mockReply = {
      send: jest.fn()
    } as unknown as FastifyReply

    // Reset all mocks
    jest.clearAllMocks()

    // Setup default mock returns
    ;(getActiveNodeCount as jest.Mock).mockReturnValue(10)
    ;(statisticsInstance.getAverage as jest.Mock).mockReturnValue(0.25)
    ;(statisticsInstance.getMultiStatReport as jest.Mock).mockReturnValue({
      allVals: [0.1, 0.2, 0.3],
      min: 0.1,
      max: 0.3,
      avg: 0.2
    })

    // Mock os.cpus()
    const mockCpuData = [
      {
        times: {
          user: 100,
          nice: 0,
          sys: 50,
          idle: 850,
          irq: 0
        }
      },
      {
        times: {
          user: 200,
          nice: 0,
          sys: 100,
          idle: 700,
          irq: 0
        }
      }
    ]
    ;(os.cpus as jest.Mock).mockReturnValue(mockCpuData)

    // Mock process.memoryUsage()
    originalMemoryUsage = process.memoryUsage
    process.memoryUsage = jest.fn().mockReturnValue({
      rss: 100000000,
      heapTotal: 80000000,
      heapUsed: 60000000,
      external: 5000000,
      arrayBuffers: 2000000
    }) as any

    // Mock process.resourceUsage()
    ;(resourceUsage as jest.Mock).mockReturnValue({
      userCPUTime: 1000,
      systemCPUTime: 500,
      maxRSS: 200000,
      sharedMemorySize: 0,
      unsharedDataSize: 0,
      unsharedStackSize: 0,
      minorPageFault: 10,
      majorPageFault: 1,
      swappedOut: 0,
      fsRead: 100,
      fsWrite: 50,
      ipcSent: 0,
      ipcReceived: 0,
      signalsCount: 0,
      voluntaryContextSwitches: 20,
      involuntaryContextSwitches: 5
    })

    // Create instance
    memoryReporting = new MemoryReporting(mockServer)
  })

  afterEach(() => {
    // Restore original functions
    process.memoryUsage = originalMemoryUsage
  })

  describe('constructor', () => {
    it('should initialize with empty report array', () => {
      expect(memoryReporting.report).toEqual([])
    })

    it('should store server instance', () => {
      expect(memoryReporting.server).toBe(mockServer)
    })

    it('should initialize CPU times', () => {
      expect(memoryReporting.lastCPUTimes).toBeDefined()
      expect(memoryReporting.lastCPUTimes).toHaveLength(2)
    })
  })

  describe('setMemoryReportingInstance', () => {
    it('should set the global memory reporting instance', () => {
      setMemoryReportingInstance(memoryReporting)
      expect(memoryReportingInstance).toBe(memoryReporting)
    })
  })

  describe('registerEndpoints', () => {
    it('should register all endpoints', () => {
      memoryReporting.registerEndpoints()
      
      expect(mockServer.get).toHaveBeenCalledTimes(3)
      expect(mockServer.get).toHaveBeenCalledWith(
        '/memory',
        expect.any(Object),
        expect.any(Function)
      )
      expect(mockServer.get).toHaveBeenCalledWith(
        '/top',
        expect.any(Object),
        expect.any(Function)
      )
      expect(mockServer.get).toHaveBeenCalledWith(
        '/df',
        expect.any(Object),
        expect.any(Function)
      )
    })

    describe('/memory endpoint', () => {
      it('should return memory report', () => {
        memoryReporting.registerEndpoints()
        
        // Get the handler
        const memoryCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/memory'
        )
        const handler = memoryCall[2]

        // Call the handler
        handler(mockRequest, mockReply)

        // Check response
        const sentData = (mockReply.send as jest.Mock).mock.calls[0][0]
        expect(sentData).toContain('System Memory Report')
        expect(sentData).toContain('rss:')
        expect(sentData).toContain('heapTotal:')
        expect(sentData).toContain('heapUsed:')
        expect(sentData).toContain('external:')
        expect(sentData).toContain('arrayBuffers:')
      })

      it('should include gathered report data', () => {
        memoryReporting.registerEndpoints()
        
        const memoryCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/memory'
        )
        const handler = memoryCall[2]

        handler(mockRequest, mockReply)

        const sentData = (mockReply.send as jest.Mock).mock.calls[0][0]
        expect(sentData).toContain('numActiveNodes')
        expect(sentData).toContain('cpuPercent')
        expect(sentData).toContain('cpuAVGPercent')
      })
    })

    describe('/top endpoint', () => {
      it('should spawn top command and send output', () => {
        const mockStdout = {
          on: jest.fn()
        }
        const mockStderr = {
          on: jest.fn()
        }
        const mockTopProcess = {
          stdout: mockStdout,
          stderr: mockStderr,
          on: jest.fn(),
          kill: jest.fn()
        }
        
        ;(spawn as jest.Mock).mockReturnValue(mockTopProcess)

        memoryReporting.registerEndpoints()
        
        const topCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/top'
        )
        const handler = topCall[2]

        handler(mockRequest, mockReply)

        expect(spawn).toHaveBeenCalledWith('top', ['-n', '10'])
        expect(mockStdout.on).toHaveBeenCalledWith('data', expect.any(Function))
        expect(mockStderr.on).toHaveBeenCalledWith('data', expect.any(Function))
        expect(mockTopProcess.on).toHaveBeenCalledWith('close', expect.any(Function))
      })

      it('should handle top command output', () => {
        const mockStdout = {
          on: jest.fn()
        }
        const mockTopProcess = {
          stdout: mockStdout,
          stderr: { on: jest.fn() },
          on: jest.fn(),
          kill: jest.fn()
        }
        
        ;(spawn as jest.Mock).mockReturnValue(mockTopProcess)

        memoryReporting.registerEndpoints()
        
        const topCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/top'
        )
        const handler = topCall[2]

        handler(mockRequest, mockReply)

        // Simulate data from top
        const dataHandler = mockStdout.on.mock.calls[0][1]
        const testData = Buffer.from('top output data')
        dataHandler(testData)

        expect(mockReply.send).toHaveBeenCalledWith('top output data')
        expect(mockTopProcess.kill).toHaveBeenCalled()
      })

      it('should handle top command error', () => {
        const mockStderr = {
          on: jest.fn()
        }
        const mockTopProcess = {
          stdout: { on: jest.fn() },
          stderr: mockStderr,
          on: jest.fn(),
          kill: jest.fn()
        }
        
        ;(spawn as jest.Mock).mockReturnValue(mockTopProcess)

        memoryReporting.registerEndpoints()
        
        const topCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/top'
        )
        const handler = topCall[2]

        handler(mockRequest, mockReply)

        // Simulate error
        const errorHandler = mockStderr.on.mock.calls[0][1]
        errorHandler('error data')

        expect(mockReply.send).toHaveBeenCalledWith('top command error')
        expect(mockTopProcess.kill).toHaveBeenCalled()
      })
    })

    describe('/df endpoint', () => {
      it('should spawn df command and send output', () => {
        const mockStdout = {
          on: jest.fn()
        }
        const mockDfProcess = {
          stdout: mockStdout,
          stderr: { on: jest.fn() },
          on: jest.fn(),
          kill: jest.fn()
        }
        
        ;(spawn as jest.Mock).mockReturnValue(mockDfProcess)

        memoryReporting.registerEndpoints()
        
        const dfCall = (mockServer.get as jest.Mock).mock.calls.find(
          call => call[0] === '/df'
        )
        const handler = dfCall[2]

        handler(mockRequest, mockReply)

        expect(spawn).toHaveBeenCalledWith('df')
        
        // Simulate data
        const dataHandler = mockStdout.on.mock.calls[0][1]
        dataHandler(Buffer.from('df output'))

        expect(mockReply.send).toHaveBeenCalledWith('df output')
        expect(mockDfProcess.kill).toHaveBeenCalled()
      })
    })
  })

  describe('updateCpuPercent', () => {
    it('should calculate CPU percent and update statistics', () => {
      setMemoryReportingInstance(memoryReporting)
      
      // Update CPU times to create a delta
      const newCpuData = [
        {
          times: {
            user: 150,
            nice: 0,
            sys: 75,
            idle: 875,
            irq: 0
          }
        },
        {
          times: {
            user: 250,
            nice: 0,
            sys: 125,
            idle: 725,
            irq: 0
          }
        }
      ]
      ;(os.cpus as jest.Mock).mockReturnValue(newCpuData)

      memoryReporting.updateCpuPercent()

      expect(statisticsInstance.setManualStat).toHaveBeenCalledWith(
        'cpuPercent',
        expect.any(Number)
      )
    })
  })

  describe('addToReport', () => {
    it('should add item to report', () => {
      memoryReporting.addToReport('TestCat', 'TestSub', 'testKey', 100)
      
      expect(memoryReporting.report).toHaveLength(1)
      expect(memoryReporting.report[0]).toEqual({
        category: 'TestCat',
        subcat: 'TestSub',
        itemKey: 'testKey',
        count: 100
      })
    })
  })

  describe('reportToStream', () => {
    it('should format report items correctly', () => {
      const report = [
        { category: 'Cat1', subcat: 'Sub1', itemKey: 'key1', count: 100 },
        { category: 'Cat2', subcat: 'Sub2', itemKey: 'cpuPercent', count: 25.5 },
        { category: 'Cat3', subcat: 'Sub3', itemKey: 'cpuAVGPercent', count: 30.2 }
      ]

      const result = memoryReporting.reportToStream(report, 'Header\n')

      expect(result).toContain('Header\n')
      expect(result).toContain('       100 Cat1 Sub1 key1')
      expect(result).toContain('    25.5 % Cat2 Sub2 cpuPercent')
      expect(result).toContain('    30.2 % Cat3 Sub3 cpuAVGPercent')
    })
  })

  describe('gatherReport', () => {
    it('should reset report and gather new data', () => {
      // Add some initial data
      memoryReporting.report = [{ category: 'old', subcat: 'data', itemKey: 'key', count: 1 }]

      memoryReporting.gatherReport()

      // Should have new data, not old
      expect(memoryReporting.report.length).toBeGreaterThan(0)
      expect(memoryReporting.report.find(item => item.category === 'old')).toBeUndefined()
      expect(memoryReporting.report.find(item => item.category === 'P2P')).toBeDefined()
      expect(memoryReporting.report.find(item => item.category === 'Process')).toBeDefined()
    })
  })

  describe('getCPUTimes', () => {
    it('should return CPU times with totals', () => {
      const times = memoryReporting.getCPUTimes()

      expect(times).toHaveLength(2)
      expect(times[0]).toHaveProperty('user', 100)
      expect(times[0]).toHaveProperty('sys', 50)
      expect(times[0]).toHaveProperty('idle', 850)
      expect(times[0]).toHaveProperty('total', 1000)
      expect(times[1]).toHaveProperty('total', 1000)
    })
  })

  describe('cpuPercent', () => {
    it('should calculate CPU usage percentage', () => {
      // Update CPU data to simulate time passing
      const newCpuData = [
        {
          times: {
            user: 200,
            nice: 0,
            sys: 100,
            idle: 900,
            irq: 0
          }
        },
        {
          times: {
            user: 300,
            nice: 10,
            sys: 150,
            idle: 740,
            irq: 0
          }
        }
      ]
      ;(os.cpus as jest.Mock).mockReturnValue(newCpuData)

      const percent = memoryReporting.cpuPercent()

      expect(percent).toBeGreaterThanOrEqual(0)
      expect(percent).toBeLessThanOrEqual(1)
    })

    it('should handle no CPU usage', () => {
      // Same CPU data means no usage
      const percent = memoryReporting.cpuPercent()

      expect(percent).toBe(0)
    })
  })

  describe('roundTo3decimals', () => {
    it('should round numbers to 3 decimal places', () => {
      expect(memoryReporting.roundTo3decimals(1.23456)).toBe(1.235)
      expect(memoryReporting.roundTo3decimals(1.2344)).toBe(1.234)
      expect(memoryReporting.roundTo3decimals(1.2)).toBe(1.2)
      expect(memoryReporting.roundTo3decimals(0)).toBe(0)
      expect(memoryReporting.roundTo3decimals(-1.2345)).toBe(-1.234)
    })
  })

  describe('stateReport', () => {
    it('should add active nodes to report', () => {
      memoryReporting.stateReport()

      expect(memoryReporting.report).toHaveLength(1)
      expect(memoryReporting.report[0]).toEqual({
        category: 'P2P',
        subcat: 'Nodelist',
        itemKey: 'numActiveNodes',
        count: 10
      })
    })
  })

  describe('systemProcessReport', () => {
    it('should add CPU and resource usage to report', () => {
      memoryReporting.systemProcessReport()

      // Should have multiple entries
      expect(memoryReporting.report.length).toBeGreaterThan(3)

      // Check CPU percent
      const cpuPercent = memoryReporting.report.find(
        item => item.itemKey === 'cpuPercent'
      )
      expect(cpuPercent).toBeDefined()
      expect(cpuPercent?.category).toBe('Process')
      expect(cpuPercent?.subcat).toBe('CPU')

      // Check CPU average
      const cpuAvg = memoryReporting.report.find(
        item => item.itemKey === 'cpuAVGPercent'
      )
      expect(cpuAvg).toBeDefined()
      expect(cpuAvg?.count).toBe(25) // 0.25 * 100

      // Check resource usage entries
      const userCPUTime = memoryReporting.report.find(
        item => item.itemKey === 'userCPUTime'
      )
      expect(userCPUTime).toBeDefined()
      expect(userCPUTime?.count).toBe(1000)
    })

    it('should format multi-stat report correctly', () => {
      memoryReporting.systemProcessReport()

      const cpuMultiStat = memoryReporting.report.find(
        item => item.itemKey.startsWith('cpu: ')
      )
      expect(cpuMultiStat).toBeDefined()
      expect(cpuMultiStat?.itemKey).toContain('"allVals":[10,20,30]')
      expect(cpuMultiStat?.itemKey).toContain('"min":10')
      expect(cpuMultiStat?.itemKey).toContain('"max":30')
      expect(cpuMultiStat?.itemKey).toContain('"avg":20')
    })
  })
})