import { jest } from '@jest/globals'
import * as P2P from '../../../src/P2P'
import * as State from '../../../src/State'
import * as Crypto from '../../../src/Crypto'
import { customFetch } from '../../../src/utils/customHttpFunctions'
import { Headers } from 'node-fetch'

// Mock dependencies
jest.mock('../../../src/State')
jest.mock('../../../src/Crypto')
jest.mock('../../../src/utils/customHttpFunctions')

describe('P2P', () => {
  const mockNodeInfo = {
    externalIp: '127.0.0.1',
    externalPort: 9001,
    publicKey: 'mockPublicKey',
    nodeId: 'mockNodeId',
  }

  const mockSignedObject = {
    signature: 'mockSignature',
    publicKey: 'mockPublicKey',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    ;(State.getNodeInfo as jest.Mock).mockReturnValue(mockNodeInfo)
    ;(Crypto.sign as jest.Mock as any).mockImplementation((obj: Record<string, unknown>) => ({
      ...obj,
      ...mockSignedObject,
    }))
  })

  describe('createArchiverJoinRequest', () => {
    it('should create a valid join request with correct structure', () => {
      const result = P2P.createArchiverJoinRequest()

      expect(result).toHaveProperty('nodeInfo', mockNodeInfo)
      expect(result).toHaveProperty('appData')
      expect(result.appData).toHaveProperty('version')
      expect(result).toHaveProperty('requestType', P2P.RequestTypes.JOIN)
      expect(result).toHaveProperty('requestTimestamp')
      expect(result).toHaveProperty('signature', mockSignedObject.signature)
      expect(result).toHaveProperty('publicKey', mockSignedObject.publicKey)
    })

    it('should include current timestamp', () => {
      const before = Date.now()
      const result = P2P.createArchiverJoinRequest()
      const after = Date.now()

      expect(result.requestTimestamp).toBeGreaterThanOrEqual(before)
      expect(result.requestTimestamp).toBeLessThanOrEqual(after)
    })

    it('should call Crypto.sign with the correct join request', () => {
      P2P.createArchiverJoinRequest()

      expect(Crypto.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeInfo: mockNodeInfo,
          appData: expect.objectContaining({ version: expect.any(String) }),
          requestType: P2P.RequestTypes.JOIN,
          requestTimestamp: expect.any(Number),
        })
      )
    })

    it('should create unique timestamps for each request', () => {
      jest.useFakeTimers()
      const firstTimestamp = Date.now()
      jest.setSystemTime(firstTimestamp)
      const firstRequest = P2P.createArchiverJoinRequest()

      // Advance time by 1000ms
      jest.setSystemTime(firstTimestamp + 1000)
      const secondRequest = P2P.createArchiverJoinRequest()

      expect(secondRequest.requestTimestamp).toBe(firstRequest.requestTimestamp + 1000)
      jest.useRealTimers()
    })
  })

  describe('createArchiverActiveRequest', () => {
    it('should create a valid active request with correct structure', () => {
      const result = P2P.createArchiverActiveRequest()

      expect(result).toHaveProperty('nodeInfo', mockNodeInfo)
      expect(result).toHaveProperty('requestType', P2P.RequestTypes.ACTIVE)
      expect(result).toHaveProperty('signature', mockSignedObject.signature)
      expect(result).toHaveProperty('publicKey', mockSignedObject.publicKey)
    })

    it('should call Crypto.sign with the correct active request', () => {
      P2P.createArchiverActiveRequest()

      expect(Crypto.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeInfo: mockNodeInfo,
          requestType: P2P.RequestTypes.ACTIVE,
        })
      )
    })
  })

  describe('createArchiverLeaveRequest', () => {
    it('should create a valid leave request with correct structure', () => {
      const result = P2P.createArchiverLeaveRequest()

      expect(result).toHaveProperty('nodeInfo', mockNodeInfo)
      expect(result).toHaveProperty('requestType', P2P.RequestTypes.LEAVE)
      expect(result).toHaveProperty('requestTimestamp')
      expect(result).toHaveProperty('signature', mockSignedObject.signature)
      expect(result).toHaveProperty('publicKey', mockSignedObject.publicKey)
    })

    it('should include current timestamp', () => {
      const before = Date.now()
      const result = P2P.createArchiverLeaveRequest()
      const after = Date.now()

      expect(result.requestTimestamp).toBeGreaterThanOrEqual(before)
      expect(result.requestTimestamp).toBeLessThanOrEqual(after)
    })

    it('should call Crypto.sign with the correct leave request', () => {
      P2P.createArchiverLeaveRequest()

      expect(Crypto.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeInfo: mockNodeInfo,
          requestType: P2P.RequestTypes.LEAVE,
          requestTimestamp: expect.any(Number),
        })
      )
    })
  })

  describe('postJson', () => {
    const mockUrl = 'http://test.com/api'
    const mockBody = { data: 'test' }

    it('should successfully post JSON data and return parsed response', async () => {
      const mockResponse = { success: true, data: 'response' }
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      })

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toEqual(mockResponse)
      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'post',
        body: JSON.stringify(mockBody),
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      })
    })

    it('should handle non-OK response', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: false,
        headers: new Headers(),
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found'),
      })

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toBeNull()
    })

    it('should handle network errors', async () => {
      ;(customFetch as any).mockRejectedValueOnce(new Error('Network error'))

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toBeNull()
    })

    it('should handle invalid JSON response', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('invalid json'),
      })

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toBeNull()
    })

    it('should respect custom timeout', async () => {
      const customTimeout = 10
      await P2P.postJson(mockUrl, mockBody, customTimeout)

      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'post',
        body: JSON.stringify(mockBody),
        headers: { 'Content-Type': 'application/json' },
        timeout: customTimeout * 1000,
      })
    })

    it('should handle response with empty body', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      })

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toBeNull()
    })

    it('should handle case where response.text() throws an error', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.reject(new Error('Text extraction error')),
      })

      const result = await P2P.postJson(mockUrl, mockBody)
      expect(result).toBeNull()
    })

    it('should handle extreme timeout values', async () => {
      // Test with 0 timeout
      await P2P.postJson(mockUrl, mockBody, 0)
      expect(customFetch).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          timeout: 0,
        })
      )

      // Test with very large timeout
      const veryLargeTimeout = Number.MAX_SAFE_INTEGER / 1000
      await P2P.postJson(mockUrl, mockBody, veryLargeTimeout)
      expect(customFetch).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          timeout: veryLargeTimeout * 1000,
        })
      )
    })
  })

  describe('getJson', () => {
    const mockUrl = 'http://test.com/api'

    it('should successfully get JSON data and return parsed response', async () => {
      const mockResponse = { data: 'test response' }
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      })

      const result = await P2P.getJson(mockUrl)
      expect(result).toEqual(mockResponse)
      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000,
      })
    })

    it('should handle non-OK response', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: false,
        headers: new Headers(),
        statusText: 'Not Found',
        text: () => Promise.resolve('Not Found'),
      })

      const result = await P2P.getJson(mockUrl)
      expect(result).toBeNull()
    })

    it('should handle network errors', async () => {
      ;(customFetch as any).mockRejectedValueOnce(new Error('Network error'))

      const result = await P2P.getJson(mockUrl)
      expect(result).toBeNull()
    })

    it('should handle invalid JSON response', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('invalid json'),
      })

      const result = await P2P.getJson(mockUrl)
      expect(result).toBeNull()
    })

    it('should respect custom timeout', async () => {
      const customTimeout = 10
      await P2P.getJson(mockUrl, customTimeout)

      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        headers: { 'Content-Type': 'application/json' },
        timeout: customTimeout * 1000,
      })
    })

    it('should handle response with empty body', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(''),
      })

      const result = await P2P.getJson(mockUrl)
      expect(result).toBeNull()
    })

    it('should handle case where response.text() throws an error', async () => {
      ;(customFetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.reject(new Error('Text extraction error')),
      })

      const result = await P2P.getJson(mockUrl)
      expect(result).toBeNull()
    })

    it('should handle extremely long URLs', async () => {
      const longUrl = 'http://test.com/api' + 'a'.repeat(2000)

      await P2P.getJson(longUrl)
      expect(customFetch).toHaveBeenCalledWith(longUrl, expect.anything())
    })
  })

  describe('get', () => {
    const mockUrl = 'http://test.com/api'

    it('should make a GET request with default options', async () => {
      const mockResponse = { ok: true }
      ;(customFetch as any).mockResolvedValueOnce(mockResponse)

      const result = await P2P.get(mockUrl)
      expect(result).toBe(mockResponse)
      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        timeout: 20000,
      })
    })

    it('should respect custom timeout', async () => {
      const customTimeout = 30
      await P2P.get(mockUrl, customTimeout)

      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        timeout: customTimeout * 1000,
      })
    })

    it('should merge custom options', async () => {
      const customOpts = {
        headers: { Authorization: 'Bearer token' },
      }
      await P2P.get(mockUrl, 20, customOpts)

      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        timeout: 20000,
        headers: { Authorization: 'Bearer token' },
      })
    })

    it('should handle invalid URLs', async () => {
      const invalidUrl = 'invalid://url'

      // Mock the fetch to avoid actual network calls
      ;(customFetch as any).mockResolvedValueOnce({})

      await P2P.get(invalidUrl)
      expect(customFetch).toHaveBeenCalledWith(invalidUrl, expect.anything())
    })

    it('should handle negative timeout values', async () => {
      const negativeTimeout = -5

      await P2P.get(mockUrl, negativeTimeout)
      expect(customFetch).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          timeout: negativeTimeout * 1000,
        })
      )
    })

    it('should correctly merge complex custom options', async () => {
      const complexOpts = {
        headers: {
          Authorization: 'Bearer token',
          'X-Custom-Header': 'custom-value',
        },
        redirect: 'follow' as const,
        signal: new AbortController().signal,
      }

      await P2P.get(mockUrl, 15, complexOpts as any)

      expect(customFetch).toHaveBeenCalledWith(mockUrl, {
        method: 'get',
        timeout: 15000,
        ...complexOpts,
      })
    })
  })
})
