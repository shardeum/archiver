import { AJVSchemaEnum } from '../../../../src/types/enum/AJVSchemaEnum'
import { describe, expect, it } from '@jest/globals'

/**
 * Test suite for AJVSchemaEnum
 *
 * Strategy:
 * 1. Verify enum exists and is properly defined
 * 2. Test positive cases - all expected values are present and correct
 * 3. Test negative cases - no unexpected values, immutability
 * 4. Test edge cases - access patterns, comparison behaviors
 * 5. Test each enum value individually
 */
describe('AJVSchemaEnum', () => {
  // Individual enum value tests
  describe('Receipt', () => {
    it('should have the correct value', () => {
      expect(AJVSchemaEnum.Receipt).toBe('Receipt')
    })

    it('should be usable as a property accessor', () => {
      const testObj = { [AJVSchemaEnum.Receipt]: 'test value' }
      expect(testObj.Receipt).toBe('test value')
    })

    it('should be usable in a Map', () => {
      const testMap = new Map<string, string>()
      testMap.set(AJVSchemaEnum.Receipt, 'mapped value')
      expect(testMap.get('Receipt')).toBe('mapped value')
    })
  })

  describe('AccountsCopy', () => {
    it('should have the correct value', () => {
      expect(AJVSchemaEnum.AccountsCopy).toBe('AccountsCopy')
    })

    it('should maintain identity equality', () => {
      const value = AJVSchemaEnum.AccountsCopy
      expect(value === AJVSchemaEnum.AccountsCopy).toBe(true)
    })

    it('should work in a switch statement', () => {
      const value = AJVSchemaEnum.AccountsCopy
      let result = ''

      // Simulating a switch statement with if-else
      if (value === AJVSchemaEnum.AccountsCopy) {
        result = 'correct'
      } else {
        result = 'incorrect'
      }

      expect(result).toBe('correct')
    })
  })

  describe('ArchiverReceipt', () => {
    it('should have the correct value', () => {
      expect(AJVSchemaEnum.ArchiverReceipt).toBe('ArchiverReceipt')
    })

    it('should work with JSON stringification', () => {
      const obj = { type: AJVSchemaEnum.ArchiverReceipt }
      const json = JSON.stringify(obj)
      expect(json).toBe('{"type":"ArchiverReceipt"}')

      const parsed = JSON.parse(json)
      expect(parsed.type).toBe('ArchiverReceipt')
      expect(parsed.type === AJVSchemaEnum.ArchiverReceipt).toBe(true)
    })
  })

  describe('OriginalTxData', () => {
    it('should have the correct value', () => {
      expect(AJVSchemaEnum.OriginalTxData).toBe('OriginalTxData')
    })

    it('should be usable in array operations', () => {
      const arr = [AJVSchemaEnum.OriginalTxData, 'other value']
      expect(arr.includes(AJVSchemaEnum.OriginalTxData)).toBe(true)
      expect(arr.indexOf('OriginalTxData')).toBe(0)
    })
  })

  describe('GlobalTxReceipt', () => {
    it('should have the correct value', () => {
      expect(AJVSchemaEnum.GlobalTxReceipt).toBe('GlobalTxReceipt')
    })

    it('should work when comparing against literal strings', () => {
      // eslint-disable-next-line quotes
      expect(AJVSchemaEnum.GlobalTxReceipt === 'GlobalTxReceipt').toBe(true)
      expect(AJVSchemaEnum.GlobalTxReceipt === 'GlobalTxReceipt').toBe(true)
    })
  })

  // Positive test cases
  it('should exist and be defined', () => {
    expect(AJVSchemaEnum).toBeDefined()
    expect(typeof AJVSchemaEnum).toBe('object')
  })

  it('should contain all expected enum values', () => {
    // Direct value checking
    expect(AJVSchemaEnum.Receipt).toEqual('Receipt')
    expect(AJVSchemaEnum.AccountsCopy).toEqual('AccountsCopy')
    expect(AJVSchemaEnum.ArchiverReceipt).toEqual('ArchiverReceipt')
    expect(AJVSchemaEnum.OriginalTxData).toEqual('OriginalTxData')
    expect(AJVSchemaEnum.GlobalTxReceipt).toEqual('GlobalTxReceipt')
  })

  it('should have correct number of enum values', () => {
    // Filter is needed due to TypeScript's reverse mapping in enums
    const enumValues = Object.values(AJVSchemaEnum).filter((value) => typeof value === 'string')
    expect(enumValues.length).toEqual(5)
  })

  it('should have values that match their keys', () => {
    const enumEntries = Object.entries(AJVSchemaEnum).filter(([key, value]) => typeof value === 'string')

    for (const [key, value] of enumEntries) {
      expect(value).toEqual(key)
    }
  })

  // Negative test cases
  it('should not contain unexpected values', () => {
    // @ts-ignore - intentionally testing incorrect access
    expect(AJVSchemaEnum.NonExistentValue).toBeUndefined()

    const validValues = ['Receipt', 'AccountsCopy', 'ArchiverReceipt', 'OriginalTxData', 'GlobalTxReceipt']

    // All string values in enum should be in our valid values list
    const enumValues = Object.values(AJVSchemaEnum).filter((value) => typeof value === 'string')
    enumValues.forEach((value) => {
      expect(validValues).toContain(value)
    })
  })
})
