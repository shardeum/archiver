import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'
import Statistics, { statisticsInstance } from '../../../../src/statistics/index'
import * as fs from 'fs'
import * as path from 'path'
import { Readable } from 'stream'
import { EventEmitter } from 'events'
import { nestedCountersInstance } from '../../../../src/profiler/nestedCounters'
import * as utils from '../../../../src/Utils'

// Mock dependencies
jest.mock('fs')
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
}))
jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn(),
  },
}))

jest.mock('../../../../src/Utils', () => ({
  insertSorted: jest.fn((arr: any[], value: any, compareFn: (a: any, b: any) => number) => {
    arr.push(value)
    arr.sort(compareFn)
  }),
  computeMedian: jest.fn((arr: any[]) => {
    if (arr.length === 0) return 0
    const mid = Math.floor(arr.length / 2)
    return arr.length % 2 !== 0 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2
  }),
}))

describe('statistics/index', () => {
  let stats: Statistics
  let mockConfig: any
  let mockContext: any
  let consoleLogSpy: any
  let setIntervalSpy: any
  let clearIntervalSpy: any
  let mockWriteStream: any

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()
    jest.useFakeTimers()

    // Setup console spy
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

    // Setup interval spies
    setIntervalSpy = jest.spyOn(global, 'setInterval')
    clearIntervalSpy = jest.spyOn(global, 'clearInterval')

    // Mock fs.createWriteStream
    mockWriteStream = {
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    }
    ;(fs.createWriteStream as jest.Mock).mockReturnValue(mockWriteStream)

    // Default config
    mockConfig = {
      interval: 1, // 1 second
      save: false,
    }

    // Default context
    mockContext = { appName: 'test-app' }
  })

  afterEach(() => {
    // Clean up statistics instance
    if (stats && stats.interval) {
      stats.stopSnapshots()
    }

    consoleLogSpy.mockRestore()
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
    jest.useRealTimers()
  })

  describe('constructor', () => {
    it('should create a Statistics instance with default configuration', () => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['testCounter'],
          watchers: { testWatcher: () => 42 },
          timers: ['testTimer'],
          manualStats: ['testManual'],
        },
        mockContext
      )

      expect(stats).toBeInstanceOf(Statistics)
      expect(stats).toBeInstanceOf(EventEmitter)
      expect(stats.intervalDuration).toBe(1000)
      expect(stats.context).toBe(mockContext)
      expect(statisticsInstance).toBe(stats)
    })

    it('should save statistics to file when config.save is true', () => {
      mockConfig.save = true

      // Mock the stream's pipe method
      const mockPipe = jest.fn()
      const getStreamSpy = jest.spyOn(Statistics.prototype, 'getStream').mockReturnValue({
        pipe: mockPipe,
        _read: jest.fn(),
        push: jest.fn(),
      } as any)

      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )

      expect(fs.createWriteStream).toHaveBeenCalledWith('/test/base/dir/statistics.tsv')
      expect(mockPipe).toHaveBeenCalledWith(mockWriteStream)

      // Restore the mock
      getStreamSpy.mockRestore()
    })

    it('should use default interval when not specified', () => {
      delete mockConfig.interval

      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )

      expect(stats.intervalDuration).toBe(1000) // Default 1 second
    })
  })

  describe('counters', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['requests', 'errors'],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should increment counter', () => {
      stats.incrementCounter('requests')

      expect(stats.getCurrentCount('requests')).toBe(1)
      expect(stats.getCounterTotal('requests')).toBe(1)
      expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('statistics', 'requests')
    })

    it('should track total across snapshots', () => {
      stats.incrementCounter('requests')
      stats.incrementCounter('requests')

      // Take snapshot
      stats.counters['requests'].snapshot()

      stats.incrementCounter('requests')

      expect(stats.getCurrentCount('requests')).toBe(1)
      expect(stats.getCounterTotal('requests')).toBe(3)
    })

    it('should throw error for undefined counter', () => {
      expect(() => stats.incrementCounter('nonexistent')).toThrow("Counter 'nonexistent' is undefined.")
      expect(() => stats.getCurrentCount('nonexistent')).toThrow("Counter 'nonexistent' is undefined.")
      expect(() => stats.getCounterTotal('nonexistent')).toThrow("Counter 'nonexistent' is undefined.")
    })
  })

  describe('watchers', () => {
    let watcherValue: number

    beforeEach(() => {
      watcherValue = 42
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {
            cpuUsage: function () {
              return watcherValue
            },
            memoryUsage: function () {
              return this.appName === 'test-app' ? 100 : 200
            },
          },
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should get watcher value', () => {
      expect(stats.getWatcherValue('cpuUsage')).toBe(42)
    })

    it('should bind watcher function to context', () => {
      expect(stats.getWatcherValue('memoryUsage')).toBe(100)
    })

    it('should update watcher value on snapshot', () => {
      watcherValue = 84
      stats.watchers['cpuUsage'].snapshot()

      expect(stats.watchers['cpuUsage'].ring.previous()).toBe(84)
    })

    it('should throw error for undefined watcher', () => {
      expect(() => stats.getWatcherValue('nonexistent')).toThrow("Watcher 'nonexistent' is undefined.")
    })
  })

  describe('timers', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: ['processTime', 'requestTime'],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should start and stop timer', () => {
      const now = Date.now()
      jest.spyOn(Date, 'now').mockReturnValue(now)

      stats.startTimer('processTime', 'task1')
      expect(stats.timers['processTime'].ids['task1']).toBe(now)

      stats.stopTimer('processTime', 'task1')
      expect(stats.timers['processTime'].ids['task1']).toBeUndefined()
    })

    it('should not duplicate timer start', () => {
      const now = Date.now()
      jest
        .spyOn(Date, 'now')
        .mockReturnValueOnce(now)
        .mockReturnValueOnce(now + 1000)

      stats.startTimer('processTime', 'task1')
      stats.startTimer('processTime', 'task1') // Should not update

      expect(stats.timers['processTime'].ids['task1']).toBe(now)
    })

    it('should calculate median duration on snapshot', () => {
      const now = 1000
      const dateSpy = jest.spyOn(Date, 'now')

      // Set initial times for starting tasks
      dateSpy.mockReturnValueOnce(now) // start task1
      dateSpy.mockReturnValueOnce(now + 100) // start task2
      dateSpy.mockReturnValueOnce(now + 200) // start task3

      stats.startTimer('processTime', 'task1')
      stats.startTimer('processTime', 'task2')
      stats.startTimer('processTime', 'task3')

      // Set time for snapshot calculation
      dateSpy.mockReturnValue(now + 1000)

      stats.timers['processTime'].snapshot()

      // Durations: task1=1000ms, task2=900ms, task3=800ms
      // Sorted: [800, 900, 1000], median = 900
      expect(stats.timers['processTime'].ring.previous()).toBe(900)

      dateSpy.mockRestore()
    })

    it('should throw error for undefined timer', () => {
      expect(() => stats.startTimer('nonexistent', 'id')).toThrow("Timer 'nonexistent' is undefined.")
      expect(() => stats.stopTimer('nonexistent', 'id')).toThrow("Timer 'nonexistent' is undefined.")
    })
  })

  describe('manual stats', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: ['cacheSize', 'queueLength'],
        },
        mockContext
      )
    })

    it('should set manual stat value', () => {
      stats.setManualStat('cacheSize', 1024)

      expect(stats.manualStats['cacheSize'].ring.previous()).toBe(1024)
    })

    it('should update manual stat value', () => {
      stats.setManualStat('cacheSize', 1024)
      stats.setManualStat('cacheSize', 2048)

      expect(stats.manualStats['cacheSize'].ring.previous()).toBe(2048)
    })

    it('should throw error for undefined manual stat', () => {
      expect(() => stats.setManualStat('nonexistent', 100)).toThrow("manualStat 'nonexistent' is undefined.")
    })
  })

  describe('snapshots', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['requests'],
          watchers: { memory: () => 100 },
          timers: ['processTime'],
          manualStats: ['cacheSize'],
        },
        mockContext
      )
    })

    it('should start snapshots and set interval', () => {
      stats.startSnapshots()

      expect(consoleLogSpy).toHaveBeenCalledWith('Starting statistics snapshots...')
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
      expect(stats.interval).toBeTruthy()
    })

    it('should not set duplicate intervals', () => {
      stats.startSnapshots()
      const firstInterval = stats.interval

      stats.startSnapshots()

      expect(stats.interval).toBe(firstInterval)
      expect(setIntervalSpy).toHaveBeenCalledTimes(1)
    })

    it('should stop snapshots and clear interval', () => {
      stats.startSnapshots()
      const interval = stats.interval

      stats.stopSnapshots()

      expect(clearIntervalSpy).toHaveBeenCalledWith(interval)
      expect(stats.interval).toBeNull()
    })

    it('should emit snapshot event', () => {
      const snapshotListener = jest.fn()
      stats.on('snapshot', snapshotListener)

      stats.startSnapshots()
      jest.advanceTimersByTime(1000)

      expect(snapshotListener).toHaveBeenCalled()
    })

    it('should write TSV header when starting snapshots', () => {
      stats.getStream()
      stats.streamIsPushable = true
      const pushSpy = jest.spyOn(stats.stream!, 'push')

      stats.startSnapshots()

      expect(pushSpy).toHaveBeenCalledWith('Name\tValue\tTime\n')
    })

    it('should include all stat types in snapshot', () => {
      // Setup some data
      stats.incrementCounter('requests')
      stats.setManualStat('cacheSize', 512)

      const now = Date.now()
      jest.spyOn(Date, 'now').mockReturnValue(now)
      stats.startTimer('processTime', 'task1')

      jest.spyOn(Date, 'now').mockReturnValue(now + 500)

      // Mock stream
      stats.getStream()
      stats.streamIsPushable = true
      const pushSpy = jest.spyOn(stats.stream!, 'push')

      // Take snapshot
      stats._takeSnapshot()

      const lastCall = pushSpy.mock.calls[pushSpy.mock.calls.length - 1][0] as string
      expect(lastCall).toContain('requests-average')
      expect(lastCall).toContain('requests-total')
      expect(lastCall).toContain('memory-average')
      expect(lastCall).toContain('memory-value')
      expect(lastCall).toContain('processTime-average')
    })
  })

  describe('stream functionality', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should create readable stream', () => {
      const stream = stats.getStream()

      expect(stream).toBeInstanceOf(Readable)
      expect(stats.stream).toBe(stream)
    })

    it('should set streamIsPushable when _read is called', () => {
      const stream = stats.getStream()

      expect(stats.streamIsPushable).toBe(false)

      stream._read(0)

      expect(stats.streamIsPushable).toBe(true)
    })

    it('should push data to stream when pushable', () => {
      const stream = stats.getStream()
      const pushSpy = jest.spyOn(stream, 'push').mockReturnValue(true)
      stats.streamIsPushable = true

      stats._pushToStream('test data')

      expect(pushSpy).toHaveBeenCalledWith('test data')
    })

    it('should update streamIsPushable based on push result', () => {
      const stream = stats.getStream()
      jest.spyOn(stream, 'push').mockReturnValue(false)
      stats.streamIsPushable = true

      stats._pushToStream('test data')

      expect(stats.streamIsPushable).toBe(false)
    })
  })

  describe('writeOnSnapshot', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should add custom write function', () => {
      const customContext = { value: 42 }
      const writeFn = function () {
        return `custom\t${this.value}\t${new Date().toISOString()}\n`
      }

      stats.writeOnSnapshot(writeFn, customContext)

      expect(stats.snapshotWriteFns).toHaveLength(1)
    })

    it('should call custom write functions during snapshot', () => {
      const customWriteFn = jest.fn(() => 'custom-data\n')
      stats.snapshotWriteFns.push(customWriteFn)

      stats.getStream()
      stats.streamIsPushable = true
      const pushSpy = jest.spyOn(stats.stream!, 'push')

      stats._takeSnapshot()

      expect(customWriteFn).toHaveBeenCalled()
      const lastCall = pushSpy.mock.calls[pushSpy.mock.calls.length - 1][0] as string
      expect(lastCall).toContain('custom-data')
    })
  })

  describe('average calculations', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['requests'],
          watchers: { memory: () => 100 },
          timers: ['processTime'],
          manualStats: ['cacheSize'],
        },
        mockContext
      )
    })

    it('should calculate counter average', () => {
      // Increment counter and take snapshots
      stats.incrementCounter('requests')
      stats.incrementCounter('requests')
      stats.counters['requests'].snapshot()

      stats.incrementCounter('requests')
      stats.incrementCounter('requests')
      stats.incrementCounter('requests')
      stats.counters['requests'].snapshot()

      const avg = stats.getAverage('requests')
      expect(avg).toBe(2.5) // (2 + 3) / 2
    })

    it('should get previous element', () => {
      stats.incrementCounter('requests')
      stats.counters['requests'].snapshot()

      expect(stats.getPreviousElement('requests')).toBe(1)
    })

    it('should throw error for undefined ring holder', () => {
      expect(() => stats.getAverage('nonexistent')).toThrow("Cannot read properties of undefined (reading 'ring')")
      expect(() => stats.getPreviousElement('nonexistent')).toThrow(
        "Cannot read properties of undefined (reading 'ring')"
      )
    })
  })

  describe('multiStatReport', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['requests'],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should return multi stat report', () => {
      // Add some data points
      for (let i = 1; i <= 5; i++) {
        for (let j = 0; j < i; j++) {
          stats.incrementCounter('requests')
        }
        stats.counters['requests'].snapshot()
      }

      const report = stats.getMultiStatReport('requests')

      expect(report.min).toBe(1)
      expect(report.max).toBe(5)
      expect(report.avg).toBe(3) // (1+2+3+4+5)/5
      expect(report.allVals).toEqual([1, 2, 3, 4, 5])
    })

    it('should handle empty data', () => {
      const report = stats.getMultiStatReport('requests')

      expect(report.min).toBe(Number.MAX_VALUE)
      expect(report.max).toBe(Number.MIN_VALUE)
      expect(report.avg).toBe(0)
      expect(report.allVals).toEqual([])
    })
  })

  describe('Ring class edge cases', () => {
    beforeEach(() => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: ['test'],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )
    })

    it('should handle ring wraparound', () => {
      const counter = stats.counters['test']

      // Fill the ring (60 elements)
      for (let i = 0; i < 65; i++) {
        counter.count = i
        counter.snapshot()
      }

      // The ring should wrap around and contain values 5-64
      const report = stats.getMultiStatReport('test')
      expect(report.allVals).toHaveLength(60)
      expect(report.min).toBe(5)
      expect(report.max).toBe(64)
    })

    it('should handle previous() at ring boundary', () => {
      const counter = stats.counters['test']
      counter.ring.index = 0
      counter.ring.elements[59] = 99 // Last element

      expect(counter.ring.previous()).toBe(99)
    })
  })

  describe('error scenarios', () => {
    it('should handle missing timer stop gracefully', () => {
      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: ['test'],
          manualStats: [],
        },
        mockContext
      )

      // Stop a timer that was never started
      expect(() => stats.stopTimer('test', 'nonexistent')).not.toThrow()
    })

    it('should handle watcher function errors', () => {
      const errorWatcher = jest.fn(() => {
        throw new Error('Watcher error')
      })

      stats = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: { errorWatcher },
          timers: [],
          manualStats: [],
        },
        mockContext
      )

      expect(() => stats.getWatcherValue('errorWatcher')).toThrow('Watcher error')
    })
  })

  describe('singleton pattern', () => {
    it('should set global statisticsInstance', () => {
      const stats1 = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )

      expect(statisticsInstance).toBe(stats1)

      const stats2 = new Statistics(
        '/test/base/dir',
        mockConfig,
        {
          counters: [],
          watchers: {},
          timers: [],
          manualStats: [],
        },
        mockContext
      )

      expect(statisticsInstance).toBe(stats2)
      expect(statisticsInstance).not.toBe(stats1)
    })
  })
})
