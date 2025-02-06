import * as Logger from '../Logger'
import {InternalTXType, Sign} from '../types/internalTxType'
import * as crypto from '@shardeum-foundation/lib-crypto-utils'
import * as P2P from '../P2P'
import * as NodeList from '../NodeList'
import {robustQuery, verifyMultiSigs} from '../Utils'
import {DevSecurityLevel} from '../types/security'
import {join} from "path";
import {readFileSync} from "fs";
import { Transaction, TransactionFactory, TransactionType, TypedTransaction } from '@ethereumjs/tx'
import { toBuffer } from 'ethereumjs-util'
import { Address } from '@ethereumjs/util'
import { getSenderAddress } from '@shardeum-foundation/lib-net'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { config } from '../Config'

interface SecureAccountData {
  Name: string
  SourceFundsAddress: string
  RecipientFundsAddress: string
  SecureAccountAddress: string
}

const secureAccountsFilePath = join(__dirname, '..', '..', 'static', 'genesis-secure-accounts.json');
let secureAccountDataMap: Map<string, SecureAccountData> | null = null;

const getSecureAccounts = (): Map<string, SecureAccountData> => {
  if (!secureAccountDataMap) {
    try {
      const data = readFileSync(secureAccountsFilePath, 'utf8');
      const jsonData: SecureAccountData[] = JSON.parse(data);
      secureAccountDataMap = new Map(jsonData.map(account => [account.Name, account]));
    } catch (error) {
      Logger.mainLogger.error(`Error reading secure accounts file: ${error}`);
      secureAccountDataMap = new Map();
    }
  }
  return secureAccountDataMap;
};

let multisigKeys: Record<string, DevSecurityLevel> = {}
let minMultiSigRequiredForGlobalTxs = 3


export const getMultisigPublicKeys = (): Required<{ [x: string]: DevSecurityLevel }> => {
  return multisigKeys
}


type Response = {
  result: string
  reason: string
}


export const scheduleMultiSigKeysSyncFromNetConfig =  (): void => {

  setInterval(async () => {
    console.log("Executing syncKeysFromNetworkConfig on interval...");
    await syncKeysFromNetworkConfig();
  }, config.multisigKeysSyncFromNetworkInternal * 1000); // will sync for multi sig keys from network each 10 mins
};



export const syncKeysFromNetworkConfig = async (): Promise<void> => {

  try {
    const queryFn = async (node): Promise<object> => {
      const REQUEST_NETCONFIG_TIMEOUT_SECOND = 3
      try {
        const response = await P2P.getJson(
            `http://${node.ip}:${node.port}/netconfig`,
            REQUEST_NETCONFIG_TIMEOUT_SECOND
        )
        return response
      } catch (error) {
        Logger.mainLogger.error(`Error querying node ${node.ip}:${node.port}: ${error} while updating dev public keys and multisig keys from /netconfig`)
        return null
      }

    }

    const equalityFn = (responseA, responseB): boolean => {
      return (
          JSON.stringify(responseA?.config?.debug?.multisigKeys) ===
          JSON.stringify(responseB?.config?.debug?.multisigKeys) &&
          JSON.stringify(responseA?.config?.debug?.minMultiSigRequiredForGlobalTxs) ===
          JSON.stringify(responseB?.config?.debug?.minMultiSigRequiredForGlobalTxs)
      )
    }

    // Get the list of 10 max random active nodes or the first node if no active nodes are available
    const nodes =
        NodeList.getActiveNodeCount() > 0 ? NodeList.getRandomActiveNodes(10) : [NodeList.getFirstNode()]

    const tallyItem = await robustQuery(
        nodes,
        queryFn,
        equalityFn,
        3 // Redundancy (minimum 3 nodes should return the same result to reach consensus)
    )

    if (tallyItem?.value?.config?.debug) {

      const newMultisigKeys = tallyItem.value.config.debug.multisigKeys
      const newMinMultiSigRequired = tallyItem.value.config.debug.minMultiSigRequiredForGlobalTxs

      if (
          newMultisigKeys &&
          typeof newMultisigKeys === 'object' &&
          JSON.stringify(newMultisigKeys) !== JSON.stringify(multisigKeys)
      ) {
        multisigKeys = newMultisigKeys
      }

      if (typeof newMinMultiSigRequired === 'number' && newMinMultiSigRequired > 0 && newMinMultiSigRequired !== minMultiSigRequiredForGlobalTxs) {
        minMultiSigRequiredForGlobalTxs = newMinMultiSigRequired
      }
    }

  } catch (error) {
    Logger.mainLogger.error('error in syncKeysFromNetworkConfig', error)
  }

}



export const verifyTransaction = (tx: any) : Response  => {


  try {

    if (isInternalTx(tx)){

      if(isInternalTXGlobal(tx)) {
        return { result: 'pass', reason: 'valid'}
      } else if (
        tx.internalTXType === InternalTXType.ChangeConfig ||
        tx.internalTXType === InternalTXType.ChangeNetworkParam
      ) {
        const multiSigPublicKeys = getMultisigPublicKeys()
        const is_array_sig = Array.isArray(tx.sign) === true
        const requiredSigs = Math.max(3, minMultiSigRequiredForGlobalTxs)
        // Ensure old single sig / non-array are still compatible
        const sigs: Sign[] = is_array_sig ? tx.sign : [tx.sign]
        const { sign, ...txWithoutSign} = tx
        const authorized = verifyMultiSigs(
            txWithoutSign,
            sigs,
            multiSigPublicKeys,
            requiredSigs,
            DevSecurityLevel.HIGH
        )

        if (!authorized) {
          Logger.mainLogger.info(`ChangeConfig or ChangeNetworkParam failed verification ${JSON.stringify(tx)}`)
          return { result: 'fail', reason: 'Invalid Signature' }
        }
        return { result: 'pass', reason: 'valid' }

      } else if ( tx.internalTXType === InternalTXType.SetCertTime ) {
        return { result: 'pass', reason: 'valid' }
      } else if ( tx.internalTXType === InternalTXType.InitRewardTimes ) {
        const isValid = crypto.verifyObj(tx)
        if ( !isValid ) {
          Logger.mainLogger.info(`Init reward tx failed verification ${JSON.stringify(tx)}`)
          return { result: 'fail', reason: 'Invalid Signature' }
        }
        Logger.mainLogger.info(`Init reward tx passed ${JSON.stringify(tx)}`)
        return { result: 'pass', reason: 'valid' }
      } else if ( tx.internalTXType === InternalTXType.TransferFromSecureAccount ) {
        const verifyResult = validateTransferFromSecureAccount(tx)
        return { result: verifyResult.success ? 'pass' : 'fail', reason: verifyResult.reason }
      } else {
        const isValid = crypto.verifyObj(tx)
        if ( !isValid ) {
          Logger.mainLogger.info(`Single signed tx failed ${JSON.stringify(tx)}`)
          return { result: 'fail', reason: 'Invalid Signature' }
        }

        return { result: 'pass', reason: 'valid' }
      }
    }

    if (tx?.isDebugTx === true) {
      Logger.mainLogger.info(`Debug tx allowed ${JSON.stringify(tx)}`)
      return { result: 'pass', reason: 'all_allowed' }
    }

    // verify coin transfer tx
    try {

      const transaction = getTransactionObj(tx)
      const isSigned = transaction.isSigned()
      if(!isSigned) {
        return { result: 'fail', reason: 'invalid - signs missing' }
      }
      const {
        address: senderAddress,
        isValid: isSignatureValid,
      } = getTxSenderAddress(transaction)

      if(!isSignatureValid) {
        return { result: 'fail', reason: 'invalid - signature' }
      }

      return {result: 'pass', reason: 'valid' }


    } catch (error) {
      return { result: 'fail', reason: 'invalid could not get sender address' }
    }


  } catch (err) {
    Logger.mainLogger.error(err)
  }

  return { result : 'fail', reason: `tx verification error :  ${tx}`}
}



export function isInternalTXGlobal(internalTx: any): boolean {
  return (
    internalTx.internalTXType === InternalTXType.SetGlobalCodeBytes ||
    internalTx.internalTXType === InternalTXType.ApplyChangeConfig ||
    internalTx.internalTXType === InternalTXType.InitNetwork ||
    internalTx.internalTXType === InternalTXType.ApplyNetworkParam
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isInternalTx(timestampedTx: any): boolean {
  if (timestampedTx && timestampedTx.raw) return false
  if (timestampedTx && timestampedTx.isInternalTx) return true
  if (timestampedTx && timestampedTx.tx && timestampedTx.tx.isInternalTx) return true
  return false
}

export function validateTransferFromSecureAccount(tx: any) : { success: boolean; reason: string } {

  try {

    if (tx.internalTXType === InternalTXType.TransferFromSecureAccount) {
      return { success: false, reason: 'Invalid Secure Account Transaction type' }
    }

    if (typeof tx.amount !== 'string' || !/^\d+$/.test(tx.amount)) {
      return { success: false, reason: 'Invalid amount format' }
    }

    if (BigInt(tx.amount) <= 0) {
      return { success: false, reason: 'Amount is negative or zero' }
    }

    if (typeof tx.accountName !== 'string' || tx.accountName.trim() === '') {
      return { success: false, reason: 'Invalid account name' }
    }

    if (typeof tx.nonce !== 'number' || tx.nonce < 0) {
      return { success: false, reason: 'Invalid nonce' }
    }

    const secureAccounts = getSecureAccounts();
    const secureAccountData = secureAccounts.get(tx.accountName);

    if(!secureAccountData) {
      return { success: false, reason: 'Secure Account not found' }
    }

    // verify signatures
    // check if tx.sign is not an array
    if (!Array.isArray(tx.sign)) {
      return { success: false, reason: 'tx.sign is not an array' }
    }

    if (tx.sign.length === 0) {
      return { success: false, reason: 'Missing signatures' }
    }

    const txData = {
      account: tx.amount,
      accountName: tx.accountName,
      nonce: tx.nonce
    }

    const allowedPublicKeys = getMultisigPublicKeys()
    const requiredSigs = Math.max(3, minMultiSigRequiredForGlobalTxs)

    const isSignatureValid = verifyMultiSigs(
        txData,
        tx.sign as Sign[],
        allowedPublicKeys,
        requiredSigs,
        DevSecurityLevel.HIGH
    )

    if (!isSignatureValid) {
      Logger.mainLogger.error(`Signature verification failed for secure account transfer transaction : ${StringUtils.safeStringify(tx)}`)
      return { success: false, reason: 'Invalid signature' }
    }

    return { success: true, reason: 'valid' }

  } catch (error) {
    Logger.mainLogger.error(`error in validation of secure account transaction verification ${StringUtils.safeStringify(tx)}`, ' and error is : ', error)
    return { success: false, reason: 'error occurred in verification of secure account transfer transaction' }
  }
}


export function getTransactionObj(
    tx
): Transaction[TransactionType.Legacy] | Transaction[TransactionType.AccessListEIP2930] {
  if (!tx.raw) throw Error('fail')
  let transactionObj
  const serializedInput = toBuffer(tx.raw)
  try {
    transactionObj = TransactionFactory.fromSerializedData<TransactionType.Legacy>(serializedInput)
  } catch (e) {
    // do nothing here
  }
  if (!transactionObj) {
    try {
      transactionObj =
          TransactionFactory.fromSerializedData<TransactionType.AccessListEIP2930>(serializedInput)
    } catch (e) {
      Logger.mainLogger.error(`error in getTransactionObject ${tx}`)
    }
  }

  if (transactionObj) {
    Object.freeze(transactionObj)
    return transactionObj
  } else throw Error('tx obj fail')
}

type GetTxSenderAddressResult = { address: Address; isValid: boolean; gasValid: boolean }


export function getTxSenderAddress(
    tx: TypedTransaction,
): GetTxSenderAddressResult {
  try {

    const rawTx = '0x' + toHexString(tx.serialize())
    const { address, isValid, gasValid } = getSenderAddress(rawTx)

    return { address: Address.fromString(address), isValid, gasValid }
    } catch (e) {
      Logger.mainLogger.error('Error getting sender address from tx', e)
    }
    return { address: null, isValid: false, gasValid: false }
}


function toHexString(byteArray: Uint8Array): string {
  return Array.from(byteArray, (byte) => {
    return ('0' + (byte & 0xff).toString(16)).slice(-2)
  }).join('')
}

