import { config } from '../Config'
import { AccountType } from '../shardeum/calculateAccountHash'
import { InternalTXType } from '../shardeum/verifyGlobalTxReceipt'
import * as NodeList from '../NodeList'
import { getJson } from '../P2P'
import * as Utils from '../Utils'
import { Address } from '@ethereumjs/util'
import { TypedTransaction } from '@ethereumjs/tx'
import { getSenderAddress } from '@shardus/net'

type GetTxSenderAddressResult = { address: Address; isValid: boolean; gasValid: boolean }

const txSenderCache: Map<string, GetTxSenderAddressResult> = new Map()
let simpleTTL = 0
const cacheMaxSize = 20000

export async function crackKeyFromSecureAccount(tx: any): Promise<string> {
  // Define the query function for robustQuery
  const queryFn = async (node: NodeList.ConsensusNodeInfo): Promise<any[]> => {
    const response = (await getJson(`http://${node.ip}:${node.port}/secure_accounts`)) as any

    if (response.accounts) {
      return response.accounts
    }

    throw new Error(`Secure account data not found on node ${node.ip}`)
  }

  // Use robustQuery to fetch secure accounts
  const activeNodes = NodeList.getActiveList()
  const result = await Utils.robustQuery(activeNodes, queryFn)

  if (!result.value || !Array.isArray(result.value)) {
    throw new Error(`Unable to retrieve secure accounts`)
  }

  // Find the matching secure account from the result
  const matchingAccount = result.value.find(
    (account: any) => account.secureAccountConfig.Name === tx.accountName
  )

  if (!matchingAccount) {
    throw new Error(`Secure account ${tx.accountName} not found`)
  }

  const secureAccountConfig = matchingAccount.secureAccountConfig

  // Return the SourceFundsAddress formatted as a Shardus address
  return toShardusAddress(secureAccountConfig.SourceFundsAddress, AccountType.Account)
}

export function toShardusAddress(addressStr: string, accountType: AccountType): string {
  if (config.VERBOSE) {
    console.log(`Running toShardusAddress`, typeof addressStr, addressStr, accountType)
  }
  if (accountType === AccountType.ContractStorage || accountType === AccountType.ContractCode) {
    throw new Error(
      `toShardusAddress does not work anymore with type ContractStorage, use toShardusAddressWithKey instead`
    )
  }

  if (accountType === AccountType.Account || accountType === AccountType.Debug) {
    if (addressStr.length != 42) {
      throw new Error(
        `must pass in a 42 character hex address for Account type of Account or Debug. addressStr: ${addressStr} ${addressStr.length}}`
      )
    }
    //change this:0x665eab3be2472e83e3100b4233952a16eed20c76
    //    to this:  665eab3be2472e83e3100b4233952a16eed20c76000000000000000000000000
    return addressStr.slice(2).toLowerCase() + '0'.repeat(24)
  }

  if (accountType === AccountType.SecureAccount) {
    if (addressStr.length === 64) {
      return addressStr.toLowerCase()
    } else {
      throw new Error('must pass in a 64 character hex addressStr AccountType.Receipt')
    }
  }

  if (
    accountType === AccountType.Receipt ||
    accountType === AccountType.StakeReceipt ||
    accountType === AccountType.UnstakeReceipt ||
    accountType === AccountType.InternalTxReceipt
  ) {
    if (addressStr.length === 66) {
      return addressStr.slice(2).toLowerCase()
    } else {
      throw new Error('must pass in a 64 character hex addressStr AccountType.Receipt')
    }
  }

  if (addressStr.length === 64) {
    //unexpected case but lets allow it
    return addressStr.toLowerCase()
  }

  if (addressStr.length != 66) {
    throw new Error(
      `must pass in a 66 character 32 byte address for non Account types. use the key for storage and codehash contractbytes ${addressStr.length}`
    )
  }

  //so far rest of the accounts are just using the 32 byte eth address for a shardus address minus the "0x"
  //  later this will change so we can keep certain accounts close to their "parents"

  //change this:0x665eab3be2472e83e3100b4233952a16eed20c76111111111111111111111111
  //    to this:  665eab3be2472e83e3100b4233952a16eed20c76000000000000000000000000
  return addressStr.slice(2).toLowerCase()
}

function isDebugTx(tx: any): boolean {
  return tx.isDebugTx != null
}

function isInternalTx(timestampedTx: any): boolean {
  if (timestampedTx && timestampedTx.raw) return false
  if (timestampedTx && timestampedTx.isInternalTx) return true
  if (timestampedTx && timestampedTx.tx && timestampedTx.tx.isInternalTx) return true
  return false
}

async function extractKeyFromInternalTx(tx: any): Promise<string> {
  let extractedKey: string
  const internalTx = tx
  if (internalTx.internalTXType === InternalTXType.SetGlobalCodeBytes) {
    extractedKey = internalTx.from
  } else if (internalTx.internalTXType === InternalTXType.InitNetwork) {
    extractedKey = internalTx.networkAccount
  } else if (internalTx.internalTXType === InternalTXType.ChangeConfig) {
    extractedKey = tx.from
    // keys.targetKeys = [networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.ApplyChangeConfig) {
    extractedKey = internalTx.networkAccount
  } else if (internalTx.internalTXType === InternalTXType.ChangeNetworkParam) {
    extractedKey = tx.from
    // keys.targetKeys = [networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.ApplyNetworkParam) {
    extractedKey = internalTx.networkAccount
  } else if (internalTx.internalTXType === InternalTXType.SetCertTime) {
    extractedKey = tx.nominee
    // keys.targetKeys = [toShardusAddress(tx.nominator, AccountType.Account), networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.InitRewardTimes) {
    extractedKey = tx.nominee
    // keys.targetKeys = [networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.ClaimReward) {
    extractedKey = tx.nominee
    // keys.targetKeys = [toShardusAddress(tx.nominator, AccountType.Account), networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.Penalty) {
    extractedKey = tx.reportedNodePublickKey
    // keys.targetKeys = [toShardusAddress(tx.operatorEVMAddress, AccountType.Account), networkAccount]
  } else if (internalTx.internalTXType === InternalTXType.TransferFromSecureAccount) {
    extractedKey = await crackKeyFromSecureAccount(tx)
    // keys.targetKeys = targetKeys
  }
  return extractedKey
}

function toHexString(byteArray: Uint8Array): string {
  return Array.from(byteArray, (byte) => {
    return ('0' + (byte & 0xff).toString(16)).slice(-2)
  }).join('')
}

export function getTxSenderAddress(
  tx: TypedTransaction,
  txid: string = undefined,
  overrideSender: Address = undefined
): GetTxSenderAddressResult {
  try {
    if (overrideSender != null) {
      const res = { address: overrideSender, isValid: true, gasValid: true }
      if (txid != null) {
        txSenderCache.set(txid, res)
      }
      return res
    }

    if (txid != null) {
      const cached = txSenderCache.get(txid)
      if (cached != null) {
        return cached
      }
    }

    const rawTx = '0x' + toHexString(tx.serialize())
    const { address, isValid, gasValid } = getSenderAddress(rawTx)
    if (config.VERBOSE) console.log('Sender address retrieved from signed txn', address)
    const res = { address: Address.fromString(address), isValid, gasValid }
    if (txid != null) {
      simpleTTL++
      if (simpleTTL > cacheMaxSize) {
        simpleTTL = cacheMaxSize
        txSenderCache.clear()
      }
      txSenderCache.set(txid, res)
    }
    return res
  } catch (e) {
    if (config.VERBOSE) console.error('Error getting sender address from tx', e)
    const res = { address: null, isValid: false, gasValid: false }
    if (txid != null) {
      txSenderCache.set(txid, res)
    }
    return res
  }
}

export async function extractKeyFromTx(receiptTx: any): Promise<string> {
  const { txId, originalTxData } = receiptTx.tx
  const tx = originalTxData.tx
  if (isInternalTx(tx)) {
    return await extractKeyFromInternalTx(tx)
  }

  if (isDebugTx(tx)) {
    const debugTx = tx
    const transformedSourceKey = toShardusAddress(debugTx.from, AccountType.Debug)
    return transformedSourceKey
  }

  // const transaction = getTransactionObj(tx) // task 2
  // const senderAddress = getTxSenderAddress(transaction, txId).address // task 3
  // const txSenderEvmAddr = senderAddress.toString()
  // const transformedSourceKey = toShardusAddress(txSenderEvmAddr, AccountType.Account)
  // return transformedSourceKey // executionShardKey
  return 'placeholder'
}
