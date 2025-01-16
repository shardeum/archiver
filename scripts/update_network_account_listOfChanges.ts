import { readFileSync } from 'fs'
import { resolve, join } from 'path'
import { overrideDefaultConfig, config } from '../src/Config'
import * as Crypto from '../src/Crypto'
import * as dbstore from '../src/dbstore'
import * as AccountDB from '../src/dbstore/accounts'
import { startSaving } from '../src/saveConsoleOutput'
import * as Logger from '../src/Logger'
import { accountSpecificHash } from '../src/shardeum/calculateAccountHash'
import { addSigListeners } from '../src/State'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { initAjvSchemas } from '../src/types/ajv/Helpers'
import { initializeSerialization } from '../src/utils/serialization/SchemaHelpers'
import * as CycleDB from '../src/dbstore/cycles'
import * as readline from 'readline'

// Configuration schema and default values
interface ConfigSchema {
  p2p: {
    baselineNodes: number
    minNodes: number
    maxNodes: number
  }
  // Add more configs as needed
  // sharding: {
  //   nodesPerConsensusGroup: number
  //   executeInOneShard: boolean
  // }
}

const defaultConfig: ConfigSchema = {
  p2p: {
    baselineNodes: 1280,
    minNodes: 1280,
    maxNodes: 1280,
  },
  // Add default values for new configurations
  // sharding: {
  //   nodesPerConsensusGroup: 1280,
  //   executeInOneShard: false,
  // },
}

// Readline interface for terminal input
const rl = readline.createInterface({
  input: process.stdin as NodeJS.ReadableStream,
  output: process.stdout as NodeJS.WritableStream,
})

const askQuestion = (query: string): Promise<string> => {
  return new Promise((resolve) => rl.question(query, resolve))
}

// Utility function to validate and parse input based on expected type
const parseInput = (value: string, expectedType: string, defaultValue: any): any => {
  if (value === '') return defaultValue

  switch (expectedType) {
    case 'number':
      const parsedNumber = parseFloat(value)
      return isNaN(parsedNumber) ? defaultValue : parsedNumber
    case 'boolean':
      return value.toLowerCase() === 'true'
    case 'string':
      return value
    default:
      return defaultValue
  }
}

// Function to dynamically ask configuration questions
const askConfigQuestions = async (): Promise<ConfigSchema> => {
  const userConfig: Partial<ConfigSchema> = {}

  for (const section in defaultConfig) {
    userConfig[section] = {}
    for (const key in defaultConfig[section]) {
      let attempts = 0
      const maxAttempts = 3
      let isValid = false

      while (!isValid && attempts < maxAttempts) {
        const value = await askQuestion(`Enter ${section}.${key} (default: ${defaultConfig[section][key]}): `)
        const expectedType = typeof defaultConfig[section][key]
        const parsedValue = parseInput(value, expectedType, defaultConfig[section][key])

        // If empty input, use default value
        if (value === '') {
          userConfig[section][key] = defaultConfig[section][key]
          isValid = true
        }
        // If valid parsed value
        else if (parsedValue !== undefined) {
          userConfig[section][key] = parsedValue
          isValid = true
        }
        // Invalid input
        else {
          attempts++
          console.log(
            `Invalid input. Please enter a valid ${expectedType} for ${section}.${key}. (${attempts}/${maxAttempts} attempts)`
          )
        }
      }

      if (!isValid) {
        console.log(`Maximum attempts reached. Using default value for ${section}.${key}.`)
        userConfig[section][key] = defaultConfig[section][key]
      }
    }
  }

  return userConfig as ConfigSchema
}

// Function to get the latest cycle from db
const getCycleNumber = async (): Promise<number> => {
  const latestCycle = await CycleDB.queryLatestCycleRecords(1)
  const latestCycleRecord = latestCycle[0]
  const latestCycleNumber = latestCycleRecord.counter

  let cycleNumberInput: number
  do {
    cycleNumberInput = parseInt(
      await askQuestion(
        'Enter cycle number (must be less than the latest cycle number, latest cycle number is: ' +
          latestCycleNumber +
          '): '
      ),
      10
    )
    if (isNaN(cycleNumberInput) || cycleNumberInput >= latestCycleNumber) {
      console.log(`Please enter a valid cycle number less than ${latestCycleNumber}.`)
    }
  } while (isNaN(cycleNumberInput) || cycleNumberInput >= latestCycleNumber)

  return cycleNumberInput
}

const runProgram = async (): Promise<void> => {
  try {
    initAjvSchemas()
    initializeSerialization()

    // Load configuration from file
    const file = join(process.cwd(), 'archiver-config.json')
    overrideDefaultConfig(file)

    const hashKey = config.ARCHIVER_HASH_KEY
    Crypto.setCryptoHashKey(hashKey)

    let logsConfig
    try {
      logsConfig = StringUtils.safeJsonParse(readFileSync(resolve(__dirname, '../archiver-log.json'), 'utf8'))
    } catch (err) {
      console.log('Failed to parse archiver log file:', err)
    }
    const logDir = `${config.ARCHIVER_LOGS}/${config.ARCHIVER_IP}_${config.ARCHIVER_PORT}`
    const baseDir = '.'
    logsConfig.dir = logDir
    Logger.initLogger(baseDir, logsConfig)
    if (logsConfig.saveConsoleOutput) {
      startSaving(join(baseDir, logsConfig.dir))
    }

    await dbstore.initializeDB(config)

    const userConfig = await askConfigQuestions() // Get config values
    const cycleNumber = await getCycleNumber() // Get the latest cycle number

    addSigListeners()

    const networkAccountId = config.globalNetworkAccount
    const networkAccount = (await AccountDB.queryAccountByAccountId(
      networkAccountId
    )) as AccountDB.AccountsCopy

    // Add changes to listOfChanges
    const changes = {
      change: userConfig,
      cycle: cycleNumber,
    }

    console.log('Proposed Changes:', JSON.stringify(changes, null, 2))

    const confirmation = (
      await askQuestion('Are you sure you want to proceed with these changes? (yes/no): ')
    ).trim()
    console.log(`User input: ${confirmation}`)
    if (confirmation.toLowerCase() === 'yes' || confirmation.toLowerCase() === 'y') {
      networkAccount.data.listOfChanges.push(changes)

      const calculatedAccountHash = accountSpecificHash(networkAccount.data)
      networkAccount.hash = calculatedAccountHash
      networkAccount.data.hash = calculatedAccountHash

      await AccountDB.insertAccount(networkAccount)
      console.log('✅ Changes were applied.')
    } else {
      console.log('❌ Changes were not applied.')
    }
  } catch (error) {
    console.error('An error occurred:', error)
    throw error
  } finally {
    const cleanup = async () => {
      try {
        await dbstore.closeDatabase()
        rl.close()
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError)
      }
    }

    await cleanup()
  }
}

runProgram()
