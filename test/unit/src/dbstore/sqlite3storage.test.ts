import { Database } from 'sqlite3'
import * as sqlite3Storage from '../../../../src/dbstore/sqlite3storage'
import { SerializeToJsonString } from '../../../../src/utils/serialization'

// Define interfaces for our mocks
interface MockDatabase extends Partial<Database> {
  run: jest.Mock
  get: jest.Mock
  all: jest.Mock
  close: jest.Mock
  on: jest.Mock
  [key: string]: any
}

// There's a linter error in the source code at line 51 of sqlite3storage.ts:
// export async function run(db: Database, sql: string, params = [] || {}): Promise<unknown> {
//
// The expression `[] || {}` is always truthy and will always evaluate to [].
// In our tests we'll use any[] to be compatible with both the current and future fixed version

// Mock sqlite3 module
jest.mock('sqlite3', () => {
  const mockDb = {
    run: jest.fn().mockImplementation((sql, params, callback) => {
      if (callback) callback.call({ lastID: 1 }, null)
    }),
    get: jest.fn().mockImplementation((sql, params, callback) => {
      if (callback) callback(null, { id: 1, name: 'test' })
    }),
    all: jest.fn().mockImplementation((sql, params, callback) => {
      if (callback)
        callback(null, [
          { id: 1, name: 'test' },
          { id: 2, name: 'test2' },
        ])
    }),
    close: jest.fn().mockImplementation((callback) => {
      if (callback) callback(null)
    }),
    on: jest.fn(),
  }

  return {
    Database: jest.fn().mockImplementation(() => mockDb),
  }
})

// Mock console methods to prevent noise during tests
jest.spyOn(console, 'log').mockImplementation(() => {})
jest.spyOn(console, 'error').mockImplementation(() => {})

// Mock SerializeToJsonString
jest.mock('../../../../src/utils/serialization', () => ({
  SerializeToJsonString: jest.fn().mockImplementation((obj) => {
    if (obj instanceof Date) {
      return JSON.stringify(obj.toISOString())
    }
    return JSON.stringify(obj)
  }),
}))

describe('sqlite3storage', () => {
  let mockDb: MockDatabase
  let origDb: any

  beforeEach(() => {
    jest.clearAllMocks()

    // Create a fresh mock database for each test
    mockDb = {
      run: jest.fn().mockImplementation((sql, params, callback) => {
        if (callback) callback.call({ lastID: 1 }, null)
      }),
      get: jest.fn().mockImplementation((sql, params, callback) => {
        if (callback) callback(null, { id: 1, name: 'test' })
      }),
      all: jest.fn().mockImplementation((sql, params, callback) => {
        if (callback)
          callback(null, [
            { id: 1, name: 'test' },
            { id: 2, name: 'test2' },
          ])
      }),
      close: jest.fn().mockImplementation((callback) => {
        if (callback) callback(null)
      }),
      on: jest.fn(),
    }

    // Update the Database constructor mock to return our fresh mockDb
    const DatabaseMock = require('sqlite3').Database as jest.Mock
    DatabaseMock.mockImplementation(() => mockDb)
  })

  describe('createDB', () => {
    it('should create a database instance with the correct path', async () => {
      const dbPath = '/path/to/db'
      const dbName = 'testDB'

      const db = await sqlite3Storage.createDB(dbPath, dbName)

      expect(require('sqlite3').Database).toHaveBeenCalledWith(dbPath, expect.any(Function))
      expect(db).toBeDefined()
    })

    it('should set WAL journal mode', async () => {
      const dbPath = '/path/to/db'
      const dbName = 'testDB'

      await sqlite3Storage.createDB(dbPath, dbName)

      expect(mockDb.run).toHaveBeenCalledWith('PRAGMA journal_mode=WAL', expect.any(Array), expect.any(Function))
    })

    it('should register profile event handler', async () => {
      const dbPath = '/path/to/db'
      const dbName = 'testDB'

      await sqlite3Storage.createDB(dbPath, dbName)

      expect(mockDb.on).toHaveBeenCalledWith('profile', expect.any(Function))
    })

    it('should throw error if database creation fails', async () => {
      // Override the mock to simulate an error
      const errorMessage = 'DB creation error'
      const DatabaseMock = require('sqlite3').Database as jest.Mock

      // Save the original implementation
      const originalImplementation = DatabaseMock.mockImplementation

      // Replace with our implementation that throws
      DatabaseMock.mockImplementation((path: string, callback: Function) => {
        if (callback) callback(new Error(errorMessage))
        return mockDb
      })

      const dbPath = '/path/to/db'
      const dbName = 'testDB'

      await expect(sqlite3Storage.createDB(dbPath, dbName)).rejects.toThrow(errorMessage)

      // Restore the original implementation
      DatabaseMock.mockImplementation(originalImplementation)
    })

    it('should log slow and very slow queries', async () => {
      const dbPath = '/path/to/db'
      const dbName = 'testDB'
      const consoleLogSpy = jest.spyOn(console, 'log')

      await sqlite3Storage.createDB(dbPath, dbName)

      // Simulate profile event with different execution times
      // Get the callback function that was passed to db.on
      const onCalls = mockDb.on.mock.calls

      // Check if there are any calls and get the second argument (the handler function)
      if (onCalls && onCalls.length > 0) {
        const onHandler = onCalls[0][1] as (sql: string, time: number) => void

        // Call with medium slow query (600ms)
        onHandler('SELECT * FROM test', 600)
        expect(consoleLogSpy).toHaveBeenCalledWith('SLOW QUERY', expect.any(Number), 'SELECT * FROM test', 600)

        // Call with very slow query (1200ms)
        onHandler('INSERT INTO test VALUES (?)', 1200)
        expect(consoleLogSpy).toHaveBeenCalledWith(
          'VERY SLOW QUERY',
          expect.any(Number),
          'INSERT INTO test VALUES (?)',
          1200
        )

        // Call with normal query (300ms)
        consoleLogSpy.mockClear()
        onHandler('UPDATE test SET name = ?', 300)
        expect(consoleLogSpy).not.toHaveBeenCalled()
      } else {
        fail('Event handler was not registered')
      }
    })
  })

  describe('close', () => {
    it('should close the database connection', async () => {
      const dbName = 'testDB'

      await sqlite3Storage.close(mockDb as unknown as Database, dbName)

      expect(mockDb.close).toHaveBeenCalled()
    })

    it('should handle errors when closing the database connection', async () => {
      const dbName = 'testDB'
      const errorMessage = 'Error closing database'
      const consoleSpy = jest.spyOn(console, 'error')

      // Override mockDb.close to simulate an error
      const originalClose = mockDb.close
      mockDb.close = jest.fn().mockImplementation((callback) => {
        if (callback) callback(new Error(errorMessage))
      })

      await sqlite3Storage.close(mockDb as unknown as Database, dbName)

      expect(consoleSpy).toHaveBeenCalledWith(`Error thrown in ${dbName} db close() function: `)

      // Restore original implementation
      mockDb.close = originalClose
    })
  })

  describe('runCreate', () => {
    it('should execute a create statement', async () => {
      const createStatement = 'CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)'

      await sqlite3Storage.runCreate(mockDb as unknown as Database, createStatement)

      expect(mockDb.run).toHaveBeenCalledWith(createStatement, expect.any(Array), expect.any(Function))
    })
  })

  describe('run', () => {
    it('should execute SQL with parameters', async () => {
      const sql = 'INSERT INTO test VALUES (?)'
      const params: any[] = ['value']

      const result = await sqlite3Storage.run(mockDb as unknown as Database, sql, params)

      expect(mockDb.run).toHaveBeenCalledWith(sql, params, expect.any(Function))
      expect(result).toEqual({ id: 1 })
    })

    it('should use empty array as default for params', async () => {
      const sql = 'INSERT INTO test VALUES (1)'

      await sqlite3Storage.run(mockDb as unknown as Database, sql)

      expect(mockDb.run).toHaveBeenCalledWith(sql, expect.any(Array), expect.any(Function))
    })

    it('should handle errors from database', async () => {
      const sql = 'INVALID SQL'
      const errorMessage = 'SQL syntax error'

      // Override mockDb.run to simulate an error
      const originalRun = mockDb.run
      mockDb.run = jest.fn().mockImplementation((sql, params, callback) => {
        if (callback) callback.call({ lastID: null }, new Error(errorMessage))
      })

      await expect(sqlite3Storage.run(mockDb as unknown as Database, sql)).rejects.toThrow(errorMessage)

      // Restore original implementation
      mockDb.run = originalRun
    })
  })

  describe('get', () => {
    it('should retrieve a single record', async () => {
      const sql = 'SELECT * FROM test WHERE id = ?'
      const params: any[] = [1]

      const result = await sqlite3Storage.get(mockDb as unknown as Database, sql, params)

      expect(mockDb.get).toHaveBeenCalledWith(sql, params, expect.any(Function))
      expect(result).toEqual({ id: 1, name: 'test' })
    })

    it('should use empty array as default for params', async () => {
      const sql = 'SELECT * FROM test LIMIT 1'

      await sqlite3Storage.get(mockDb as unknown as Database, sql)

      expect(mockDb.get).toHaveBeenCalledWith(sql, expect.any(Array), expect.any(Function))
    })

    it('should handle errors from database', async () => {
      const sql = 'INVALID SQL'
      const errorMessage = 'SQL syntax error'

      // Override mockDb.get to simulate an error
      const originalGet = mockDb.get
      mockDb.get = jest.fn().mockImplementation((sql, params, callback) => {
        if (callback) callback(new Error(errorMessage), null)
      })

      await expect(sqlite3Storage.get(mockDb as unknown as Database, sql)).rejects.toThrow(errorMessage)

      // Restore original implementation
      mockDb.get = originalGet
    })
  })

  describe('all', () => {
    it('should retrieve multiple records', async () => {
      const sql = 'SELECT * FROM test'
      const params: any[] = []

      const result = await sqlite3Storage.all(mockDb as unknown as Database, sql, params)

      expect(mockDb.all).toHaveBeenCalledWith(sql, params, expect.any(Function))
      expect(result).toEqual([
        { id: 1, name: 'test' },
        { id: 2, name: 'test2' },
      ])
    })

    it('should use empty array as default for params', async () => {
      const sql = 'SELECT * FROM test'

      await sqlite3Storage.all(mockDb as unknown as Database, sql)

      expect(mockDb.all).toHaveBeenCalledWith(sql, expect.any(Array), expect.any(Function))
    })

    it('should handle errors from database', async () => {
      const sql = 'INVALID SQL'
      const errorMessage = 'SQL syntax error'

      // Override mockDb.all to simulate an error
      const originalAll = mockDb.all
      mockDb.all = jest.fn().mockImplementation((sql, params, callback) => {
        if (callback) callback(new Error(errorMessage), null)
      })

      await expect(sqlite3Storage.all(mockDb as unknown as Database, sql)).rejects.toThrow(errorMessage)

      // Restore original implementation
      mockDb.all = originalAll
    })
  })

  describe('extractValues', () => {
    it('should extract values from an object', () => {
      const object = {
        id: 1,
        name: 'test',
        created: new Date('2023-01-01'),
      }

      const values = sqlite3Storage.extractValues(object)

      // In our implementation, dates are serialized to JSON strings
      expect(values).toEqual([1, 'test', JSON.stringify(object.created.toISOString())])
    })

    it('should serialize nested objects to JSON strings', () => {
      const object = {
        id: 1,
        metadata: { key: 'value' },
      }

      const values = sqlite3Storage.extractValues(object)

      expect(values).toEqual([1, JSON.stringify(object.metadata)])
      expect(SerializeToJsonString).toHaveBeenCalledWith(object.metadata)
    })

    it('should handle empty objects', () => {
      const object = {}

      const values = sqlite3Storage.extractValues(object)

      expect(values).toEqual([])
    })

    it('should return null on error', () => {
      // Force an error by making SerializeToJsonString throw
      jest.mocked(SerializeToJsonString).mockImplementationOnce(() => {
        throw new Error('Serialization error')
      })

      const object = {
        metadata: { key: 'value' },
      }

      const values = sqlite3Storage.extractValues(object)

      expect(values).toBeNull()
    })
  })

  describe('extractValuesFromArray', () => {
    it('should extract values from an array of objects', () => {
      const array = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ]

      const values = sqlite3Storage.extractValuesFromArray(array)

      expect(values).toEqual([1, 'test1', 2, 'test2'])
    })

    it('should serialize nested objects to JSON strings', () => {
      const array = [
        { id: 1, metadata: { key: 'value1' } },
        { id: 2, metadata: { key: 'value2' } },
      ]

      const values = sqlite3Storage.extractValuesFromArray(array)

      expect(values).toEqual([1, JSON.stringify(array[0].metadata), 2, JSON.stringify(array[1].metadata)])
      expect(SerializeToJsonString).toHaveBeenCalledWith(array[0].metadata)
      expect(SerializeToJsonString).toHaveBeenCalledWith(array[1].metadata)
    })

    it('should handle empty arrays', () => {
      const array: object[] = []

      const values = sqlite3Storage.extractValuesFromArray(array)

      expect(values).toEqual([])
    })

    it('should return null on error', () => {
      // Force an error by making SerializeToJsonString throw
      jest.mocked(SerializeToJsonString).mockImplementationOnce(() => {
        throw new Error('Serialization error')
      })

      const array = [{ metadata: { key: 'value' } }]

      const values = sqlite3Storage.extractValuesFromArray(array)

      expect(values).toBeNull()
    })
  })
})
