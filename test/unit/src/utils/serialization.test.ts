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
})
