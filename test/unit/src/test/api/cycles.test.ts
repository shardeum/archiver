import { queryCycles } from '../../../../../src/test/api/cycles'
import * as P2P from '../../../../../src/P2P'

// Mock dependencies
jest.mock('../../../../../src/P2P')

describe('test/api/cycles', () => {
  describe('queryCycles', () => {
    const mockP2P = P2P as jest.Mocked<typeof P2P>
    let consoleLogSpy: jest.SpyInstance

    beforeEach(() => {
      jest.clearAllMocks()
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
    })

    it('should make two API calls with correct URLs', async () => {
      const mockResponse1 = { data: 'cycle info 1' }
      const mockResponse2 = { data: 'cycle info 2' }

      mockP2P.getJson
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)

      await queryCycles('127.0.0.1', '8080', 10, 5, 15)

      expect(mockP2P.getJson).toHaveBeenCalledTimes(2)
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8080/cycleinfo/10')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8080/cycleinfo?start=5&end=15')
    })

    it('should log responses from both API calls', async () => {
      const mockResponse1 = { cycleInfo: 'test data 1' }
      const mockResponse2 = { cycleInfo: 'test data 2' }

      mockP2P.getJson
        .mockResolvedValueOnce(mockResponse1)
        .mockResolvedValueOnce(mockResponse2)

      await queryCycles('192.168.1.1', '3000', 20, 10, 30)

      expect(consoleLogSpy).toHaveBeenCalledTimes(2)
      expect(consoleLogSpy).toHaveBeenNthCalledWith(1, mockResponse1)
      expect(consoleLogSpy).toHaveBeenNthCalledWith(2, mockResponse2)
    })

    it('should handle different IP formats', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('localhost', '8080', 5, 1, 10)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://localhost:8080/cycleinfo/5')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://localhost:8080/cycleinfo?start=1&end=10')
    })

    it('should handle different port numbers', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('127.0.0.1', '9999', 100, 50, 150)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:9999/cycleinfo/100')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:9999/cycleinfo?start=50&end=150')
    })

    it('should handle zero values for count, start, and end', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('127.0.0.1', '8080', 0, 0, 0)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8080/cycleinfo/0')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8080/cycleinfo?start=0&end=0')
    })

    it('should handle negative values for count, start, and end', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('127.0.0.1', '8080', -5, -10, -1)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:8080/cycleinfo/-5')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:8080/cycleinfo?start=-10&end=-1')
    })

    it('should handle API errors gracefully', async () => {
      const error = new Error('Network error')
      mockP2P.getJson.mockRejectedValueOnce(error)

      await expect(queryCycles('127.0.0.1', '8080', 10, 5, 15)).rejects.toThrow('Network error')
      expect(mockP2P.getJson).toHaveBeenCalledTimes(1)
    })

    it('should handle null or undefined responses', async () => {
      mockP2P.getJson
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(undefined)

      await queryCycles('127.0.0.1', '8080', 10, 5, 15)

      expect(consoleLogSpy).toHaveBeenCalledWith(null)
      expect(consoleLogSpy).toHaveBeenCalledWith(undefined)
    })

    it('should work with IPv6 addresses', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('::1', '8080', 10, 5, 15)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://::1:8080/cycleinfo/10')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://::1:8080/cycleinfo?start=5&end=15')
    })

    it('should handle very large numbers', async () => {
      mockP2P.getJson.mockResolvedValue({})

      await queryCycles('127.0.0.1', '8080', Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(
        1,
        `http://127.0.0.1:8080/cycleinfo/${Number.MAX_SAFE_INTEGER}`
      )
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(
        2,
        `http://127.0.0.1:8080/cycleinfo?start=0&end=${Number.MAX_SAFE_INTEGER}`
      )
    })

    it('should complete both API calls even if first one returns error data', async () => {
      const errorResponse = { error: 'Invalid cycle' }
      const successResponse = { cycleInfo: 'valid data' }

      mockP2P.getJson
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse)

      await queryCycles('127.0.0.1', '8080', 10, 5, 15)

      expect(mockP2P.getJson).toHaveBeenCalledTimes(2)
      expect(consoleLogSpy).toHaveBeenCalledWith(errorResponse)
      expect(consoleLogSpy).toHaveBeenCalledWith(successResponse)
    })

    it('should handle special characters in IP or port', async () => {
      mockP2P.getJson.mockResolvedValue({})

      // This test verifies the function doesn't do any validation/escaping
      await queryCycles('127.0.0.1:evil', '8080;drop', 10, 5, 15)

      expect(mockP2P.getJson).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:evil:8080;drop/cycleinfo/10')
      expect(mockP2P.getJson).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:evil:8080;drop/cycleinfo?start=5&end=15')
    })
  })
})