import { logEnvSetup } from '../../../../src/utils/environment'

// Mock the nestedCounters module
jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn(),
  },
}))

// Get the mocked instance after the mock is set up
import { nestedCountersInstance } from '../../../../src/profiler/nestedCounters'

describe('environment', () => {
  let consoleLogSpy: jest.SpyInstance
  let originalEnv: string | undefined

  beforeEach(() => {
    jest.clearAllMocks()
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    originalEnv = process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    if (originalEnv === undefined) {
      delete process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS
    } else {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = originalEnv
    }
  })

  describe('logEnvSetup', () => {
    it('should log LOAD_JSON_GENESIS_SECURE_ACCOUNTS when it exists', () => {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = 'test-value'

      logEnvSetup()

      expect(consoleLogSpy).toHaveBeenCalledWith('LOAD_JSON_GENESIS_SECURE_ACCOUNTS', 'test-value')
    })

    it('should log undefined when LOAD_JSON_GENESIS_SECURE_ACCOUNTS does not exist', () => {
      delete process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS

      logEnvSetup()

      expect(consoleLogSpy).toHaveBeenCalledWith('LOAD_JSON_GENESIS_SECURE_ACCOUNTS', undefined)
    })

    it('should count event when nestedCountersInstance is not null', () => {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = 'test-value'

      logEnvSetup()

      expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith(
        'env',
        'LOAD_JSON_GENESIS_SECURE_ACCOUNTS test-value'
      )
    })

    it('should handle nestedCountersInstance being null', () => {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = 'test-value'

      // Temporarily mock the module to return null
      jest.doMock('../../../../src/profiler/nestedCounters', () => ({
        nestedCountersInstance: null,
      }))

      // Re-import the function to get the version with null nestedCountersInstance
      jest.resetModules()
      const { logEnvSetup: logEnvSetupWithNull } = require('../../../../src/utils/environment')

      expect(() => logEnvSetupWithNull()).not.toThrow()
      expect(consoleLogSpy).toHaveBeenCalledWith('LOAD_JSON_GENESIS_SECURE_ACCOUNTS', 'test-value')

      // Reset the mock back to the original
      jest.resetModules()
    })

    it('should not throw when an error occurs', () => {
      // Mock console.log to throw an error
      consoleLogSpy.mockImplementation(() => {
        throw new Error('Console log error')
      })

      expect(() => logEnvSetup()).not.toThrow()
    })

    it('should not throw when nestedCountersInstance.countEvent throws', () => {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = 'test-value'
      ;(nestedCountersInstance.countEvent as jest.Mock).mockImplementation(() => {
        throw new Error('Count event error')
      })

      expect(() => logEnvSetup()).not.toThrow()
      expect(consoleLogSpy).toHaveBeenCalledWith('LOAD_JSON_GENESIS_SECURE_ACCOUNTS', 'test-value')
    })
  })
})
