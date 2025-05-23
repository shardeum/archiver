import { P2P as P2PTypes } from '@shardeum-foundation/lib-types'
import * as Account from '../dbstore/accounts'
import * as Transaction from '../dbstore/transactions'
import * as Receipt from '../dbstore/receipts'
import * as OriginalTxsData from '../dbstore/originalTxsData'
import * as ProcessedTransaction from '../dbstore/processedTxs'
import * as Crypto from '../Crypto'
import { clearCombinedAccountsData, combineAccountsData, collectCycleData } from './Data'
import { config } from '../Config'
import * as Logger from '../Logger'
import { nestedCountersInstance } from '../profiler/nestedCounters'
import { profilerInstance } from '../profiler/profiler'
import { getCurrentCycleCounter, shardValuesByCycle, computeCycleMarker } from './Cycles'
import { bulkInsertCycles, queryCycleByMarker, updateCycle } from '../dbstore/cycles'
import * as State from '../State'
import * as Utils from '../Utils'
import { DataType, GossipData, sendDataToAdjacentArchivers, TxData } from './GossipData'
import { postJson } from '../P2P'
import { globalAccountsMap, setGlobalNetworkAccount } from '../GlobalAccount'
import {
  CycleLogWriter,
  ReceiptLogWriter,
  OriginalTxDataLogWriter,
  ReceiptOverwriteLogWriter,
} from '../Data/DataLogWriter'
import * as OriginalTxDB from '../dbstore/originalTxsData'
import ShardFunction from '../ShardFunctions'
import { accountSpecificHash, verifyAccountHash } from '../shardeum/calculateAccountHash'
import { ShardeumReceipt, verifyAppReceiptData } from '../shardeum/verifyAppReceiptData'
import { Cycle as DbCycle } from '../dbstore/types'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { verifyPayload } from '../types/ajv/Helpers'
import { AJVSchemaEnum } from '../types/enum/AJVSchemaEnum'
import { verifyTransaction } from '../services/transactionVerification'
import { CycleShardData } from '@shardeum-foundation/lib-types/build/src/state-manager/shardFunctionTypes'
import { generateTxId } from '../Utils'
import { queryReceiptByReceiptId } from '../dbstore/receipts'

export let storingAccountData = false
const processedReceiptsMap: Map<string, number> = new Map()
const receiptsInValidationMap: Map<string, number> = new Map()
const processedOriginalTxsMap: Map<string, number> = new Map()
const originalTxsInValidationMap: Map<string, number> = new Map()
const missingReceiptsMap: Map<string, MissingTx> = new Map()
// const missingOriginalTxsMap: Map<string, MissingTx> = new Map()
const collectingMissingReceiptsMap: Map<string, number> = new Map()
// const collectingMissingOriginalTxsMap: Map<string, number> = new Map()

interface MissingTx {
  txTimestamp: number
  receivedTimestamp: number
  senders: string[]
}

type GET_TX_RECEIPT_RESPONSE = {
  success: boolean
  receipt?: Receipt.ArchiverReceipt | Receipt.SignedReceipt
  reason?: string
}

export interface ReceiptVerificationResult {
  success: boolean
  failedReasons?: string[]
  nestedCounterMessages?: string[]
}

/**
 * Fetches authorized signers that belong to the execution shard from the provided signatures.
 * @param {Crypto.core.Signature[] | P2PTypes.P2PTypes.Signature[]} signs - The array of signatures to verify.
 * @param {CycleShardData} cycleShardData - The cycle shard data containing node information.
 * @param {number} homePartition - The home partition number.
 * @param {string} txId - The transaction ID.
 * @param {number} timestamp - The timestamp of the transaction.
 * @param {number} cycle - The cycle number.
 * @returns {Set<[number, Crypto.core.Signature]> | Set<[number, P2PTypes.P2PTypes.Signature]>} - A set of tuples containing the index and signature of authorized signers.
 */
function fetchAuthorizedSigners(
  signaturePack: Crypto.core.Signature[] | P2PTypes.P2PTypes.Signature[],
  cycleShardData: CycleShardData,
  homePartition: number,
  txId: string,
  timestamp: number,
  cycle: number
): Map<string, { index: number; sign: Crypto.core.Signature | P2PTypes.P2PTypes.Signature }> {
  const nodeMap = new Map<string, P2PTypes.NodeListTypes.Node>()
  // Fill the map with nodes keyed by their public keys
  cycleShardData.nodes.forEach((node) => {
    if (node.publicKey && node.publicKey.length == 64) {
      nodeMap.set(node.publicKey.toLowerCase(), node)
    }
  })

  // Create a set to store acceptable signers
  // in case of GlobalTxReceipt, the signatures are of type : P2PTypes.P2PTypes.Signature
  // in case of NonGlobalTxReceipt, signatures are of type : Crypto.core.Signature
  const acceptableSigners = new Map<
    string,
    { index: number; sign: Crypto.core.Signature | P2PTypes.P2PTypes.Signature }
  >()
  try {
    for (const [index, sign] of signaturePack.entries()) {
      const { owner: nodePubKey } = sign

      // Get the node id from the public key
      const node = nodeMap.get(nodePubKey.toLowerCase())

      // If the node is not found in the active nodes list, log an error and continue
      if (node == null) {
        Logger.mainLogger.error(
          `The node with public key ${nodePubKey} of the receipt ${txId} with ${timestamp} is not in the active nodesList of cycle ${cycle}`
        )
        if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'sign_owner_not_in_active_nodesList')
        continue
      }

      // Check if the node is in the execution group
      if (!cycleShardData.parititionShardDataMap.get(homePartition).coveredBy[node.id]) {
        Logger.mainLogger.error(
          `The node with public key ${nodePubKey} of the receipt ${txId} with ${timestamp} is not in the execution group of the tx`
        )
        if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'node_not_in_execution_group_of_tx')
        continue
      }

      acceptableSigners.set(nodePubKey.toLowerCase(), { index, sign })
    }
  } catch (error) {
    Logger.mainLogger.error(`Error in fetchAuthorizedSigners: ${error.message}`)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'fetchAuthorizedSigners_error')
  }
  return acceptableSigners
}

/**
 * Verifies the global transaction receipt.
 *
 * @param receipt - The receipt to verify. It can be either a `Receipt.Receipt` or `Receipt.ArchiverReceipt`.
 * @returns A promise that resolves to an object indicating whether the verification was successful.
 *
 * The function performs the following checks:
 * 1. Validates the transaction ID by comparing the generated transaction ID with the incoming transaction ID.
 * 2. Ensures the voting group count does not exceed the number of nodes.
 * 3. Checks if the number of signatures meets the required majority votes percentage.
 * 4. Fetches the authorized signers and verifies if the valid signatures meet the required majority votes percentage.
 * 5. Verifies the signatures and ensures the number of valid signatures meets the required threshold.
 *
 * If any of the checks fail, the function logs the appropriate error and returns `{ success: false }`.
 * If all checks pass, the function returns `{ success: true }`.
 */
const verifyGlobalTxreceipt = async (
  receipt: Receipt.Receipt | Receipt.ArchiverReceipt
): Promise<{ success: boolean }> => {
  const result = { success: false }
  try {
    const appliedReceipt = receipt.signedReceipt as P2PTypes.GlobalAccountsTypes.GlobalTxReceipt
    const { signs, tx } = appliedReceipt

    const { timestamp, originalTxData } = receipt.tx
    const txId = appliedReceipt.tx.txId
    // verify tx id
    const generatedTxId = generateTxId((originalTxData as any)?.tx)

    if (generatedTxId != txId) {
      if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'txId_mismatch')
      Logger.mainLogger.error(
        `VerifyGlobalTxreceipt : Transaction ID mismatch detected. Incoming txId: ${txId}, Generated txId: ${generatedTxId}`
      )
      return result
    }

    const { cycle } = receipt
    const executionShardKey = tx.source // while finding the home partition/node on the setGlobal side, the source string is used
    const cycleShardData = shardValuesByCycle.get(cycle)
    const { homePartition } = ShardFunction.addressToPartition(cycleShardData.shardGlobals, executionShardKey)
    // Refer to https://github.com/shardeum/shardus-core/blob/7d8877b7e1a5b18140f898a64b932182d8a35298/src/p2p/GlobalAccounts.ts#L397
    let votingGroupCount = cycleShardData.shardGlobals.nodesPerConsenusGroup

    /**
     * Workaround: Early cycles may lack enough nodes for receipts to pass verification.
     * Relaxing the signature requirement for the first x cycles
     * could prevent unnecessary rejections. Needs tuning for larger networks.
     **/
    if (
      cycleShardData.nodes.length < votingGroupCount &&
      cycleShardData.cycleNumber <= config.formingNetworkCycleThreshold
    ) {
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent('receipt', 'votingGroupCount_lesser_than_nodes_length_forming_phase')
      Logger.mainLogger.log(
        'verifyGlobalTxreceipt: votingGroupCount_lesser_than_nodes_length',
        votingGroupCount,
        cycleShardData.nodes.length
      )
      votingGroupCount = cycleShardData.nodes.length
    }

    let isReceiptMajority = signs.length / votingGroupCount >= config.requiredMajorityVotesPercentage
    if (!isReceiptMajority) {
      Logger.mainLogger.error(
        `Invalid receipt globalModification signs count is less than ${config.requiredMajorityVotesPercentage}% of the votingGroupCount, ${signs.length}, ${votingGroupCount}`
      )
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          `Invalid_receipt_globalModification_signs_count_less_than_${config.requiredMajorityVotesPercentage}%`
        )
      return result
    }

    const acceptableSigners = fetchAuthorizedSigners(
      signs,
      cycleShardData,
      homePartition,
      txId,
      timestamp,
      cycle
    ) as Map<string, { index: number; sign: P2PTypes.P2PTypes.Signature }>
    isReceiptMajority = acceptableSigners.size / votingGroupCount >= config.requiredMajorityVotesPercentage
    if (!isReceiptMajority) {
      Logger.mainLogger.error(
        `Invalid receipt globalModification valid signs count is less than votingGroupCount ${acceptableSigners.size}, ${votingGroupCount}`
      )
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          'Invalid_receipt_globalModification_valid_signs_count_less_than_votingGroupCount'
        )
      return result
    }
    const requiredSignatures = Math.floor(votingGroupCount * config.requiredMajorityVotesPercentage)

    const goodSignatures = new Map()
    for (const [nodePubKey, signature] of acceptableSigners) {
      if (Crypto.verify({ ...tx, sign: signature.sign })) {
        goodSignatures.set(nodePubKey, signature)
        // Break the loop if the required number of good signatures are found
        if (goodSignatures.size >= requiredSignatures) break
      } else {
        if (nestedCountersInstance)
          nestedCountersInstance.countEvent(
            'receipt',
            'VerifyGlobalTxReceipt_Found_invalid_signature_in_receipt_signedReceipt'
          )
        Logger.mainLogger.error(
          `VerifyGlobalTxReceipt : Found invalid signature in receipt signedReceipt ${txId}, ${nodePubKey}, ${signature.index}`
        )
      }
    }

    if (goodSignatures.size < requiredSignatures) {
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          'VerifyGlobalTxReceipt_Invalid_receipt_signedReceipt_valid_signatures_count_less_than_requiredSignatures'
        )
      Logger.mainLogger.error(
        `VerifyGlobalTxReceipt : Invalid receipt signedReceipt valid signatures count is less than requiredSignatures ${txId}, ${goodSignatures.size}, ${requiredSignatures}`
      )

      return result
    }

    return { success: true }
  } catch (error) {
    Logger.mainLogger.error(`Error in verifyGlobalTxreceipt: ${error.message}`)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'verifyGlobalTxreceipt_error')
    return result
  }
}

/**
 * Verifies a non-global transaction receipt.
 *
 * @param receipt - The receipt to verify, which can be either a `Receipt.Receipt` or `Receipt.ArchiverReceipt`.
 * @returns A promise that resolves to an object indicating the success status of the verification.
 *
 * The function performs the following steps:
 * 1. Extracts the necessary variables from the signed receipt.
 * 2. Determines the home partition index of the primary account (`executionShardKey`).
 * 3. Calculates the voting group count and ensures it does not exceed the number of nodes.
 * 4. Checks if the receipt has a majority of signatures based on the required percentage.
 * 5. Calculates the vote hash and fetches the authorized signers.
 * 6. Verifies if the number of valid signatures meets the required majority.
 * 7. Uses a map to store valid signatures and ensures there are no duplicates.
 * 8. Verifies each signature and counts valid ones until the required number is met.
 * 9. Logs errors and counts events for various failure conditions.
 */
const verifyNonGlobalTxReceipt = async (
  receipt: Receipt.Receipt | Receipt.ArchiverReceipt
): Promise<{ success: boolean }> => {
  const result = { success: false }
  try {
    const { cycle } = receipt
    const { txId: txid, timestamp, originalTxData } = receipt.tx
    const cycleShardData = shardValuesByCycle.get(cycle)
    const { signaturePack, proposal, voteOffsets } = receipt.signedReceipt as Receipt.SignedReceipt
    // verify tx id
    const generatedTxId = generateTxId((originalTxData as any)?.tx)
    if (generatedTxId != proposal.txid) {
      if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'txId_mismatch')
      Logger.mainLogger.error(
        `VerifyNonGlobalTxReceipt : Transaction ID mismatch detected. Incoming txId: ${txid}, Generated txId: ${generatedTxId}`
      )
      return result
    }

    // shardKey extraction
    const { executionShardKey } = proposal
    // Determine the home partition index of the primary account (executionShardKey)
    const { homePartition } = ShardFunction.addressToPartition(cycleShardData.shardGlobals, executionShardKey)

    let votingGroupCount = cycleShardData.shardGlobals.nodesPerConsenusGroup

    /**
     * Workaround: Early cycles may lack enough nodes for receipts to pass verification.
     * Relaxing the signature requirement for the first x cycles
     * could prevent unnecessary rejections. Needs tuning for larger networks.
     **/
    if (
      cycleShardData.nodes.length < votingGroupCount &&
      cycleShardData.cycleNumber <= config.formingNetworkCycleThreshold
    ) {
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent('receipt', 'votingGroupCount_lesser_than_nodes_length_forming_phase')
      Logger.mainLogger.log(
        'verifyNonGlobalTxReceipt : votingGroupCount_lesser_than_nodes_length_forming_phase',
        votingGroupCount,
        cycleShardData.nodes.length
      )
      votingGroupCount = cycleShardData.nodes.length
    }

    let isReceiptMajority = signaturePack.length / votingGroupCount >= config.requiredMajorityVotesPercentage
    if (!isReceiptMajority) {
      Logger.mainLogger.error(
        `VerifyNonGlobalTxReceipt : Invalid receipt globalModification signs count is less than ${config.requiredMajorityVotesPercentage}% of the votingGroupCount, ${signaturePack.length}, ${votingGroupCount}`
      )
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          `VerifyNonGlobalTxReceipt_Invalid_receipt_globalModification_signs_count_less_than_${config.requiredMajorityVotesPercentage}%`
        )
      return result
    }

    const voteHash = calculateVoteHash(proposal)
    const acceptableSigners = fetchAuthorizedSigners(
      signaturePack,
      cycleShardData,
      homePartition,
      txid,
      timestamp,
      cycle
    ) as Map<string, { index: number; sign: Crypto.core.Signature }>
    isReceiptMajority = acceptableSigners.size / votingGroupCount >= config.requiredMajorityVotesPercentage
    if (!isReceiptMajority) {
      Logger.mainLogger.error(
        `VerifyNonGlobalTxReceipt : Invalid receipt valid signs count is less than votingGroupCount ${acceptableSigners.size}, ${votingGroupCount}`
      )
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          'VerifyNonGlobalTxReceipt_Invalid_receipt_valid_signs_count_less_than_votingGroupCount'
        )
      return result
    }

    const requiredSignatures = Math.floor(votingGroupCount * config.requiredMajorityVotesPercentage)

    // Using a map to store the good signatures to avoid duplicates
    const goodSignatures = new Map()
    for (const [nodePublicKey, signature] of acceptableSigners) {
      if (Crypto.verify({ txid, voteHash, sign: signature.sign, voteTime: voteOffsets.at(signature.index) })) {
        goodSignatures.set(nodePublicKey, signature)
        // Break the loop if the required number of good signatures are found
        if (goodSignatures.size >= requiredSignatures) break
      } else {
        if (nestedCountersInstance)
          nestedCountersInstance.countEvent(
            'receipt',
            'VerifyNonGlobalTxReceipt_Found_invalid_signature_in_receipt_signedReceipt'
          )
        Logger.mainLogger.error(
          `VerifyNonGlobalTxReceipt : Found invalid signature in receipt signedReceipt ${txid}, ${nodePublicKey}, ${signature.index} | voteHash: ${voteHash} | voteTime: ${voteOffsets.at(signature.index)}`
        )
      }
    }
    if (goodSignatures.size < requiredSignatures) {
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent(
          'receipt',
          'VerifyNonGlobalTxReceipt_Invalid_receipt_signedReceipt_valid_signatures_count_less_than_requiredSignatures'
        )
      Logger.mainLogger.error(
        `VerifyNonGlobalTxReceipt : Invalid receipt signedReceipt valid signatures count is less than requiredSignatures ${txid}, ${goodSignatures.size}, ${requiredSignatures}`
      )

      return result
    }

    return { success: true }
  } catch (error) {
    Logger.mainLogger.error(`Error in verifyNonGlobalTxReceipt: ${error.message}`)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'verifyNonGlobalTxReceipt_error')
    return result
  }
}

/**
 * Validate type and field existence of the receipt data before processing it further
 * @param receipt
 * @returns boolean
 */
export const validateReceiptType = (receipt: Receipt.Receipt | Receipt.ArchiverReceipt): boolean => {
  if ((receipt as any).executionShardKey) {
    delete (receipt as any).executionShardKey
  }

  // Validate against the Receipt schema will come when archiver is syncing from another archiver
  const errors_validation_receipt = verifyPayload(AJVSchemaEnum.Receipt, receipt)
  if (!errors_validation_receipt) {
    return true // Valid Receipt
  }

  // Validate against the ArchiverReceipt schema this will be used when receipt object is getting received from validator
  const errors_validation_archiver_receipt = verifyPayload(AJVSchemaEnum.ArchiverReceipt, receipt)
  if (!errors_validation_archiver_receipt) {
    return true // Valid ArchiverReceipt
  }

  // If neither validation passes, log the errors and return false
  Logger.mainLogger.error(
    'Invalid Receipt',
    {
      receiptType: errors_validation_receipt ? 'ArchiverReceipt' : 'Receipt',
      receiptErrors: [errors_validation_receipt, errors_validation_archiver_receipt],
    },
    'where receipt was',
    StringUtils.safeStringify(receipt)
  )

  return false // Invalid receipt
}

/**
 * Verifies the receipt data to ensure its integrity and validity.
 *
 * @param receipt - The receipt object which can be either a `Receipt.Receipt` or `Receipt.ArchiverReceipt`.
 * @returns A promise that resolves to an object containing a `success` boolean indicating the verification result.
 *
 * The function performs the following checks:
 * 1. Validates the transaction ID by comparing the generated transaction ID with the incoming transaction ID.
 * 2. Logs the time taken between the receipt timestamp and the current time if verbose logging is enabled.
 * 3. Checks if the receipt cycle is older than 2 cycles and logs an error if true.
 * 4. Retrieves the cycle shard data and logs an error if not found.
 * 5. If the receipt is a global modification receipt, validates it using AJV and returns the result.
 * 6. If the receipt is a non-global transaction receipt, validates it and returns the result.
 *
 * The function logs appropriate errors and counts events using `nestedCountersInstance` for various failure scenarios.
 */
export const verifyReceiptData = async (
  receipt: Receipt.Receipt | Receipt.ArchiverReceipt
): Promise<{
  success: boolean
}> => {
  const result = { success: false }
  try {
    // Check the signed nodes are part of the execution group nodes of the tx
    const { cycle, globalModification } = receipt

    const { txId, timestamp } = receipt.tx

    if (config.VERBOSE) {
      const currentTimestamp = Date.now()
      // Console log the timetaken between the receipt timestamp and the current time ( both in ms and s)
      console.log(
        `Time taken between receipt timestamp and current time: ${txId}`,
        `${currentTimestamp - timestamp} ms`,
        `${(currentTimestamp - timestamp) / 1000} s`
      )
    }
    const currentCycle = getCurrentCycleCounter()
    if (currentCycle - cycle > 2) {
      Logger.mainLogger.error(
        `Found receipt with cycle older than 2 cycles ${txId}, ${cycle}, ${timestamp}, ${currentCycle}`
      )
    }
    const cycleShardData = shardValuesByCycle.get(cycle)
    if (!cycleShardData) {
      Logger.mainLogger.error('Cycle shard data not found')
      if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Cycle_shard_data_not_found')
      return result
    }

    let globalReceiptValidationErrors
    if (globalModification) {
      try {
        // Validate if receipt is a global modification receipt using AJV
        globalReceiptValidationErrors = verifyPayload(AJVSchemaEnum.GlobalTxReceipt, receipt?.signedReceipt)
        // If the receipt is a global modification receipt, validate the receipt
        if (!globalReceiptValidationErrors) {
          return verifyGlobalTxreceipt(receipt)
        } else {
          Logger.mainLogger.error('VerifyReceiptData : globalReceiptValidationErrors have occured')
          if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'globalReceiptValidationErrors')
        }
        return result
      } catch (error) {
        globalReceiptValidationErrors = true
        if (nestedCountersInstance)
          nestedCountersInstance.countEvent(
            'receipt',
            `Failed to validate receipt schema txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
          )
        Logger.mainLogger.error(
          `Failed to validate receipt schema txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
        )
        return result
      }
    }
    // If the receipt is a non global transaction receipt, validate the receipt
    return verifyNonGlobalTxReceipt(receipt)
  } catch (error) {
    Logger.mainLogger.error(`Error in verifyReceiptData: ${error.message}`)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'verifyReceiptData_error')
    return result
  }
}

/**
 * Calculates a hash for a given vote, which can be either an `AppliedVote` or a `Proposal`.
 * The hash calculation varies based on the type of vote and the configuration settings.
 *
 * @param vote - The vote object, which can be of type `Receipt.AppliedVote` or `Receipt.Proposal`.
 * @returns The calculated hash as a string. If an error occurs during the calculation, an empty string is returned.
 *
 * The function performs the following steps:
 * 1. If `config.usePOQo` is true and the vote is a `Proposal`:
 *    - Extracts the `applied` and `cant_preApply` properties from the proposal.
 *    - Calculates a hash of the account IDs, before state hashes, and after state hashes.
 *    - Combines the apply status hash, accounts hash, and app receipt data hash to generate the proposal hash.
 * 2. If `config.usePOQo` is true and the vote is an `AppliedVote`:
 *    - Extracts the `transaction_result` and `cant_apply` properties from the applied vote.
 *    - Extracts the account state hashes and app data hash.
 *    - Combines the hashes of the applied hash, state hash, and app data hash to generate the applied vote hash.
 * 3. If neither condition is met, it hashes the vote object with an additional `node_id` property set to an empty string.
 *
 * If an error occurs during the hash calculation, it logs the error and increments a nested counter event.
 */
const calculateVoteHash = (vote: Receipt.AppliedVote | Receipt.Proposal): string => {
  try {
    if (config.usePOQo === true && (vote as Receipt.Proposal).applied !== undefined) {
      const proposal = vote as Receipt.Proposal
      const applyStatus = {
        applied: proposal.applied,
        cantApply: proposal.cant_preApply,
      }
      const accountsHash = Crypto.hash(
        Crypto.hashObj(proposal.accountIDs) +
          Crypto.hashObj(proposal.beforeStateHashes) +
          Crypto.hashObj(proposal.afterStateHashes)
      )
      const proposalHash = Crypto.hash(
        Crypto.hashObj(applyStatus) + accountsHash + proposal.appReceiptDataHash + proposal.executionShardKey
      )
      return proposalHash
    } else if (config.usePOQo === true) {
      const appliedVote = vote as Receipt.AppliedVote
      const appliedHash = {
        applied: appliedVote.transaction_result,
        cantApply: appliedVote.cant_apply,
      }
      const stateHash = {
        account_id: appliedVote.account_id,
        account_state_hash_after: appliedVote.account_state_hash_after,
        account_state_hash_before: appliedVote.account_state_hash_before,
      }
      const appDataHash = {
        app_data_hash: appliedVote.app_data_hash,
      }
      const voteToHash = {
        appliedHash: Crypto.hashObj(appliedHash),
        stateHash: Crypto.hashObj(stateHash),
        appDataHash: Crypto.hashObj(appDataHash),
      }
      return Crypto.hashObj(voteToHash)
    }
    return Crypto.hashObj({ ...vote, node_id: '' })
  } catch {
    Logger.mainLogger.error('Error in calculateVoteHash', vote)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Error_in_calculateVoteHash')
    return ''
  }
}

/**
 * Verifies the given archiver receipt.
 *
 * @param {Receipt.ArchiverReceipt | Receipt.Receipt} receipt - The receipt to verify. It can be either an ArchiverReceipt or a generic Receipt.
 * @returns {Promise<ReceiptVerificationResult>} A promise that resolves to a ReceiptVerificationResult object indicating the success or failure of the verification process.
 *
 * The function performs the following verifications:
 * 1. If `config.verifyAppReceiptData` is enabled, it verifies the application receipt data.
 *    - If the verification fails, it returns a failure result with the reasons.
 *    - If the receipt is valid but does not need to be saved, it returns a failure result with the reasons.
 * 2. If `config.verifyAccountData` is enabled, it verifies the account data.
 *    - If the verification fails, it returns a failure result with the reasons.
 *
 * The function returns a success result if all enabled verifications pass.
 */
export const verifyArchiverReceipt = async (
  receipt: Receipt.ArchiverReceipt | Receipt.Receipt
): Promise<ReceiptVerificationResult> => {
  const { txId, timestamp } = receipt.tx
  const existingReceipt = await Receipt.queryReceiptByReceiptId(txId)
  const failedReasons = []
  const nestedCounterMessages = []
  try {
    if (config.verifyAppReceiptData) {
      const { valid, needToSave } = await verifyAppReceiptData(
        receipt,
        existingReceipt,
        failedReasons,
        nestedCounterMessages
      )
      if (!valid) {
        failedReasons.push(`Invalid receipt: App Receipt Verification failed ${txId}, ${receipt.cycle}, ${timestamp}`)
        nestedCounterMessages.push('Invalid_receipt_app_receipt_verification_failed')
        return { success: false, failedReasons, nestedCounterMessages }
      }
      if (!needToSave) {
        failedReasons.push(`Valid receipt: but no need to save ${txId}, ${receipt.cycle}, ${timestamp}`)
        nestedCounterMessages.push('Valid_receipt_but_no_need_to_save')
        return { success: false, failedReasons, nestedCounterMessages }
      }
    }
    if (config.verifyAccountData) {
      const result = await verifyAccountHash(receipt, failedReasons, nestedCounterMessages)
      if (!result) {
        failedReasons.push(`Invalid receipt: Account Verification failed ${txId}, ${receipt.cycle}, ${timestamp}`)
        nestedCounterMessages.push('Invalid_receipt_account_verification_failed')
        return { success: false, failedReasons, nestedCounterMessages }
      }
    }
    return { success: true, failedReasons, nestedCounterMessages }
  } catch (error) {
    Logger.mainLogger.error(`Error in verifyArchiverReceipt: ${error.message}`)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'verifyArchiverReceipt_error')
    return {
      success: false,
      failedReasons: [`Error in verifyArchiverReceipt: ${error.message}`],
      nestedCounterMessages,
    }
  }
}

/**
 * Determines whether a new receipt should be allowed to overwrite an existing receipt in the database.
 *
 * Receipt status overwrite logic:
 * Incoming Status : Existing Status
 * - 0 -> 1: Don't replace (reject incoming receipt with failure if existing has success)
 * - 1 -> 0: Replace (allow overwriting failure with success)
 * - 1 -> 1: Won't happen (impossible case, nonce will change)
 * - 0 -> 0: Replace (allow overwriting failure with failure)
 *
 * @param {any} receipt - The incoming receipt that may overwrite an existing one
 * @param {string} txId - The transaction ID to check for existing receipts
 * @returns {Promise<boolean>} True if overwrite is allowed, false if rejected
 */
export async function checkIfValidOverwrite(receipt: any, txId: string): Promise<boolean> {
  try {
    const existingReceipt = await queryReceiptByReceiptId(txId)
    if (!existingReceipt) return true // receipt came for the first time, let it insert

    // we found a duplicate receipt
    if (config.dataLogWrite && ReceiptOverwriteLogWriter) {
      ReceiptOverwriteLogWriter.writeToLog(
        `Existing Receipt : ${StringUtils.safeStringify(existingReceipt)} Incoming Receipt : ${StringUtils.safeStringify(receipt)}`
      )
    }
    if (config.VERBOSE) console.log('Duplicate receipts were found for the txId', txId)
    if (config.VERBOSE)
      console.log(
        `Existing Receipt : ${StringUtils.safeStringify(existingReceipt)} Incoming Receipt : ${StringUtils.safeStringify(receipt)}`
      )
    if (nestedCountersInstance) nestedCountersInstance.countEvent('duplicate-receipts', `txId : ${txId}`)

    const existingShardeumReceipt = existingReceipt.appReceiptData.data as ShardeumReceipt
    const existingStatus = existingShardeumReceipt.readableReceipt.status
    if (existingStatus === 1) {
      return false // you cannot override a successful receipt (status 1) with any new receipt
    } else return true // if the existingStatus is 0 (failure), let the new receipt ( be it with status 0 or 1) override the old failure receipt
  } catch (error) {
    // Log the error with context about what operation was attempted
    Logger.mainLogger.error(`Error in checkIfValidOverwrite for txId ${txId}: ${error.message}`, error)
    if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'checkIfValidOverwrite_error')

    // Default to rejecting the overwrite in case of error to be safe
    return false
  }
}

/**
 * Stores receipt data in the database.
 *
 * @param {Receipt.Receipt[] | Receipt.ArchiverReceipt[]} receipts - Array of receipts to be stored.
 * @param {string} [senderInfo=''] - Optional sender information.
 * @param {boolean} [verifyData=false] - Flag to indicate if the receipt data should be verified.
 * @param {boolean} [saveOnlyGossipData=false] - Flag to indicate if only gossip data should be saved.
 * @returns {Promise<void>} - A promise that resolves when the operation is complete.
 *
 * @remarks
 * This function processes and stores receipt data. It performs validation and verification of receipts,
 * updates account and transaction data, and handles bulk insertion of data into the database.
 *
 * The function skips processing if the receipts array is empty or invalid. It also skips receipts that
 * have already been processed or are in the validation map.
 *
 * If `verifyData` is true, the function verifies the receipt data and handles any verification failures.
 *
 * The function processes each receipt, updating account and transaction data, and performs bulk insertion
 * when the number of receipts, accounts, transactions, or processed transactions reaches a specified bucket size.
 *
 * If the archiver is not active and the processed receipts map exceeds 2000 entries, the map is cleared.
 */
export const storeReceiptData = async (
  receipts: Receipt.Receipt[] | Receipt.ArchiverReceipt[],
  senderInfo = '',
  verifyData = false,
  saveOnlyGossipData = false,
  checkpoint: boolean = true
): Promise<void> => {
  if (!receipts || !Array.isArray(receipts) || receipts.length <= 0) return
  const bucketSize = 1000
  let combineReceipts = []
  let combineAccounts = []
  let combineOriginalTxsData = []
  let combineTransactions = []
  let combineProcessedTxs = []
  let txDataList: TxData[] = []
  let originalTxDataList: TxData[] = [] // this is kind of duplicate of 'txDataList' but have created to avoid confusion
  if (saveOnlyGossipData) return
  for (let receipt of receipts) {
    // TODO : needs to be addressed on the validator side, post mainnet
    if (receipt == null || receipt == undefined) {
      Logger.mainLogger.error('storeReceiptData : Invalid incoming receipt, Receipt is ', receipt)
      if (nestedCountersInstance)
        nestedCountersInstance.countEvent('storeReceiptData', 'invalid_receipt_null_or_undefined')
      continue
    }

    let txId: string
    try {
      if (receipt.globalModification) {
        const appliedReceipt = receipt.signedReceipt as P2PTypes.GlobalAccountsTypes.GlobalTxReceipt
        txId = appliedReceipt.tx.txId
      } else {
        const { proposal } = receipt.signedReceipt as Receipt.SignedReceipt
        txId = proposal.txid
      }

      const timestamp = receipt?.tx?.timestamp
      if (!txId || !timestamp) {
        logReceiptData(receipt)
        continue
      }
      if (
        (processedReceiptsMap.has(txId) && processedReceiptsMap.get(txId) === timestamp) ||
        (receiptsInValidationMap.has(txId) && receiptsInValidationMap.get(txId) === timestamp)
      ) {
        if (config.VERBOSE) console.log('RECEIPT', 'Skip', txId, timestamp, senderInfo)
        logReceiptData(receipt, txId, timestamp)
        continue
      }
      if (config.VERBOSE) console.log('RECEIPT', 'Validate', txId, timestamp, senderInfo)
      receiptsInValidationMap.set(txId, timestamp)
      if (profilerInstance) profilerInstance.profileSectionStart('Validate_receipt')
      if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Validate_receipt')
      if (!validateReceiptType(receipt)) {
        Logger.mainLogger.error('Invalid receipt: Validation failed', txId, receipt.cycle, timestamp)
        receiptsInValidationMap.delete(txId)
        if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Invalid_receipt_validation_failed')
        if (profilerInstance) profilerInstance.profileSectionEnd('Validate_receipt')
        logReceiptData(receipt, txId, timestamp)
        continue
      }

      if (config.enableDuplicateReceiptsCheck && !receipt.globalModification) {
        // only consider this for EVM txns and Non Global Internal Txns
        const result = await checkIfValidOverwrite(receipt, txId)
        if (!result) {
          logReceiptData(receipt, txId, timestamp)
          continue // if the incoming receipt has a status of 0, do not allow it to overwrite a receipt of status 1
        }
      }

      if (verifyData) {
        // if (config.usePOQo === false) {
        // const existingReceipt = await Receipt.queryReceiptByReceiptId(txId)
        // if (
        //   existingReceipt &&
        //   receipt.appliedReceipt &&
        //   receipt.appliedReceipt.confirmOrChallenge &&
        //   receipt.appliedReceipt.confirmOrChallenge.message === 'challenge'
        // ) {
        //   // If the existing receipt is confirmed, and the new receipt is challenged, then skip saving the new receipt
        //   if (existingReceipt.appliedReceipt.confirmOrChallenge.message === 'confirm') {
        //     Logger.mainLogger.error(
        //       `Existing receipt is confirmed, but new receipt is challenged ${txId}, ${receipt.cycle}, ${timestamp}`
        //     )
        //     receiptsInValidationMap.delete(txId)
        //     if (nestedCountersInstance)
        //       nestedCountersInstance.countEvent(
        //         'receipt',
        //         'Existing_receipt_is_confirmed_but_new_receipt_is_challenged'
        //       )
        //     if (profilerInstance) profilerInstance.profileSectionEnd('Validate_receipt')
        //     continue
        //   }
        // }
        // }

        if (config.verifyReceiptData) {
          const { success } = await verifyReceiptData(receipt)
          if (!success) {
            Logger.mainLogger.error('Invalid receipt: Verification failed', txId, receipt.cycle, timestamp)
            receiptsInValidationMap.delete(txId)
            if (nestedCountersInstance)
              nestedCountersInstance.countEvent('receipt', 'Invalid_receipt_verification_failed')
            if (profilerInstance) profilerInstance.profileSectionEnd('Validate_receipt')
            logReceiptData(receipt, txId, timestamp)
            continue
          }

          if (profilerInstance) profilerInstance.profileSectionStart('Verify_archiver_receipt')
          if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Verify_archiver_receipt')
          const start_time = process.hrtime()
          // console.log('offloading receipt', txId, timestamp)
          // const result = await offloadReceipt(txId, timestamp, requiredSignatures, receipt)
          let result
          try {
            result = await verifyArchiverReceipt(receipt)
          } catch (error) {
            receiptsInValidationMap.delete(txId)
            if (nestedCountersInstance)
              nestedCountersInstance.countEvent('receipt', 'Invalid_receipt_verification_failed')
            if (profilerInstance) profilerInstance.profileSectionEnd('Verify_archiver_receipt')
            logReceiptData(receipt, txId, timestamp)
            continue
          }
          // console.log('offload receipt result', txId, timestamp, result)
          const end_time = process.hrtime(start_time)
          const time_taken = end_time[0] * 1000 + end_time[1] / 1000000
          if (time_taken > 100) {
            console.log(`Time taken for receipt verification in millisecond is: `, txId, timestamp, time_taken)
          }
          if (profilerInstance) profilerInstance.profileSectionEnd('Offload_receipt')
          for (const message of result.failedReasons) {
            Logger.mainLogger.error(message)
          }
          for (const message of result.nestedCounterMessages) {
            if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', message)
          }
          if (result.success === false) {
            receiptsInValidationMap.delete(txId)
            if (profilerInstance) profilerInstance.profileSectionEnd('Validate_receipt')
            logReceiptData(receipt, txId, timestamp)
            continue
          }
        }
      }
      if (profilerInstance) profilerInstance.profileSectionEnd('Validate_receipt')
      // await Receipt.insertReceipt({
      //   ...receipts[i],
      //   receiptId: tx.txId,
      //   timestamp: tx.timestamp,
      // })
      const { afterStates, cycle, tx, appReceiptData, signedReceipt, globalModification } = receipt
      const sortedVoteOffsets = globalModification ? [] : (signedReceipt as Receipt.SignedReceipt).voteOffsets.sort()
      const medianOffset = sortedVoteOffsets[Math.floor(sortedVoteOffsets.length / 2)] ?? 0
      const applyTimestamp = tx.timestamp + medianOffset * 1000
      if (config.VERBOSE) console.log('RECEIPT', 'Save', txId, timestamp, senderInfo)
      processedReceiptsMap.set(txId, tx.timestamp)
      receiptsInValidationMap.delete(txId)
      if (missingReceiptsMap.has(txId)) missingReceiptsMap.delete(txId)
      receipt.beforeStates = globalModification || config.storeReceiptBeforeStates ? receipt.beforeStates : [] // Store beforeStates for globalModification tx, or if config.storeReceiptBeforeStates is true
      let executionShardKey: string
      if (globalModification) {
        const appliedReceipt = receipt.signedReceipt as P2PTypes.GlobalAccountsTypes.GlobalTxReceipt
        executionShardKey = appliedReceipt.tx.source
      } else {
        const appliedReceipt = receipt.signedReceipt as Receipt.SignedReceipt
        executionShardKey = appliedReceipt.proposal.executionShardKey
      }

      combineReceipts.push({
        ...receipt,
        receiptId: txId,
        timestamp: tx.timestamp,
        applyTimestamp,
        executionShardKey,
      })
      logReceiptData(receipt, txId, tx.timestamp, applyTimestamp)
      txDataList.push({ txId, timestamp })
      originalTxDataList.push({ txId, timestamp })
      // If the receipt is a challenge, then skip updating its accounts data or transaction data
      // if (
      //   config.newPOQReceipt === true &&
      //   appliedReceipt &&
      //   appliedReceipt.confirmOrChallenge &&
      //   appliedReceipt.confirmOrChallenge.message === 'challenge'
      // )
      //   continue

      if (globalModification) {
        let globalReceiptValidationErrors
        try {
          globalReceiptValidationErrors = verifyPayload(AJVSchemaEnum.GlobalTxReceipt, receipt?.signedReceipt)

          if (!globalReceiptValidationErrors) {
            for (const account of afterStates) {
              const accObj: Account.AccountsCopy = {
                accountId: config.globalNetworkAccount, // for global tx type receipts fixing accountID to 1000000000000000000000000000000000000000000000000000000000000001 for now
                data: account.data,
                timestamp: account.data.timestamp,
                hash: account.hash,
                cycleNumber: cycle,
                isGlobal: account.isGlobal || false,
              }
              if (account.timestamp !== account.data['timestamp'])
                Logger.mainLogger.error('Mismatched account timestamp', txId, account.accountId)
              if (account.hash !== account.data['hash'])
                Logger.mainLogger.error('Mismatched account hash', txId, account.accountId)

              const accountExist = await Account.queryAccountByAccountId(account.accountId)
              if (accountExist) {
                if (accObj.timestamp > accountExist.timestamp) await Account.updateAccount(accObj)
              } else {
                // await Account.insertAccount(accObj)
                combineAccounts.push(accObj)
              }

              //check global network account updates
              if (accObj.accountId === config.globalNetworkAccount) {
                setGlobalNetworkAccount(accObj)
              }
              if (accObj.isGlobal) {
                globalAccountsMap.set(accObj.accountId, {
                  hash: accObj.hash,
                  timestamp: accObj.timestamp,
                })
              }
            }
          }
        } catch (error) {
          globalReceiptValidationErrors = true
          if (nestedCountersInstance)
            nestedCountersInstance.countEvent(
              'receipt',
              `Failed to validate receipt schema txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
            )
          Logger.mainLogger.error(
            `Failed to validate receipt schema txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
          )
        }
      } else {
        try {
          const signedReceipt = receipt.signedReceipt as Receipt.SignedReceipt
          const { accountIDs } = signedReceipt.proposal

          for (const accountId of accountIDs) {
            const account = receipt.afterStates.find((acc) => acc.accountId === accountId)
            if (!account) {
              Logger.mainLogger.error('Account not found in afterStates', txId, accountId)
              continue
            }

            const accObj: Account.AccountsCopy = {
              accountId: account.accountId,
              data: account.data,
              timestamp: account.data.timestamp,
              hash: account.hash,
              cycleNumber: cycle,
              isGlobal: account.isGlobal || false,
            }

            if (account.timestamp !== account.data['timestamp']) {
              Logger.mainLogger.error('Mismatched account timestamp', txId, account.accountId)
            }
            if (account.hash !== account.data['hash']) {
              Logger.mainLogger.error('Mismatched account hash', txId, account.accountId)
            }

            const accountExist = await Account.queryAccountByAccountId(account.accountId)
            if (accountExist) {
              if (accObj.timestamp > accountExist.timestamp) await Account.updateAccount(accObj)
            } else {
              combineAccounts.push(accObj)
            }
          }
        } catch (error) {
          if (nestedCountersInstance) {
            nestedCountersInstance.countEvent(
              'receipt',
              `Failed to process non-global receipt txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
            )
          }
          Logger.mainLogger.error(
            `Failed to process non-global receipt txId: ${txId}, cycle: ${cycle}, timestamp: ${timestamp}, error: ${error}`
          )
        }
      }

      // if (receipt) {
      //   const accObj: Account.AccountsCopy = {
      //     accountId: receipt.accountId,
      //     data: receipt.data,
      //     timestamp: receipt.timestamp,
      //     hash: receipt.stateId,
      //     cycleNumber: cycle,
      //   }
      //   const accountExist = await Account.queryAccountByAccountId(
      //     receipt.accountId
      //   )
      //   if (accountExist) {
      //     if (accObj.timestamp > accountExist.timestamp)
      //       await Account.updateAccount(accObj.accountId, accObj)
      //   } else {
      //     // await Account.insertAccount(accObj)
      //     combineAccounts.push(accObj)
      //   }
      // }

      const originalTxData: OriginalTxsData.OriginalTxData = {
        txId: txId,
        timestamp: tx.timestamp,
        cycle: cycle,
        originalTxData: tx.originalTxData,
      }
      if (config.dataLogWrite && OriginalTxDataLogWriter) {
        OriginalTxDataLogWriter.writeToLog(`${StringUtils.safeStringify(originalTxData)}\n`)
      }

      const txObj: Transaction.Transaction = {
        txId: txId,
        appReceiptId: appReceiptData ? appReceiptData.accountId : txId, // Set txId if appReceiptData lacks appReceiptId
        timestamp: tx.timestamp,
        cycleNumber: cycle,
        data: appReceiptData ? appReceiptData.data : {},
        originalTxData: tx.originalTxData,
      }

      const processedTx: ProcessedTransaction.ProcessedTransaction = {
        txId: txId,
        cycle: cycle,
        txTimestamp: tx.timestamp,
        applyTimestamp,
      }

      // await Transaction.insertTransaction(txObj)
      combineOriginalTxsData.push(originalTxData)
      combineTransactions.push(txObj)
      combineProcessedTxs.push(processedTx)
      // Receipts size can be big, better to save per 100
      if (combineReceipts.length >= 100) {
        await Receipt.bulkInsertReceipts(combineReceipts, checkpoint)
        if (State.isActive) sendDataToAdjacentArchivers(DataType.RECEIPT, txDataList)
        combineReceipts = []
        txDataList = []
      }

      if (combineOriginalTxsData.length >= bucketSize) {
        await OriginalTxsData.bulkInsertOriginalTxsData(combineOriginalTxsData, checkpoint)
        combineOriginalTxsData = []
        originalTxDataList = []
      }

      if (combineAccounts.length >= bucketSize) {
        await Account.bulkInsertAccounts(combineAccounts)
        combineAccounts = []
      }
      if (combineTransactions.length >= bucketSize) {
        await Transaction.bulkInsertTransactions(combineTransactions)
        combineTransactions = []
      }
      if (combineProcessedTxs.length >= bucketSize) {
        await ProcessedTransaction.bulkInsertProcessedTxs(combineProcessedTxs)
        combineProcessedTxs = []
      }
    } catch (e) {
      Logger.mainLogger.error(
        'storeReceiptData: something went wrong while processing receipt:',
        txId,
        'receipt:',
        receipt,
        'err:',
        e
      )
      if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'storeReceiptData_unknown_error')
    }
  }
  // Receipts size can be big, better to save per 100
  if (combineReceipts.length > 0) {
    await Receipt.bulkInsertReceipts(combineReceipts, checkpoint)
    if (State.isActive) sendDataToAdjacentArchivers(DataType.RECEIPT, txDataList)
  }

  if (combineOriginalTxsData.length > 0) {
    await OriginalTxsData.bulkInsertOriginalTxsData(combineOriginalTxsData, checkpoint)
  }

  if (combineAccounts.length > 0) await Account.bulkInsertAccounts(combineAccounts)
  if (combineTransactions.length > 0) await Transaction.bulkInsertTransactions(combineTransactions)
  if (combineProcessedTxs.length > 0) await ProcessedTransaction.bulkInsertProcessedTxs(combineProcessedTxs)
  // If the archiver is not active, good to clean up the processed receipts map if it exceeds 2000
  if (!State.isActive && processedReceiptsMap.size > 2000) processedReceiptsMap.clear()
}

function logReceiptData(
  receipt: Receipt.Receipt | Receipt.ArchiverReceipt,
  txId?: string,
  timestamp?: number,
  applyTimestamp?: number
) {
  if (config.dataLogWrite && ReceiptLogWriter) {
    ReceiptLogWriter.writeToLog(
      `${StringUtils.safeStringify({
        ...receipt,
        receiptId: txId,
        timestamp,
        applyTimestamp,
      })}\n`
    )
  }
}

export const validateCycleData = (cycleRecord: P2PTypes.CycleCreatorTypes.CycleData): boolean => {
  const err = Utils.validateTypes(cycleRecord, {
    activated: 'a',
    activatedPublicKeys: 'a',
    active: 'n',
    apoptosized: 'a',
    archiverListHash: 's',
    counter: 'n',
    desired: 'n',
    duration: 'n',
    expired: 'n',
    joined: 'a',
    joinedArchivers: 'a',
    joinedConsensors: 'a',
    leavingArchivers: 'a',
    lost: 'a',
    lostSyncing: 'a',
    marker: 's',
    maxSyncTime: 'n',
    mode: 's',
    networkConfigHash: 's',
    networkId: 's',
    nodeListHash: 's',
    previous: 's',
    refreshedArchivers: 'a',
    refreshedConsensors: 'a',
    refuted: 'a',
    removed: 'a',
    returned: 'a',
    standbyAdd: 'a',
    standbyNodeListHash: 's',
    standbyRemove: 'a',
    start: 'n',
    syncing: 'n',
    target: 'n',
    archiversAtShutdown: 'a?',
  })
  if (err) {
    Logger.mainLogger.error('Invalid Cycle Record', err)
    return false
  }
  const cycleRecordWithoutMarker = { ...cycleRecord }
  delete cycleRecordWithoutMarker.marker
  if (computeCycleMarker(cycleRecordWithoutMarker) !== cycleRecord.marker) {
    Logger.mainLogger.error('Invalid Cycle Record: cycle marker does not match with the computed marker')
    return false
  }
  return true
}

export const storeCycleData = async (cycles: P2PTypes.CycleCreatorTypes.CycleData[] = []): Promise<void> => {
  if (cycles && cycles.length <= 0) return
  const bucketSize = 1000
  let combineCycles = []
  for (let i = 0; i < cycles.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const cycleRecord = cycles[i]

    const cycleObj: DbCycle = {
      counter: cycleRecord.counter,
      cycleMarker: cycleRecord.marker,
      cycleRecord,
    }
    if (config.dataLogWrite && CycleLogWriter) CycleLogWriter.writeToLog(`${StringUtils.safeStringify(cycleObj)}\n`)
    const cycleExist = await queryCycleByMarker(cycleObj.cycleMarker)
    if (cycleExist) {
      if (StringUtils.safeStringify(cycleObj) !== StringUtils.safeStringify(cycleExist))
        await updateCycle(cycleObj.cycleMarker, cycleObj)
    } else {
      // await Cycle.insertCycle(cycleObj)
      combineCycles.push(cycleObj)
    }
    if (combineCycles.length >= bucketSize || i === cycles.length - 1) {
      if (combineCycles.length > 0) await bulkInsertCycles(combineCycles)
      combineCycles = []
    }
  }
}

interface StoreAccountParam {
  accounts?: Account.AccountsCopy[]
  receipts?: Transaction.Transaction[]
}

export const storeAccountData = async (restoreData: StoreAccountParam = {}): Promise<void> => {
  Logger.mainLogger.debug(`storeAccountData: ${restoreData.accounts ? restoreData.accounts.length : 0} accounts`)
  Logger.mainLogger.debug(`storeAccountData: ${restoreData.receipts ? restoreData.receipts.length : 0} receipts`)
  const { accounts, receipts } = restoreData
  if (profilerInstance) profilerInstance.profileSectionStart('store_account_data')
  storingAccountData = true
  if (!accounts && !receipts) return
  Logger.mainLogger.debug('Received Accounts Size', accounts ? accounts.length : 0)
  Logger.mainLogger.debug('Received Transactions Size', receipts ? receipts.length : 0)
  // for (let i = 0; i < accounts.length; i++) {
  //   const account = accounts[i]
  //   await Account.insertAccount(account)
  //   // const accountExist = await Account.queryAccountByAccountId(
  //   //   account.accountId
  //   // )
  //   // if (accountExist) {
  //   //   if (account.timestamp > accountExist.timestamp)
  //   //     await Account.updateAccount(account.accountId, account)
  //   // } else {
  //   //   await Account.insertAccount(account)
  //   // }
  // }
  //
  if (accounts && accounts.length > 0) {
    const combineAccounts = []
    for (const account of accounts) {
      try {
        const calculatedAccountHash = accountSpecificHash(account.data)
        if (calculatedAccountHash !== account.hash) {
          Logger.mainLogger.error('Invalid account hash', account.accountId, account.hash, calculatedAccountHash)
          continue
        }
        combineAccounts.push(account)
      } catch (error) {
        Logger.mainLogger.error('Error in calculating genesis account hash', error)
      }
    }
    if (combineAccounts.length > 0) await Account.bulkInsertAccounts(accounts)
  }
  if (receipts && receipts.length > 0) {
    Logger.mainLogger.debug('Received receipts Size', receipts.length)
    const combineTransactions = []
    const combineProcessedTxs = []
    for (const receipt of receipts) {
      const txObj: Transaction.Transaction = {
        txId: receipt.data.txId || receipt.txId,
        appReceiptId: receipt.appReceiptId,
        timestamp: receipt.timestamp,
        cycleNumber: receipt.cycleNumber,
        data: receipt.data,
        originalTxData: {},
      }
      const processedTx: ProcessedTransaction.ProcessedTransaction = {
        txId: receipt.data.txId || receipt.txId,
        cycle: receipt.cycleNumber,
        txTimestamp: receipt.timestamp,
        applyTimestamp: receipt.timestamp,
      }
      combineTransactions.push(txObj)
      combineProcessedTxs.push(processedTx)
    }
    await Transaction.bulkInsertTransactions(combineTransactions)
    await ProcessedTransaction.bulkInsertProcessedTxs(combineProcessedTxs)
  }
  if (profilerInstance) profilerInstance.profileSectionEnd('store_account_data')
  Logger.mainLogger.debug('Combined Accounts Data', combineAccountsData.accounts.length)
  if (combineAccountsData.accounts.length > 0 || combineAccountsData.receipts.length > 0) {
    Logger.mainLogger.debug('Found combine accountsData', combineAccountsData.accounts.length)
    const accountData = { ...combineAccountsData }
    clearCombinedAccountsData()
    storeAccountData(accountData)
  } else {
    storingAccountData = false
  }
}

export const storeOriginalTxData = async (
  originalTxsData: OriginalTxsData.OriginalTxData[] = [],
  senderInfo = '',
  saveOnlyGossipData = false,
  checkpoint: boolean = true
): Promise<void> => {
  if (!originalTxsData || !Array.isArray(originalTxsData) || originalTxsData.length <= 0) return
  const bucketSize = 1000
  let combineOriginalTxsData = []
  let txDataList: TxData[] = []
  if (saveOnlyGossipData) return
  for (const originalTxData of originalTxsData) {
    const { txId, timestamp } = originalTxData
    if (!txId || !timestamp) continue
    try {
      const tx = (originalTxData.originalTxData as any)?.tx

      const { result, reason } = verifyTransaction(tx)

      if (result !== 'pass') {
        Logger.mainLogger.info(
          `OriginalTxData verification failed for`,
          StringUtils.safeStringify(originalTxData),
          '\n with reason ',
          reason
        )
        continue
      }
    } catch (error) {
      Logger.mainLogger.error(
        `Error verifying transaction: ${error.message} where tx was ${StringUtils.safeStringify(originalTxData)}`
      )
      continue
    }
    if (
      (processedOriginalTxsMap.has(txId) && processedOriginalTxsMap.get(txId) === timestamp) ||
      (originalTxsInValidationMap.has(txId) && originalTxsInValidationMap.get(txId) === timestamp)
    ) {
      if (config.VERBOSE) console.log('ORIGINAL_TX_DATA', 'Skip', txId, timestamp, senderInfo)
      continue
    }
    if (config.VERBOSE) console.log('ORIGINAL_TX_DATA', 'Validate', txId, timestamp, senderInfo)
    if (validateOriginalTxDataSchema(originalTxData) === false) {
      Logger.mainLogger.error('Invalid originalTxData: Validation failed', txId)
      originalTxsInValidationMap.delete(txId)
      continue
    }
    if (config.VERBOSE) console.log('ORIGINAL_TX_DATA', 'Save', txId, timestamp, senderInfo)
    processedOriginalTxsMap.set(txId, timestamp)
    originalTxsInValidationMap.delete(txId)
    // if (missingOriginalTxsMap.has(txId)) missingOriginalTxsMap.delete(txId)

    if (config.dataLogWrite && OriginalTxDataLogWriter)
      OriginalTxDataLogWriter.writeToLog(`${StringUtils.safeStringify(originalTxData)}\n`)
    combineOriginalTxsData.push(originalTxData)
    txDataList.push({ txId, timestamp })
    if (combineOriginalTxsData.length >= bucketSize) {
      await OriginalTxsData.bulkInsertOriginalTxsData(combineOriginalTxsData, checkpoint)
      if (State.isActive) sendDataToAdjacentArchivers(DataType.ORIGINAL_TX_DATA, txDataList)
      combineOriginalTxsData = []
      txDataList = []
    }
  }
  if (combineOriginalTxsData.length > 0) {
    await OriginalTxsData.bulkInsertOriginalTxsData(combineOriginalTxsData, checkpoint)
    if (State.isActive) sendDataToAdjacentArchivers(DataType.ORIGINAL_TX_DATA, txDataList)
  }
  // If the archiver is not active yet, good to clean up the processed originalTxs map if it exceeds 2000
  if (!State.isActive && processedOriginalTxsMap.size > 2000) processedOriginalTxsMap.clear()
}
interface validateResponse {
  success: boolean
  reason?: string
  error?: string
}

export const validateOriginalTxDataSchema = (originalTxData: OriginalTxsData.OriginalTxData): boolean => {
  const errors = verifyPayload(AJVSchemaEnum.OriginalTxData, originalTxData)

  if (errors) {
    Logger.mainLogger.error(
      'Invalid originalTxsData',
      errors,
      'where originalTxData was: ',
      StringUtils.safeStringify(originalTxData)
    )
    return false
  }

  return true
}

export const validateGossipData = (data: GossipData): validateResponse => {
  let err = Utils.validateTypes(data, {
    dataType: 's',
    data: 'a',
    sign: 'o',
  })
  if (err) {
    Logger.mainLogger.error('Invalid gossip data', data)
    return { success: false, reason: 'Invalid gossip data' + err }
  }
  err = Utils.validateTypes(data.sign, { owner: 's', sig: 's' })
  if (err) {
    Logger.mainLogger.error('Invalid gossip data signature', err)
    return { success: false, reason: 'Invalid gossip data signature' + err }
  }
  if (!State.activeArchivers.some((archiver) => archiver.publicKey === data.sign.owner)) {
    Logger.mainLogger.error('Data sender is not the active archivers')
    return { success: false, error: 'Data sender not the active archivers' }
  }
  if (
    data.dataType !== DataType.RECEIPT &&
    data.dataType !== DataType.ORIGINAL_TX_DATA &&
    data.dataType !== DataType.CYCLE
  ) {
    Logger.mainLogger.error('Invalid dataType', data)
    return { success: false, error: 'Invalid dataType' }
  }
  if (!Crypto.verify(data)) {
    Logger.mainLogger.error('Invalid signature', data)
    return { success: false, error: 'Invalid signature' }
  }
  return { success: true }
}

export const processGossipData = (gossipdata: GossipData): void => {
  const { dataType, data, sign } = gossipdata
  const senderArchiver = State.activeArchivers.find((archiver) => archiver.publicKey === sign.owner)
  const receivedTimestamp = Date.now()
  if (dataType === DataType.RECEIPT) {
    for (const { txId, timestamp } of data as TxData[]) {
      if (
        (processedReceiptsMap.has(txId) && processedReceiptsMap.get(txId) === timestamp) ||
        (receiptsInValidationMap.has(txId) && receiptsInValidationMap.get(txId) === timestamp) ||
        (collectingMissingReceiptsMap.has(txId) && collectingMissingReceiptsMap.get(txId) === timestamp)
      ) {
        // console.log('GOSSIP', 'RECEIPT', 'SKIP', txId, 'sender', sign.owner)
        continue
      } else {
        if (missingReceiptsMap.has(txId)) {
          if (
            missingReceiptsMap.get(txId).txTimestamp === timestamp &&
            !missingReceiptsMap.get(txId).senders.some((sender) => sender === sign.owner)
          )
            missingReceiptsMap.get(txId).senders.push(sign.owner)
          else {
            // Not expected to happen, but log error if it happens <-- could be malicious act of the sender
            if (missingReceiptsMap.get(txId).txTimestamp !== timestamp)
              Logger.mainLogger.error(
                `Received gossip for receipt ${txId} with different timestamp ${timestamp} from archiver ${sign.owner}`
              )
            if (missingReceiptsMap.get(txId).senders.some((sender) => sender === sign.owner))
              Logger.mainLogger.error(`Received gossip for receipt ${txId} from the same sender ${sign.owner}`)
          }
        } else missingReceiptsMap.set(txId, { txTimestamp: timestamp, receivedTimestamp, senders: [sign.owner] })
        // console.log('GOSSIP', 'RECEIPT', 'MISS', txId, 'sender', sign.owner)
      }
    }
  }

  // if (dataType === DataType.ORIGINAL_TX_DATA) {
  //   for (const { txId, timestamp } of data as TxData[]) {
  //     if (
  //       (processedOriginalTxsMap.has(txId) && processedOriginalTxsMap.get(txId) === timestamp) ||
  //       (originalTxsInValidationMap.has(txId) && originalTxsInValidationMap.get(txId) === timestamp) ||
  //       (collectingMissingOriginalTxsMap.has(txId) && collectingMissingOriginalTxsMap.get(txId) === timestamp)
  //     ) {
  //       // console.log('GOSSIP', 'ORIGINAL_TX_DATA', 'SKIP', txId, 'sender', sign.owner)
  //       continue
  //     } else {
  //       if (missingOriginalTxsMap.has(txId)) {
  //         if (
  //           missingOriginalTxsMap.get(txId).txTimestamp === timestamp &&
  //           !missingOriginalTxsMap.get(txId).senders.some((sender) => sender === sign.owner)
  //         )
  //           missingOriginalTxsMap.get(txId).senders.push(sign.owner)
  //         else {
  //           // Not expected to happen, but log error if it happens <-- could be malicious act of the sender
  //           if (missingOriginalTxsMap.get(txId).txTimestamp !== timestamp)
  //             Logger.mainLogger.error(
  //               `Received gossip for originalTxData ${txId} with different timestamp ${timestamp} from archiver ${sign.owner}`
  //             )
  //           if (missingOriginalTxsMap.get(txId).senders.some((sender) => sender === sign.owner))
  //             Logger.mainLogger.error(
  //               `Received gossip for originalTxData ${txId} from the same sender ${sign.owner}`
  //             )
  //         }
  //       } else
  //         missingOriginalTxsMap.set(txId, {
  //           txTimestamp: timestamp,
  //           receivedTimestamp,
  //           senders: [sign.owner],
  //         })
  //       // console.log('GOSSIP', 'ORIGINAL_TX_DATA', 'MISS', txId, 'sender', sign.owner)
  //     }
  //   }
  // }

  if (dataType === DataType.CYCLE) {
    collectCycleData(
      data as P2PTypes.CycleCreatorTypes.CycleData[],
      senderArchiver?.ip + ':' + senderArchiver?.port,
      'archiver'
    )
  }
}

export const collectMissingTxDataFromArchivers = async (): Promise<void> => {
  const currentTimestamp = Date.now()
  if (missingReceiptsMap.size > 0) {
    const cloneMissingReceiptsMap: Map<string, Omit<MissingTx, 'receivedTimestamp'>> = new Map()
    for (const [txId, { txTimestamp, receivedTimestamp, senders }] of missingReceiptsMap) {
      if (currentTimestamp - receivedTimestamp > config.waitingTimeForMissingTxData) {
        cloneMissingReceiptsMap.set(txId, { txTimestamp, senders })
        collectingMissingReceiptsMap.set(txId, txTimestamp)
        missingReceiptsMap.delete(txId)
      }
    }
    if (cloneMissingReceiptsMap.size > 0)
      Logger.mainLogger.debug('Collecting missing receipts', cloneMissingReceiptsMap.size)
    for (const [txId, { txTimestamp, senders }] of cloneMissingReceiptsMap) {
      collectMissingReceipts(senders, txId, txTimestamp)
    }
    cloneMissingReceiptsMap.clear()
  }

  // if (missingOriginalTxsMap.size > 0) {
  //   const cloneMissingOriginalTxsMap: Map<string, Omit<MissingTx, 'receivedTimestamp'>> = new Map()
  //   for (const [txId, { txTimestamp, receivedTimestamp, senders }] of missingOriginalTxsMap) {
  //     if (currentTimestamp - receivedTimestamp > config.waitingTimeForMissingTxData) {
  //       cloneMissingOriginalTxsMap.set(txId, { txTimestamp, senders })
  //       collectingMissingOriginalTxsMap.set(txId, txTimestamp)
  //       missingOriginalTxsMap.delete(txId)
  //     }
  //   }
  //   if (cloneMissingOriginalTxsMap.size > 0)
  //     Logger.mainLogger.debug('Collecting missing originalTxsData', cloneMissingOriginalTxsMap.size)
  //   for (const [txId, { txTimestamp, senders }] of cloneMissingOriginalTxsMap) {
  //     collectMissingOriginalTxsData(senders, txId, txTimestamp)
  //   }
  //   cloneMissingOriginalTxsMap.clear()
  // }
}

export const collectMissingReceipts = async (senders: string[], txId: string, txTimestamp: number): Promise<void> => {
  const txIdList: [string, number][] = [[txId, txTimestamp]]
  let foundTxData = false
  const senderArchivers = State.activeArchivers.filter((archiver) => senders.includes(archiver.publicKey))
  Logger.mainLogger.debug(
    `Collecting missing receipt for txId ${txId} with timestamp ${txTimestamp} from archivers`,
    senderArchivers.map((a) => a.ip + ':' + a.port)
  )
  if (nestedCountersInstance) nestedCountersInstance.countEvent('receipt', 'Collect_missing_receipt')
  if (profilerInstance) profilerInstance.profileSectionStart('Collect_missing_receipt')
  for (const senderArchiver of senderArchivers) {
    if (
      (processedReceiptsMap.has(txId) && processedReceiptsMap.get(txId) === txTimestamp) ||
      (receiptsInValidationMap.has(txId) && receiptsInValidationMap.get(txId) === txTimestamp)
    ) {
      foundTxData = true
      break
    }
    const receipts = (await queryTxDataFromArchivers(senderArchiver, DataType.RECEIPT, txIdList)) as Receipt.Receipt[]
    if (receipts && receipts.length > 0) {
      for (const receipt of receipts) {
        const { receiptId, timestamp } = receipt
        if (txId === receiptId && txTimestamp === timestamp) {
          storeReceiptData([receipt], senderArchiver.ip + ':' + senderArchiver.port, false)
          foundTxData = true
        }
      }
    }
    if (foundTxData) break
  }
  if (!foundTxData) {
    if (nestedCountersInstance)
      nestedCountersInstance.countEvent('receipt', 'Failed to collect missing receipt from archivers')
    Logger.mainLogger.error(
      `Failed to collect receipt for txId ${txId} with timestamp ${txTimestamp} from archivers ${senders}`
    )
  }
  collectingMissingReceiptsMap.delete(txId)
  if (profilerInstance) profilerInstance.profileSectionEnd('Collect_missing_receipt')
}

const collectMissingOriginalTxsData = async (senders: string[], txId: string, txTimestamp: number): Promise<void> => {
  const txIdList: [string, number][] = [[txId, txTimestamp]]
  let foundTxData = false
  const senderArchivers = State.activeArchivers.filter((archiver) => senders.includes(archiver.publicKey))
  Logger.mainLogger.debug(
    `Collecting missing originalTxData for txId ${txId} with timestamp ${txTimestamp} from archivers`,
    senderArchivers.map((a) => a.ip + ':' + a.port)
  )
  if (nestedCountersInstance) nestedCountersInstance.countEvent('originalTxData', 'Collect_missing_originalTxData')
  if (profilerInstance) profilerInstance.profileSectionStart('Collect_missing_originalTxData')
  for (const senderArchiver of senderArchivers) {
    if (
      (processedOriginalTxsMap.has(txId) && processedOriginalTxsMap.get(txId) === txTimestamp) ||
      (originalTxsInValidationMap.has(txId) && originalTxsInValidationMap.get(txId) === txTimestamp)
    ) {
      foundTxData = true
      break
    }
    const originalTxs = (await queryTxDataFromArchivers(
      senderArchiver,
      DataType.ORIGINAL_TX_DATA,
      txIdList
    )) as OriginalTxDB.OriginalTxData[]
    if (originalTxs && originalTxs.length > 0) {
      for (const originalTx of originalTxs)
        if (txId === originalTx.txId && txTimestamp === originalTx.timestamp) {
          storeOriginalTxData([originalTx], senderArchiver.ip + ':' + senderArchiver.port)
          foundTxData = true
        }
    }
    if (foundTxData) break
  }
  if (!foundTxData) {
    if (nestedCountersInstance)
      nestedCountersInstance.countEvent('originalTxData', 'Failed to collect_missing_originalTxData')
    Logger.mainLogger.error(
      `Failed to collect originalTxData for txId ${txId} with timestamp ${txTimestamp} from archivers ${senders}`
    )
  }
  // collectingMissingOriginalTxsMap.delete(txId)
  if (profilerInstance) profilerInstance.profileSectionEnd('Collect_missing_originalTxData')
}

type TxDataFromArchiversResponse = {
  receipts?: Receipt.Receipt[]
  originalTxs?: OriginalTxDB.OriginalTxData[]
}

type QueryTxDataFromArchiversResponse = Receipt.Receipt[] | OriginalTxDB.OriginalTxData[] | null

export const queryTxDataFromArchivers = async (
  archiver: State.ArchiverNodeInfo,
  txDataType: DataType,
  txIdList: [string, number][]
): Promise<QueryTxDataFromArchiversResponse> => {
  let api_route = ''
  if (txDataType === DataType.RECEIPT) {
    api_route = `receipt`
  } else if (txDataType === DataType.ORIGINAL_TX_DATA) {
    api_route = `originalTx`
  }
  const signedData = Crypto.sign({ txIdList, sender: State.getNodeInfo().publicKey })
  const response = (await postJson(
    `http://${archiver.ip}:${archiver.port}/${api_route}`,
    signedData
  )) as TxDataFromArchiversResponse
  if (response) {
    if (txDataType === DataType.RECEIPT) {
      const receipts = response.receipts || null
      if (receipts && receipts.length > -1) {
        return receipts
      }
    } else if (txDataType === DataType.ORIGINAL_TX_DATA) {
      const originalTxs = response.originalTxs || null
      if (originalTxs && originalTxs.length > -1) {
        return originalTxs
      }
    }
  }
  return null
}

export function cleanOldReceiptsMap(timestamp: number): void {
  let savedReceiptsCount = 0
  for (const [key, value] of processedReceiptsMap) {
    if (value < timestamp) {
      processedReceiptsMap.delete(key)
      savedReceiptsCount++
    }
  }
  if (savedReceiptsCount > 0)
    Logger.mainLogger.debug(
      `Clean ${savedReceiptsCount} old receipts from the processed receipts cache on cycle ${getCurrentCycleCounter()}`
    )
}

export function cleanOldOriginalTxsMap(timestamp: number): void {
  let savedOriginalTxsCount = 0
  for (const [key, value] of processedOriginalTxsMap) {
    if (value < timestamp) {
      if (!processedReceiptsMap.has(key))
        Logger.mainLogger.error('The processed receipt is not found for originalTx', key, value)
      processedOriginalTxsMap.delete(key)
      savedOriginalTxsCount++
    }
  }
  if (savedOriginalTxsCount > 0)
    Logger.mainLogger.debug(
      `Clean ${savedOriginalTxsCount} old originalTxsData from the processed originalTxsData cache on cycle ${getCurrentCycleCounter()}`
    )
}

export const scheduleMissingTxsDataQuery = (): void => {
  // Set to collect missing txs data in every 1 second
  setInterval(() => {
    collectMissingTxDataFromArchivers()
  }, 1000)
}
