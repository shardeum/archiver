import { healthCheckRouter } from '../../../../src/routes/healthCheck'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

describe('healthCheckRouter', () => {
  let mockFastify: FastifyInstance
  let mockRequest: FastifyRequest
  let mockReply: FastifyReply
  let mockDone: jest.Mock
  let registeredRoutes: Map<string, Function>

  beforeEach(() => {
    // Initialize route registry
    registeredRoutes = new Map()

    // Setup mock reply
    mockReply = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as unknown as FastifyReply

    // Setup mock request
    mockRequest = {} as FastifyRequest

    // Setup mock fastify instance
    mockFastify = {
      get: jest.fn((path: string, handler: Function) => {
        registeredRoutes.set(path, handler)
      }),
    } as unknown as FastifyInstance

    // Setup mock done callback
    mockDone = jest.fn()

    jest.clearAllMocks()
  })

  describe('Router registration', () => {
    it('should register health check routes', () => {
      healthCheckRouter(mockFastify, {}, mockDone)

      expect(mockFastify.get).toHaveBeenCalledTimes(2)
      expect(mockFastify.get).toHaveBeenCalledWith('/is-alive', expect.any(Function))
      expect(mockFastify.get).toHaveBeenCalledWith('/is-healthy', expect.any(Function))
    })

    it('should call done callback', () => {
      healthCheckRouter(mockFastify, {}, mockDone)

      expect(mockDone).toHaveBeenCalledTimes(1)
      expect(mockDone).toHaveBeenCalledWith()
    })

    it('should register routes before calling done', () => {
      const callOrder: string[] = []

      const trackingFastify = {
        get: jest.fn(() => {
          callOrder.push('get')
        }),
      } as unknown as FastifyInstance

      const trackingDone = jest.fn(() => {
        callOrder.push('done')
      })

      healthCheckRouter(trackingFastify, {}, trackingDone)

      expect(callOrder).toEqual(['get', 'get', 'done'])
    })
  })

  describe('/is-alive endpoint', () => {
    let isAliveHandler: Function

    beforeEach(() => {
      healthCheckRouter(mockFastify, {}, mockDone)
      isAliveHandler = registeredRoutes.get('/is-alive')!
    })

    it('should be registered', () => {
      expect(isAliveHandler).toBeDefined()
      expect(typeof isAliveHandler).toBe('function')
    })

    it('should return 200 OK', () => {
      const result = isAliveHandler(mockRequest, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(200)
      expect(mockReply.send).toHaveBeenCalledWith('OK')
      expect(result).toBe(mockReply)
    })

    it('should handle multiple calls', () => {
      // First call
      isAliveHandler(mockRequest, mockReply)
      expect(mockReply.status).toHaveBeenCalledTimes(1)
      expect(mockReply.send).toHaveBeenCalledTimes(1)

      // Second call
      isAliveHandler(mockRequest, mockReply)
      expect(mockReply.status).toHaveBeenCalledTimes(2)
      expect(mockReply.send).toHaveBeenCalledTimes(2)
    })

    it('should work with different reply objects', () => {
      const customReply = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
      } as unknown as FastifyReply

      isAliveHandler(mockRequest, customReply)

      expect(customReply.status).toHaveBeenCalledWith(200)
      expect(customReply.send).toHaveBeenCalledWith('OK')
    })
  })

  describe('/is-healthy endpoint', () => {
    let isHealthyHandler: Function

    beforeEach(() => {
      healthCheckRouter(mockFastify, {}, mockDone)
      isHealthyHandler = registeredRoutes.get('/is-healthy')!
    })

    it('should be registered', () => {
      expect(isHealthyHandler).toBeDefined()
      expect(typeof isHealthyHandler).toBe('function')
    })

    it('should return 200 OK', () => {
      const result = isHealthyHandler(mockRequest, mockReply)

      expect(mockReply.status).toHaveBeenCalledWith(200)
      expect(mockReply.send).toHaveBeenCalledWith('OK')
      expect(result).toBe(mockReply)
    })

    it('should have TODO comment for actual health check logic', () => {
      // This test documents that the implementation has a TODO
      // When actual health check logic is added, this test should be updated
      const result = isHealthyHandler(mockRequest, mockReply)

      // Currently just returns OK without any actual health checks
      expect(mockReply.send).toHaveBeenCalledWith('OK')
      expect(mockReply.send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          status: expect.any(String),
          checks: expect.any(Array),
        })
      )
    })
  })

  describe('Error handling', () => {
    it('should handle synchronous errors in route registration', () => {
      const errorFastify = {
        get: jest.fn(() => {
          throw new Error('Registration error')
        }),
      } as unknown as FastifyInstance

      expect(() => {
        healthCheckRouter(errorFastify, {}, mockDone)
      }).toThrow('Registration error')

      expect(mockDone).not.toHaveBeenCalled()
    })

    it('should handle errors in done callback', () => {
      const errorDone = jest.fn(() => {
        throw new Error('Done error')
      })

      expect(() => {
        healthCheckRouter(mockFastify, {}, errorDone)
      }).toThrow('Done error')

      expect(mockFastify.get).toHaveBeenCalledTimes(2)
    })
  })

  describe('Fastify plugin compliance', () => {
    it('should be a valid fastify plugin callback', () => {
      expect(typeof healthCheckRouter).toBe('function')
      expect(healthCheckRouter.length).toBe(3) // fastify, opts, done
    })

    it('should work with empty options', () => {
      healthCheckRouter(mockFastify, {}, mockDone)
      expect(mockDone).toHaveBeenCalled()
    })

    it('should work with undefined options', () => {
      healthCheckRouter(mockFastify, undefined as any, mockDone)
      expect(mockDone).toHaveBeenCalled()
    })

    it('should work with null options', () => {
      healthCheckRouter(mockFastify, null as any, mockDone)
      expect(mockDone).toHaveBeenCalled()
    })

    it('should work with custom options', () => {
      const customOpts = { prefix: '/health', custom: true }
      healthCheckRouter(mockFastify, customOpts, mockDone)
      expect(mockDone).toHaveBeenCalled()
    })
  })

  describe('Response format', () => {
    it('should return plain text responses', () => {
      healthCheckRouter(mockFastify, {}, mockDone)

      const isAliveHandler = registeredRoutes.get('/is-alive')!
      const isHealthyHandler = registeredRoutes.get('/is-healthy')!

      isAliveHandler(mockRequest, mockReply)
      expect(mockReply.send).toHaveBeenCalledWith('OK')
      expect(mockReply.send).not.toHaveBeenCalledWith({ status: 'OK' })

      jest.clearAllMocks()

      isHealthyHandler(mockRequest, mockReply)
      expect(mockReply.send).toHaveBeenCalledWith('OK')
      expect(mockReply.send).not.toHaveBeenCalledWith({ status: 'OK' })
    })

    it('should use proper status codes', () => {
      healthCheckRouter(mockFastify, {}, mockDone)

      const isAliveHandler = registeredRoutes.get('/is-alive')!
      const isHealthyHandler = registeredRoutes.get('/is-healthy')!

      isAliveHandler(mockRequest, mockReply)
      expect(mockReply.status).toHaveBeenCalledWith(200)
      expect(mockReply.status).not.toHaveBeenCalledWith(204)

      jest.clearAllMocks()

      isHealthyHandler(mockRequest, mockReply)
      expect(mockReply.status).toHaveBeenCalledWith(200)
      expect(mockReply.status).not.toHaveBeenCalledWith(500)
    })
  })

  describe('Method chaining', () => {
    it('should support method chaining on reply', () => {
      healthCheckRouter(mockFastify, {}, mockDone)
      const isAliveHandler = registeredRoutes.get('/is-alive')!

      const result = isAliveHandler(mockRequest, mockReply)

      // Verify chaining works
      expect(result).toBe(mockReply)
      expect(mockReply.status).toHaveReturnedWith(mockReply)
      expect(mockReply.send).toHaveReturnedWith(mockReply)
    })
  })
})
