import { ticketSchema, Sign, Ticket } from '../../../../src/schemas/ticketSchema'
import * as Ajv from 'ajv'

describe('ticketSchema', () => {
  let ajv: Ajv.Ajv
  let validate: any

  beforeEach(() => {
    ajv = new Ajv({ allErrors: true })
    validate = ajv.compile(ticketSchema)
  })

  describe('Schema validation', () => {
    it('should validate a valid single ticket array', () => {
      const validTickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          sign: [
            {
              owner: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
              sig: '0x' + 'a'.repeat(130)
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(validTickets)
      expect(valid).toBe(true)
      expect(validate.errors).toBeNull()
    })

    it('should validate multiple tickets in array', () => {
      const validTickets = [
        {
          data: [
            { address: '0x1111111111111111111111111111111111111111' },
            { address: '0x2222222222222222222222222222222222222222' }
          ],
          sign: [
            {
              owner: '0x3333333333333333333333333333333333333333',
              sig: '0x' + 'b'.repeat(130)
            }
          ],
          type: 'silver'
        },
        {
          data: [
            { address: '0x4444444444444444444444444444444444444444' }
          ],
          sign: [
            {
              owner: '0x5555555555555555555555555555555555555555',
              sig: '0x' + 'c'.repeat(130)
            },
            {
              owner: '0x6666666666666666666666666666666666666666',
              sig: '0x' + 'd'.repeat(130)
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(validTickets)
      expect(valid).toBe(true)
    })

    it('should validate empty array', () => {
      const emptyTickets: Ticket[] = []
      const valid = validate(emptyTickets)
      expect(valid).toBe(true)
    })

    it('should reject non-array input', () => {
      const invalidInput = {
        data: [],
        sign: [],
        type: 'silver'
      }

      const valid = validate(invalidInput)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'type',
          params: { type: 'array' }
        })
      )
    })

    it('should reject missing required field: data', () => {
      const invalidTickets = [
        {
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130)
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(invalidTickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'data' }
        })
      )
    })

    it('should reject missing required field: sign', () => {
      const invalidTickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(invalidTickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'sign' }
        })
      )
    })

    it('should reject missing required field: type', () => {
      const invalidTickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130)
            }
          ]
        }
      ]

      const valid = validate(invalidTickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'required',
          params: { missingProperty: 'type' }
        })
      )
    })

    it('should reject empty data array', () => {
      const invalidTickets = [
        {
          data: [],
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130)
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(invalidTickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minItems',
          dataPath: expect.stringContaining('data')
        })
      )
    })

    it('should reject empty sign array', () => {
      const invalidTickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          sign: [],
          type: 'silver'
        }
      ]

      const valid = validate(invalidTickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'minItems',
          dataPath: expect.stringContaining('sign')
        })
      )
    })

    it('should reject invalid address format', () => {
      const invalidAddresses = [
        '1234567890123456789012345678901234567890', // Missing 0x
        '0x123456789012345678901234567890123456789', // Too short
        '0x12345678901234567890123456789012345678901', // Too long
        '0xGHIJKL7890123456789012345678901234567890', // Invalid hex chars
        '0x123456789012345678901234567890123456789g', // Invalid char at end
        'not-an-address'
      ]

      invalidAddresses.forEach(invalidAddress => {
        const tickets = [
          {
            data: [{ address: invalidAddress }],
            sign: [
              {
                owner: '0x1234567890123456789012345678901234567890',
                sig: '0x' + 'a'.repeat(130)
              }
            ],
            type: 'silver'
          }
        ]

        const valid = validate(tickets)
        expect(valid).toBe(false)
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'pattern',
            dataPath: expect.stringContaining('address')
          })
        )
      })
    })

    it('should reject invalid owner format', () => {
      const invalidOwners = [
        '1234567890123456789012345678901234567890', // Missing 0x
        '0x123', // Too short
        '0xZZZZ567890123456789012345678901234567890', // Invalid hex
      ]

      invalidOwners.forEach(invalidOwner => {
        const tickets = [
          {
            data: [
              { address: '0x1234567890123456789012345678901234567890' }
            ],
            sign: [
              {
                owner: invalidOwner,
                sig: '0x' + 'a'.repeat(130)
              }
            ],
            type: 'silver'
          }
        ]

        const valid = validate(tickets)
        expect(valid).toBe(false)
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'pattern',
            dataPath: expect.stringContaining('owner')
          })
        )
      })
    })

    it('should reject invalid signature format', () => {
      const invalidSigs = [
        'a'.repeat(130), // Missing 0x
        '0x' + 'a'.repeat(129), // Too short
        '0x' + 'a'.repeat(131), // Too long
        '0x' + 'g'.repeat(130), // Invalid hex
      ]

      invalidSigs.forEach(invalidSig => {
        const tickets = [
          {
            data: [
              { address: '0x1234567890123456789012345678901234567890' }
            ],
            sign: [
              {
                owner: '0x1234567890123456789012345678901234567890',
                sig: invalidSig
              }
            ],
            type: 'silver'
          }
        ]

        const valid = validate(tickets)
        expect(valid).toBe(false)
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'pattern',
            dataPath: expect.stringContaining('sig')
          })
        )
      })
    })

    it('should reject invalid ticket type', () => {
      const invalidTypes = ['gold', 'bronze', 'platinum', '', 'SILVER', 'Silver']

      invalidTypes.forEach(invalidType => {
        const tickets = [
          {
            data: [
              { address: '0x1234567890123456789012345678901234567890' }
            ],
            sign: [
              {
                owner: '0x1234567890123456789012345678901234567890',
                sig: '0x' + 'a'.repeat(130)
              }
            ],
            type: invalidType
          }
        ]

        const valid = validate(tickets)
        expect(valid).toBe(false)
        expect(validate.errors).toContainEqual(
          expect.objectContaining({
            keyword: 'enum',
            dataPath: expect.stringContaining('type')
          })
        )
      })
    })

    it('should reject additional properties on ticket', () => {
      const tickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130)
            }
          ],
          type: 'silver',
          extraField: 'not allowed'
        }
      ]

      const valid = validate(tickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          params: { additionalProperty: 'extraField' }
        })
      )
    })

    it('should reject additional properties on data items', () => {
      const tickets = [
        {
          data: [
            { 
              address: '0x1234567890123456789012345678901234567890',
              extraField: 'not allowed'
            }
          ],
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130)
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(tickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          dataPath: expect.stringContaining('data')
        })
      )
    })

    it('should reject additional properties on sign items', () => {
      const tickets = [
        {
          data: [
            { address: '0x1234567890123456789012345678901234567890' }
          ],
          sign: [
            {
              owner: '0x1234567890123456789012345678901234567890',
              sig: '0x' + 'a'.repeat(130),
              timestamp: 123456 // extra field
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(tickets)
      expect(valid).toBe(false)
      expect(validate.errors).toContainEqual(
        expect.objectContaining({
          keyword: 'additionalProperties',
          dataPath: expect.stringContaining('sign')
        })
      )
    })

    it('should validate with mixed case hex in addresses and signatures', () => {
      const tickets = [
        {
          data: [
            { address: '0xAbCdEf1234567890123456789012345678901234' }
          ],
          sign: [
            {
              owner: '0xFeDcBa9876543210987654321098765432109876',
              sig: '0x' + 'aAbBcCdDeEfF'.repeat(10) + 'aAbBcCdDeE' // Exactly 130 hex chars
            }
          ],
          type: 'silver'
        }
      ]

      const valid = validate(tickets)
      expect(valid).toBe(true)
    })

    it('should handle multiple validation errors', () => {
      const tickets = [
        {
          data: [], // Empty array
          sign: [
            {
              owner: 'invalid', // Invalid format
              sig: 'invalid' // Invalid format
            }
          ],
          type: 'gold' // Invalid enum
        }
      ]

      const valid = validate(tickets)
      expect(valid).toBe(false)
      expect(validate.errors.length).toBeGreaterThan(1)
    })
  })

  describe('Type exports', () => {
    it('should create valid Sign type', () => {
      const sign: Sign = {
        owner: 'test-owner',
        sig: 'test-signature'
      }

      expect(sign.owner).toBe('test-owner')
      expect(sign.sig).toBe('test-signature')
    })

    it('should create valid Ticket type', () => {
      const ticket: Ticket = {
        data: [{ address: 'test-address' }],
        sign: [{ owner: 'test-owner', sig: 'test-sig' }],
        type: 'silver'
      }

      expect(ticket.data).toHaveLength(1)
      expect(ticket.sign).toHaveLength(1)
      expect(ticket.type).toBe('silver')
    })

    it('should enforce type safety', () => {
      const ticket: Ticket = {
        data: [],
        sign: [],
        type: 'silver'
      }

      // TypeScript ensures these are arrays
      expect(Array.isArray(ticket.data)).toBe(true)
      expect(Array.isArray(ticket.sign)).toBe(true)
    })
  })

  describe('Schema structure', () => {
    it('should have correct top-level structure', () => {
      expect(ticketSchema).toHaveProperty('type', 'array')
      expect(ticketSchema).toHaveProperty('items')
      expect(ticketSchema.items).toHaveProperty('type', 'object')
    })

    it('should have correct pattern for Ethereum addresses', () => {
      const addressPattern = ticketSchema.items.properties.data.items.properties.address.pattern
      expect(addressPattern).toBe('^0x[a-fA-F0-9]{40}$')
      
      // Test the pattern
      const regex = new RegExp(addressPattern)
      expect(regex.test('0x1234567890123456789012345678901234567890')).toBe(true)
      expect(regex.test('1234567890123456789012345678901234567890')).toBe(false)
      expect(regex.test('0x123456789012345678901234567890123456789')).toBe(false)
    })

    it('should have correct pattern for signatures', () => {
      const sigPattern = ticketSchema.items.properties.sign.items.properties.sig.pattern
      expect(sigPattern).toBe('^0x[a-fA-F0-9]{130}$')
      
      // Test the pattern
      const regex = new RegExp(sigPattern)
      expect(regex.test('0x' + 'a'.repeat(130))).toBe(true)
      expect(regex.test('0x' + 'a'.repeat(129))).toBe(false)
      expect(regex.test('a'.repeat(130))).toBe(false)
    })

    it('should only allow silver type', () => {
      const typeEnum = ticketSchema.items.properties.type.enum
      expect(typeEnum).toEqual(['silver'])
      expect(typeEnum).toHaveLength(1)
    })
  })
})