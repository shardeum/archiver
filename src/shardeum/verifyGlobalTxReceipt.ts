import { P2P } from '@shardeum-foundation/lib-types'
import { ArchiverReceipt, Receipt } from '../dbstore/receipts'
import { accountSpecificHash } from './calculateAccountHash'

// Refer to https://github.com/shardeum/shardeum/blob/89db23e1d4ffb86b4353b8f37fb360ea3cd93c5b/src/shardeum/shardeumTypes.ts#L242
export interface SetGlobalTxValue {
  isInternalTx: boolean
  internalTXType: InternalTXType
  timestamp: number
  from: string
  change: {
    cycle: number
    change: object
  }
}

// Refer to https://github.com/shardeum/shardeum/blob/89db23e1d4ffb86b4353b8f37fb360ea3cd93c5b/src/shardeum/shardeumTypes.ts#L87-L88
export enum InternalTXType {
  SetGlobalCodeBytes = 0, //Deprecated
  InitNetwork = 1,
  NodeReward = 2, //Deprecated
  ChangeConfig = 3,
  ApplyChangeConfig = 4,
  SetCertTime = 5,
  Stake = 6,
  Unstake = 7,
  InitRewardTimes = 8,
  ClaimReward = 9,
  ChangeNetworkParam = 10,
  ApplyNetworkParam = 11,
  Penalty = 12,
  TransferFromSecureAccount = 13,
}

/**
 * Verifies the account hash in a global transaction receipt
 *
 * This function validates that the account hashes in a receipt match the calculated
 * hashes of the account data. It checks:
 * 1. If the receipt passes schema validation
 * 2. If the receipt is a GlobalTxReceipt, it delegates to verifyGlobalTxAccountChange
 * 3. Otherwise, it verifies:
 *    - Account IDs, before and after state hashes have matching lengths
 *    - Each account in afterStates has a matching ID from the receipt
 *    - The calculated hash of each account matches the expected hash in the receipt
 *
 * @param receipt - The transaction receipt to verify
 * @param failedReasons - Array to collect failure reasons if verification fails
 * @param nestedCounterMessages - Array to collect counter messages for metrics
 * @returns boolean - True if verification passes, false otherwise
 */
export const verifyGlobalTxAccountChange = (
  receipt: ArchiverReceipt | Receipt,
  failedReasons = [],
  nestedCounterMessages = []
): boolean => {
  try {
    const signedReceipt = receipt.signedReceipt as P2P.GlobalAccountsTypes.GlobalTxReceipt
    const internalTx = signedReceipt.tx.value as SetGlobalTxValue

    if (internalTx.internalTXType === InternalTXType.InitNetwork) {
      // Refer to https://github.com/shardeum/shardeum/blob/89db23e1d4ffb86b4353b8f37fb360ea3cd93c5b/src/index.ts#L2334
      // no need to do anything, as it is network account creation
      return true
    } else if (
      internalTx.internalTXType === InternalTXType.ApplyChangeConfig ||
      internalTx.internalTXType === InternalTXType.ApplyNetworkParam
    ) {
      if (signedReceipt.tx.addressHash !== '') {
        for (const account of receipt.beforeStates) {
          if (account.accountId !== signedReceipt.tx.address) {
            failedReasons.push(
              `Unexpected account found in before accounts ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
            )
            nestedCounterMessages.push(`Unexpected account found in before accounts`)
            return false
          }
          const expectedAccountHash = signedReceipt.tx.addressHash
          const calculatedAccountHash = accountSpecificHash(account.data)
          if (expectedAccountHash !== calculatedAccountHash) {
            failedReasons.push(
              `Account hash before does not match in globalModification tx - ${account.accountId} , ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
            )
            nestedCounterMessages.push(`Account hash before does not match in globalModification tx`)
            return false
          }
        }
      }
      for (const account of receipt.afterStates) {
        // TODO : can be optimized by using only one find operation instead of for loop since we have only afterState for globalModification tx
        if (account.accountId !== signedReceipt.tx.address) {
          failedReasons.push(
            `Unexpected account found in accounts ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
          )
          nestedCounterMessages.push(`Unexpected account found in accounts`)
          return false
        }
        const networkAccountBefore = receipt.beforeStates.find(
          (bAccount) => bAccount?.accountId === account.accountId
        )
        const networkAccountAfter = receipt.afterStates.find(
          (fAccount) => fAccount?.accountId === signedReceipt.tx.address
        )
        if (!networkAccountBefore || !networkAccountAfter) {
          failedReasons.push(
            `Network account Before or After states not found ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
          )
          nestedCounterMessages.push(`Network account Before or After states not found`)
          return false
        }

        // Get the hash from afterState array entry i.e the network account after state hash
        const expectedAccountHash = networkAccountAfter.hash

        // Compare the hash from the network account with the afterStateHash in the signed receipt
        // If they don't match, the transaction receipt is invalid
        if (expectedAccountHash !== signedReceipt.tx.afterStateHash) {
          failedReasons.push(
            `Account afterStateHash does not match in globalModification tx - ${networkAccountAfter.accountId} , ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
          )
          nestedCounterMessages.push(`Account afterStateHash does not match in globalModification tx`)
          return false
        }
      }
      return true
    } else {
      failedReasons.push(
        `Unexpected internal transaction type in the globalModification tx ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}`
      )
      nestedCounterMessages.push(`Unexpected internal transaction type in the globalModification tx`)
      return false
    }
  } catch (error) {
    console.error(`verifyGlobalTxAccountChange error`, error)
    failedReasons.push(
      `Error while verifying global account change ${receipt.tx.txId} , ${receipt.cycle} , ${receipt.tx.timestamp}, ${error}`
    )
    nestedCounterMessages.push(`Error while verifying global account change`)
    return false
  }
}
