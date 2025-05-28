import { initReceipts } from '../../../../../src/types/ajv/Receipts'
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

describe('ajv/Receipts schemas', () => {
  let ajv: Ajv.Ajv

  beforeEach(() => {
    resetSchemas()
    ajv = new Ajv({ allErrors: true })
  })

  afterEach(() => {
    resetSchemas()
  })

  describe('initReceipts', () => {
    it('should initialize without errors', () => {
      expect(() => initReceipts()).not.toThrow()
    })

    it('should register all receipt schemas', () => {
      initReceipts()
      
      expect(getSchema(AJVSchemaEnum.ArchiverReceipt)).toBeDefined()
      expect(getSchema(AJVSchemaEnum.Receipt)).toBeDefined()
      expect(getSchema(AJVSchemaEnum.GlobalTxReceipt)).toBeDefined()
    })

    it('should be idempotent', () => {
      initReceipts()
      const schema1 = getSchema(AJVSchemaEnum.Receipt)
      
      initReceipts()
      const schema2 = getSchema(AJVSchemaEnum.Receipt)
      
      expect(schema1).toBe(schema2)
    })
  })

  describe('GlobalTxReceipt schema validation', () => {
    let validate: any

    beforeEach(() => {
      initReceipts()
      const schema = getSchema(AJVSchemaEnum.GlobalTxReceipt)
      if (!schema) {
        throw new Error('Schema not found')
      }
      validate = ajv.compile(schema)
    })

    it('should validate a valid GlobalTxReceipt', () => {
      const validReceipt = {
        signs: [
          { owner: '0xowner1', sig: '0xsig1' },
          { owner: '0xowner2', sig: '0xsig2' }
        ],
        tx: {
          address: '0x123456',
          addressHash: 'hash123',
          value: { amount: 100 },
          when: 1234567890,
          source: 'test-source',
          txId: 'tx-123',
          afterStateHash: 'state-hash-123'
        }
      }

      const valid = validate(validReceipt)
      expect(valid).toBe(true)
      expect(validate.errors).toBeNull()
    })

    it('should validate with txGroupCycle', () => {
      const receipt = {
        signs: [{ owner: 'owner', sig: 'sig' }],
        tx: {
          address: 'addr',
          addressHash: 'hash',
          value: {},
          when: 123,
          source: 'src',
          txId: 'tx1',
          afterStateHash: 'hash2'
        },
        txGroupCycle: 42
      }

      const valid = validate(receipt)
      expect(valid).toBe(true)
    })

    it('should reject missing signs', () => {
      const invalidReceipt = {
        tx: {
          address: 'addr',
          addressHash: 'hash',
          value: {},
          when: 123,
          source: 'src',
          txId: 'tx1',
          afterStateHash: 'hash2'
        }
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'signs' }
        })
      )
    })

    it('should reject additional properties', () => {
      const invalidReceipt = {
        signs: [],
        tx: {
          address: 'addr',
          addressHash: 'hash',
          value: {},
          when: 123,
          source: 'src',
          txId: 'tx1',
          afterStateHash: 'hash2'
        },
        consensusGroup: 'should not be allowed'
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          params: { additionalProperty: 'consensusGroup' }
        })
      )
    })

    it('should validate empty signs array', () => {
      const receipt = {
        signs: [],
        tx: {
          address: 'addr',
          addressHash: 'hash',
          value: null,
          when: 0,
          source: '',
          txId: '',
          afterStateHash: ''
        }
      }

      const valid = validate(receipt)
      expect(valid).toBe(true)
    })

    it('should reject negative txGroupCycle', () => {
      const receipt = {
        signs: [],
        tx: {
          address: 'addr',
          addressHash: 'hash',
          value: {},
          when: 123,
          source: 'src',
          txId: 'tx1',
          afterStateHash: 'hash2'
        },
        txGroupCycle: -1
      }

      const valid = validate(receipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minimum',
          dataPath: expect.stringContaining('txGroupCycle')
        })
      )
    })
  })

  describe('ArchiverReceipt schema validation', () => {
    let validate: any

    beforeEach(() => {
      initReceipts()
      const schema = getSchema(AJVSchemaEnum.ArchiverReceipt)
      if (!schema) {
        throw new Error('Schema not found')
      }
      
      // Add referenced schemas for validation
      ajv.addSchema({
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          data: { type: 'object' },
          timestamp: { type: 'integer' },
          hash: { type: 'string' },
          isGlobal: { type: 'boolean' }
        },
        required: ['accountId', 'data', 'timestamp', 'hash', 'isGlobal']
      }, AJVSchemaEnum.AccountsCopy)
      
      ajv.addSchema({
        type: 'object',
        properties: {
          txId: { type: 'string' },
          timestamp: { type: 'integer' },
          cycle: { type: 'integer' },
          originalTxData: { type: 'object' }
        },
        required: ['txId', 'timestamp', 'cycle', 'originalTxData']
      }, AJVSchemaEnum.OriginalTxData)
      
      validate = ajv.compile(schema)
    })

    it('should validate a valid ArchiverReceipt with SignedReceipt', () => {
      const validReceipt = {
        tx: {
          originalTxData: { data: 'test' },
          txId: 'tx-123',
          timestamp: 1234567890
        },
        cycle: 10,
        signedReceipt: {
          proposal: {
            applied: true,
            cant_preApply: false,
            accountIDs: ['acc1', 'acc2'],
            beforeStateHashes: ['hash1', 'hash2'],
            afterStateHashes: ['hash3', 'hash4'],
            appReceiptDataHash: 'app-hash',
            txid: 'tx-123'
          },
          proposalHash: 'proposal-hash',
          signaturePack: [
            { owner: 'node1', sig: 'sig1' },
            { owner: 'node2', sig: 'sig2' }
          ],
          voteOffsets: [0, 1]
        },
        appReceiptData: {
          data: { result: 'success' }
        },
        globalModification: false
      }

      const valid = validate(validReceipt)
      expect(valid).toBe(true)
    })

    it('should validate a valid ArchiverReceipt with GlobalTxReceipt', () => {
      const validReceipt = {
        tx: {
          originalTxData: {},
          txId: 'tx-456',
          timestamp: 9876543210
        },
        cycle: 20,
        signedReceipt: {
          signs: [{ owner: 'owner1', sig: 'sig1' }],
          tx: {
            address: 'addr',
            addressHash: 'hash',
            value: 'value',
            when: 123,
            source: 'source',
            txId: 'tx-456',
            afterStateHash: 'state-hash'
          }
        },
        appReceiptData: {
          accountId: 'acc-123',
          data: {}
        },
        globalModification: true
      }

      const valid = validate(validReceipt)
      expect(valid).toBe(true)
    })

    it('should validate with afterStates and beforeStates', () => {
      const receipt = {
        tx: {
          originalTxData: {},
          txId: 'tx-789',
          timestamp: 123
        },
        cycle: 5,
        signedReceipt: {
          signs: [],
          tx: {
            address: 'a',
            addressHash: 'h',
            value: 'v',
            when: 1,
            source: 's',
            txId: 't',
            afterStateHash: 'ash'
          }
        },
        afterStates: [
          {
            accountId: 'acc1',
            data: {},
            timestamp: 123,
            hash: 'h1',
            isGlobal: false
          }
        ],
        beforeStates: [
          {
            accountId: 'acc2',
            data: {},
            timestamp: 456,
            hash: 'h2',
            isGlobal: true
          }
        ],
        appReceiptData: {
          data: {}
        },
        globalModification: false
      }

      const valid = validate(receipt)
      expect(valid).toBe(true)
    })

    it('should reject missing required fields', () => {
      const invalidReceipt = {
        tx: {
          originalTxData: {},
          txId: 'tx-123',
          timestamp: 123
        },
        cycle: 1
        // Missing signedReceipt, appReceiptData, globalModification
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      
      const missingProps = ['signedReceipt', 'appReceiptData', 'globalModification']
      missingProps.forEach(prop => {
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'required',
            params: { missingProperty: prop }
          })
        )
      })
    })

    it('should reject invalid signedReceipt (not matching oneOf)', () => {
      const invalidReceipt = {
        tx: {
          originalTxData: {},
          txId: 'tx-123',
          timestamp: 123
        },
        cycle: 1,
        signedReceipt: {
          // Invalid - has neither SignedReceipt nor GlobalTxReceipt structure
          invalidField: 'test'
        },
        appReceiptData: { data: {} },
        globalModification: false
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'oneOf'
        })
      )
    })
  })

  describe('Receipt schema validation', () => {
    let validate: any

    beforeEach(() => {
      initReceipts()
      const schema = getSchema(AJVSchemaEnum.Receipt)
      if (!schema) {
        throw new Error('Schema not found')
      }
      
      // Add referenced schemas
      ajv.addSchema({
        type: 'object',
        properties: {
          accountId: { type: 'string' },
          data: { type: 'object' },
          timestamp: { type: 'integer' },
          hash: { type: 'string' },
          isGlobal: { type: 'boolean' }
        },
        required: ['accountId', 'data', 'timestamp', 'hash', 'isGlobal']
      }, AJVSchemaEnum.AccountsCopy)
      
      ajv.addSchema({
        type: 'object',
        properties: {
          txId: { type: 'string' },
          timestamp: { type: 'integer' },
          cycle: { type: 'integer' },
          originalTxData: { type: 'object' }
        },
        required: ['txId', 'timestamp', 'cycle', 'originalTxData']
      }, AJVSchemaEnum.OriginalTxData)
      
      validate = ajv.compile(schema)
    })

    it('should validate a complete Receipt', () => {
      const validReceipt = {
        receiptId: 'receipt-123',
        timestamp: 1234567890,
        applyTimestamp: 1234567900,
        tx: {
          originalTxData: { test: true },
          txId: 'tx-123',
          timestamp: 1234567880
        },
        cycle: 100,
        signedReceipt: {
          signs: [],
          tx: {
            address: 'addr',
            addressHash: 'hash',
            value: {},
            when: 123,
            source: 'src',
            txId: 'tx-123',
            afterStateHash: 'hash'
          }
        },
        appReceiptData: {
          data: { status: 'applied' }
        },
        globalModification: false
      }

      const valid = validate(validReceipt)
      expect(valid).toBe(true)
    })

    it('should reject missing receiptId', () => {
      const invalidReceipt = {
        // Missing receiptId
        timestamp: 123,
        applyTimestamp: 456,
        tx: {
          originalTxData: {},
          txId: 'tx',
          timestamp: 100
        },
        cycle: 1,
        signedReceipt: {
          signs: [],
          tx: {
            address: 'a',
            addressHash: 'h',
            value: 'v',
            when: 1,
            source: 's',
            txId: 't',
            afterStateHash: 'ash'
          }
        },
        appReceiptData: { data: {} },
        globalModification: false
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'receiptId' }
        })
      )
    })

    it('should validate with all optional arrays', () => {
      const receipt = {
        receiptId: 'r-123',
        timestamp: 100,
        applyTimestamp: 200,
        tx: {
          originalTxData: {},
          txId: 'tx-1',
          timestamp: 50
        },
        cycle: 0,
        signedReceipt: {
          proposal: {
            applied: false,
            cant_preApply: true,
            accountIDs: [],
            beforeStateHashes: [],
            afterStateHashes: [],
            appReceiptDataHash: '',
            txid: 'tx-1',
            executionShardKey: 'shard-1'
          },
          proposalHash: 'ph',
          signaturePack: [],
          voteOffsets: [],
          sign: { owner: 'o', sig: 's' },
          txGroupCycle: 0
        },
        afterStates: [],
        beforeStates: [],
        appReceiptData: {
          accountId: 'acc',
          data: {},
          extraField: 'allowed'
        },
        globalModification: true
      }

      const valid = validate(receipt)
      expect(valid).toBe(true)
    })

    it('should reject additional properties on Receipt', () => {
      const invalidReceipt = {
        receiptId: 'r-123',
        timestamp: 100,
        applyTimestamp: 200,
        tx: {
          originalTxData: {},
          txId: 'tx-1',
          timestamp: 50
        },
        cycle: 0,
        signedReceipt: {
          signs: [],
          tx: {
            address: 'a',
            addressHash: 'h',
            value: 'v',
            when: 1,
            source: 's',
            txId: 't',
            afterStateHash: 'ash'
          }
        },
        appReceiptData: { data: {} },
        globalModification: false,
        extraField: 'not allowed'
      }

      const valid = validate(invalidReceipt)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          params: { additionalProperty: 'extraField' }
        })
      )
    })
  })

  describe('Schema structure', () => {
    it('should have correct structure for all schemas', () => {
      initReceipts()
      
      const archiverReceipt = getSchema(AJVSchemaEnum.ArchiverReceipt)
      expect(archiverReceipt).toBeDefined()
      expect(archiverReceipt).toHaveProperty('type', 'object')
      expect(archiverReceipt).toHaveProperty('required')
      expect(archiverReceipt).toHaveProperty('additionalProperties', false)
      
      const receipt = getSchema(AJVSchemaEnum.Receipt)
      expect(receipt).toBeDefined()
      expect(receipt).toHaveProperty('type', 'object')
      expect(receipt).toHaveProperty('required')
      expect(receipt).toHaveProperty('properties.receiptId')
      
      const globalTxReceipt = getSchema(AJVSchemaEnum.GlobalTxReceipt)
      expect(globalTxReceipt).toBeDefined()
      expect(globalTxReceipt).toHaveProperty('type', 'object')
      expect(globalTxReceipt).toHaveProperty('properties.signs')
      expect(globalTxReceipt).toHaveProperty('properties.tx')
    })

    it('should register exactly 3 schemas', () => {
      initReceipts()
      
      const registeredSchemas = Array.from(mockSchemaMap.keys())
      expect(registeredSchemas).toHaveLength(3)
      expect(registeredSchemas).toContain(AJVSchemaEnum.ArchiverReceipt)
      expect(registeredSchemas).toContain(AJVSchemaEnum.Receipt)
      expect(registeredSchemas).toContain(AJVSchemaEnum.GlobalTxReceipt)
    })

    it('should have correct oneOf for signedReceipt', () => {
      initReceipts()
      
      const archiverReceipt = getSchema(AJVSchemaEnum.ArchiverReceipt) as any
      expect(archiverReceipt.properties.signedReceipt).toHaveProperty('oneOf')
      expect(archiverReceipt.properties.signedReceipt.oneOf).toHaveLength(2)
    })

    it('should reference external schemas correctly', () => {
      initReceipts()
      
      const archiverReceipt = getSchema(AJVSchemaEnum.ArchiverReceipt) as any
      
      // Check afterStates references AccountsCopy
      expect(archiverReceipt.properties.afterStates.items).toHaveProperty('$ref', AJVSchemaEnum.AccountsCopy)
      
      // Check beforeStates references AccountsCopy
      expect(archiverReceipt.properties.beforeStates.items).toHaveProperty('$ref', AJVSchemaEnum.AccountsCopy)
      
      // Check tx.originalTxData references OriginalTxData
      expect(archiverReceipt.properties.tx.properties.originalTxData.items).toHaveProperty('$ref', AJVSchemaEnum.OriginalTxData)
    })
  })
})