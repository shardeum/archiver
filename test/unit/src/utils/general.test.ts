import { XOR } from '../../../../src/utils/general'

describe('general', () => {
  describe('XOR', () => {
    it('should XOR two hex strings correctly', () => {
      const hex1 = '12345678'
      const hex2 = '87654321'
      const result = XOR(hex1, hex2)

      // 0x12345678 ^ 0x87654321 = 0x95511559
      expect(result).toBe(0x95511559)
    })

    it('should handle hex strings with leading zeros', () => {
      const hex1 = '00000001'
      const hex2 = '00000002'
      const result = XOR(hex1, hex2)

      // 0x00000001 ^ 0x00000002 = 0x00000003
      expect(result).toBe(3)
    })

    it('should handle identical hex strings', () => {
      const hex1 = 'ABCDEF12'
      const hex2 = 'ABCDEF12'
      const result = XOR(hex1, hex2)

      // Any number XOR with itself is 0
      expect(result).toBe(0)
    })

    it('should handle maximum 32-bit values', () => {
      const hex1 = 'FFFFFFFF'
      const hex2 = 'FFFFFFFF'
      const result = XOR(hex1, hex2)

      // 0xFFFFFFFF ^ 0xFFFFFFFF = 0
      expect(result).toBe(0)
    })

    it('should handle XOR with zeros', () => {
      const hex1 = '12345678'
      const hex2 = '00000000'
      const result = XOR(hex1, hex2)

      // Any number XOR with 0 is the number itself
      expect(result).toBe(0x12345678)
    })

    it('should only use first 8 characters of hex strings', () => {
      const hex1 = '12345678ABCDEF'
      const hex2 = '87654321FEDCBA'
      const result = XOR(hex1, hex2)

      // Should only use '12345678' and '87654321'
      expect(result).toBe(0x95511559)
    })

    it('should handle lowercase hex strings', () => {
      const hex1 = 'abcdef12'
      const hex2 = '12345678'
      const result = XOR(hex1, hex2)

      // 0xABCDEF12 ^ 0x12345678 = 0xB9F9B96A
      expect(result).toBe(0xb9f9b96a)
    })

    it('should handle mixed case hex strings', () => {
      const hex1 = 'AbCdEf12'
      const hex2 = '12345678'
      const result = XOR(hex1, hex2)

      // 0xABCDEF12 ^ 0x12345678 = 0xB9F9B96A
      expect(result).toBe(0xb9f9b96a)
    })

    it('should return unsigned 32-bit integer', () => {
      const hex1 = 'FFFFFFFF'
      const hex2 = '00000001'
      const result = XOR(hex1, hex2)

      // 0xFFFFFFFF ^ 0x00000001 = 0xFFFFFFFE
      // Should be unsigned (4294967294) not signed (-2)
      expect(result).toBe(0xfffffffe)
      expect(result).toBe(4294967294)
    })

    it('should handle short hex strings', () => {
      const hex1 = '123'
      const hex2 = '456'
      const result = XOR(hex1, hex2)

      // 0x123 ^ 0x456 = 0x575
      expect(result).toBe(0x575)
    })

    it('should handle empty strings', () => {
      const hex1 = ''
      const hex2 = ''
      const result = XOR(hex1, hex2)

      // parseInt('', 16) returns NaN, which becomes 0 in bitwise operations
      expect(result).toBe(0)
    })

    it('should handle invalid hex characters', () => {
      const hex1 = 'GHIJKLMN'
      const hex2 = '12345678'
      const result = XOR(hex1, hex2)

      // parseInt stops at first invalid character, so 'GHIJKLMN' becomes 0
      expect(result).toBe(0x12345678)
    })

    it('should handle mixed valid and invalid hex characters', () => {
      const hex1 = '12G45678'
      const hex2 = '87654321'
      const result = XOR(hex1, hex2)

      // parseInt('12G45678', 16) parses '12' and stops at 'G'
      // 0x12 ^ 0x87654321 = 0x87654333
      expect(result).toBe(0x87654333)
    })
  })
})
