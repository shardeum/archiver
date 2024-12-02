import * as fs from 'fs'
import * as Logger from './Logger'
import * as merge from 'deepmerge'
import * as minimist from 'minimist'
import { join } from 'path'
import { Utils as StringUtils } from '@shardus/types'
import { DevSecurityLevel } from './types/security'

export interface Config {
  [index: string]: object | string | number | boolean
  ARCHIVER_IP: string
  ARCHIVER_PORT: number
  ARCHIVER_HASH_KEY: string
  ARCHIVER_PUBLIC_KEY: string
  ARCHIVER_SECRET_KEY: string
  ARCHIVER_DB: string // Archiver DB folder name and path
  ARCHIVER_DATA: {
    cycleDB: string
    accountDB: string
    transactionDB: string
    receiptDB: string
    originalTxDataDB: string
    processedTxDB: string
    txDigestDB: string
  }
  DATASENDER_TIMEOUT: number
  RATE_LIMIT: number // number of allowed request per second,
  N_NODE_REJECT_PERCENT: number
  N_NODELIST: number
  N_RANDOM_NODELIST_BUCKETS: number // Number of random node lists in the NodeList cache
  RECEIPT_CONFIRMATIONS: number // Number of receipt confirmations (from other validators) before storing a tx receipt
  STATISTICS: {
    save: boolean
    interval: number
  }
  ARCHIVER_MODE: string
  DevPublicKey: string
  dataLogWrite: boolean
  dataLogWriter: {
    dirName: string
    maxLogFiles: number
    maxReceiptEntries: number
    maxCycleEntries: number
    maxOriginalTxEntries: number
  }
  experimentalSnapshot: boolean
  VERBOSE: boolean
  useSerialization: boolean
  useSyncV2: boolean
  sendActiveMessage: boolean
  globalNetworkAccount: string
  maxValidatorsToServe: number
  limitToArchiversOnly: boolean
  verifyReceiptData: boolean
  verifyReceiptSignaturesSeparately: boolean
  verifyAppReceiptData: boolean
  verifyAccountData: boolean
  REQUEST_LIMIT: {
    MAX_ACCOUNTS_PER_REQUEST: number
    MAX_RECEIPTS_PER_REQUEST: number
    MAX_ORIGINAL_TXS_PER_REQUEST: number
    MAX_CYCLES_PER_REQUEST: number
    MAX_BETWEEN_CYCLES_PER_REQUEST: number
  }
  cycleRecordsCache: {
    enabled: boolean
  }
  newPOQReceipt: boolean
  storeReceiptBeforeStates: boolean
  waitingTimeForMissingTxData: number // Wait time in ms for missing tx data before collecting from other archivers
  gossipToMoreArchivers: true // To gossip to more archivers in addition to adjacent archivers
  randomGossipArchiversCount: 2 // Number of random archivers to gossip to
  subscribeToMoreConsensors: boolean // To subscribe to more consensors when the number of active archivers is less than 4
  extraConsensorsToSubscribe: 1 // Number of extra consensors to subscribe to
  // For debugging gossip data, set this to true. This will save only the gossip data received from the gossip archivers.
  saveOnlyGossipData: boolean
  // For debugging purpose, set this to true to stop gossiping tx data
  stopGossipTxData: boolean
  usePOQo: boolean
  // The percentage of votes required to confirm transaction
  requiredVotesPercentage: number
  // The percentage of votes required for majority
  requiredMajorityVotesPercentage: number
  // max number of recent cycle shard data to keep
  maxCyclesShardDataToKeep: number
  // the number of cycles within which we want to keep \changes to a config*/
  configChangeMaxCyclesToKeep: number
  // the number of config changes to keep*/
  configChangeMaxChangesToKeep: number
  receiptLoadTrakerInterval: number // Interval to track the receipt load
  receiptLoadTrakerLimit: number // Limit to track the receipt load
  lastActivityCheckInterval: number // Interval to check last activity
  lastActivityCheckTimeout: number // Timeout to check last activity
  txDigest: {
    cycleDiff: number
    syncDelay: number
    apiServerPort: number
    txCronSchedule: string
  }
  workerProcessesDebugLog: boolean // To enable debug logs for worker processes managed by the main process
  restrictFirstNodeSelectionByPublicKey: boolean // The flag to pick the first node that matches the PUBLIC_KEY specified in the firstNodeInfo
  firstNodePublicKey: string // The public key of the first node to be selected
  disableOffloadReceipt: boolean // To disable offloading of receipts globally
  disableOffloadReceiptForGlobalModification: boolean // To disable offloading of receipts for global modifications receipts
  restoreNGTsFromSnapshot: boolean // To restore NGTs from snapshot
  tickets: {
    allowedTicketSigners: {
      [pubkey: string]: number
    }
    minSigRequired: number
    requiredSecurityLevel: number
  }
  maxRecordsPerRequest: number // this is the equiavlent of the accountBucketSize config variable used by the validators to fetch records from the archiver
}

let config: Config = {
  ARCHIVER_IP: '127.0.0.1',
  ARCHIVER_PORT: 4000,
  ARCHIVER_HASH_KEY: '',
  ARCHIVER_PUBLIC_KEY: '',
  ARCHIVER_SECRET_KEY: '',
  ARCHIVER_LOGS: 'archiver-logs',
  ARCHIVER_DB: 'archiver-db',
  ARCHIVER_DATA: {
    cycleDB: 'cycles.sqlite3',
    accountDB: 'accounts.sqlite3',
    transactionDB: 'transactions.sqlite3',
    receiptDB: 'receipts.sqlite3',
    originalTxDataDB: 'originalTxsData.sqlite3',
    processedTxDB: 'processedTransactions.sqlite3',
    txDigestDB: 'txDigest.sqlite3',
  },
  DATASENDER_TIMEOUT: 1000 * 60 * 5,
  RATE_LIMIT: 100, // 100 req per second,
  N_NODE_REJECT_PERCENT: 5, // Percentage of old nodes to remove from nodelist
  N_NODELIST: 10, // number of active node list GET /nodelist should emit but if the total active nodelist is less than said value it will emit all the node list.
  N_RANDOM_NODELIST_BUCKETS: 100,
  RECEIPT_CONFIRMATIONS: 5,
  STATISTICS: {
    save: true,
    interval: 1,
  },
  ARCHIVER_MODE: 'release', // 'debug'/'release'
  DevPublicKey: '',
  dataLogWrite: true,
  dataLogWriter: {
    dirName: 'data-logs',
    maxLogFiles: 10,
    maxReceiptEntries: 10000, // Should be >= max TPS experienced by the network.
    maxCycleEntries: 500,
    maxOriginalTxEntries: 10000, // Should be >= max TPS experienced by the network.
  },
  experimentalSnapshot: true,
  VERBOSE: false,
  useSerialization: true,
  useSyncV2: true,
  sendActiveMessage: false,
  globalNetworkAccount:
    process.env.GLOBAL_ACCOUNT || '1000000000000000000000000000000000000000000000000000000000000001', //this address will change in the future
  maxValidatorsToServe: 10, // max number of validators to serve accounts data during restore mode
  limitToArchiversOnly: true,
  verifyReceiptData: true,
  verifyReceiptSignaturesSeparately: true,
  verifyAccountData: true,
  verifyAppReceiptData: true,
  REQUEST_LIMIT: {
    MAX_ACCOUNTS_PER_REQUEST: 1000,
    MAX_RECEIPTS_PER_REQUEST: 100,
    MAX_ORIGINAL_TXS_PER_REQUEST: 100,
    MAX_CYCLES_PER_REQUEST: 100,
    MAX_BETWEEN_CYCLES_PER_REQUEST: 100,
  },
  cycleRecordsCache: {
    enabled: false,
  },
  newPOQReceipt: false,
  storeReceiptBeforeStates: true,
  waitingTimeForMissingTxData: 2000, // in ms
  gossipToMoreArchivers: true,
  randomGossipArchiversCount: 2,
  subscribeToMoreConsensors: true,
  extraConsensorsToSubscribe: 1,
  saveOnlyGossipData: false,
  stopGossipTxData: false,
  usePOQo: true,
  requiredVotesPercentage: 2 / 3,
  requiredMajorityVotesPercentage: 60,
  maxCyclesShardDataToKeep: 10,
  configChangeMaxCyclesToKeep: 5,
  configChangeMaxChangesToKeep: 1000,
  receiptLoadTrakerInterval: 10 * 1000,
  receiptLoadTrakerLimit: 10,
  lastActivityCheckInterval: 15 * 1000,
  lastActivityCheckTimeout: 30 * 1000,
  txDigest: {
    cycleDiff: 10,
    syncDelay: 20,
    apiServerPort: 8084,
    txCronSchedule: '*/5 * * * *',
  },
  workerProcessesDebugLog: false,
  restrictFirstNodeSelectionByPublicKey: false,
  firstNodePublicKey: '',
  disableOffloadReceipt: false,
  disableOffloadReceiptForGlobalModification: true,
  restoreNGTsFromSnapshot: false,
  tickets: {  
    allowedTicketSigners: {
      '0x002D3a2BfE09E3E29b6d38d58CaaD16EEe4C9BC5': 5,
      '0x0a0844DA5e01E391d12999ca859Da8a897D5979A': 5,
      '0x390878B18DeBe2A9f0d5c0252a109c84243D3beb': 5,
      '0x32B6f2C027D4c9D99Ca07d047D17987390a5EB39': 5,
      '0x80aF8E195B56aCC3b4ec8e2C99EC38957258635a': 5,
      '0x7Efbb31431ac7C405E8eEba99531fF1254fCA3B6': 5,
      '0xCc74bf387F6C102b5a7F828796C57A6D2D19Cb00': 5,
      '0x4ed5C053BF2dA5F694b322EA93dce949F3276B85': 5,
      '0xd31aBC7497aD8bC9fe8555C9eDe45DFd7FB3Bf6F': 5,
      '0xe7e4cc292b424C6D50d16F1Bb5BAB2032c486980': 5,
      '0xD815DA50966c19261B34Ffa3bE50A30A67D97456': 5,
      '0xE856B2365641eba73Bc430AAC1E8F930dA513D9D': 5,
      '0x8282F755e784414697421D4b59232E5d194e2262': 5,
      '0x353Ad64Df4fAe5EffF717A1c41BE6dEBee543129': 5,
      '0x9Ce1C3c114538c625aA2488b97fEb3723fdBB07B': 5,
      '0x6A83e4e4eB0A2c8f562db6BB64b02a9A6237B314': 5,
      '0x92E375E0c76CaE76D9DfBab17EE7B3B4EE407715': 5,
      '0xBD79B430CA932e2D89bb77ACaE7367a07471c2eA': 5,
      '0xEbe173a837Bc30BFEF6E13C9988a4771a4D83275': 5,
      '0xfF2b584A947182c55BBc039BEAB78BC201D3AdDe': 5,
      '0xCeA068d8DCB4B4020D30a9950C00cF8408611F67': 5,
      '0x52F8d3DaA7b5FF25ca2bF7417E059aFe0bD5fB0E': 5,
      '0x0341996A92193d8B7d80C4774fA2eff889e4b427': 5,
      '0xF82BDA6Ef512e4219C6DCEea896E50e8180a5bff': 5,
      '0xA04A1B214a2537139fE59488820D4dA06516933f': 5,
      '0x550817e7B91244BBeFE2AD621ccD555A16B00405': 5,
      '0x84C55a4bFfff1ADadb9C46e2B60979F519dAf874': 5,
      '0x4563303BCE96D3f8d9C7fB94b36dfFC9d831871d': 5,
      '0xdA058F9c7Ce86C1D21DD5DBDeBad5ab5c785520a': 5,
      '0x891DF765C855E9848A18Ed18984B9f57cb3a4d47': 5,
      '0x7Fb9b1C5E20bd250870F87659E46bED410221f17': 5,
      '0x1e5e12568b7103E8B22cd680A6fa6256DD66ED76': 5,
      '0xa58169308e7153B5Ce4ca5cA515cC4d0cBE7770B': 5,
    },
    minSigRequired: 1,
    requiredSecurityLevel: 5
  },
  maxRecordsPerRequest: 200, 
}
// Override default config params from config file, env vars, and cli args
export async function overrideDefaultConfig(file: string): Promise<void> {
  const env = process.env
  const args = process.argv

  // Override config from config file
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const fileConfig = StringUtils.safeJsonParse(fs.readFileSync(file, { encoding: 'utf8' }))
    const overwriteMerge = (target: [], source: []): [] => source
    config = merge(config, fileConfig, { arrayMerge: overwriteMerge })
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.warn('Failed to parse config file:', err)
    }
  }

  // Override config from env vars
  for (const param in config) {
    /* eslint-disable security/detect-object-injection */
    if (env[param]) {
      switch (typeof config[param]) {
        case 'number': {
          config[param] = Number(env[param])
          break
        }
        case 'string': {
          config[param] = String(env[param])
          break
        }
        case 'object': {
          try {
            const parameterStr = env[param]
            if (parameterStr) {
              const parameterObj = StringUtils.safeJsonParse(parameterStr)
              config[param] = parameterObj
            }
          } catch (e) {
            Logger.mainLogger.error(e)
            Logger.mainLogger.error('Unable to JSON parse', env[param])
          }
          break
        }
        case 'boolean': {
          config[param] = String(env[param]).toLowerCase() === 'true'
          break
        }
        default: {
          break
        }
      }
    }
  }

  // Override config from cli args
  const parsedArgs = minimist(args.slice(2))
  for (const param of Object.keys(config)) {
    /* eslint-disable security/detect-object-injection */
    if (parsedArgs[param]) {
      switch (typeof config[param]) {
        case 'number': {
          config[param] = Number(parsedArgs[param])
          break
        }
        case 'string': {
          config[param] = String(parsedArgs[param])
          break
        }
        case 'boolean': {
          if (typeof parsedArgs[param] === 'boolean') {
            config[param] = parsedArgs[param]
          } else {
            config[param] = String(parsedArgs[param]).toLowerCase() === 'true'
          }
          break
        }
        default: {
          break
        }
      }
    }
  }

  // Pull in secrets
  const secretsPath = join(__dirname, '../.secrets')
  const secrets = {}

  if (fs.existsSync(secretsPath)) {
    const lines = fs.readFileSync(secretsPath, 'utf-8').split('\n').filter(Boolean)

    lines.forEach((line) => {
      const [key, value] = line.split('=')
      secrets[key.trim()] = value.trim()
    })

    // Now, secrets contain your secrets, for example:
    // const apiKey = secrets.API_KEY;

    if (secrets['ARCHIVER_PUBLIC_KEY']) config.ARCHIVER_PUBLIC_KEY = secrets['ARCHIVER_PUBLIC_KEY']
    if (secrets['ARCHIVER_SECRET_KEY']) config.ARCHIVER_SECRET_KEY = secrets['ARCHIVER_SECRET_KEY']
    if (secrets['ARCHIVER_HASH_KEY']) config.ARCHIVER_HASH_KEY = secrets['ARCHIVER_HASH_KEY']
  }

  if (config.ARCHIVER_HASH_KEY === '') {
    // Use default hash key if none provided
    // pragma: allowlist nextline secret
    config.ARCHIVER_HASH_KEY = '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc'
  }
  if (config.DevPublicKey === '') {
    // Use default dev public key if none provided
    // pragma: allowlist nextline secret
    config.DevPublicKey = '774491f80f47fedb119bb861601490f42bc3ea3b57fc63906c0d08e6d777a592'
  }
}

export function updateConfig(newConfig: Partial<Config>): Config {
  for (const key in newConfig) {
    if (typeof newConfig[key] !== typeof config[key])
      throw new Error(
        `Value with incorrect type passed to update the Archiver Config: ${key}:${
          newConfig[key]
        } of type ${typeof newConfig[key]}`
      )
  }
  config = merge(config, newConfig)
  Logger.mainLogger.info('Updated Archiver Config:', config)
  return config
}

export { config }
