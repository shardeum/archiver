import { isDebugMode, isDebugMiddleware } from '../../../src/DebugMode'
import { config } from '../../../src/Config'
import * as Crypto from '../../../src/Crypto'

// Mock dependencies
jest.mock('../../../src/Config', () => ({
  config: {
    ARCHIVER_MODE: jest.fn().mockReturnValue('debug'),
    DevPublicKey: 'test-public-key'
  }
}))

jest.mock('../../../src/Crypto', () => ({
  verify: jest.fn()
}))

describe('DebugMode', () => {
  // Reset mocks between tests
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
  })

  describe('isDebugMode', () => {
    it('should return true when ARCHIVER_MODE is set to debug', () => {
      // Set up the config mock
      ;(config.ARCHIVER_MODE as any) = 'debug'
      
      // Call the function
      const result = isDebugMode()
      
      // Assert the result
      expect(result).toBe(true)
    })

    it('should return false when ARCHIVER_MODE is not set to debug', () => {
      // Set up the config mock
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Call the function
      const result = isDebugMode()
      
      // Assert the result
      expect(result).toBe(false)
    })

    it('should return false when config is undefined', () => {
      // Set up the config mock to be undefined
      const originalConfig = { ...config }
      ;(config as any) = undefined
      
      // Call the function
      const result = isDebugMode()
      
      // Assert the result
      expect(result).toBe(false)
      
      // Restore config
      ;(config as any) = originalConfig
    })

    it('should return false when ARCHIVER_MODE is undefined', () => {
      // Set up the config mock
      ;(config.ARCHIVER_MODE as any) = undefined
      
      // Call the function
      const result = isDebugMode()
      
      // Assert the result
      expect(result).toBe(false)
    })
  })

  describe('isDebugMiddleware', () => {
    // Set up variables for middleware tests
    let req: any
    let res: any
    
    beforeEach(() => {
      req = {
        query: {},
        routerPath: '/test-path'
      }
      res = {
        code: jest.fn().mockReturnThis(),
        send: jest.fn()
      }
    })

    it('should return immediately if isDebugMode returns true', () => {
      // Set up the config mock
      ;(config.ARCHIVER_MODE as any) = 'debug'
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify no error response was sent
      expect(res.code).not.toHaveBeenCalled()
      expect(res.send).not.toHaveBeenCalled()
    })

    it('should return 401 if sig or sig_counter are missing', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify error response
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should return 401 if sig is present but sig_counter is missing', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request
      req.query.sig = 'test-signature'
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify error response
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should return 401 if sig_counter is present but sig is missing', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request
      req.query.sig_counter = '12345'
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify error response
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should return 401 if counter is not greater than lastCounter', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request
      req.query.sig = 'test-signature'
      req.query.sig_counter = '0' // This will be less than or equal to lastCounter after first call
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Call it again with the same counter
      isDebugMiddleware(req, res)
      
      // Verify error response on second call
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
    })

    it('should return 401 if counter is greater than current time plus buffer', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Mock current time
      const realDateNow = Date.now.bind(global.Date)
      const currentTime = 1000000
      global.Date.now = jest.fn(() => currentTime)
      
      // Set up the request with a counter far in the future
      req.query.sig = 'test-signature'
      req.query.sig_counter = (currentTime + 20000).toString() // Beyond buffer of 10000ms
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify error response
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
      
      // Restore Date.now
      global.Date.now = realDateNow
    })

    it('should return 401 if signature verification fails', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request with valid counter
      const currentTime = Date.now()
      req.query.sig = 'test-signature'
      req.query.sig_counter = (currentTime + 1000).toString() // Within buffer, greater than lastCounter
      
      // Set up Crypto.verify to return false
      ;(Crypto.verify as jest.Mock).mockReturnValue(false)
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify error response
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalledWith(expect.any(Error))
      expect(Crypto.verify).toHaveBeenCalled()
    })

    it('should succeed if all conditions are met', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request with valid counter
      const currentTime = Date.now()
      req.query.sig = 'test-signature'
      req.query.sig_counter = (currentTime + 1000).toString() // Within buffer, greater than lastCounter
      
      // Set up Crypto.verify to return true
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify no error response
      expect(res.code).not.toHaveBeenCalled()
      expect(res.send).not.toHaveBeenCalled()
      expect(Crypto.verify).toHaveBeenCalledWith({
        route: '/test-path',
        count: req.query.sig_counter,
        sign: { 
          owner: 'test-public-key', 
          sig: 'test-signature' 
        }
      })
    })

    it('should update lastCounter when verification succeeds', () => {
      // Set up the config mock to not be in debug mode
      ;(config.ARCHIVER_MODE as any) = 'production'
      
      // Set up the request with valid counter
      const currentTime = Date.now()
      req.query.sig = 'test-signature'
      req.query.sig_counter = (currentTime + 1000).toString() // Within buffer, greater than lastCounter
      
      // Set up Crypto.verify to return true
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify first call succeeds
      expect(res.code).not.toHaveBeenCalled()
      
      // Now try with a lower counter
      req.query.sig_counter = currentTime.toString() // Lower than the one used above
      
      // Call the middleware again
      isDebugMiddleware(req, res)
      
      // Verify second call fails due to counter not being greater than lastCounter
      expect(res.code).toHaveBeenCalledWith(401)
      expect(res.send).toHaveBeenCalled()
    })

    it('should handle case where DevPublicKey is not set', () => {
      // Set up the config mock to not be in debug mode and without DevPublicKey
      ;(config.ARCHIVER_MODE as any) = 'production'
      ;(config.DevPublicKey as any) = undefined
      
      // Set up the request with valid counter
      const currentTime = Date.now()
      req.query.sig = 'test-signature'
      req.query.sig_counter = (currentTime + 1000).toString()
      
      // Set up Crypto.verify to return true
      ;(Crypto.verify as jest.Mock).mockReturnValue(true)
      
      // Call the middleware
      isDebugMiddleware(req, res)
      
      // Verify Crypto.verify was called with empty owner
      expect(Crypto.verify).toHaveBeenCalledWith({
        route: '/test-path',
        count: req.query.sig_counter,
        sign: { 
          owner: '', 
          sig: 'test-signature' 
        }
      })
    })
  })
})
