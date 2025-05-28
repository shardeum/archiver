import { DevSecurityLevel } from '../../../../src/types/security'

describe('security types', () => {
  describe('DevSecurityLevel enum', () => {
    it('should have correct numeric values for all security levels', () => {
      expect(DevSecurityLevel.NONE).toBe(0)
      expect(DevSecurityLevel.LOW).toBe(1)
      expect(DevSecurityLevel.MEDIUM).toBe(2)
      expect(DevSecurityLevel.HIGH).toBe(3)
    })

    it('should have exactly 4 security levels', () => {
      const numericValues = Object.values(DevSecurityLevel)
        .filter(v => typeof v === 'number')
      
      expect(numericValues).toHaveLength(4)
    })

    it('should be able to get string keys from enum values', () => {
      expect(DevSecurityLevel[DevSecurityLevel.NONE]).toBe('NONE')
      expect(DevSecurityLevel[DevSecurityLevel.LOW]).toBe('LOW')
      expect(DevSecurityLevel[DevSecurityLevel.MEDIUM]).toBe('MEDIUM')
      expect(DevSecurityLevel[DevSecurityLevel.HIGH]).toBe('HIGH')
    })

    it('should be able to get numeric values from string keys', () => {
      expect(DevSecurityLevel['NONE']).toBe(0)
      expect(DevSecurityLevel['LOW']).toBe(1)
      expect(DevSecurityLevel['MEDIUM']).toBe(2)
      expect(DevSecurityLevel['HIGH']).toBe(3)
    })

    it('should maintain correct ordering from NONE to HIGH', () => {
      expect(DevSecurityLevel.NONE).toBeLessThan(DevSecurityLevel.LOW)
      expect(DevSecurityLevel.LOW).toBeLessThan(DevSecurityLevel.MEDIUM)
      expect(DevSecurityLevel.MEDIUM).toBeLessThan(DevSecurityLevel.HIGH)
    })

    it('should work in comparison operations', () => {
      const userLevel = DevSecurityLevel.LOW
      const requiredLevel = DevSecurityLevel.MEDIUM
      
      expect(userLevel < requiredLevel).toBe(true)
      expect(userLevel >= requiredLevel).toBe(false)
      expect(DevSecurityLevel.HIGH >= requiredLevel).toBe(true)
    })

    it('should work in switch statements', () => {
      const getSecurityDescription = (level: DevSecurityLevel): string => {
        switch (level) {
          case DevSecurityLevel.NONE:
            return 'No security'
          case DevSecurityLevel.LOW:
            return 'Low security'
          case DevSecurityLevel.MEDIUM:
            return 'Medium security'
          case DevSecurityLevel.HIGH:
            return 'High security'
          default:
            return 'Unknown'
        }
      }
      
      expect(getSecurityDescription(DevSecurityLevel.NONE)).toBe('No security')
      expect(getSecurityDescription(DevSecurityLevel.LOW)).toBe('Low security')
      expect(getSecurityDescription(DevSecurityLevel.MEDIUM)).toBe('Medium security')
      expect(getSecurityDescription(DevSecurityLevel.HIGH)).toBe('High security')
    })

    it('should be usable in type guards', () => {
      const isValidSecurityLevel = (value: unknown): value is DevSecurityLevel => {
        return typeof value === 'number' && 
               value >= DevSecurityLevel.NONE && 
               value <= DevSecurityLevel.HIGH
      }
      
      expect(isValidSecurityLevel(0)).toBe(true)
      expect(isValidSecurityLevel(1)).toBe(true)
      expect(isValidSecurityLevel(2)).toBe(true)
      expect(isValidSecurityLevel(3)).toBe(true)
      expect(isValidSecurityLevel(4)).toBe(false)
      expect(isValidSecurityLevel(-1)).toBe(false)
      expect(isValidSecurityLevel('HIGH')).toBe(false)
      expect(isValidSecurityLevel(null)).toBe(false)
      expect(isValidSecurityLevel(undefined)).toBe(false)
    })

    it('should work with array operations', () => {
      const allLevels = [
        DevSecurityLevel.NONE,
        DevSecurityLevel.LOW,
        DevSecurityLevel.MEDIUM,
        DevSecurityLevel.HIGH
      ]
      
      expect(allLevels).toHaveLength(4)
      expect(allLevels.includes(DevSecurityLevel.MEDIUM)).toBe(true)
      expect(allLevels.indexOf(DevSecurityLevel.HIGH)).toBe(3)
      
      const highSecurityLevels = allLevels.filter(level => level >= DevSecurityLevel.MEDIUM)
      expect(highSecurityLevels).toEqual([DevSecurityLevel.MEDIUM, DevSecurityLevel.HIGH])
    })

    it('should be serializable to JSON and back', () => {
      const config = {
        minLevel: DevSecurityLevel.LOW,
        maxLevel: DevSecurityLevel.HIGH,
        currentLevel: DevSecurityLevel.MEDIUM
      }
      
      const json = JSON.stringify(config)
      const parsed = JSON.parse(json)
      
      expect(parsed.minLevel).toBe(1)
      expect(parsed.maxLevel).toBe(3)
      expect(parsed.currentLevel).toBe(2)
      
      // Can be used again as enum values
      expect(parsed.minLevel).toBe(DevSecurityLevel.LOW)
      expect(parsed.maxLevel).toBe(DevSecurityLevel.HIGH)
      expect(parsed.currentLevel).toBe(DevSecurityLevel.MEDIUM)
    })

    it('should handle boundary values correctly', () => {
      const minLevel = DevSecurityLevel.NONE
      const maxLevel = DevSecurityLevel.HIGH
      
      expect(minLevel).toBe(0)
      expect(maxLevel).toBe(3)
      
      // Test that values outside the range don't exist
      expect(DevSecurityLevel[-1]).toBeUndefined()
      expect(DevSecurityLevel[4]).toBeUndefined()
    })

    it('should be usable for access control logic', () => {
      const checkAccess = (userLevel: DevSecurityLevel, requiredLevel: DevSecurityLevel): boolean => {
        return userLevel >= requiredLevel
      }
      
      // NONE user can't access anything except NONE
      expect(checkAccess(DevSecurityLevel.NONE, DevSecurityLevel.NONE)).toBe(true)
      expect(checkAccess(DevSecurityLevel.NONE, DevSecurityLevel.LOW)).toBe(false)
      
      // LOW user can access NONE and LOW
      expect(checkAccess(DevSecurityLevel.LOW, DevSecurityLevel.NONE)).toBe(true)
      expect(checkAccess(DevSecurityLevel.LOW, DevSecurityLevel.LOW)).toBe(true)
      expect(checkAccess(DevSecurityLevel.LOW, DevSecurityLevel.MEDIUM)).toBe(false)
      
      // HIGH user can access everything
      expect(checkAccess(DevSecurityLevel.HIGH, DevSecurityLevel.NONE)).toBe(true)
      expect(checkAccess(DevSecurityLevel.HIGH, DevSecurityLevel.LOW)).toBe(true)
      expect(checkAccess(DevSecurityLevel.HIGH, DevSecurityLevel.MEDIUM)).toBe(true)
      expect(checkAccess(DevSecurityLevel.HIGH, DevSecurityLevel.HIGH)).toBe(true)
    })

    it('should work with Object methods', () => {
      const entries = Object.entries(DevSecurityLevel)
        .filter(([key]) => isNaN(Number(key)))
      
      expect(entries).toEqual([
        ['NONE', 0],
        ['LOW', 1],
        ['MEDIUM', 2],
        ['HIGH', 3]
      ])
      
      const keys = Object.keys(DevSecurityLevel)
        .filter(key => isNaN(Number(key)))
      
      expect(keys).toEqual(['NONE', 'LOW', 'MEDIUM', 'HIGH'])
    })

    it('should be usable in Map and Set', () => {
      const levelPermissions = new Map<DevSecurityLevel, string[]>()
      levelPermissions.set(DevSecurityLevel.NONE, ['read'])
      levelPermissions.set(DevSecurityLevel.LOW, ['read', 'write'])
      levelPermissions.set(DevSecurityLevel.MEDIUM, ['read', 'write', 'delete'])
      levelPermissions.set(DevSecurityLevel.HIGH, ['read', 'write', 'delete', 'admin'])
      
      expect(levelPermissions.get(DevSecurityLevel.LOW)).toEqual(['read', 'write'])
      expect(levelPermissions.has(DevSecurityLevel.MEDIUM)).toBe(true)
      
      const allowedLevels = new Set([DevSecurityLevel.MEDIUM, DevSecurityLevel.HIGH])
      expect(allowedLevels.has(DevSecurityLevel.MEDIUM)).toBe(true)
      expect(allowedLevels.has(DevSecurityLevel.LOW)).toBe(false)
    })

    it('should handle type assertions correctly', () => {
      const level: number = 2
      const typedLevel = level as DevSecurityLevel
      
      expect(typedLevel).toBe(DevSecurityLevel.MEDIUM)
      expect(DevSecurityLevel[typedLevel]).toBe('MEDIUM')
    })
  })
})