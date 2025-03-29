import * as log4js from 'log4js'
import { existsSync, mkdirSync, rmdirSync } from 'fs'
import Logger, { initLogger, mainLogger, fatalLogger, errorLogger } from '../../../src/Logger'
import path = require('path')

jest.mock('fs')
jest.mock('log4js')
jest.mock('log4js-extend')

describe('Logger', () => {
    const baseDir = '/test/base/dir'
    const mockConfig = {
        dir: 'logs',
        files: {
            main: 'main.log',
            fatal: 'fatal.log'
        },
        options: {
            appenders: {
                out: { type: 'console' },
                main: { type: 'file', maxLogSize: 10485760, backups: 3 },
                fatal: { type: 'file', maxLogSize: 10485760, backups: 3 },
                errorFile: { type: 'file', maxLogSize: 10485760, backups: 3 }
            },
            categories: {
                default: { appenders: ['out'], level: 'info' },
                main: { appenders: ['main', 'out'], level: 'info' },
                fatal: { appenders: ['fatal', 'out'], level: 'fatal' }
            }
        }
    }

    beforeEach(() => {
        jest.clearAllMocks()
            ; (existsSync as jest.Mock).mockReturnValue(false)
            ; (mkdirSync as jest.Mock).mockImplementation(() => { })
            ; (log4js.configure as jest.Mock).mockReturnValue({})
            ; (log4js.getLogger as jest.Mock).mockReturnValue({
                info: jest.fn()
            })
    })

    describe('constructor and initialization', () => {
        it('should create logger instance with valid config', () => {
            const logger = new Logger(baseDir, mockConfig)
            expect(logger).toBeDefined()
            expect(logger.baseDir).toBe(baseDir)
            expect(logger.config).toBe(mockConfig)
        })

        it('should throw error when baseDir is not provided', () => {
            expect(() => new Logger('', mockConfig)).toThrow('Fatal Error: Base directory not defined.')
        })

        it('should throw error when config is not provided', () => {
            expect(() => new Logger(baseDir, null as any)).toThrow('Fatal Error: No configuration provided.')
        })
    })

    describe('_checkValidConfig', () => {
        it('should throw error when log directory is not defined', () => {
            const invalidConfig = { ...mockConfig, dir: undefined }
            expect(() => new Logger(baseDir, invalidConfig)).toThrow('Fatal Error: Log directory not defined.')
        })

        it('should throw error when files config is missing', () => {
            const invalidConfig = { ...mockConfig, files: undefined }
            expect(() => new Logger(baseDir, invalidConfig)).toThrow('Fatal Error: Valid log file locations not provided.')
        })

        it('should throw error when files config is not an object', () => {
            const invalidConfig = { ...mockConfig, files: 'not an object' as any }
            expect(() => new Logger(baseDir, invalidConfig)).toThrow('Fatal Error: Valid log file locations not provided.')
        })
    })

    describe('_addFileNamesToAppenders', () => {
        it('should add correct filenames to file appenders', () => {
            const logger = new Logger(baseDir, mockConfig)
            const expectedPath = path.join(baseDir, mockConfig.dir)

            expect(logger.log4Conf.appenders.main.filename).toBe(`${expectedPath}/main.log`)
            expect(logger.log4Conf.appenders.fatal.filename).toBe(`${expectedPath}/fatal.log`)
            expect(logger.log4Conf.appenders.errorFile.filename).toBe(`${expectedPath}/errorFile.log`)
        })

        it('should not add filename to non-file appenders', () => {
            const logger = new Logger(baseDir, mockConfig)
            expect(logger.log4Conf.appenders.out.filename).toBeUndefined()
        })
    })

    describe('getLogger', () => {
        it('should return logger instance for valid category', () => {
            const logger = new Logger(baseDir, mockConfig)
            const mainLoggerInstance = logger.getLogger('main')
            expect(mainLoggerInstance).toBeDefined()
            expect(log4js.getLogger).toHaveBeenCalledWith('main')
        })
    })

    describe('shutdown', () => {
        it('should properly shutdown logger', async () => {
            const logger = new Logger(baseDir, mockConfig)
                ; (log4js.shutdown as jest.Mock).mockImplementation((callback) => callback())

            const result = await logger.shutdown()
            expect(result).toBe('done')
            expect(log4js.shutdown).toHaveBeenCalled()
        })
    })

    describe('initLogger', () => {
        it('should initialize global logger instances', () => {
            initLogger(baseDir, mockConfig)

            expect(mainLogger).toBeDefined()
            expect(fatalLogger).toBeDefined()
            expect(errorLogger).toBeDefined()
            expect(log4js.getLogger).toHaveBeenCalledWith('main')
            expect(log4js.getLogger).toHaveBeenCalledWith('fatal')
            expect(log4js.getLogger).toHaveBeenCalledWith('errorFile')
        })
    })

    describe('directory creation', () => {
        it('should create log directories if they do not exist', () => {
            new Logger(baseDir, mockConfig)

            expect(existsSync).toHaveBeenCalledWith(expect.stringContaining('logs'))
            expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining('logs'))
        })

        it('should not create directories if they already exist', () => {
            ; (existsSync as jest.Mock).mockReturnValue(true)
            new Logger(baseDir, mockConfig)

            expect(mkdirSync).not.toHaveBeenCalled()
        })
    })
}) 