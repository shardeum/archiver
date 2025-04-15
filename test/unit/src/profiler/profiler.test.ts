import * as fastify from 'fastify'
import Profiler, { profilerInstance, setProfilerInstance } from '../../../../src/profiler/profiler'
import { nestedCountersInstance } from '../../../../src/profiler/nestedCounters'

// Mock nestedCountersInstance
jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn(),
  },
}))

// Mock isDebugMiddleware
jest.mock('../../../../src/DebugMode', () => ({
  isDebugMiddleware: jest.fn().mockImplementation((req, res) => true),
}))

describe('Profiler', () => {
  let mockServer: any
  let profiler: Profiler

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()

    // Create a mock server
    mockServer = {
      get: jest.fn().mockReturnThis(),
    } as unknown as fastify.FastifyInstance

    // Create a new Profiler instance
    profiler = new Profiler(mockServer)
  })

  describe('constructor', () => {
    it('should initialize properties correctly', () => {
      expect(profiler.sectionTimes).toEqual(expect.any(Object))
      expect(profiler.eventCounters).toBeInstanceOf(Map)
      expect(profiler.stackHeight).toBe(0)
      expect(profiler.netInternalStackHeight).toBe(0)
      expect(profiler.netExternalStackHeight).toBe(0)
      expect(profiler.server).toBe(mockServer)

      // Verify that _total and _internal_total sections are started
      expect(profiler.sectionTimes['_total']).toBeDefined()
      expect(profiler.sectionTimes['_internal_total']).toBeDefined()
    })
  })

  describe('registerEndpoints', () => {
    it('should register the /perf endpoint', () => {
      profiler.registerEndpoints()

      expect(mockServer.get).toHaveBeenCalledWith(
        '/perf',
        expect.objectContaining({
          preHandler: expect.any(Function),
        }),
        expect.any(Function)
      )
    })
  })

  describe('profileSectionStart', () => {
    it('should create and start a new section', () => {
      profiler.profileSectionStart('test-section')

      expect(profiler.sectionTimes['test-section']).toBeDefined()
      expect(profiler.sectionTimes['test-section'].started).toBe(true)
      expect(profiler.sectionTimes['test-section'].c).toBe(1)
      expect(profiler.sectionTimes['test-section'].internal).toBe(false)
      expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('profiler', 'test-section')
    })

    it('should increment the stack height for non-internal sections', () => {
      expect(profiler.stackHeight).toBe(0)

      profiler.profileSectionStart('test-section')

      expect(profiler.stackHeight).toBe(1)
    })

    it('should start _totalBusy sections when stack height becomes 1', () => {
      profiler.profileSectionStart('test-section')

      expect(profiler.sectionTimes['_totalBusy']).toBeDefined()
      expect(profiler.sectionTimes['_internal_totalBusy']).toBeDefined()
    })

    it('should not start _totalBusy sections again if already started', () => {
      profiler.profileSectionStart('test-section')
      profiler.sectionTimes['_totalBusy'].c = 1
      profiler.sectionTimes['_internal_totalBusy'].c = 1

      // Reset to track new calls
      jest.clearAllMocks()

      profiler.profileSectionStart('another-section')

      expect(profiler.sectionTimes['_totalBusy'].c).toBe(1)
      expect(profiler.sectionTimes['_internal_totalBusy'].c).toBe(1)
    })

    it('should handle net-internl sections correctly', () => {
      profiler.profileSectionStart('net-internl')

      expect(profiler.netInternalStackHeight).toBe(1)
      expect(profiler.sectionTimes['_internal_net-internl']).toBeDefined()
    })

    it('should handle net-externl sections correctly', () => {
      profiler.profileSectionStart('net-externl')

      expect(profiler.netExternalStackHeight).toBe(1)
      expect(profiler.sectionTimes['_internal_net-externl']).toBeDefined()
    })

    it('should not start a section that has already been started', () => {
      profiler.profileSectionStart('test-section')

      // Mark as already started
      profiler.sectionTimes['test-section'].started = true

      // Reset to track new calls
      jest.clearAllMocks()

      profiler.profileSectionStart('test-section')

      // Should not increment counter again
      expect(profiler.sectionTimes['test-section'].c).toBe(1)
    })
  })

  describe('profileSectionEnd', () => {
    beforeEach(() => {
      // Setup by starting a section
      profiler.profileSectionStart('test-section')
    })

    it('should end a section correctly', () => {
      profiler.profileSectionEnd('test-section')

      expect(profiler.sectionTimes['test-section'].started).toBe(false)
      expect(profiler.sectionTimes['test-section'].end).toBeDefined()
      expect(profiler.sectionTimes['test-section'].total).toBeGreaterThanOrEqual(BigInt(0))
    })

    it('should decrement stack height for non-internal sections', () => {
      expect(profiler.stackHeight).toBe(1)

      profiler.profileSectionEnd('test-section')

      expect(profiler.stackHeight).toBe(0)
    })

    it('should end _totalBusy sections when stack height becomes 0', () => {
      profiler.profileSectionEnd('test-section')

      expect(profiler.sectionTimes['_totalBusy'].started).toBe(false)
      expect(profiler.sectionTimes['_internal_totalBusy'].started).toBe(false)
    })

    it('should handle net-internl sections correctly', () => {
      profiler.profileSectionStart('net-internl')
      expect(profiler.netInternalStackHeight).toBe(1)

      profiler.profileSectionEnd('net-internl')

      expect(profiler.netInternalStackHeight).toBe(0)
      expect(profiler.sectionTimes['_internal_net-internl'].started).toBe(false)
    })

    it('should handle net-externl sections correctly', () => {
      profiler.profileSectionStart('net-externl')
      expect(profiler.netExternalStackHeight).toBe(1)

      profiler.profileSectionEnd('net-externl')

      expect(profiler.netExternalStackHeight).toBe(0)
      expect(profiler.sectionTimes['_internal_net-externl'].started).toBe(false)
    })

    it('should do nothing if section does not exist', () => {
      profiler.profileSectionEnd('non-existent-section')
      // Should not throw an error
    })

    it('should do nothing if section is not started', () => {
      profiler.sectionTimes['test-section'].started = false

      profiler.profileSectionEnd('test-section')

      // Should not throw an error or modify the section
      expect(profiler.sectionTimes['test-section'].end).toBeUndefined()
    })
  })

  describe('clearTimes', () => {
    beforeEach(() => {
      // Setup by starting and ending a section
      profiler.profileSectionStart('test-section')
      profiler.profileSectionEnd('test-section')

      // Add an internal section
      profiler.profileSectionStart('_internal_test', true)
      profiler.profileSectionEnd('_internal_test', true)
    })

    it('should clear non-internal section times', () => {
      // Make sure section has some time recorded
      expect(profiler.sectionTimes['test-section'].total).toBeGreaterThanOrEqual(BigInt(0))

      profiler.clearTimes()

      expect(profiler.sectionTimes['test-section'].total).toBe(BigInt(0))
    })

    it('should not clear internal section times', () => {
      // Make sure internal section has some time recorded
      const originalTotal = profiler.sectionTimes['_internal_test'].total

      profiler.clearTimes()

      // Internal section time should be unchanged
      expect(profiler.sectionTimes['_internal_test'].total).toBe(originalTotal)
    })
  })

  describe('printAndClearReport', () => {
    beforeEach(() => {
      // Setup by starting and ending a section
      profiler.profileSectionStart('test-section')
      profiler.profileSectionEnd('test-section')

      // Start _total section which gets ended in printAndClearReport
      profiler.profileSectionStart('_total', true)

      // Mock console.log to prevent test output
      jest.spyOn(console, 'log').mockImplementation()
    })

    it('should generate a report with section times', () => {
      const report = profiler.printAndClearReport()

      expect(report).toContain('Profile Sections:')
      expect(report).toContain('test-section')
    })

    it('should restart the _total section after report generation', () => {
      profiler.printAndClearReport()

      expect(profiler.sectionTimes['_total'].started).toBe(true)
    })

    it('should sort sections by total time', () => {
      // Add another section with a different time
      profiler.profileSectionStart('fast-section')
      profiler.profileSectionEnd('fast-section')

      // Set different total times manually
      profiler.sectionTimes['test-section'].total = BigInt(1000000000) // 1 second
      profiler.sectionTimes['fast-section'].total = BigInt(500000000) // 0.5 seconds

      const report = profiler.printAndClearReport()

      // The slower section (test-section) should appear before the faster section
      const testSectionIndex = report.indexOf('test-section')
      const fastSectionIndex = report.indexOf('fast-section')

      expect(testSectionIndex).toBeLessThan(fastSectionIndex)
    })
  })

  describe('setProfilerInstance', () => {
    it('should set the global profiler instance', () => {
      setProfilerInstance(profiler)

      expect(profilerInstance).toBe(profiler)
    })
  })
})
