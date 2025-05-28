import { initAccounts } from '../../../../../src/types/ajv/Accounts'
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

describe('ajv/Accounts schemas', () => {
  let ajv: Ajv.Ajv

  beforeEach(() => {
    // Reset schemas before each test to ensure clean state
    resetSchemas()
    ajv = new Ajv({ allErrors: true })
  })

  afterEach(() => {
    // Clean up after each test
    resetSchemas()
  })

  describe('initAccounts', () => {
    it('should initialize accounts schemas without errors', () => {
      expect(() => initAccounts()).not.toThrow()
    })

    it('should register AccountsCopy schema', () => {
      initAccounts()
      const schema = getSchema(AJVSchemaEnum.AccountsCopy)
      expect(schema).toBeDefined()
      expect(schema).toHaveProperty('type', 'object')
    })

    it('should only register AccountsCopy schema', () => {
      initAccounts()
      // Only AccountsCopy is registered, DbAccountCopy is defined but not registered
      const registeredSchemas = Array.from(mockSchemaMap.keys())
      expect(registeredSchemas).toEqual([AJVSchemaEnum.AccountsCopy])
    })

    it('should be idempotent', () => {
      initAccounts()
      const schema1 = getSchema(AJVSchemaEnum.AccountsCopy)
      
      // Call init again
      initAccounts()
      const schema2 = getSchema(AJVSchemaEnum.AccountsCopy)
      
      expect(schema1).toBe(schema2)
    })
  })

  describe('AccountsCopy schema', () => {
    let validate: any

    beforeEach(() => {
      initAccounts()
      const schema = getSchema(AJVSchemaEnum.AccountsCopy)
      if (!schema) {
        throw new Error('Schema not found')
      }
      validate = ajv.compile(schema)
    })

    it('should validate a valid AccountsCopy object', () => {
      const validAccount = {
        accountId: 'acc-123',
        data: { balance: 100, name: 'Test Account' },
        timestamp: 1234567890,
        hash: 'hash-abc-123',
        isGlobal: true
      }

      const valid = validate(validAccount)
      expect(valid).toBe(true)
      expect(validate.errors).toBeNull()
    })

    it('should validate with cycleNumber field', () => {
      const accountWithCycle = {
        accountId: 'acc-456',
        data: { value: 'test' },
        timestamp: 9876543210,
        hash: 'hash-def-456',
        cycleNumber: 42,
        isGlobal: false
      }

      const valid = validate(accountWithCycle)
      expect(valid).toBe(true)
    })

    it('should validate without cycleNumber field (optional)', () => {
      const accountWithoutCycle = {
        accountId: 'acc-789',
        data: {},
        timestamp: 0,
        hash: 'hash-ghi-789',
        isGlobal: true
      }

      const valid = validate(accountWithoutCycle)
      expect(valid).toBe(true)
    })

    it('should handle cycleNumber with null value', () => {
      // Note: nullable keyword is not standard AJV, so null might not validate as expected
      // This test documents the actual behavior
      const accountWithNullCycle = {
        accountId: 'acc-789',
        data: {},
        timestamp: 0,
        hash: 'hash-ghi-789',
        cycleNumber: null,
        isGlobal: true
      }

      const valid = validate(accountWithNullCycle)
      // Without ajv-keywords, null won't validate as integer
      expect(valid).toBe(false)
      if (!valid && validate.errors) {
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'type',
            dataPath: expect.stringContaining('cycleNumber')
          })
        )
      }
    })

    it('should accept complex nested data objects', () => {
      const complexAccount = {
        accountId: 'complex-123',
        data: {
          level1: {
            level2: {
              level3: {
                array: [1, 2, 3],
                string: 'nested',
                boolean: true,
                number: 3.14159
              }
            }
          },
          dynamicKey: 'dynamicValue',
          'special-key': 'special-value'
        },
        timestamp: 1000000,
        hash: 'complex-hash',
        isGlobal: false
      }

      const valid = validate(complexAccount)
      expect(valid).toBe(true)
    })

    it('should reject missing required field: accountId', () => {
      const invalidAccount = {
        data: { test: 'data' },
        timestamp: 123,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'accountId' }
        })
      )
    })

    it('should reject missing required field: data', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        timestamp: 123,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'data' }
        })
      )
    })

    it('should reject missing required field: timestamp', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'timestamp' }
        })
      )
    })

    it('should reject missing required field: hash', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: 123,
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'hash' }
        })
      )
    })

    it('should reject missing required field: isGlobal', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: 123,
        hash: 'hash'
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'isGlobal' }
        })
      )
    })

    it('should reject invalid type for accountId', () => {
      const invalidAccount = {
        accountId: 123, // Should be string
        data: {},
        timestamp: 123,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('accountId'),
          params: { type: 'string' }
        })
      )
    })

    it('should reject invalid type for data', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: 'not-an-object', // Should be object
        timestamp: 123,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('data'),
          params: { type: 'object' }
        })
      )
    })

    it('should reject invalid type for timestamp', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: '123', // Should be integer
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
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
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: -1, // Should be >= 0
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minimum',
          dataPath: expect.stringContaining('timestamp')
        })
      )
    })

    it('should reject invalid type for isGlobal', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: 123,
        hash: 'hash',
        isGlobal: 'true' // Should be boolean
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('isGlobal'),
          params: { type: 'boolean' }
        })
      )
    })

    it('should reject invalid type for cycleNumber', () => {
      const invalidAccount = {
        accountId: 'acc-123',
        data: {},
        timestamp: 123,
        hash: 'hash',
        isGlobal: true,
        cycleNumber: '42' // Should be integer or null
      }

      const valid = validate(invalidAccount)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          dataPath: expect.stringContaining('cycleNumber'),
          params: { type: 'integer' }
        })
      )
    })

    it('should accept empty string values', () => {
      const account = {
        accountId: '',
        data: {},
        timestamp: 0,
        hash: '',
        isGlobal: false
      }

      const valid = validate(account)
      expect(valid).toBe(true)
    })

    it('should accept very large timestamp values', () => {
      const account = {
        accountId: 'acc-123',
        data: {},
        timestamp: Number.MAX_SAFE_INTEGER,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(account)
      expect(valid).toBe(true)
    })

    it('should handle additional properties', () => {
      const accountWithExtra = {
        accountId: 'acc-123',
        data: {},
        timestamp: 123,
        hash: 'hash',
        isGlobal: true,
        extraField: 'should be allowed',
        anotherExtra: 123
      }

      const valid = validate(accountWithExtra)
      expect(valid).toBe(true)
    })

    it('should validate data with null and undefined values', () => {
      const account = {
        accountId: 'acc-123',
        data: {
          nullValue: null,
          undefinedValue: undefined,
          nested: {
            alsoNull: null
          }
        },
        timestamp: 123,
        hash: 'hash',
        isGlobal: true
      }

      const valid = validate(account)
      expect(valid).toBe(true)
    })
  })

  describe('Schema structure', () => {
    it('should have correct structure for AccountsCopy schema', () => {
      initAccounts()
      const schema = getSchema(AJVSchemaEnum.AccountsCopy)
      
      expect(schema).toEqual({
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          data: { type: 'object', additionalProperties: true },
          timestamp: { type: 'integer', minimum: 0 },
          hash: { type: 'string' },
          cycleNumber: { type: 'integer', nullable: true },
          isGlobal: { type: 'boolean' },
        },
        required: ['accountId', 'data', 'timestamp', 'hash', 'isGlobal']
      })
    })

    it('should not have external dependencies', () => {
      // The addSchemaDependencies function is empty, indicating no dependencies
      // This test verifies that behavior doesn't change
      initAccounts()
      
      // If there were dependencies, they would be registered before the main schema
      // Since there are none, only AccountsCopy should be registered
      const registeredSchemas = Object.values(AJVSchemaEnum).filter(enumValue => {
        return getSchema(enumValue) !== undefined
      })
      
      expect(registeredSchemas).toEqual([AJVSchemaEnum.AccountsCopy])
    })
  })
})