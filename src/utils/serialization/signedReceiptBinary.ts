import { VectorBufferStream } from './VectorBufferStream'
import { Signature } from '@shardeum-foundation/lib-crypto-utils'
import { Proposal } from '../../dbstore/receipts'
import { verifyPayload } from '../../types/ajv/Helpers'

// Single version byte for all binary receipts
export const SIGNED_RECEIPT_BINARY_VERSION = 1

// Type bytes
const TYPE_SIGNED_RECEIPT = 1
const TYPE_GLOBAL_TX_RECEIPT = 2

// --- Proposal ---
export function serializeProposalBinary(stream: VectorBufferStream, obj: Proposal): void {
  stream.writeUInt8(obj.applied ? 1 : 0)
  stream.writeUInt8(obj.cant_preApply ? 1 : 0)
  stream.writeUInt16(obj.accountIDs.length)
  for (const id of obj.accountIDs) stream.writeString(id)
  stream.writeUInt16(obj.beforeStateHashes.length)
  for (const h of obj.beforeStateHashes) stream.writeString(h)
  stream.writeUInt16(obj.afterStateHashes.length)
  for (const h of obj.afterStateHashes) stream.writeString(h)
  stream.writeString(obj.appReceiptDataHash)
  stream.writeString(obj.txid)
  stream.writeString(obj.executionShardKey || '')
}

export function deserializeProposalBinary(stream: VectorBufferStream): Proposal {
  const applied = stream.readUInt8() === 1
  const cant_preApply = stream.readUInt8() === 1
  const accountIDsLen = stream.readUInt16()
  const accountIDs: string[] = []
  for (let i = 0; i < accountIDsLen; i++) accountIDs.push(stream.readString())
  const beforeLen = stream.readUInt16()
  const beforeStateHashes: string[] = []
  for (let i = 0; i < beforeLen; i++) beforeStateHashes.push(stream.readString())
  const afterLen = stream.readUInt16()
  const afterStateHashes: string[] = []
  for (let i = 0; i < afterLen; i++) afterStateHashes.push(stream.readString())
  const appReceiptDataHash = stream.readString()
  const txid = stream.readString()
  const executionShardKey = stream.readString()
  return {
    applied,
    cant_preApply,
    accountIDs,
    beforeStateHashes,
    afterStateHashes,
    appReceiptDataHash,
    txid,
    executionShardKey,
  }
}

// --- Signature ---
export function serializeSignatureBinary(stream: VectorBufferStream, sig: Signature): void {
  stream.writeString(sig.owner)
  stream.writeString(sig.sig)
}

export function deserializeSignatureBinary(stream: VectorBufferStream): Signature {
  return {
    owner: stream.readString(),
    sig: stream.readString(),
  }
}

// --- SignedReceipt/GlobalTxReceipt ---
export function serializeSignedReceiptBinary(obj: any): Buffer {
  const stream = new VectorBufferStream(2048)
  stream.writeUInt8(SIGNED_RECEIPT_BINARY_VERSION)
  if (isSignedReceipt(obj)) {
    stream.writeUInt8(TYPE_SIGNED_RECEIPT)
    serializeProposalBinary(stream, obj.proposal)
    stream.writeString(obj.proposalHash)
    stream.writeUInt16(obj.voteOffsets.length)
    for (const v of obj.voteOffsets) stream.writeUInt16(v)
    stream.writeUInt16(obj.signaturePack.length)
    for (const sig of obj.signaturePack) serializeSignatureBinary(stream, sig)
    if (obj.sign) {
      stream.writeUInt8(1)
      serializeSignatureBinary(stream, obj.sign)
    } else {
      stream.writeUInt8(0)
    }
  } else if (isGlobalTxReceipt(obj)) {
    stream.writeUInt8(TYPE_GLOBAL_TX_RECEIPT)
    stream.writeUInt16(obj.signs.length)
    for (const sig of obj.signs) serializeSignatureBinary(stream, sig)
    const txStr = JSON.stringify(obj.tx)
    stream.writeString(txStr)
  } else {
    throw new Error('Unknown receipt type for binary serialization')
  }
  return stream.getBuffer()
}

export function deserializeSignedReceiptBinary(buf: Buffer): any {
  const stream = VectorBufferStream.fromBuffer(buf)
  const version = stream.readUInt8()
  if (version !== SIGNED_RECEIPT_BINARY_VERSION) {
    throw new Error(`Unsupported SignedReceipt binary version: ${version}`)
  }
  const type = stream.readUInt8()
  if (type === TYPE_SIGNED_RECEIPT) {
    const proposal = deserializeProposalBinary(stream)
    const proposalHash = stream.readString()
    const voteOffsetsLen = stream.readUInt16()
    const voteOffsets: number[] = []
    for (let i = 0; i < voteOffsetsLen; i++) voteOffsets.push(stream.readUInt16())
    const sigPackLen = stream.readUInt16()
    const signaturePack: Signature[] = []
    for (let i = 0; i < sigPackLen; i++) signaturePack.push(deserializeSignatureBinary(stream))
    const hasSign = stream.readUInt8()
    let sign: Signature | undefined
    if (hasSign) sign = deserializeSignatureBinary(stream)
    const obj = {
      proposal,
      proposalHash,
      voteOffsets,
      signaturePack,
      ...(sign ? { sign } : {}),
    }
    const errors = verifyPayload('SignedReceipt', obj)
    if (errors && errors.length > 0) {
      throw new Error('SignedReceipt AJV validation failed: ' + errors.join('; '))
    }
    return obj
  } else if (type === TYPE_GLOBAL_TX_RECEIPT) {
    const signsLen = stream.readUInt16()
    const signs: Signature[] = []
    for (let i = 0; i < signsLen; i++) signs.push(deserializeSignatureBinary(stream))
    const tx = JSON.parse(stream.readString())
    const obj = { signs, tx }
    const errors = verifyPayload('GlobalTxReceipt', obj)
    if (errors && errors.length > 0) {
      throw new Error('GlobalTxReceipt AJV validation failed: ' + errors.join('; '))
    }
    return obj
  } else {
    throw new Error('Unknown receipt type byte: ' + type)
  }
}

function isSignedReceipt(obj: any): boolean {
  return (
    obj &&
    typeof obj === 'object' &&
    'proposal' in obj &&
    'proposalHash' in obj &&
    'signaturePack' in obj &&
    'voteOffsets' in obj
  )
}

function isGlobalTxReceipt(obj: any): boolean {
  return obj && typeof obj === 'object' && 'signs' in obj && 'tx' in obj
}
