import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { initAjvSchemas } from '../src/types/ajv/Helpers'
import { initializeSerialization } from '../src/utils/serialization/SchemaHelpers'

interface TxData {
  nodeId: string
  publicKey: string
  startTime?: number
  start?: number
  endTime?: number
  end?: number
}

interface Tx {
  cycle: number
  hash: string
  priority: number
  subQueueKey: string
  txData: TxData
  type: string
}

interface TransactionEntry {
  hash: string
  tx: Tx
}

interface NewNodeReward {
  hash: string
  tx: Tx
}

function findUnmatchedNodeInitRewards(
  transactions: TransactionEntry[],
  endCycle: number,
  endTime: number
): NewNodeReward[] {
  const unmatchedRewards: NewNodeReward[] = []
  const nodeInitRewardMap = new Map<string, TransactionEntry>()
  const nodeRewardMap = new Map<string, TransactionEntry>()

  console.log('Mapping nodeInitRewards by nodeId and start cycle...')
  for (const transaction of transactions) {
    if (transaction.tx.type === 'nodeInitReward' && transaction.tx.txData.startTime) {
      const key = `${transaction.tx.txData.nodeId}-${transaction.tx.cycle}`
      nodeInitRewardMap.set(key, transaction)
      console.log(
        `Mapped nodeInitReward - Node ID: ${transaction.tx.txData.nodeId}, Cycle: ${transaction.tx.cycle}`
      )
    } else if (transaction.tx.type === 'nodeReward' && transaction.tx.txData.start !== undefined) {
      const rewardKey = `${transaction.tx.txData.nodeId}-${transaction.tx.txData.start}`
      nodeRewardMap.set(rewardKey, transaction)
      console.log(
        `Mapped nodeReward - Node ID: ${transaction.tx.txData.nodeId}, Start Cycle: ${transaction.tx.txData.start}`
      )
    }
  }

  console.log('Identifying unmatched nodeInitRewards without matching nodeRewards within ±5 cycle range...')
  for (const [key, transaction] of nodeInitRewardMap) {
    const { nodeId } = transaction.tx.txData // Access nodeId from txData
    const cycle = transaction.tx.cycle
    const rewardKey = `${nodeId}-${cycle}`

    // Check if any nodeReward exists within ±5 cycles of the nodeInitReward's cycle
    const hasMatchingReward = Array.from(nodeRewardMap.values()).some((rewardTx) => {
      const rewardCycle = rewardTx.tx.txData.start
      return (
        rewardTx.tx.txData.nodeId === nodeId &&
        rewardCycle !== undefined &&
        Math.abs(rewardCycle - cycle) <= 5
      )
    })

    if (!hasMatchingReward) {
      const { publicKey, startTime } = transaction.tx.txData
      const newHash = generateHash(nodeId + startTime + endCycle)

      const newNodeReward: NewNodeReward = {
        hash: newHash,
        tx: {
          cycle: endCycle,
          hash: newHash,
          priority: transaction.tx.priority,
          subQueueKey: transaction.tx.subQueueKey,
          txData: {
            nodeId,
            publicKey,
            start: cycle,
            end: endCycle,
            endTime: endTime,
          },
          type: 'nodeReward',
        },
      }
      unmatchedRewards.push(newNodeReward)
      console.log(
        `Created new nodeReward - Node ID: ${nodeId}, Start Cycle: ${cycle}, End Cycle: ${endCycle}`
      )
    }
  }


  console.log(`Total unmatched nodeInitRewards found: ${unmatchedRewards.length}`)
  return unmatchedRewards
}

function generateHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

async function main() {
  const filePath = path.join(__dirname, '..', 'tx-list-restore.json')
  const endCycle = Number(process.argv[2])
  const endTime = Number(process.argv[3])

  if (!endCycle || !endTime) {
    console.error('Please provide endCycle and endTime as arguments.')
    process.exit(1)
  }
  initAjvSchemas()
  initializeSerialization()
  console.log(`Reading data from ${filePath}...`)
  const rawData = fs.readFileSync(filePath, 'utf-8')
  const transactions: TransactionEntry[] = JSON.parse(rawData)
  console.log(`Successfully read ${transactions.length} transactions.`)

  const newRewards = findUnmatchedNodeInitRewards(transactions, endCycle, endTime)

  const updatedTransactions = [...transactions, ...newRewards]
  console.log(`Appending ${newRewards.length} new nodeReward entries to the data.`)

  fs.writeFileSync(filePath, JSON.stringify(updatedTransactions, null, 2), 'utf-8')
  console.log(`Successfully added ${newRewards.length} new nodeReward entries and saved to ${filePath}.`)
}

main()
