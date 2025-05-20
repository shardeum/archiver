import { nestedCountersInstance } from '../profiler/nestedCounters'

export function logEnvSetup(): void {
  try {
    console.log('LOAD_JSON_GENESIS_SECURE_ACCOUNTS', process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS)

    if (nestedCountersInstance != null) {
      nestedCountersInstance.countEvent(
        'env',
        'LOAD_JSON_GENESIS_SECURE_ACCOUNTS ' + process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS
      )
    }
  } catch (e) {
    //if we crashed from logging I guess we should not log right now.
  }
}
