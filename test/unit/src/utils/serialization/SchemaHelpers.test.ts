import * as Ajv from 'ajv'

// Create mock functions outside
const mockCompile = jest.fn()
const mockAddSchema = jest.fn()

// Mock Ajv
jest.mock('ajv', () => {
  // Create a mock constructor function
  function MockAjv() {
    return {
      compile: mockCompile,
      addSchema: mockAddSchema,
    }
  }

  // Make it work with both import styles
  MockAjv.default = MockAjv
  return MockAjv
})

describe('SchemaHelpers', () => {
  // Create test schemas
  const testSchema1 = { type: 'object', properties: { name: { type: 'string' } } }
  const testSchema2 = { type: 'object', properties: { age: { type: 'number' } } }

  // Mock validate function
  const mockValidateFunction = jest.fn() as Ajv.ValidateFunction

  // Before each test
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks()

    // Reset modules to get a fresh copy of the module each time
    jest.resetModules()

    // Setup the compiler mock to return our mock validate function
    mockCompile.mockReturnValue(mockValidateFunction)
  })

  // Import the module in each test to get a fresh copy
  function getModule() {
    return require('../../../../../src/utils/serialization/SchemaHelpers')
  }

  describe('addSchema', () => {
    it('should add a schema to the schema map', () => {
      // Get fresh module
      const { addSchema, getVerifyFunction } = getModule()

      // Act
      addSchema('test-schema', testSchema1)

      // Assert - we'll verify by getting the schema through getVerifyFunction
      expect(() => getVerifyFunction('test-schema')).not.toThrow()
    })

    it('should throw an error when adding a schema with an existing name', () => {
      // Get fresh module
      const { addSchema } = getModule()

      // Arrange
      addSchema('duplicate-schema', testSchema1)

      // Act & Assert
      expect(() => addSchema('duplicate-schema', testSchema2)).toThrow('error already registered duplicate-schema')
    })
  })

  describe('initializeSerialization', () => {
    it('should register all schemas with AJV', () => {
      // Get fresh module
      const { addSchema, initializeSerialization } = getModule()

      // Arrange - add schemas
      addSchema('schema1', testSchema1)
      addSchema('schema2', testSchema2)

      // Act
      initializeSerialization()

      // Assert
      expect(mockAddSchema).toHaveBeenCalledTimes(2)
      expect(mockAddSchema).toHaveBeenCalledWith(testSchema1, 'schema1')
      expect(mockAddSchema).toHaveBeenCalledWith(testSchema2, 'schema2')
    })

    it('should do nothing when no schemas are registered', () => {
      // Get fresh module with no schemas added
      const { initializeSerialization } = getModule()

      // Act
      initializeSerialization()

      // Assert
      expect(mockAddSchema).not.toHaveBeenCalled()
    })
  })

  describe('getVerifyFunction', () => {
    it('should return a cached verification function if it exists', () => {
      // Get fresh module
      const { addSchema, getVerifyFunction } = getModule()

      // Arrange
      addSchema('cached-schema', testSchema1)

      // First call to create and cache
      const firstResult = getVerifyFunction('cached-schema')

      // Act - second call should use cache
      const secondResult = getVerifyFunction('cached-schema')

      // Assert
      expect(mockCompile).toHaveBeenCalledTimes(1)
      expect(secondResult).toBe(firstResult)
    })

    it('should create and return a new verification function if not cached', () => {
      // Get fresh module
      const { addSchema, getVerifyFunction } = getModule()

      // Arrange
      addSchema('new-schema', testSchema1)

      // Act
      const result = getVerifyFunction('new-schema')

      // Assert
      expect(mockCompile).toHaveBeenCalledTimes(1)
      expect(mockCompile).toHaveBeenCalledWith(testSchema1)
      expect(result).toBe(mockValidateFunction)
    })

    it('should throw an error when schema name does not exist', () => {
      // Get fresh module
      const { getVerifyFunction } = getModule()

      // Act & Assert
      expect(() => getVerifyFunction('non-existent-schema')).toThrow('error missing schema non-existent-schema')
    })
  })
})
