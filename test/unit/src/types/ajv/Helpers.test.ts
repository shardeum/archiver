// Mock dependencies first
jest.mock('../../../../../src/utils/serialization/SchemaHelpers', () => ({
  getVerifyFunction: jest.fn()
}))

jest.mock('../../../../../src/types/ajv/Accounts', () => ({
  initAccounts: jest.fn()
}))

jest.mock('../../../../../src/types/ajv/Receipts', () => ({
  initReceipts: jest.fn()
}))

jest.mock('../../../../../src/types/ajv/OriginalTxData', () => ({
  initOriginalTxData: jest.fn()
}))

jest.mock('@shardeum-foundation/lib-types', () => ({
  Utils: {
    safeStringify: jest.fn((obj) => JSON.stringify(obj))
  }
}))

import { initAjvSchemas, verifyPayload } from '../../../../../src/types/ajv/Helpers'
import { ErrorObject } from 'ajv'
import { AJVSchemaEnum } from '../../../../../src/types/enum/AJVSchemaEnum'

// Get mocked functions
const mockGetVerifyFunction = require('../../../../../src/utils/serialization/SchemaHelpers').getVerifyFunction as jest.Mock
const mockInitAccounts = require('../../../../../src/types/ajv/Accounts').initAccounts as jest.Mock
const mockInitReceipts = require('../../../../../src/types/ajv/Receipts').initReceipts as jest.Mock
const mockInitOriginalTxData = require('../../../../../src/types/ajv/OriginalTxData').initOriginalTxData as jest.Mock

describe('ajv/Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('initAjvSchemas', () => {
    it('should initialize all schema modules in correct order', () => {
      initAjvSchemas()

      expect(mockInitAccounts).toHaveBeenCalledTimes(1)
      expect(mockInitReceipts).toHaveBeenCalledTimes(1)
      expect(mockInitOriginalTxData).toHaveBeenCalledTimes(1)

      // Verify order of calls
      const callOrder = [
        mockInitAccounts.mock.invocationCallOrder[0],
        mockInitReceipts.mock.invocationCallOrder[0],
        mockInitOriginalTxData.mock.invocationCallOrder[0]
      ]
      expect(callOrder).toEqual([1, 2, 3])
    })

    it('should not throw if init functions succeed', () => {
      expect(() => initAjvSchemas()).not.toThrow()
    })

    it('should propagate errors from init functions', () => {
      const error = new Error('Schema init failed')
      mockInitAccounts.mockImplementationOnce(() => {
        throw error
      })

      expect(() => initAjvSchemas()).toThrow('Schema init failed')
    })

    it('should be idempotent', () => {
      initAjvSchemas()
      initAjvSchemas()

      expect(mockInitAccounts).toHaveBeenCalledTimes(2)
      expect(mockInitReceipts).toHaveBeenCalledTimes(2)
      expect(mockInitOriginalTxData).toHaveBeenCalledTimes(2)
    })
  })

  describe('verifyPayload', () => {
    let mockVerifyFn: jest.Mock & { errors?: ErrorObject[] | null }

    beforeEach(() => {
      mockVerifyFn = jest.fn() as jest.Mock & { errors?: ErrorObject[] | null }
      mockGetVerifyFunction.mockReturnValue(mockVerifyFn)
    })

    it('should return null for valid payload', () => {
      mockVerifyFn.mockReturnValue(true)

      const result = verifyPayload('TestSchema', { valid: true })

      expect(mockGetVerifyFunction).toHaveBeenCalledWith('TestSchema')
      expect(mockVerifyFn).toHaveBeenCalledWith({ valid: true })
      expect(result).toBeNull()
    })

    it('should return parsed errors for invalid payload', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'type',
          dataPath: '.field',
          schemaPath: '#/properties/field/type',
          params: { type: 'string' },
          message: 'should be string'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('TestSchema', { field: 123 })

      expect(result).toEqual(['should be string: {"type":"string"}'])
    })

    it('should handle multiple validation errors', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'required',
          dataPath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'name' },
          message: 'should have required property \'name\''
        },
        {
          keyword: 'minimum',
          dataPath: '.age',
          schemaPath: '#/properties/age/minimum',
          params: { limit: 0, exclusive: false, comparison: '>=' },
          message: 'should be >= 0'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('TestSchema', { age: -5 })

      expect(result).toHaveLength(2)
      expect(result).toEqual([
        'should have required property \'name\': {"missingProperty":"name"}',
        'should be >= 0: {"limit":0,"exclusive":false,"comparison":">="}'
      ])
    })

    it('should handle errors with empty params object', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'custom',
          dataPath: '.field',
          schemaPath: '#/custom',
          params: {},
          message: 'custom validation failed'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('TestSchema', { field: 'test' })

      // Empty params object has no keys, so it won't append params
      expect(result).toEqual(['custom validation failed'])
    })

    it('should handle errors with params that have values', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'custom',
          dataPath: '.field',
          schemaPath: '#/custom',
          params: { customParam: 'value' },
          message: 'custom validation failed'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('TestSchema', { field: 'test' })

      expect(result).toEqual(['custom validation failed: {"customParam":"value"}'])
    })

    it('should return null if errors array is null', () => {
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = null

      const result = verifyPayload('TestSchema', { test: true })

      expect(result).toBeNull()
    })

    it('should handle empty errors array', () => {
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = []

      const result = verifyPayload('TestSchema', { test: true })

      expect(result).toEqual([])
    })

    it('should work with different payload types', () => {
      mockVerifyFn.mockReturnValue(true)

      // String payload
      expect(verifyPayload('Schema1', 'string payload')).toBeNull()
      expect(mockVerifyFn).toHaveBeenCalledWith('string payload')

      // Number payload
      expect(verifyPayload('Schema2', 42)).toBeNull()
      expect(mockVerifyFn).toHaveBeenCalledWith(42)

      // Array payload
      expect(verifyPayload('Schema3', [1, 2, 3])).toBeNull()
      expect(mockVerifyFn).toHaveBeenCalledWith([1, 2, 3])

      // Null payload
      expect(verifyPayload('Schema4', null)).toBeNull()
      expect(mockVerifyFn).toHaveBeenCalledWith(null)
    })

    it('should verify using the correct schema', () => {
      mockVerifyFn.mockReturnValue(true)

      verifyPayload(AJVSchemaEnum.AccountsCopy, { test: 'data' })
      expect(mockGetVerifyFunction).toHaveBeenCalledWith(AJVSchemaEnum.AccountsCopy)

      verifyPayload(AJVSchemaEnum.Receipt, { receipt: 'data' })
      expect(mockGetVerifyFunction).toHaveBeenCalledWith(AJVSchemaEnum.Receipt)
    })

    it('should handle complex error params', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'additionalProperties',
          dataPath: '',
          schemaPath: '#/additionalProperties',
          params: { 
            additionalProperty: 'extraField',
            allowedProperties: ['field1', 'field2', 'field3']
          },
          message: 'should NOT have additional properties'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('StrictSchema', { field1: 1, extraField: 'not allowed' })

      expect(result).toEqual([
        'should NOT have additional properties: {"additionalProperty":"extraField","allowedProperties":["field1","field2","field3"]}'
      ])
    })

    it('should handle nested dataPath in errors', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'type',
          dataPath: '.user.profile.age',
          schemaPath: '#/properties/user/properties/profile/properties/age/type',
          params: { type: 'number' },
          message: 'should be number'
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('NestedSchema', { 
        user: { 
          profile: { 
            age: 'not a number' 
          } 
        } 
      })

      expect(result).toEqual(['should be number: {"type":"number"}'])
    })

    it('should handle getVerifyFunction throwing error', () => {
      mockGetVerifyFunction.mockImplementationOnce(() => {
        throw new Error('Schema not found')
      })

      expect(() => verifyPayload('NonExistentSchema', {})).toThrow('Schema not found')
    })

    it('should handle errors with undefined message', () => {
      const errors: ErrorObject[] = [
        {
          keyword: 'test',
          dataPath: '',
          schemaPath: '#/test',
          params: { test: true },
          message: undefined as any
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('TestSchema', {})

      expect(result).toEqual(['undefined: {"test":true}'])
    })
  })

  describe('Error parsing edge cases', () => {
    let mockVerifyFn: jest.Mock & { errors?: ErrorObject[] | null }

    beforeEach(() => {
      mockVerifyFn = jest.fn() as jest.Mock & { errors?: ErrorObject[] | null }
      mockGetVerifyFunction.mockReturnValue(mockVerifyFn)
    })

    it('should handle circular reference in error params', () => {
      const circularObj: any = { a: 1 }
      circularObj.circular = circularObj

      const errors: ErrorObject[] = [
        {
          keyword: 'custom',
          dataPath: '',
          schemaPath: '#/custom',
          params: circularObj,
          message: 'circular reference error'
        }
      ]
      
      // Mock safeStringify to handle circular refs
      const { Utils } = require('@shardeum-foundation/lib-types')
      Utils.safeStringify.mockImplementationOnce(() => '{"a":1,"circular":"[Circular]"}')
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('CircularSchema', {})

      expect(result).toEqual(['circular reference error: {"a":1,"circular":"[Circular]"}'])
    })

    it('should handle very long error messages', () => {
      const longMessage = 'a'.repeat(1000)
      const errors: ErrorObject[] = [
        {
          keyword: 'pattern',
          dataPath: '.field',
          schemaPath: '#/properties/field/pattern',
          params: { pattern: '^[a-z]+$' },
          message: longMessage
        }
      ]
      
      mockVerifyFn.mockReturnValue(false)
      mockVerifyFn.errors = errors

      const result = verifyPayload('LongMessageSchema', { field: '123' })

      expect(result![0]).toHaveLength(1000 + ': {"pattern":"^[a-z]+$"}'.length)
      expect(result![0]).toContain(longMessage)
    })
  })
})