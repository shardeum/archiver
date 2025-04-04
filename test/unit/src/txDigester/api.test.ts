// Mock the txDigestFunctions module
jest.mock('../../../../src/txDigester/txDigestFunctions', () => ({
  getTxDigestsForACycleRange: jest.fn(),
}))

// Import modules after mocks are set up
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Server, IncomingMessage, ServerResponse } from 'http'
import { registerRoutes } from '../../../../src/txDigester/api'
import { getTxDigestsForACycleRange } from '../../../../src/txDigester/txDigestFunctions'

describe('txDigester API', () => {
  let mockFastify: FastifyInstance
  let routes: Record<string, Function> = {}
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()
    
    // Create a mock Fastify instance
    routes = {}
    mockFastify = {
      get: jest.fn((path: string, handler: Function) => {
        routes[path] = handler
        return mockFastify
      }),
    } as unknown as FastifyInstance<Server, IncomingMessage, ServerResponse>
    
    // Register routes
    registerRoutes(mockFastify)
  })
  
  describe('registerRoutes', () => {
    it('should register the /api/tx-digests endpoint', () => {
      expect(mockFastify.get).toHaveBeenCalledWith('/api/tx-digests', expect.any(Function))
      expect(routes['/api/tx-digests']).toBeDefined()
    })
  })
  
  describe('GET /api/tx-digests', () => {
    const createMockRequest = (query: any) => ({
      query,
    } as unknown as FastifyRequest)
    
    const createMockReply = () => {
      const mockSend = jest.fn()
      const mockStatus = jest.fn().mockReturnValue({ send: mockSend })
      
      return {
        send: mockSend,
        status: mockStatus,
      } as unknown as FastifyReply
    }
    
    it('should fetch and return tx digests for valid query parameters', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      // Mock implementation
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })
    
    it('should return 400 when cycleStart is not a number', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: 'invalid', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should return 400 when cycleEnd is not a number', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: 'invalid' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should return 400 when cycleEnd <= cycleStart', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '100' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should return 400 when cycleStart is negative', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '-1', cycleEnd: '10' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should return 400 when cycleEnd is negative', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '10', cycleEnd: '-1' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should return 400 when range is too large (cycleEnd - cycleStart > 10000)', async () => {
      // Arrange
      const mockRequest = createMockRequest({ cycleStart: '1', cycleEnd: '20000' })
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
    
    it('should handle empty query parameters', async () => {
      // Arrange
      const mockRequest = createMockRequest({})
      const mockReply = createMockReply()
      
      // Act
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Assert
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })
  })
}) 