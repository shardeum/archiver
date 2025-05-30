import { CombinedAccountsData } from './types'
import * as ReceiptDB from '../dbstore/receipts'

let combineAccountsData: CombinedAccountsData = {
  accounts: [],
  receipts: [],
}

export function clearCombinedAccountsData(): void {
  combineAccountsData = {
    accounts: [],
    receipts: [],
  }
}

export function addToCombinedAccountsData(data: { accounts?: any[]; receipts?: ReceiptDB.Receipt[] }): void {
  let newCombineAccountsData = { ...combineAccountsData }
  if (data.accounts)
    newCombineAccountsData.accounts = [
      ...newCombineAccountsData.accounts,
      ...data.accounts,
    ]
  if (data.receipts)
    newCombineAccountsData.receipts = [
      ...newCombineAccountsData.receipts,
      ...data.receipts,
    ]
  combineAccountsData = { ...newCombineAccountsData }
}

export function getCombinedAccountsData(): CombinedAccountsData {
  return combineAccountsData
}

// Placeholder function - will be imported from dataSync.ts
export async function syncGenesisAccountsFromConsensor(
  totalGenesisAccounts: any,
  firstConsensor: any
): Promise<void> {
  // This function is defined in dataSync.ts
}