import {
  ArchiverLogging,
  ArchiverRegistrationLog,
  ValidatorConnectionLog,
  DataSyncLog,
  OperationType
} from '../../../../src/profiler/archiverLogging'
import { nestedCountersInstance } from '../../../../src/profiler/nestedCounters'
import * as Logger from '../../../../src/Logger'

// Mock dependencies
jest.mock('../../../../src/profiler/nestedCounters', () => ({
  nestedCountersInstance: {
    countEvent: jest.fn()
  }
}))

jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    info: jest.fn()
  }
}))

describe('archiverLogging', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Mock Date.now and Math.random for consistent operation IDs
    jest.spyOn(Date, 'now').mockReturnValue(1234567890)
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('ArchiverLogging', () => {
    describe('generateOperationId', () => {
      it('should generate a unique operation ID', () => {
        const id = ArchiverLogging.generateOperationId()
        expect(id).toMatch(/^op-1234567890-[a-z0-9]{9}$/)
        expect(id.startsWith('op-1234567890-')).toBe(true)
      })

      it('should generate different IDs for different timestamps', () => {
        const id1 = ArchiverLogging.generateOperationId()
        
        jest.spyOn(Date, 'now').mockReturnValue(9876543210)
        jest.spyOn(Math, 'random').mockReturnValue(0.987654321)
        
        const id2 = ArchiverLogging.generateOperationId()
        
        expect(id1).not.toBe(id2)
        expect(id2).toMatch(/^op-9876543210-[a-z0-9]{9}$/)
      })

      it('should include timestamp and random component', () => {
        const id = ArchiverLogging.generateOperationId()
        expect(id).toMatch(/^op-\d+-[a-z0-9]{9}$/)
      })
    })

    describe('logArchiverRegistration', () => {
      it('should log registration with all fields', () => {
        const log: ArchiverRegistrationLog = {
          archiverId: 'arch-123',
          timestamp: 1234567890,
          validators: {
            discovered: 10,
            connected: 8
          },
          state: 'REGISTERED'
        }

        ArchiverLogging.logArchiverRegistration(log)

        expect(Logger.mainLogger.info).toHaveBeenCalledWith('Archiver Registration', log)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'registration_REGISTERED', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_discovered', 10)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_connected', 8)
      })

      it('should handle REGISTERING state', () => {
        const log: ArchiverRegistrationLog = {
          archiverId: 'arch-456',
          timestamp: 1234567890,
          validators: {
            discovered: 5,
            connected: 0
          },
          state: 'REGISTERING'
        }

        ArchiverLogging.logArchiverRegistration(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'registration_REGISTERING', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_discovered', 5)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_connected', 0)
      })

      it('should handle ERROR state', () => {
        const log: ArchiverRegistrationLog = {
          archiverId: 'arch-789',
          timestamp: 1234567890,
          validators: {
            discovered: 0,
            connected: 0
          },
          state: 'ERROR'
        }

        ArchiverLogging.logArchiverRegistration(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'registration_ERROR', 1)
      })

      it('should handle null/undefined nested counters instance', () => {
        // Temporarily set nestedCountersInstance to null
        const originalInstance = nestedCountersInstance
        ;(nestedCountersInstance as any) = null

        const log: ArchiverRegistrationLog = {
          archiverId: 'arch-null',
          timestamp: 1234567890,
          validators: { discovered: 1, connected: 1 },
          state: 'REGISTERED'
        }

        // Should not throw
        expect(() => ArchiverLogging.logArchiverRegistration(log)).not.toThrow()
        expect(Logger.mainLogger.info).toHaveBeenCalled()

        // Restore
        ;(nestedCountersInstance as any) = originalInstance
      })

      it('should handle missing validators data gracefully', () => {
        const log = {
          archiverId: 'arch-missing',
          timestamp: 1234567890,
          state: 'REGISTERED'
        } as ArchiverRegistrationLog

        ArchiverLogging.logArchiverRegistration(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'registration_REGISTERED', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_discovered', undefined)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('archiver', 'validators_connected', undefined)
      })
    })

    describe('logValidatorConnection', () => {
      it('should log successful connection with handshake', () => {
        const log: ValidatorConnectionLog = {
          validatorId: 'val-123',
          archiverId: 'arch-123',
          timestamp: 1234567890,
          status: 'CONNECTED',
          handshake: {
            success: true,
            duration: 250
          }
        }

        ArchiverLogging.logValidatorConnection(log)

        expect(Logger.mainLogger.info).toHaveBeenCalledWith('Validator Connection', log)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'connection_CONNECTED', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'handshake_success', 1)
      })

      it('should log failed handshake', () => {
        const log: ValidatorConnectionLog = {
          validatorId: 'val-456',
          archiverId: 'arch-456',
          timestamp: 1234567890,
          status: 'ERROR',
          handshake: {
            success: false,
            duration: 5000,
            error: 'Timeout'
          }
        }

        ArchiverLogging.logValidatorConnection(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'connection_ERROR', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'handshake_failure', 1)
      })

      it('should handle CONNECTING status', () => {
        const log: ValidatorConnectionLog = {
          validatorId: 'val-789',
          archiverId: 'arch-789',
          timestamp: 1234567890,
          status: 'CONNECTING',
          handshake: {
            success: false,
            duration: 0
          }
        }

        ArchiverLogging.logValidatorConnection(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'connection_CONNECTING', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'handshake_failure', 1)
      })

      it('should handle missing handshake data', () => {
        const log = {
          validatorId: 'val-missing',
          archiverId: 'arch-missing',
          timestamp: 1234567890,
          status: 'CONNECTED'
        } as ValidatorConnectionLog

        ArchiverLogging.logValidatorConnection(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'connection_CONNECTED', 1)
        // When handshake is undefined/missing, it evaluates to falsy, so handshake_failure is logged
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('validator', 'handshake_failure', 1)
      })
    })

    describe('logDataSync', () => {
      it('should log complete data sync with all metrics', () => {
        const log: DataSyncLog = {
          sourceArchiver: 'arch-source',
          targetArchiver: 'arch-target',
          cycle: 100,
          dataType: 'VALIDATOR_LIST',
          dataHash: 'hash-123',
          status: 'COMPLETE',
          metrics: {
            duration: 1500,
            dataSize: 2048
          },
          operationId: 'op-123'
        }

        ArchiverLogging.logDataSync(log)

        expect(Logger.mainLogger.info).toHaveBeenCalledWith('Data Sync', log)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_sync_COMPLETE', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_type_VALIDATOR_LIST', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_size', 2048)
      })

      it('should handle different data types', () => {
        const dataTypes: DataSyncLog['dataType'][] = [
          'CYCLE_RECORD',
          'TX_LIST',
          'STANDBY_LIST',
          'ARCHIVER_LIST'
        ]

        dataTypes.forEach(dataType => {
          jest.clearAllMocks()
          
          const log: DataSyncLog = {
            sourceArchiver: 'arch-1',
            targetArchiver: 'arch-2',
            cycle: 50,
            dataType,
            dataHash: 'hash',
            status: 'IN_PROGRESS',
            metrics: {
              duration: 500,
              dataSize: 1024
            }
          }

          ArchiverLogging.logDataSync(log)

          expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', `data_type_${dataType}`, 1)
          expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_sync_IN_PROGRESS', 1)
        })
      })

      it('should handle ERROR status with error message', () => {
        const log: DataSyncLog = {
          sourceArchiver: 'arch-error-source',
          targetArchiver: 'arch-error-target',
          cycle: 200,
          dataType: 'TX_LIST',
          dataHash: 'hash-error',
          status: 'ERROR',
          metrics: {
            duration: 10000,
            dataSize: 0
          },
          error: 'Network timeout'
        }

        ArchiverLogging.logDataSync(log)

        expect(Logger.mainLogger.info).toHaveBeenCalledWith('Data Sync', log)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_sync_ERROR', 1)
      })

      it('should handle STARTED status', () => {
        const log: DataSyncLog = {
          sourceArchiver: 'arch-start',
          targetArchiver: 'arch-end',
          cycle: 1,
          dataType: 'ARCHIVER_LIST',
          dataHash: '',
          status: 'STARTED',
          metrics: {
            duration: 0,
            dataSize: 0
          }
        }

        ArchiverLogging.logDataSync(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_sync_STARTED', 1)
      })

      it('should handle missing metrics data', () => {
        const log = {
          sourceArchiver: 'arch-1',
          targetArchiver: 'arch-2',
          cycle: 10,
          dataType: 'CYCLE_RECORD',
          dataHash: 'hash',
          status: 'COMPLETE'
        } as DataSyncLog

        ArchiverLogging.logDataSync(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_sync_COMPLETE', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_type_CYCLE_RECORD', 1)
        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_size', undefined)
      })

      it('should handle zero metrics', () => {
        const log: DataSyncLog = {
          sourceArchiver: 'arch-zero',
          targetArchiver: 'arch-zero-target',
          cycle: 0,
          dataType: 'STANDBY_LIST',
          dataHash: 'empty-hash',
          status: 'COMPLETE',
          metrics: {
            duration: 0,
            dataSize: 0
          }
        }

        ArchiverLogging.logDataSync(log)

        expect(nestedCountersInstance.countEvent).toHaveBeenCalledWith('sync', 'data_size', 0)
      })
    })
  })

  describe('Type exports', () => {
    it('should create valid OperationType values', () => {
      const operationTypes: OperationType[] = [
        'CYCLE_SYNC',
        'VALIDATOR_SYNC',
        'TX_SYNC',
        'REGISTRATION',
        'CONNECTION'
      ]

      operationTypes.forEach(type => {
        expect(typeof type).toBe('string')
      })
    })

    it('should create valid ArchiverRegistrationLog', () => {
      const log: ArchiverRegistrationLog = {
        archiverId: 'test-arch',
        timestamp: Date.now(),
        validators: {
          discovered: 5,
          connected: 3
        },
        state: 'REGISTERED'
      }

      expect(log.state).toMatch(/^(REGISTERING|REGISTERED|ERROR)$/)
    })

    it('should create valid ValidatorConnectionLog', () => {
      const log: ValidatorConnectionLog = {
        validatorId: 'test-val',
        archiverId: 'test-arch',
        timestamp: Date.now(),
        status: 'CONNECTED',
        handshake: {
          success: true,
          duration: 100,
          error: undefined
        }
      }

      expect(log.status).toMatch(/^(CONNECTING|CONNECTED|ERROR)$/)
    })

    it('should create valid DataSyncLog', () => {
      const log: DataSyncLog = {
        sourceArchiver: 'source',
        targetArchiver: 'target',
        cycle: 42,
        dataType: 'VALIDATOR_LIST',
        dataHash: 'hash',
        status: 'COMPLETE',
        metrics: {
          duration: 1000,
          dataSize: 2048
        }
      }

      expect(log.dataType).toMatch(/^(VALIDATOR_LIST|CYCLE_RECORD|TX_LIST|STANDBY_LIST|ARCHIVER_LIST)$/)
      expect(log.status).toMatch(/^(STARTED|IN_PROGRESS|COMPLETE|ERROR)$/)
    })
  })
})