import { describe, expect, it } from '@jest/globals'
import { Ordering } from '../../../../src/utils/ordering'

describe('Ordering', () => {
  describe('Enum values', () => {
    it('should have correct Less value', () => {
      expect(Ordering.Less).toBe(-1)
    })

    it('should have correct Equal value', () => {
      expect(Ordering.Equal).toBe(0)
    })

    it('should have correct Greater value', () => {
      expect(Ordering.Greater).toBe(1)
    })

    it('should have exactly 3 values', () => {
      const values = Object.values(Ordering).filter(v => typeof v === 'number')
      expect(values).toHaveLength(3)
    })

    it('should have corresponding string keys', () => {
      expect(Ordering[Ordering.Less]).toBe('Less')
      expect(Ordering[Ordering.Equal]).toBe('Equal')
      expect(Ordering[Ordering.Greater]).toBe('Greater')
    })
  })

  describe('Usage in comparisons', () => {
    it('should work correctly in sorting functions', () => {
      const compare = (a: number, b: number): Ordering => {
        if (a < b) return Ordering.Less
        if (a > b) return Ordering.Greater
        return Ordering.Equal
      }

      expect(compare(1, 2)).toBe(Ordering.Less)
      expect(compare(2, 1)).toBe(Ordering.Greater)
      expect(compare(1, 1)).toBe(Ordering.Equal)
    })

    it('should work with array sort', () => {
      const items = [
        { value: 3, name: 'three' },
        { value: 1, name: 'one' },
        { value: 2, name: 'two' },
      ]

      items.sort((a, b) => {
        if (a.value < b.value) return Ordering.Less
        if (a.value > b.value) return Ordering.Greater
        return Ordering.Equal
      })

      expect(items[0].name).toBe('one')
      expect(items[1].name).toBe('two')
      expect(items[2].name).toBe('three')
    })
  })

  describe('Type safety', () => {
    it('should be assignable from numbers -1, 0, 1', () => {
      const less: Ordering = -1
      const equal: Ordering = 0
      const greater: Ordering = 1

      expect(less).toBe(Ordering.Less)
      expect(equal).toBe(Ordering.Equal)
      expect(greater).toBe(Ordering.Greater)
    })

    it('should not accept other numeric values at runtime', () => {
      // This test verifies runtime behavior
      const invalidValue = 2
      const validValues = Object.values(Ordering).filter(v => typeof v === 'number')
      expect(validValues).not.toContain(invalidValue)
    })
  })
})