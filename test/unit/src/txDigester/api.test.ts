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
  let consoleLogSpy: jest.SpyInstance
  let consoleErrorSpy: jest.SpyInstance
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks()
    
    // Spy on console methods
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    
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
  
  afterEach(() => {
    // Restore console methods
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
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

    // Edge case: Missing cycleStart parameter
    it('should return 400 when cycleStart is missing', async () => {
      const mockRequest = createMockRequest({ cycleEnd: '110' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Missing cycleEnd parameter
    it('should return 400 when cycleEnd is missing', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(mockReply.status(400).send).toHaveBeenCalledWith({
        error: 'Invalid query parameters. They must be positive numbers with cycleEnd > cycleStart',
      })
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Null query object
    it('should return 400 when query is null', async () => {
      const mockRequest = createMockRequest(null)
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Undefined query object
    it('should return 400 when query is undefined', async () => {
      const mockRequest = createMockRequest(undefined)
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Float values
    it('should handle float values for cycleStart and cycleEnd', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100.5', cycleEnd: '110.7' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Number() keeps the decimal, doesn't convert to integers
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100.5, 110.7)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Exactly at the boundary (10000)
    it('should allow range exactly at 10000', async () => {
      const mockRequest = createMockRequest({ cycleStart: '1', cycleEnd: '10001' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 1, cycleEnd: 10001, txCount: 5000, hash: '0xdef' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(1, 10001)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Just over the boundary
    it('should return 400 when range is just over 10000', async () => {
      const mockRequest = createMockRequest({ cycleStart: '1', cycleEnd: '10002' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Zero values
    it('should allow cycleStart to be 0', async () => {
      const mockRequest = createMockRequest({ cycleStart: '0', cycleEnd: '10' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 0, cycleEnd: 10, txCount: 3, hash: '0x123' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(0, 10)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Very large valid numbers
    it('should handle very large cycle numbers', async () => {
      const mockRequest = createMockRequest({ cycleStart: '999999', cycleEnd: '1000000' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 999999, cycleEnd: 1000000, txCount: 10, hash: '0xghi' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(999999, 1000000)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Special string values
    it('should return 400 for special string values like "Infinity"', async () => {
      const mockRequest = createMockRequest({ cycleStart: 'Infinity', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    it('should return 400 for "NaN" string', async () => {
      const mockRequest = createMockRequest({ cycleStart: 'NaN', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Whitespace in parameters
    it('should handle whitespace in numeric strings', async () => {
      const mockRequest = createMockRequest({ cycleStart: ' 100 ', cycleEnd: ' 110 ' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Scientific notation
    it('should handle scientific notation', async () => {
      const mockRequest = createMockRequest({ cycleStart: '1e2', cycleEnd: '1.1e2' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Empty strings
    it('should return 400 for empty string parameters', async () => {
      const mockRequest = createMockRequest({ cycleStart: '', cycleEnd: '' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Boolean-like strings
    it('should return 400 for boolean-like strings', async () => {
      const mockRequest = createMockRequest({ cycleStart: 'true', cycleEnd: 'false' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Edge case: Array values
    it('should handle array values by taking first element', async () => {
      const mockRequest = createMockRequest({ cycleStart: ['100'], cycleEnd: ['110'] })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // Arrays are converted to their first element when passed to Number()
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Edge case: Object values
    it('should handle object values by converting to NaN', async () => {
      const mockRequest = createMockRequest({ cycleStart: { value: 100 }, cycleEnd: { value: 110 } })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Error handling: Database errors
    it('should handle database errors gracefully', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const dbError = new Error('Database connection failed')
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockRejectedValueOnce(dbError)
      
      await expect(routes['/api/tx-digests'](mockRequest, mockReply)).rejects.toThrow(dbError)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
    })

    // Error handling: Null response from database
    it('should handle null response from getTxDigestsForACycleRange', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(null)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(null)
    })

    // Error handling: Undefined response from database
    it('should handle undefined response from getTxDigestsForACycleRange', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(undefined)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(undefined)
    })

    // Success scenarios with various data
    it('should return empty array when no digests found', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce([])
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith([])
    })

    it('should return multiple digests successfully', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '150' })
      const mockReply = createMockReply()
      const mockDigests = [
        { cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' },
        { cycleStart: 111, cycleEnd: 120, txCount: 10, hash: '0xdef' },
        { cycleStart: 121, cycleEnd: 130, txCount: 15, hash: '0xghi' },
        { cycleStart: 131, cycleEnd: 140, txCount: 20, hash: '0xjkl' },
        { cycleStart: 141, cycleEnd: 150, txCount: 25, hash: '0xmno' }
      ]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 150)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    it('should handle digests with zero transaction count', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const mockDigests = [
        { cycleStart: 100, cycleEnd: 110, txCount: 0, hash: '0xempty' }
      ]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    it('should handle very long hash strings', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const longHash = '0x' + 'a'.repeat(1000)
      const mockDigests = [
        { cycleStart: 100, cycleEnd: 110, txCount: 5, hash: longHash }
      ]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Console logging tests
    it('should log when fetching tx digests', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Fetching tx digests for cycles: 100 to 110')
      expect(consoleLogSpy).toHaveBeenCalledWith('Fetched Tx digests', mockDigests)
    })

    it('should not log when request validation fails', async () => {
      const mockRequest = createMockRequest({ cycleStart: 'invalid', cycleEnd: '110' })
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(consoleLogSpy).not.toHaveBeenCalled()
    })

    // Performance edge cases
    it('should handle maximum allowed range (10000)', async () => {
      const mockRequest = createMockRequest({ cycleStart: '0', cycleEnd: '10000' })
      const mockReply = createMockReply()
      const mockDigests = Array.from({ length: 1000 }, (_, i) => ({
        cycleStart: i * 10,
        cycleEnd: (i + 1) * 10,
        txCount: Math.floor(Math.random() * 100),
        hash: `0x${i.toString(16).padStart(3, '0')}`
      }))
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(0, 10000)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Type safety tests
    it('should handle response with missing fields', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const mockDigests = [
        { cycleStart: 100, cycleEnd: 110 } as any // Missing txCount and hash
      ]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    it('should handle response with extra fields', async () => {
      const mockRequest = createMockRequest({ cycleStart: '100', cycleEnd: '110' })
      const mockReply = createMockReply()
      const mockDigests = [
        { 
          cycleStart: 100, 
          cycleEnd: 110, 
          txCount: 5, 
          hash: '0xabc',
          extraField: 'should not break',
          timestamp: Date.now()
        } as any
      ]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Concurrent request simulation
    it('should handle multiple concurrent requests', async () => {
      const requests = [
        { cycleStart: '100', cycleEnd: '110' },
        { cycleStart: '200', cycleEnd: '210' },
        { cycleStart: '300', cycleEnd: '310' }
      ]
      
      const promises = requests.map(async (query, index) => {
        const mockRequest = createMockRequest(query)
        const mockReply = createMockReply()
        const mockDigests = [{
          cycleStart: Number(query.cycleStart),
          cycleEnd: Number(query.cycleEnd),
          txCount: index + 1,
          hash: `0x${index}`
        }]
        
        ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
        
        await routes['/api/tx-digests'](mockRequest, mockReply)
        
        return { query, mockReply, mockDigests }
      })
      
      const results = await Promise.all(promises)
      
      results.forEach(({ mockReply, mockDigests }) => {
        expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
      })
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledTimes(3)
    })

    // Hexadecimal input edge case
    it('should handle hexadecimal string inputs', async () => {
      const mockRequest = createMockRequest({ cycleStart: '0x64', cycleEnd: '0x6e' }) // 100, 110 in hex
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 100, cycleEnd: 110, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(100, 110)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Octal input edge case
    it('should handle octal string inputs', async () => {
      const mockRequest = createMockRequest({ cycleStart: '0144', cycleEnd: '0156' }) // 100, 110 in octal
      const mockReply = createMockReply()
      const mockDigests = [{ cycleStart: 144, cycleEnd: 156, txCount: 5, hash: '0xabc' }]
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(mockDigests)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      // JavaScript Number() doesn't treat leading zeros as octal in strict mode
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(144, 156)
      expect(mockReply.send).toHaveBeenCalledWith(mockDigests)
    })

    // Unicode and special characters
    it('should return 400 for unicode numeric characters', async () => {
      const mockRequest = createMockRequest({ cycleStart: '१००', cycleEnd: '११०' }) // Devanagari numerals
      const mockReply = createMockReply()
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(mockReply.status).toHaveBeenCalledWith(400)
      expect(getTxDigestsForACycleRange).not.toHaveBeenCalled()
    })

    // Memory test - large response
    it('should handle very large response arrays', async () => {
      const mockRequest = createMockRequest({ cycleStart: '1', cycleEnd: '10000' })
      const mockReply = createMockReply()
      
      // Create a large array of digests
      const largeDigestsArray = Array.from({ length: 10000 }, (_, i) => ({
        cycleStart: i,
        cycleEnd: i + 1,
        txCount: Math.floor(Math.random() * 1000),
        hash: `0x${i.toString(16).padStart(8, '0')}`
      }))
      
      ;(getTxDigestsForACycleRange as jest.Mock).mockResolvedValueOnce(largeDigestsArray)
      
      await routes['/api/tx-digests'](mockRequest, mockReply)
      
      expect(getTxDigestsForACycleRange).toHaveBeenCalledWith(1, 10000)
      expect(mockReply.send).toHaveBeenCalledWith(largeDigestsArray)
    })
  })
}) 