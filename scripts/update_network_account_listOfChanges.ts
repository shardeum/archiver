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
    existingArchivers: any[]
    maxSyncTimeFloor: number
  }
  sharding: {
    nodesPerConsensusGroup: number
  }
}

const defaultConfig: ConfigSchema = {
  p2p: {
    baselineNodes: 1280,
    minNodes: 1280,
    maxNodes: 1280,
    existingArchivers: [],
    maxSyncTimeFloor: 12000,
  },
  sharding: {
    nodesPerConsensusGroup: 128,
  },
}

const defaultAppData = {
  activeVersion: '1.16.5',
  latestVersion: '1.16.5',
  minVersion: '1.16.5',
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
    case 'number': {
      const parsedNumber = parseFloat(value)
      return isNaN(parsedNumber) ? undefined : parsedNumber
    }
    case 'boolean':
      if (value.toLowerCase() === 'true' || value.toLowerCase() === 'false') {
        return value.toLowerCase() === 'true'
      }
      return undefined
    case 'string':
      return value
    default:
      return defaultValue
  }
}

// Function to dynamically ask configuration questions for config changes
const askConfigQuestions = async (): Promise<ConfigSchema> => {
  const userConfig: Partial<ConfigSchema> = {}

  for (const section in defaultConfig) {
    const defaultValue = defaultConfig[section]
    // Check if the section is an object (but not an array) at the top level.
    if (typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      userConfig[section] = {}
      for (const key in defaultValue) {
        const propertyDefault = defaultValue[key]
        // If the property is an array, handle it with JSON input.
        if (Array.isArray(propertyDefault)) {
          let attempts = 0
          const maxAttempts = 3
          let isValid = false
          while (!isValid && attempts < maxAttempts) {
            const value = await askQuestion(
              `Enter ${section}.${key} as JSON (default: ${JSON.stringify(propertyDefault)}): `
            )
            if (value === '') {
              userConfig[section][key] = propertyDefault
              isValid = true
            } else {
              try {
                const parsed = JSON.parse(value)
                if (Array.isArray(parsed)) {
                  userConfig[section][key] = parsed
                  isValid = true
                } else {
                  attempts++
                  console.log(
                    `Invalid input. Please enter a valid JSON array for ${section}.${key}. (${attempts}/${maxAttempts} attempts)`
                  )
                }
              } catch (e) {
                attempts++
                console.log(
                  `Invalid JSON. Please enter a valid JSON array for ${section}.${key}. (${attempts}/${maxAttempts} attempts)`
                )
              }
            }
          }
          if (!isValid) {
            console.log(`Maximum attempts reached. Using default value for ${section}.${key}.`)
            userConfig[section][key] = propertyDefault
          }
        } else {
          // Otherwise, handle it as a primitive value.
          let attempts = 0
          const maxAttempts = 3
          let isValid = false

          while (!isValid && attempts < maxAttempts) {
            const value = await askQuestion(`Enter ${section}.${key} (default: ${propertyDefault}): `)
            const expectedType = typeof propertyDefault
            const parsedValue = parseInput(value, expectedType, propertyDefault)

            if (value === '') {
              userConfig[section][key] = propertyDefault
              isValid = true
            } else if (parsedValue !== undefined) {
              userConfig[section][key] = parsedValue
              isValid = true
            } else {
              attempts++
              console.log(
                `Invalid input. Please enter a valid ${expectedType} for ${section}.${key}. (${attempts}/${maxAttempts} attempts)`
              )
            }
          }
          if (!isValid) {
            console.log(`Maximum attempts reached. Using default value for ${section}.${key}.`)
            userConfig[section][key] = propertyDefault
          }
        }
      }
    }
    // For top-level arrays (if any)
    else if (Array.isArray(defaultValue)) {
      let attempts = 0
      const maxAttempts = 3
      let isValid = false

      while (!isValid && attempts < maxAttempts) {
        const value = await askQuestion(
          `Enter ${section} as JSON (default: ${JSON.stringify(defaultValue)}): `
        )
        if (value === '') {
          userConfig[section] = defaultValue
          isValid = true
        } else {
          try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
              userConfig[section] = parsed
              isValid = true
            } else {
              attempts++
              console.log(
                `Invalid input. Please enter a valid JSON array for ${section}. (${attempts}/${maxAttempts} attempts)`
              )
            }
          } catch (e) {
            attempts++
            console.log(
              `Invalid JSON. Please enter a valid JSON array for ${section}. (${attempts}/${maxAttempts} attempts)`
            )
          }
        }
      }
      if (!isValid) {
        console.log(`Maximum attempts reached. Using default value for ${section}.`)
        userConfig[section] = defaultValue
      }
    }
    // For primitive top-level values
    else {
      let attempts = 0
      const maxAttempts = 3
      let isValid = false

      while (!isValid && attempts < maxAttempts) {
        const value = await askQuestion(`Enter ${section} (default: ${defaultValue}): `)
        const expectedType = typeof defaultValue
        const parsedValue = parseInput(value, expectedType, defaultValue)

        if (value === '') {
          userConfig[section] = defaultValue
          isValid = true
        } else if (parsedValue !== undefined) {
          userConfig[section] = parsedValue
          isValid = true
        } else {
          attempts++
          console.log(
            `Invalid input. Please enter a valid ${expectedType} for ${section}. (${attempts}/${maxAttempts} attempts)`
          )
        }
      }
      if (!isValid) {
        console.log(`Maximum attempts reached. Using default value for ${section}.`)
        userConfig[section] = defaultValue
      }
    }
  }

  return userConfig as ConfigSchema
}

const askAppDataQuestions = async (): Promise<any> => {
  const appData: any = {}

  for (const key in defaultAppData) {
    let attempts = 0
    const maxAttempts = 3
    let isValid = false

    while (!isValid && attempts < maxAttempts) {
      const value = await askQuestion(`Enter appData.${key} (default: ${defaultAppData[key]}): `)
      const expectedType = typeof defaultAppData[key]
      const parsedValue = parseInput(value, expectedType, defaultAppData[key])

      if (value === '') {
        appData[key] = defaultAppData[key]
        isValid = true
      } else if (parsedValue !== undefined) {
        appData[key] = parsedValue
        isValid = true
      } else {
        attempts++
        console.log(
          `Invalid input. Please enter a valid ${expectedType} for appData.${key}. (${attempts}/${maxAttempts} attempts)`
        )
      }
    }

    if (!isValid) {
      console.log(`Maximum attempts reached. Using default value for appData.${key}.`)
      appData[key] = defaultAppData[key]
    }
  }

  return appData
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

    // Get configuration and appData changes from the user
    const configChanges = await askConfigQuestions()
    const appDataChanges = await askAppDataQuestions()
    const cycleNumber = await getCycleNumber()

    addSigListeners()

    const networkAccountId = config.globalNetworkAccount
    const networkAccount = (await AccountDB.queryAccountByAccountId(
      networkAccountId
    )) as AccountDB.AccountsCopy

    // Combine config and appData changes in one change object
    const changes = {
      change: configChanges,
      appData: appDataChanges,
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
