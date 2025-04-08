import * as crypto from '@shardeum-foundation/lib-crypto-utils'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { postJson } from '../src/P2P'
import { config, overrideDefaultConfig } from '../src/Config'
import { ArchiverNodeInfo } from '../src/State'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { initAjvSchemas } from '../src/types/ajv/Helpers'
import { initializeSerialization } from '../src/utils/serialization/SchemaHelpers'

const configFile = join(process.cwd(), 'archiver-config.json')
overrideDefaultConfig(configFile)

crypto.init(config.ARCHIVER_HASH_KEY)

export type ArchiverNode = Omit<ArchiverNodeInfo, 'publicKey' | 'curvePk'>

const archivers: ArchiverNode[] = [
  {
    ip: '127.0.0.1',
    port: 4000,
  },
  {
    ip: '127.0.0.1',
    port: 4001,
  },
]

const devAccount = {
  publicKey: '',
  secretKey: '',
}

const startCycle = process.env.TEST_START_CYCLE ? parseInt(process.env.TEST_START_CYCLE) : 0
const endCycle = process.env.TEST_END_CYCLE ? parseInt(process.env.TEST_END_CYCLE) : 0

// const URL = 'originalTx'
const URL = 'receipt'

const runProgram = async (): Promise<void> => {
  initAjvSchemas()
  initializeSerialization()
  for (const archiver of archivers) {
    const archiverInfo = archiver.ip + ':' + archiver.port
    const responses = {}
    for (let i = startCycle; i < endCycle; ) {
      const nextEnd = i + config.REQUEST_LIMIT.MAX_BETWEEN_CYCLES_PER_REQUEST
      console.log(i, nextEnd)

      const data: any = {
        startCycle: i,
        endCycle: nextEnd,
        type: 'tally',
        sender: devAccount.publicKey,
      }
      crypto.signObj(data, devAccount.secretKey, devAccount.publicKey)
      const response: any = await postJson(`http://${archiverInfo}/${URL}`, data, 100)
      if (!response || (!response.receipts && !response.originalTxs)) {
        console.error(`archiver ${archiverInfo} failed to respond for cycles ${i} to ${nextEnd}`)
        console.log(response)
        i = nextEnd + 1
        continue
      }
      // console.log(response)
      if (responses[archiverInfo]) {
        const result = response.receipts ? response.receipts : response.originalTxs
        responses[archiverInfo] = [...responses[archiverInfo], ...result]
      } else {
        responses[archiverInfo] = response.receipts ? response.receipts : response.originalTxs
      }
      i = nextEnd + 1
    }
    // console.dir(responses, { depth: null })
    // save to file
    writeFileSync(
      `archiver_${archiverInfo}_${startCycle}_${endCycle}_${URL}.json`,
      StringUtils.safeStringify(responses)
    )
  }
}

// Only run if this is the main module
if (require.main === module) {
  runProgram()
}

export { runProgram }
