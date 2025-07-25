import { expect, describe, it, beforeEach, afterEach, jest } from '@jest/globals'
import * as path from 'path'
import * as fs from 'fs/promises'
import { createWriteStream, existsSync, WriteStream } from 'fs'
import { config } from '../../../../src/Config'

// Mock all dependencies
jest.mock('fs/promises')
jest.mock('fs', () => ({
  createWriteStream: jest.fn(),
  existsSync: jest.fn(),
}))
jest.mock('../../../../src/Config', () => ({
  config: {
    ARCHIVER_IP: '127.0.0.1',
    ARCHIVER_PORT: 4000,
    VERBOSE: false,
    dataLogWriter: {
      dirName: 'test-logs',
      maxLogFiles: 10,
      maxCycleEntries: 100,
      maxReceiptEntries: 100,
      maxOriginalTxEntries: 100,
    },
  },
}))

// Import after mocks
import {
  initDataLogWriter,
  CycleLogWriter,
  ReceiptLogWriter,
  OriginalTxDataLogWriter,
  ReceiptOverwriteLogWriter,
} from '../../../../src/Data/DataLogWriter'

// We need to access the class, so we'll test via the exported instances
describe('DataLogWriter', () => {
  // Cast mocked functions
  const mockedMkdir = fs.mkdir as jest.MockedFunction<typeof fs.mkdir>
  const mockedReadFile = fs.readFile as jest.MockedFunction<typeof fs.readFile>
  const mockedWriteFile = fs.writeFile as jest.MockedFunction<typeof fs.writeFile>
  const mockedAppendFile = fs.appendFile as jest.MockedFunction<typeof fs.appendFile>
  const mockedReaddir = fs.readdir as jest.MockedFunction<typeof fs.readdir>
  const mockedUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>
  const mockedRename = fs.rename as jest.MockedFunction<typeof fs.rename>
  const mockedCreateWriteStream = createWriteStream as jest.MockedFunction<typeof createWriteStream>
  const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>

  // Mock write stream
  let mockWriteStream: {
    write: jest.Mock
    end: jest.Mock
    once: jest.Mock
  }

  // Spy on console methods
  let consoleLogSpy: jest.SpiedFunction<typeof console.log>
  let consoleErrorSpy: jest.SpiedFunction<typeof console.error>

  beforeEach(() => {
    jest.clearAllMocks()

    // Setup mock write stream
    mockWriteStream = {
      write: jest.fn().mockReturnValue(true),
      end: jest.fn((callback?: () => void) => callback && callback()),
      once: jest.fn(),
    }
    mockedCreateWriteStream.mockReturnValue(mockWriteStream as any)

    // Setup default mocks
    mockedExistsSync.mockReturnValue(false)
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue()
    mockedAppendFile.mockResolvedValue()
    mockedReaddir.mockResolvedValue([] as any)

    // Spy on console
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  describe('initialization', () => {
    it('should initialize all log writers', async () => {
      await initDataLogWriter()

      expect(CycleLogWriter).toBeDefined()
      expect(ReceiptLogWriter).toBeDefined()
      expect(OriginalTxDataLogWriter).toBeDefined()
      expect(ReceiptOverwriteLogWriter).toBeDefined()

      expect(mockedMkdir).toHaveBeenCalledWith(expect.stringContaining('test-logs/127.0.0.1_4000'), { recursive: true })
    })

    it('should create log directory if it does not exist', async () => {
      await initDataLogWriter()

      expect(mockedMkdir).toHaveBeenCalledTimes(4) // Once for each writer
    })

    it('should handle existing active log file', async () => {
      // Only mock exists for CycleLogWriter's active log
      mockedExistsSync
        .mockReturnValueOnce(true) // CycleLogWriter
        .mockReturnValueOnce(false) // ReceiptLogWriter
        .mockReturnValueOnce(false) // OriginalTxDataLogWriter
        .mockReturnValueOnce(false) // ReceiptOverwriteLogWriter

      // Mock readFile calls only for CycleLogWriter
      mockedReadFile
        .mockResolvedValueOnce('cycle-log2.txt') // CycleLogWriter active log
        .mockResolvedValueOnce('line1\nline2\nline3\n') // CycleLogWriter data

      await initDataLogWriter()

      expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('active-cycle-log.txt'), 'utf8')
      expect(CycleLogWriter.logCounter).toBe(2)
      expect(CycleLogWriter.totalNumberOfEntries).toBe(3)
    })

    it('should rotate log when entries exceed max', async () => {
      // Only mock exists for CycleLogWriter's active log
      mockedExistsSync
        .mockReturnValueOnce(true) // CycleLogWriter
        .mockReturnValueOnce(false) // ReceiptLogWriter
        .mockReturnValueOnce(false) // OriginalTxDataLogWriter
        .mockReturnValueOnce(false) // ReceiptOverwriteLogWriter

      // Mock readFile calls only for CycleLogWriter
      mockedReadFile
        .mockResolvedValueOnce('cycle-log1.txt') // CycleLogWriter active log
        .mockResolvedValueOnce(Array(100).fill('entry').join('\n') + '\n') // 100 entries with trailing newline

      await initDataLogWriter()

      expect(CycleLogWriter.totalNumberOfEntries).toBe(0) // Reset after rotation
      expect(CycleLogWriter.logCounter).toBe(2) // Incremented
    })

    it('should handle errors when reading active log file', async () => {
      // Only mock exists for CycleLogWriter's active log
      mockedExistsSync
        .mockReturnValueOnce(true) // CycleLogWriter
        .mockReturnValueOnce(false) // ReceiptLogWriter
        .mockReturnValueOnce(false) // OriginalTxDataLogWriter
        .mockReturnValueOnce(false) // ReceiptOverwriteLogWriter

      mockedReadFile.mockRejectedValueOnce(new Error('Read error'))

      await initDataLogWriter()

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to read active log file:'))
    })
  })

  describe('writeToLog', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should write data to the log', async () => {
      const testData = 'test log entry\n'

      await CycleLogWriter.writeToLog(testData)

      expect(mockWriteStream.write).toHaveBeenCalledWith(testData)
      expect(CycleLogWriter.totalNumberOfEntries).toBe(1)
    })

    it('should queue multiple writes', async () => {
      const data1 = 'entry1\n'
      const data2 = 'entry2\n'
      const data3 = 'entry3\n'

      await Promise.all([
        CycleLogWriter.writeToLog(data1),
        CycleLogWriter.writeToLog(data2),
        CycleLogWriter.writeToLog(data3),
      ])

      expect(mockWriteStream.write).toHaveBeenCalledWith(data1)
      expect(mockWriteStream.write).toHaveBeenCalledWith(data2)
      expect(mockWriteStream.write).toHaveBeenCalledWith(data3)
      expect(CycleLogWriter.totalNumberOfEntries).toBe(3)
    })

    it('should handle write errors', async () => {
      mockWriteStream.write.mockImplementationOnce(() => {
        throw new Error('Write error')
      })

      await CycleLogWriter.writeToLog('test data\n')

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error while writing data to log file', expect.any(Error))
    })

    it('should handle backpressure', async () => {
      mockWriteStream.write.mockReturnValueOnce(false)
      let drainCallback: (() => void) | undefined
      mockWriteStream.once.mockImplementationOnce((event, callback) => {
        if (event === 'drain') {
          drainCallback = callback as () => void
        }
      })

      const writePromise = CycleLogWriter.writeToLog('test data\n')

      // Simulate drain event
      if (drainCallback) drainCallback()

      await writePromise

      expect(mockWriteStream.once).toHaveBeenCalledWith('drain', expect.any(Function))
    })
  })

  describe('log rotation', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should rotate log file when counter reaches max/2', async () => {
      CycleLogWriter.logCounter = 4
      mockedReaddir.mockResolvedValue(['old-cycle-log6.txt', 'old-cycle-log7.txt'] as any)

      await CycleLogWriter.rotateLogFile()

      expect(CycleLogWriter.logCounter).toBe(5)
      expect(mockedUnlink).toHaveBeenCalledTimes(2)
      expect(mockedRename).toHaveBeenCalledTimes(5) // Files 6-10
    })

    it('should rotate log file when counter reaches max', async () => {
      CycleLogWriter.logCounter = 9
      mockedReaddir.mockResolvedValue(['old-cycle-log1.txt', 'old-cycle-log2.txt'] as any)

      await CycleLogWriter.rotateLogFile()

      expect(CycleLogWriter.logCounter).toBe(10)
      expect(mockedUnlink).toHaveBeenCalledTimes(2)
      expect(mockedRename).toHaveBeenCalledTimes(5) // Files 1-5
    })

    it('should reset counter when exceeding max', async () => {
      CycleLogWriter.logCounter = 10

      await CycleLogWriter.rotateLogFile()

      expect(CycleLogWriter.logCounter).toBe(1)
    })

    it('should handle rotation with verbose logging', async () => {
      ;(config as any).VERBOSE = true
      mockedReaddir.mockResolvedValue(['old-cycle-log1.txt'] as any)

      await CycleLogWriter.rotateLogFile()

      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Rotated log file:'))
      ;(config as any).VERBOSE = false
    })
  })

  describe('setActiveLog', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should set active log file correctly', async () => {
      await CycleLogWriter.setActiveLog()

      expect(mockedAppendFile).toHaveBeenCalledWith(
        expect.stringContaining(`cycle-log${CycleLogWriter.logCounter}.txt`),
        ''
      )
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('active-cycle-log.txt'),
        `cycle-log${CycleLogWriter.logCounter}.txt`
      )
      expect(mockedCreateWriteStream).toHaveBeenCalledWith(
        expect.stringContaining(`cycle-log${CycleLogWriter.logCounter}.txt`),
        { flags: 'a' }
      )
    })
  })

  describe('deleteOldLogFiles', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should delete old log files with matching prefix', async () => {
      mockedReaddir.mockResolvedValue([
        'old-cycle-log1.txt',
        'old-cycle-log2.txt',
        'cycle-log3.txt',
        'other-file.txt',
      ] as any)

      const result = await CycleLogWriter.deleteOldLogFiles('old')

      expect(result.oldLogFiles).toEqual(['old-cycle-log1.txt', 'old-cycle-log2.txt'])
      expect(result.promises).toHaveLength(2)
    })

    it('should return empty arrays when no matching files', async () => {
      mockedReaddir.mockResolvedValue(['other-file.txt'] as any)

      const result = await CycleLogWriter.deleteOldLogFiles('old')

      expect(result.oldLogFiles).toEqual([])
      expect(result.promises).toHaveLength(0)
    })
  })

  describe('endStream', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should end stream successfully', async () => {
      CycleLogWriter.totalNumberOfEntries = 50

      await CycleLogWriter.endStream()

      expect(mockWriteStream.end).toHaveBeenCalled()
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ Finished writing 50.')
    })

    it('should handle errors when ending stream', async () => {
      mockWriteStream.end.mockImplementationOnce(() => {
        throw new Error('End stream error')
      })

      await expect(CycleLogWriter.endStream()).rejects.toThrow('End stream error')

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error while ending stream', expect.any(Error))
    })
  })

  describe('automatic rotation during writes', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should rotate log when reaching max entries during write', async () => {
      CycleLogWriter.totalNumberOfEntries = 100
      CycleLogWriter.maxNumberEntriesPerLog = 100

      await CycleLogWriter.writeToLog('final entry\n')

      expect(mockWriteStream.write).toHaveBeenCalledWith('End: Number of entries: 100\n')
      expect(mockWriteStream.end).toHaveBeenCalled()
      expect(CycleLogWriter.totalNumberOfEntries).toBe(1) // Reset and new entry
      expect(CycleLogWriter.logCounter).toBe(2) // Incremented
    })
  })

  describe('concurrent write handling', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should handle concurrent writes properly', async () => {
      const writes = Array(10)
        .fill(null)
        .map((_, i) => `entry${i}\n`)

      await Promise.all(writes.map((data) => CycleLogWriter.writeToLog(data)))

      expect(mockWriteStream.write).toHaveBeenCalledTimes(10)
      expect(CycleLogWriter.totalNumberOfEntries).toBe(10)
    })

    it('should maintain write order in queue', async () => {
      const writes: string[] = []
      mockWriteStream.write.mockImplementation((data) => {
        writes.push(data as string)
        return true
      })

      await Promise.all([
        CycleLogWriter.writeToLog('first\n'),
        CycleLogWriter.writeToLog('second\n'),
        CycleLogWriter.writeToLog('third\n'),
      ])

      expect(writes).toEqual(['first\n', 'second\n', 'third\n'])
    })
  })

  describe('error handling in writeToLog', () => {
    beforeEach(async () => {
      await initDataLogWriter()
    })

    it('should catch and log errors in writeToLog', async () => {
      // Mock insertDataLog to throw an error
      jest.spyOn(CycleLogWriter as any, 'insertDataLog').mockRejectedValueOnce(new Error('Insert error'))

      await CycleLogWriter.writeToLog('test data\n')

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error in writeToLog:', expect.any(Error))
    })
  })
})
