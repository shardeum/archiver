import { queryNodes } from '../../../../../src/test/api/nodes'
import * as P2P from '../../../../../src/P2P'

// Mock dependencies
jest.mock('../../../../../src/P2P')

describe('test/api/nodes', () => {
  describe('queryNodes', () => {
    const mockP2P = P2P as jest.Mocked<typeof P2P>
    let consoleLogSpy: jest.SpyInstance

    beforeEach(() => {
      jest.clearAllMocks()
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
    })

    it('should make five API calls with correct URLs', async () => {
      const mockResponses = [
        { nodelist: 'data' },
        { fullNodelist: 'data' },
        { nodeids: 'data' },
        { lostNodes: 'data' },
        { nodeInfo: 'data' },
      ]

      mockResponses.forEach((response) => {
        mockP2P.getJson.mockResolvedValueOnce(response)
      })

      await queryNodes('127.0.0.1', '8080', 10, 20)

      expect(mockP2P.getJson).toHaveBeenCalledTimes(5)
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8080/nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8080/full-nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:8080/nodeids')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8080/lost?start=10&end=20')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(5, 'http://127.0.0.1:8080/nodeinfo')
    })

    it('should log all responses', async () => {
      const mockResponses = [
        { type: 'nodelist' },
        { type: 'full-nodelist' },
        { type: 'nodeids' },
        { type: 'lost' },
        { type: 'nodeinfo' },
      ]

      mockResponses.forEach((response) => {
        mockP2P.getJson.mockResolvedValueOnce(response)
      })

      await queryNodes('192.168.1.1', '3000', 0, 100)

      expect(consoleLogSpy).toHaveBeenCalledTimes(5)
      mockResponses.forEach((response, index) => {
        expect(consoleLogSpy).toHaveBeenNthCalledWith(index + 1, response)
      })
    })

    it('should handle different IP and port formats', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryNodes('localhost', '9999', 5, 15)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://localhost:9999/nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://localhost:9999/full-nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(3, 'http://localhost:9999/nodeids')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://localhost:9999/lost?start=5&end=15')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(5, 'http://localhost:9999/nodeinfo')
    })

    it('should handle zero values for start and end', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryNodes('127.0.0.1', '8080', 0, 0)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8080/lost?start=0&end=0')
    })

    it('should handle negative values for start and end', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryNodes('127.0.0.1', '8080', -10, -5)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://127.0.0.1:8080/lost?start=-10&end=-5')
    })

    it('should handle API errors on first call', async () => {
      const error = new Error('Network error')
      mockP2P.getJson.mockRejectedValueOnce(error)

      await expect(queryNodes('127.0.0.1', '8080', 10, 20)).rejects.toThrow('Network error')
      expect(mockP2P.getJson).toHaveBeenCalledTimes(1)
    })

    it('should handle API errors on middle calls', async () => {
      mockP2P.getJson
        .mockResolvedValueOnce({ nodelist: 'data' })
        .mockResolvedValueOnce({ fullNodelist: 'data' })
        .mockRejectedValueOnce(new Error('API Error'))

      await expect(queryNodes('127.0.0.1', '8080', 10, 20)).rejects.toThrow('API Error')
      expect(mockP2P.getJson).toHaveBeenCalledTimes(3)
      expect(consoleLogSpy).toHaveBeenCalledTimes(2)
    })

    it('should handle API errors on last call', async () => {
      mockP2P.getJson
        .mockResolvedValueOnce({ nodelist: 'data' })
        .mockResolvedValueOnce({ fullNodelist: 'data' })
        .mockResolvedValueOnce({ nodeids: 'data' })
        .mockResolvedValueOnce({ lost: 'data' })
        .mockRejectedValueOnce(new Error('Last call failed'))

      await expect(queryNodes('127.0.0.1', '8080', 10, 20)).rejects.toThrow('Last call failed')
      expect(mockP2P.getJson).toHaveBeenCalledTimes(5)
      expect(consoleLogSpy).toHaveBeenCalledTimes(4)
    })

    it('should handle null or undefined responses', async () => {
      mockP2P.getJson
        .mockResolvedValueOnce(null as any)
        .mockResolvedValueOnce(undefined as any)
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({} as any)

      await queryNodes('127.0.0.1', '8080', 10, 20)

      expect(consoleLogSpy).toHaveBeenCalledWith(null)
      expect(consoleLogSpy).toHaveBeenCalledWith(undefined)
      expect(consoleLogSpy).toHaveBeenCalledWith({})
      expect(consoleLogSpy).toHaveBeenCalledWith([])
      expect(consoleLogSpy).toHaveBeenCalledWith({})
    })

    it('should work with IPv6 addresses', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryNodes('::1', '8080', 10, 20)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://::1:8080/nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://::1:8080/full-nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(3, 'http://::1:8080/nodeids')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://::1:8080/lost?start=10&end=20')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(5, 'http://::1:8080/nodeinfo')
    })

    it('should handle very large numbers for start and end', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryNodes('127.0.0.1', '8080', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(
        4,
        `http://127.0.0.1:8080/lost?start=${Number.MAX_SAFE_INTEGER}&end=${Number.MAX_SAFE_INTEGER}`
      )
    })

    it('should handle special characters in IP or port', async () => {
      mockP2P.getJson.mockResolvedValue({})

      // This test verifies the function doesn't do any validation/escaping
      await queryNodes('127.0.0.1;evil', '8080&bad', 10, 20)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1;evil:8080&bad/nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1;evil:8080&bad/full-nodelist')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(3, 'http://127.0.0.1;evil:8080&bad/nodeids')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(4, 'http://127.0.0.1;evil:8080&bad/lost?start=10&end=20')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(5, 'http://127.0.0.1;evil:8080&bad/nodeinfo')
    })

    it('should complete all API calls even if some return error data', async () => {
      const responses = [
        { error: 'Invalid request' },
        { nodes: [] },
        { error: 'Not found' },
        { lost: [] },
        { info: 'node data' },
      ]

      responses.forEach((response) => {
        mockP2P.getJson.mockResolvedValueOnce(response)
      })

      await queryNodes('127.0.0.1', '8080', 10, 20)

      expect(mockP2P.getJson).toHaveBeenCalledTimes(5)
      expect(consoleLogSpy).toHaveBeenCalledTimes(5)
      responses.forEach((response, index) => {
        expect(consoleLogSpy).toHaveBeenNthCalledWith(index + 1, response)
      })
    })

    it('should handle mixed types of responses', async () => {
      const responses = [
        { type: 'string response' },
        { value: 123 },
        { bool: true },
        { complex: { nested: 'object' } },
        ['array', 'of', 'items'],
      ]

      responses.forEach((response) => {
        mockP2P.getJson.mockResolvedValueOnce(response as any)
      })

      await queryNodes('127.0.0.1', '8080', 10, 20)

      expect(consoleLogSpy).toHaveBeenCalledTimes(5)
      responses.forEach((response, index) => {
        expect(consoleLogSpy).toHaveBeenNthCalledWith(index + 1, response)
      })
    })
  })
})