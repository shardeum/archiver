import * as fs from 'fs'
import * as readline from 'readline'
import { verifyReceiptData } from '../Data/Collector'

async function processReceipts(filePath) {
  const fileStream = fs.createReadStream(filePath)

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    try {
      // Parse each line as a JSON object
      const receipt = JSON.parse(line)

      // Pass the receipt to verifyReceiptData function
      verifyReceiptData(receipt)
    } catch (error) {
      console.error(`Failed to process line: ${line}`)
      console.error(error)
    }
  }

  console.log('Finished processing all receipts.')
}

// Update the file path to your receipt.txt
const filePath = 'C:\\Relevant\\work\\dev\\Gold-tasks\\logs\\receipt-log7.txt'

processReceipts(filePath)
