import { SerializeToJsonString, DeSerializeFromJsonString } from '../../../../src/utils/serialization'
import { config } from '../../../../src/Config'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'

// Mock Config
jest.mock('../../../../src/Config', () => ({
  config: {
    useSerialization: true
  }
}))

describe('Serialization Utils', () => {
  // Setup spies
  let safeStringifySpy: jest.SpyInstance
  let safeJsonParseSpy: jest.SpyInstance

  beforeEach(() => {
    // Setup spies before each test
    safeStringifySpy = jest.spyOn(StringUtils, 'safeStringify').mockImplementation()
    safeJsonParseSpy = jest.spyOn(StringUtils, 'safeJsonParse').mockImplementation()
    
    // Clear all mock implementations
    jest.clearAllMocks()
  })

  afterEach(() => {
    // Restore original implementations
    safeStringifySpy.mockRestore()
    safeJsonParseSpy.mockRestore()
  })

  describe('SerializeToJsonString', () => {
    it('should use StringUtils.safeStringify with buffer encoding when useSerialization is true', () => {
      // Arrange
      const testObj = { key: 'value', num: 42 }
      safeStringifySpy.mockReturnValueOnce('{"key":"value","num":42}')
      
      // Act
      SerializeToJsonString(testObj)
      
      // Assert
      expect(safeStringifySpy).toHaveBeenCalledWith(testObj, { bufferEncoding: 'base64' })
      expect(safeStringifySpy).toHaveBeenCalledTimes(1)
    })

    it('should use StringUtils.safeStringify without buffer encoding when useSerialization is false', () => {
      // Arrange
      const testObj = { key: 'value', num: 42 }
      config.useSerialization = false
      safeStringifySpy.mockReturnValueOnce('{"key":"value","num":42}')
      
      // Act
      SerializeToJsonString(testObj)
      
      // Assert
      expect(safeStringifySpy).toHaveBeenCalledWith(testObj)
      expect(safeStringifySpy).toHaveBeenCalledTimes(1)
      
      // Reset the config
      config.useSerialization = true
    })

    it('should return the serialized string when successful', () => {
      // Arrange
      const testObj = { key: 'value', num: 42 }
      const expectedString = '{"key":"value","num":42}'
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should handle objects with nested structures', () => {
      // Arrange
      const testObj = { key: 'value', nested: { a: 1, b: [1, 2, 3] } }
      const expectedString = '{"key":"value","nested":{"a":1,"b":[1,2,3]}}'
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should throw error and log when serialization fails', () => {
      // Arrange
      const testObj = { key: 'value' }
      const error = new Error('Serialization error')
      safeStringifySpy.mockImplementationOnce(() => {
        throw error
      })
      
      // Spy on console.log
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        SerializeToJsonString(testObj)
      }).toThrow(error)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Error serializing object', error)
      expect(consoleLogSpy).toHaveBeenCalledWith(testObj)
      
      // Restore console.log
      consoleLogSpy.mockRestore()
    })
  })

  describe('DeSerializeFromJsonString', () => {
    it('should call StringUtils.safeJsonParse with the provided string', () => {
      // Arrange
      const jsonString = '{"key":"value","num":42}'
      const expectedObj = { key: 'value', num: 42 }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(safeJsonParseSpy).toHaveBeenCalledWith(jsonString)
      expect(safeJsonParseSpy).toHaveBeenCalledTimes(1)
    })

    it('should return the parsed object with correct type', () => {
      // Arrange
      const jsonString = '{"key":"value","num":42}'
      const expectedObj = { key: 'value', num: 42 }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      const result = DeSerializeFromJsonString<{ key: string; num: number }>(jsonString)
      
      // Assert
      expect(result).toEqual(expectedObj)
    })

    it('should handle complex JSON strings with nested objects and arrays', () => {
      // Arrange
      const jsonString = '{"key":"value","nested":{"a":1,"b":[1,2,3]}}'
      const expectedObj = { key: 'value', nested: { a: 1, b: [1, 2, 3] } }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      const result = DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(result).toEqual(expectedObj)
    })

    it('should throw error and log when deserialization fails', () => {
      // Arrange
      const jsonString = 'invalid json'
      const error = new Error('Parse error')
      safeJsonParseSpy.mockImplementationOnce(() => {
        throw error
      })
      
      // Spy on console.log
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        DeSerializeFromJsonString(jsonString)
      }).toThrow(error)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Error deserializing object', error)
      expect(consoleLogSpy).toHaveBeenCalledWith(jsonString)
      
      // Restore console.log
      consoleLogSpy.mockRestore()
    })
  })

  describe('Integration scenarios', () => {
    it('should correctly serialize and deserialize an object', () => {
      // Arrange
      const testObj = { key: 'value', num: 42 }
      const serializedString = '{"key":"value","num":42}'
      
      safeStringifySpy.mockReturnValueOnce(serializedString)
      safeJsonParseSpy.mockReturnValueOnce(testObj)
      
      // Act
      const serialized = SerializeToJsonString(testObj)
      const deserialized = DeSerializeFromJsonString<typeof testObj>(serialized)
      
      // Assert
      expect(serialized).toBe(serializedString)
      expect(deserialized).toEqual(testObj)
    })

    it('should handle objects with Buffer data when useSerialization is true', () => {
      // Arrange
      const buffer = Buffer.from('test data')
      const testObj = { key: 'value', data: buffer }
      const serializedString = '{"key":"value","data":{"type":"Buffer","data":"dGVzdCBkYXRh"}}'
      
      safeStringifySpy.mockReturnValueOnce(serializedString)
      safeJsonParseSpy.mockReturnValueOnce({
        key: 'value',
        data: { type: 'Buffer', data: 'dGVzdCBkYXRh' }
      })
      
      // Act
      const serialized = SerializeToJsonString(testObj)
      const deserialized = DeSerializeFromJsonString(serialized)
      
      // Assert
      expect(serialized).toBe(serializedString)
      expect(deserialized).toEqual({
        key: 'value',
        data: { type: 'Buffer', data: 'dGVzdCBkYXRh' }
      })
    })
  })

  describe('Edge cases for SerializeToJsonString', () => {
    it('should handle null input', () => {
      // Arrange
      const testObj = null
      safeStringifySpy.mockReturnValueOnce('null')
      
      // Act
      const result = SerializeToJsonString(testObj as any)
      
      // Assert
      expect(result).toBe('null')
      expect(safeStringifySpy).toHaveBeenCalledWith(null, { bufferEncoding: 'base64' })
    })

    it('should handle undefined input', () => {
      // Arrange
      const testObj = undefined
      safeStringifySpy.mockReturnValueOnce(undefined)
      
      // Act
      const result = SerializeToJsonString(testObj as any)
      
      // Assert
      expect(result).toBe(undefined)
      expect(safeStringifySpy).toHaveBeenCalledWith(undefined, { bufferEncoding: 'base64' })
    })

    it('should handle empty object', () => {
      // Arrange
      const testObj = {}
      safeStringifySpy.mockReturnValueOnce('{}')
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe('{}')
    })

    it('should handle empty array', () => {
      // Arrange
      const testObj = []
      safeStringifySpy.mockReturnValueOnce('[]')
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe('[]')
    })

    it('should handle circular references gracefully', () => {
      // Arrange
      const testObj: any = { key: 'value' }
      testObj.circular = testObj
      const error = new TypeError('Converting circular structure to JSON')
      safeStringifySpy.mockImplementationOnce(() => {
        throw error
      })
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        SerializeToJsonString(testObj)
      }).toThrow(error)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Error serializing object', error)
      
      consoleLogSpy.mockRestore()
    })

    it('should handle objects with special values', () => {
      // Arrange
      const testObj = {
        nan: NaN,
        infinity: Infinity,
        negInfinity: -Infinity,
        date: new Date('2023-01-01'),
        regex: /test/g,
        func: () => {}
      }
      const expectedString = '{"nan":null,"infinity":null,"negInfinity":null,"date":"2023-01-01T00:00:00.000Z","regex":{}}'
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should handle very large objects', () => {
      // Arrange
      const largeObj: any = {}
      for (let i = 0; i < 10000; i++) {
        largeObj[`key${i}`] = `value${i}`
      }
      const expectedString = JSON.stringify(largeObj)
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(largeObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should handle objects with symbols', () => {
      // Arrange
      const sym = Symbol('test')
      const testObj = {
        [sym]: 'symbol value',
        key: 'regular value'
      }
      // Symbols are typically ignored in JSON serialization
      const expectedString = '{"key":"regular value"}'
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should handle deeply nested objects', () => {
      // Arrange
      const deepObj = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep'
                }
              }
            }
          }
        }
      }
      const expectedString = JSON.stringify(deepObj)
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(deepObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should handle objects with toJSON method', () => {
      // Arrange
      const testObj = {
        key: 'value',
        toJSON() {
          return { custom: 'serialization' }
        }
      }
      const expectedString = '{"custom":"serialization"}'
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert
      expect(result).toBe(expectedString)
    })

    it('should toggle between serialization modes correctly', () => {
      // Arrange
      const testObj = { key: 'value' }
      const expectedString = '{"key":"value"}'
      
      // Test with useSerialization = true
      config.useSerialization = true
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      let result = SerializeToJsonString(testObj)
      
      // Assert
      expect(safeStringifySpy).toHaveBeenCalledWith(testObj, { bufferEncoding: 'base64' })
      expect(result).toBe(expectedString)
      
      // Test with useSerialization = false
      config.useSerialization = false
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      result = SerializeToJsonString(testObj)
      
      // Assert
      expect(safeStringifySpy).toHaveBeenLastCalledWith(testObj)
      expect(result).toBe(expectedString)
      
      // Reset
      config.useSerialization = true
    })
  })

  describe('Edge cases for DeSerializeFromJsonString', () => {
    it('should handle empty string', () => {
      // Arrange
      const jsonString = ''
      const error = new SyntaxError('Unexpected end of JSON input')
      safeJsonParseSpy.mockImplementationOnce(() => {
        throw error
      })
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        DeSerializeFromJsonString(jsonString)
      }).toThrow(error)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Error deserializing object', error)
      expect(consoleLogSpy).toHaveBeenCalledWith(jsonString)
      
      consoleLogSpy.mockRestore()
    })

    it('should handle null string', () => {
      // Arrange
      const jsonString = 'null'
      safeJsonParseSpy.mockReturnValueOnce(null)
      
      // Act
      const result = DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(result).toBe(null)
    })

    it('should handle whitespace-only string', () => {
      // Arrange
      const jsonString = '   \n\t   '
      const error = new SyntaxError('Unexpected end of JSON input')
      safeJsonParseSpy.mockImplementationOnce(() => {
        throw error
      })
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        DeSerializeFromJsonString(jsonString)
      }).toThrow(error)
      
      consoleLogSpy.mockRestore()
    })

    it('should handle primitive values', () => {
      // Test number
      let jsonString = '42'
      safeJsonParseSpy.mockReturnValueOnce(42)
      expect(DeSerializeFromJsonString<number>(jsonString)).toBe(42)
      
      // Test string
      jsonString = '"hello"'
      safeJsonParseSpy.mockReturnValueOnce('hello')
      expect(DeSerializeFromJsonString<string>(jsonString)).toBe('hello')
      
      // Test boolean
      jsonString = 'true'
      safeJsonParseSpy.mockReturnValueOnce(true)
      expect(DeSerializeFromJsonString<boolean>(jsonString)).toBe(true)
    })

    it('should handle arrays', () => {
      // Arrange
      const jsonString = '[1,2,3,"test",true,null]'
      const expectedArray = [1, 2, 3, 'test', true, null]
      safeJsonParseSpy.mockReturnValueOnce(expectedArray)
      
      // Act
      const result = DeSerializeFromJsonString<any[]>(jsonString)
      
      // Assert
      expect(result).toEqual(expectedArray)
    })

    it('should handle malformed JSON with helpful error', () => {
      // Arrange
      const jsonString = '{"key": "value"'  // Missing closing brace
      const error = new SyntaxError('Unexpected end of JSON input')
      safeJsonParseSpy.mockImplementationOnce(() => {
        throw error
      })
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => {
        DeSerializeFromJsonString(jsonString)
      }).toThrow(error)
      
      expect(consoleLogSpy).toHaveBeenCalledWith('Error deserializing object', error)
      expect(consoleLogSpy).toHaveBeenCalledWith(jsonString)
      
      consoleLogSpy.mockRestore()
    })

    it('should handle JSON with trailing comma', () => {
      // Arrange
      const jsonString = '{"key": "value",}'
      const error = new SyntaxError('Unexpected token')
      safeJsonParseSpy.mockImplementationOnce(() => {
        throw error
      })
      
      // Act & Assert
      expect(() => {
        DeSerializeFromJsonString(jsonString)
      }).toThrow(error)
    })

    it('should handle very large JSON strings', () => {
      // Arrange
      const largeArray = Array(10000).fill({ key: 'value', num: 42 })
      const jsonString = JSON.stringify(largeArray)
      safeJsonParseSpy.mockReturnValueOnce(largeArray)
      
      // Act
      const result = DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(result).toEqual(largeArray)
    })

    it('should handle JSON with special characters', () => {
      // Arrange
      const jsonString = '{"key": "value with \\n newline and \\t tab and \\"quotes\\""}'
      const expectedObj = { key: 'value with \n newline and \t tab and "quotes"' }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      const result = DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(result).toEqual(expectedObj)
    })

    it('should handle JSON with unicode characters', () => {
      // Arrange
      const jsonString = '{"emoji": "😀", "chinese": "你好", "arabic": "مرحبا"}'
      const expectedObj = { emoji: '😀', chinese: '你好', arabic: 'مرحبا' }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      const result = DeSerializeFromJsonString(jsonString)
      
      // Assert
      expect(result).toEqual(expectedObj)
    })

    it('should preserve type information when deserializing', () => {
      // Arrange
      interface TestType {
        id: number
        name: string
        active: boolean
      }
      
      const jsonString = '{"id":123,"name":"test","active":true}'
      const expectedObj: TestType = { id: 123, name: 'test', active: true }
      safeJsonParseSpy.mockReturnValueOnce(expectedObj)
      
      // Act
      const result = DeSerializeFromJsonString<TestType>(jsonString)
      
      // Assert
      expect(result).toEqual(expectedObj)
      expect(typeof result.id).toBe('number')
      expect(typeof result.name).toBe('string')
      expect(typeof result.active).toBe('boolean')
    })
  })

  describe('Error handling edge cases', () => {
    it('should handle multiple consecutive errors gracefully', () => {
      // Arrange
      const testObj = { key: 'value' }
      const error1 = new Error('First error')
      const error2 = new Error('Second error')
      
      safeStringifySpy
        .mockImplementationOnce(() => { throw error1 })
        .mockImplementationOnce(() => { throw error2 })
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      // Act & Assert
      expect(() => SerializeToJsonString(testObj)).toThrow(error1)
      expect(() => SerializeToJsonString(testObj)).toThrow(error2)
      
      expect(consoleLogSpy).toHaveBeenCalledTimes(4) // 2 errors + 2 objects
      
      consoleLogSpy.mockRestore()
    })

    it('should handle different error types', () => {
      // Arrange
      const errors = [
        new TypeError('Type error'),
        new RangeError('Range error'),
        new ReferenceError('Reference error'),
        new Error('Generic error')
      ]
      
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      
      errors.forEach(error => {
        safeStringifySpy.mockImplementationOnce(() => { throw error })
        
        // Act & Assert
        expect(() => SerializeToJsonString({})).toThrow(error)
        expect(consoleLogSpy).toHaveBeenCalledWith('Error serializing object', error)
      })
      
      consoleLogSpy.mockRestore()
    })
  })

  describe('Performance and memory tests', () => {
    it('should handle rapid consecutive calls', () => {
      // Arrange
      const testObj = { key: 'value' }
      const expectedString = '{"key":"value"}'
      safeStringifySpy.mockReturnValue(expectedString)
      
      // Act - Rapid calls
      const results: string[] = []
      for (let i = 0; i < 100; i++) {
        results.push(SerializeToJsonString(testObj))
      }
      
      // Assert
      expect(results.every(r => r === expectedString)).toBe(true)
      expect(safeStringifySpy).toHaveBeenCalledTimes(100)
    })

    it('should handle nested serialization/deserialization', () => {
      // Arrange
      const testObj = { level1: { level2: { level3: 'value' } } }
      const serialized = JSON.stringify(testObj)
      
      safeStringifySpy.mockReturnValue(serialized)
      safeJsonParseSpy.mockImplementation((str) => JSON.parse(str))
      
      // Act - Multiple rounds of serialization/deserialization
      let current = testObj
      for (let i = 0; i < 5; i++) {
        const ser = SerializeToJsonString(current)
        current = DeSerializeFromJsonString(ser)
      }
      
      // Assert
      expect(current).toEqual(testObj)
    })
  })

  describe('Config edge cases', () => {
    it('should handle config changes during execution', () => {
      // Arrange
      const testObj = { key: 'value' }
      const expectedString = '{"key":"value"}'
      
      // Start with true
      config.useSerialization = true
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act & Assert - First call
      let result = SerializeToJsonString(testObj)
      expect(safeStringifySpy).toHaveBeenCalledWith(testObj, { bufferEncoding: 'base64' })
      expect(result).toBe(expectedString)
      
      // Change config mid-execution
      config.useSerialization = false
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act & Assert - Second call
      result = SerializeToJsonString(testObj)
      expect(safeStringifySpy).toHaveBeenLastCalledWith(testObj)
      expect(result).toBe(expectedString)
      
      // Reset
      config.useSerialization = true
    })

    it('should handle undefined config.useSerialization', () => {
      // Arrange
      const testObj = { key: 'value' }
      const expectedString = '{"key":"value"}'
      const originalValue = config.useSerialization
      
      // Set to undefined
      ;(config as any).useSerialization = undefined
      safeStringifySpy.mockReturnValueOnce(expectedString)
      
      // Act
      const result = SerializeToJsonString(testObj)
      
      // Assert - Should use falsy path
      expect(safeStringifySpy).toHaveBeenCalledWith(testObj)
      expect(result).toBe(expectedString)
      
      // Restore
      config.useSerialization = originalValue
    })
  })
})
