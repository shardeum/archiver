import * as db from './sqlite3storage'
// import { processedTxDatabase } from './' // Disabled: txDigest functionality not used
import * as Logger from '../Logger'
import { config } from '../Config'

// const superjson =  require('superjson')
/**
 * ProcessedTransaction stores transactions which have a receipt
 */
export interface ProcessedTransaction {
  txId: string
  cycle: number
  txTimestamp: number
  applyTimestamp: number
}

// Disabled: txDigest functionality not used
// export async function bulkInsertProcessedTxs(processedTxs: ProcessedTransaction[]): Promise<void> {
//   try {
//     // Define the table columns based on schema
//     const columns = ['txId', 'cycle', 'txTimestamp', 'applyTimestamp']
// 
//     // Construct the SQL query for bulk insertion
//     const placeholders = processedTxs.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')
//     const sql = `
//       INSERT INTO processedTxs (${columns.join(', ')}) VALUES ${placeholders}
//       ON CONFLICT (txId) DO UPDATE SET 
//       cycle = excluded.cycle, 
//       txTimestamp = excluded.txTimestamp, 
//       applyTimestamp = excluded.applyTimestamp
//     `
// 
//     // Flatten the `processedTxs` array into a single list of values
//     const values = processedTxs.flatMap((tx) => columns.map((column) => tx[column]))
// 
//     // Execute the single query
//     await db.run(processedTxDatabase, sql, values)
// 
//     if (config.VERBOSE) {
//       Logger.mainLogger.debug('Successfully inserted ProcessedTransactions', processedTxs.length)
//     }
//   } catch (err) {
//     Logger.mainLogger.error(err)
//     Logger.mainLogger.error('Unable to bulk insert ProcessedTransactions', processedTxs.length)
//   }
// }

// Disabled: txDigest functionality not used
// export async function querySortedTxsBetweenCycleRange(startCycle: number, endCycle: number): Promise<string[]> {
//   try {
//     const sql = `SELECT txId FROM processedTxs WHERE cycle BETWEEN ? AND ?`
//     const txIdsArray = (await db.all(processedTxDatabase, sql, [startCycle, endCycle])) as { txId: string }[]
//     if (config.VERBOSE) {
//       Logger.mainLogger.debug(`txIds between ${startCycle} and ${endCycle} are ${txIdsArray ? txIdsArray.length : 0}`)
//     }
// 
//     if (!txIdsArray) {
//       return []
//     }
// 
//     const txIds = txIdsArray.map((tx) => tx.txId)
//     txIds.sort()
//     return txIds
//   } catch (e) {
//     Logger.mainLogger.error('error in querySortedTxsBetweenCycleRange: ', e)
//     return null
//   }
// }

// Stub implementations to avoid TypeScript errors
export async function bulkInsertProcessedTxs(processedTxs: ProcessedTransaction[]): Promise<void> {
  // No-op: txDigest functionality not used
  if (config.VERBOSE) {
    Logger.mainLogger.debug('Skipping ProcessedTransactions insert (disabled)', processedTxs.length)
  }
}

export async function querySortedTxsBetweenCycleRange(startCycle: number, endCycle: number): Promise<string[]> {
  // Return empty array: txDigest functionality not used
  if (config.VERBOSE) {
    Logger.mainLogger.debug(`Returning empty txIds for cycles ${startCycle}-${endCycle} (disabled)`)
  }
  return []
}
