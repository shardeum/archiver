import { nestedCountersInstance } from './nestedCounters'
import * as Logger from '../Logger'

export interface ArchiverRegistrationLog {
  archiverId: string
  timestamp: number
  validators: {
    discovered: number
    connected: number
  }
  state: 'REGISTERING' | 'REGISTERED' | 'ERROR'
}

export interface ValidatorConnectionLog {
  validatorId: string
  archiverId: string
  timestamp: number
  status: 'CONNECTING' | 'CONNECTED' | 'ERROR'
  handshake: {
    success: boolean
    duration: number
    error?: string
  }
}

export interface DataSyncLog {
  sourceArchiver: string
  targetArchiver: string
  cycle: number
  dataType: 'VALIDATOR_LIST' | 'CYCLE_RECORD' | 'TX_LIST' | 'STANDBY_LIST' | 'ARCHIVER_LIST'
  dataHash: string
  status: 'STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'ERROR'
  metrics: {
    duration: number
    dataSize: number
  }
  error?: string
}

export class ArchiverLogging {
  static logArchiverRegistration(log: ArchiverRegistrationLog): void {
    Logger.mainLogger.info('Archiver Registration', log)

    nestedCountersInstance.countEvent('archiver', `registration_${log.state}`, 1)
    nestedCountersInstance.countEvent('archiver', 'validators_discovered', log.validators.discovered)
    nestedCountersInstance.countEvent('archiver', 'validators_connected', log.validators.connected)
  }

  static logValidatorConnection(log: ValidatorConnectionLog): void {
    Logger.mainLogger.info('Validator Connection', log)

    nestedCountersInstance.countEvent('validator', `connection_${log.status}`, 1)
    if (log.handshake.success) {
      nestedCountersInstance.countEvent('validator', 'handshake_success', 1)
    } else {
      nestedCountersInstance.countEvent('validator', 'handshake_failure', 1)
    }
  }

  static logDataSync(log: DataSyncLog): void {
    Logger.mainLogger.info('Data Sync', log)

    nestedCountersInstance.countEvent('sync', `data_sync_${log.status}`, 1)
    nestedCountersInstance.countEvent('sync', `data_type_${log.dataType}`, 1)
    nestedCountersInstance.countEvent('sync', 'data_size', log.metrics.dataSize)
  }
}
