import { config } from '../Config'
import { AccountType } from '../shardeum/calculateAccountHash'
import { InternalTXType } from '../shardeum/verifyGlobalTxReceipt'

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

function extractKeyFromInternalTx(tx: any): string {
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
    const sourceKeys = crackTransferFromSecureAccount(tx) // task 1
    extractedKey = sourceKeys[0]
    // keys.targetKeys = targetKeys
  }
  return extractedKey
}

export function extractKeyFromTx(receiptTx: any): string {
  const { txId, originalTxData } = receiptTx.tx
  const tx = originalTxData.tx
  if (isInternalTx(tx)) {
    return extractKeyFromInternalTx(tx)
  }

  if (isDebugTx(tx)) {
    const debugTx = tx
    const transformedSourceKey = toShardusAddress(debugTx.from, AccountType.Debug)
    return transformedSourceKey
  }

  const transaction = getTransactionObj(tx) // task 2
  const senderAddress = getTxSenderAddress(transaction, txId).address // task 3
  const txSenderEvmAddr = senderAddress.toString()
  const transformedSourceKey = toShardusAddress(txSenderEvmAddr, AccountType.Account)
  return transformedSourceKey // executionShardKey
}
