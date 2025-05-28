import { initOriginalTxData } from '../../../../../src/types/ajv/OriginalTxData'
import { AJVSchemaEnum } from '../../../../../src/types/enum/AJVSchemaEnum'
import * as Ajv from 'ajv'

// Mock the SchemaHelpers module
const mockSchemaMap = new Map<string, object>()

jest.mock('../../../../../src/utils/serialization/SchemaHelpers', () => ({
  addSchema: jest.fn((name: string, schema: object) => {
    mockSchemaMap.set(name, schema)
  })
}))

// Helper to get schema from our mock
const getSchema = (name: string) => mockSchemaMap.get(name)
const resetSchemas = () => mockSchemaMap.clear()

describe('ajv/OriginalTxData schemas', () => {
  let ajv: Ajv.Ajv

  beforeEach(() => {
    resetSchemas()
    ajv = new Ajv({ allErrors: true })
  })

  afterEach(() => {
    resetSchemas()
  })

  describe('initOriginalTxData', () => {
    it('should initialize without errors', () => {
      expect(() => initOriginalTxData()).not.toThrow()
    })

    it('should register OriginalTxData schema', () => {
      initOriginalTxData()
      const schema = getSchema(AJVSchemaEnum.OriginalTxData)
      expect(schema).toBeDefined()
      expect(schema).toHaveProperty('type', 'object')
    })

    it('should be idempotent', () => {
      initOriginalTxData()
      const schema1 = getSchema(AJVSchemaEnum.OriginalTxData)
      
      initOriginalTxData()
      const schema2 = getSchema(AJVSchemaEnum.OriginalTxData)
      
      expect(schema1).toBe(schema2)
    })
  })

  describe('OriginalTxData schema validation', () => {
    let validate: any

    beforeEach(() => {
      initOriginalTxData()
      const schema = getSchema(AJVSchemaEnum.OriginalTxData)
      if (!schema) {
        throw new Error('Schema not found')
      }
      validate = ajv.compile(schema)
    })

    it('should validate a valid OriginalTxData object', () => {
      const validData = {
        txId: 'tx-123-abc',
        timestamp: 1234567890,
        cycle: 42,
        originalTxData: {
          from: '0x123',
          to: '0x456',
          value: 100,
          data: 'test'
        }
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
      expect(validate.errors).toBeNull()
    })

    it('should validate with minimum values', () => {
      const minData = {
        txId: '',
        timestamp: 0,
        cycle: -1,
        originalTxData: {}
      }

      const valid = validate(minData)
      expect(valid).toBe(true)
    })

    it('should validate with complex originalTxData', () => {
      const complexData = {
        txId: 'complex-tx-456',
        timestamp: 9876543210,
        cycle: 999,
        originalTxData: {
          nested: {
            deep: {
              data: [1, 2, 3],
              more: {
                info: 'here'
              }
            }
          },
          array: ['a', 'b', 'c'],
          number: 3.14159,
          boolean: true,
          null: null
        }
      }

      const valid = validate(complexData)
      expect(valid).toBe(true)
    })

    it('should reject missing required field: txId', () => {
      const invalidData = {
        timestamp: 123,
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'txId' }
        })
      )
    })

    it('should reject missing required field: timestamp', () => {
      const invalidData = {
        txId: 'tx-123',
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'timestamp' }
        })
      )
    })

    it('should reject missing required field: cycle', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'cycle' }
        })
      )
    })

    it('should reject missing required field: originalTxData', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: 1
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'originalTxData' }
        })
      )
    })

    it('should reject invalid type for txId', () => {
      const invalidData = {
        txId: 123, // Should be string
        timestamp: 123,
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('txId'),
          params: { type: 'string' }
        })
      )
    })

    it('should reject invalid type for timestamp', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: '123', // Should be integer
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('timestamp'),
          params: { type: 'integer' }
        })
      )
    })

    it('should reject negative timestamp', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: -1, // Must be >= 0
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minimum',
          dataPath: expect.stringContaining('timestamp')
        })
      )
    })

    it('should reject invalid type for cycle', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: '1', // Should be integer
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('cycle'),
          params: { type: 'integer' }
        })
      )
    })

    it('should reject cycle less than -1', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: -2, // Must be >= -1
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minimum',
          dataPath: expect.stringContaining('cycle')
        })
      )
    })

    it('should accept cycle value of -1', () => {
      const validData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: -1,
        originalTxData: {}
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
    })

    it('should reject invalid type for originalTxData', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: 1,
        originalTxData: 'not-an-object' // Should be object
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('originalTxData'),
          params: { type: 'object' }
        })
      )
    })

    it('should reject additional properties', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: 1,
        originalTxData: {},
        extraField: 'not allowed'
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          params: { additionalProperty: 'extraField' }
        })
      )
    })

    it('should accept very large timestamp values', () => {
      const validData = {
        txId: 'tx-123',
        timestamp: Number.MAX_SAFE_INTEGER,
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
    })

    it('should accept very large cycle values', () => {
      const validData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: Number.MAX_SAFE_INTEGER,
        originalTxData: {}
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
    })

    it('should handle floating point numbers for integer fields', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123.45, // Should be integer
        cycle: 1.5, // Should be integer
        originalTxData: {}
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
      // Both timestamp and cycle should fail
      const errors = validate.errors || []
      const typeErrors = errors.filter((e: any) => e.keyword === 'type')
      expect(typeErrors).toHaveLength(2)
    })

    it('should validate with empty string txId', () => {
      const validData = {
        txId: '',
        timestamp: 123,
        cycle: 1,
        originalTxData: {}
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
    })

    it('should validate originalTxData with null values', () => {
      const validData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: 1,
        originalTxData: {
          nullField: null,
          nested: {
            alsoNull: null
          }
        }
      }

      const valid = validate(validData)
      expect(valid).toBe(true)
    })

    it('should handle arrays as originalTxData', () => {
      const invalidData = {
        txId: 'tx-123',
        timestamp: 123,
        cycle: 1,
        originalTxData: [1, 2, 3] // Arrays are objects in JS, but schema expects object literal
      }

      const valid = validate(invalidData)
      expect(valid).toBe(false)
    })
  })

  describe('Schema structure', () => {
    it('should have correct structure', () => {
      initOriginalTxData()
      const schema = getSchema(AJVSchemaEnum.OriginalTxData)
      
      expect(schema).toEqual({
        type: 'object',
        properties: {
          txId: { type: 'string' },
          timestamp: { type: 'integer', minimum: 0 },
          cycle: { type: 'integer', minimum: -1 },
          originalTxData: { type: 'object' }
        },
        required: ['txId', 'timestamp', 'cycle', 'originalTxData'],
        additionalProperties: false
      })
    })

    it('should not have external dependencies', () => {
      initOriginalTxData()
      
      const registeredSchemas = Array.from(mockSchemaMap.keys())
      expect(registeredSchemas).toEqual([AJVSchemaEnum.OriginalTxData])
    })

    it('should have comment about sign field', () => {
      // This test documents that the sign field is commented out
      // If it's ever uncommented, this test will need to be updated
      const schema = getSchema(AJVSchemaEnum.OriginalTxData) as any
      expect(schema?.properties?.sign).toBeUndefined()
    })
  })
})