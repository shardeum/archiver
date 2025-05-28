import * as Crypto from '../Crypto'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { Receipt as ReceiptType } from '../dbstore/receipts'

/**
 * Selects the "best" success receipt from a group, using consensus rules.
 * @param receipts Array of ReceiptType (all for the same tx)
 * @returns The best receipt, or undefined if none are success receipts
 */
export function selectBestSuccessReceipt(receipts: ReceiptType[]): ReceiptType | undefined {
  if (!Array.isArray(receipts) || receipts.length === 0) return undefined
  // Only consider receipts with status=1 (success)
  const successReceipts = receipts.filter((r) => {
    // Defensive: readableReceipt may not exist or may be nested in a non-object
    const readableReceipt = (r?.appReceiptData?.data as { readableReceipt?: any })?.readableReceipt
    return readableReceipt?.status === 1
  })
  if (successReceipts.length === 0) return undefined

  // Score each receipt according to the rules
  const scored = successReceipts.map((r) => {
    const txTimestamp = Number(r.tx.timestamp)

    // Type guard for SignedReceipt
    const signedReceipt =
      r.signedReceipt && 'voteOffsets' in r.signedReceipt
        ? (r.signedReceipt as { voteOffsets: number[]; signaturePack?: any })
        : undefined

    const voteOffsets = Array.isArray(signedReceipt?.voteOffsets)
      ? signedReceipt.voteOffsets.map(Number).sort((a, b) => a - b)
      : []
    const medianOffset = voteOffsets.length ? voteOffsets[Math.floor(voteOffsets.length / 2)] : 0
    const medianTime = txTimestamp + medianOffset * 1000
    const sumOffsets = voteOffsets.reduce((sum, v) => sum + v, 0)

    // Hashes for tie-breakers
    const receiptHash = Crypto.hash(StringUtils.safeStringify(r)).toLowerCase()
    const sigPackHash = Crypto.hash(StringUtils.safeStringify(signedReceipt?.signaturePack)).toLowerCase()

    return {
      receipt: r,
      medianTime,
      sumOffsets,
      receiptHash,
      sigPackHash,
    }
  })

  // Sort by the rules
  scored.sort((a, b) => {
    if (a.medianTime !== b.medianTime) return a.medianTime - b.medianTime
    if (a.sumOffsets !== b.sumOffsets) return a.sumOffsets - b.sumOffsets
    if (a.receiptHash !== b.receiptHash) return a.receiptHash.localeCompare(b.receiptHash)
    return a.sigPackHash.localeCompare(b.sigPackHash)
  })

  return scored[0].receipt
}
