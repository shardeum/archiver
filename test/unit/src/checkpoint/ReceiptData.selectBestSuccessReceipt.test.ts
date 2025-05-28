import { selectBestSuccessReceipt } from '../../../../src/checkpoint/ReceiptUtils'
import * as Crypto from '../../../../src/Crypto'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import { Receipt as ReceiptType, SignedReceipt } from '../../../../src/dbstore/receipts'
import { describe, it, expect, beforeEach } from '@jest/globals'

// Helper to create a valid ReceiptType object
function makeReceipt({
  status = 1,
  timestamp = 1000,
  voteOffsets = [1, 2, 3],
  signaturePack = { foo: 1 },
  txId = 'tx1',
  extra = {},
  receiptId = 'rid',
  applyTimestamp = 0,
  cycle = 0,
  globalModification = false,
  owner = 'owner',
  sig = 'sig',
}: Partial<ReceiptType> & {
  status?: number
  voteOffsets?: number[]
  signaturePack?: any
  txId?: string
  extra?: any
  receiptId?: string
  applyTimestamp?: number
  cycle?: number
  globalModification?: boolean
  owner?: string
  sig?: string
} = {}): ReceiptType {
  const signedReceipt: Partial<SignedReceipt> = {
    sign: { owner, sig },
  }
  if (voteOffsets !== undefined) signedReceipt.voteOffsets = voteOffsets
  if (signaturePack !== undefined) signedReceipt.signaturePack = signaturePack

  return {
    receiptId,
    timestamp,
    applyTimestamp,
    cycle,
    globalModification,
    tx: { txId, timestamp },
    appReceiptData: {
      data: {
        readableReceipt: { status },
        ...extra,
      },
    },
    signedReceipt: signedReceipt as SignedReceipt,
  } as unknown as ReceiptType
}

beforeEach(() => {
  Crypto.setCryptoHashKey('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
})

describe('selectBestSuccessReceipt', () => {
  it('returns undefined if no success receipts', () => {
    const receipts = [makeReceipt({ status: 0 }), makeReceipt({ status: 0, txId: 'tx2' })]
    expect(selectBestSuccessReceipt(receipts)).toBeUndefined()
  })

  it('returns the only success receipt', () => {
    const r = makeReceipt({ status: 1 })
    expect(selectBestSuccessReceipt([r])).toBe(r)
  })

  it('selects the receipt with youngest median time', () => {
    const r1 = makeReceipt({ timestamp: 1000, voteOffsets: [5, 5, 5] }) // medianTime = 6000
    const r2 = makeReceipt({ timestamp: 1000, voteOffsets: [1, 1, 1] }) // medianTime = 2000
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r2)
  })

  it('uses sum of offsets as tiebreaker if median time is equal', () => {
    // Both have medianTime = 3000, but r1 sum = 6, r2 sum = 9
    const r1 = makeReceipt({ timestamp: 1000, voteOffsets: [2, 2, 2] }) // medianTime = 3000, sum = 6
    const r2 = makeReceipt({ timestamp: 1000, voteOffsets: [1, 4, 4] }) // medianTime = 3000, sum = 9
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r1)
  })

  it('uses receipt hash as tiebreaker if median time and sum are equal', () => {
    const r1 = makeReceipt({ timestamp: 1000, voteOffsets: [2, 2, 2], signaturePack: { foo: 1 } })
    const r2 = makeReceipt({ timestamp: 1000, voteOffsets: [2, 2, 2], signaturePack: { foo: 2 } })
    let winner
    try {
      winner =
        Crypto.hash(StringUtils.safeStringify(r1) || '').toLowerCase() <
        Crypto.hash(StringUtils.safeStringify(r2) || '').toLowerCase()
          ? r1
          : r2
    } catch (e) {
      winner = r1
    }
    expect(selectBestSuccessReceipt([r1, r2])).toBe(winner)
  })

  it('uses signaturePack hash as final tiebreaker', () => {
    const r1 = makeReceipt({ signaturePack: { foo: 1 } })
    const r2 = makeReceipt({ signaturePack: { foo: 2 } })
    r2.tx = { ...r1.tx }
    r2.appReceiptData = { ...r1.appReceiptData }
    if ('voteOffsets' in r1.signedReceipt && 'voteOffsets' in r2.signedReceipt) {
      r2.signedReceipt.voteOffsets = [...(r1.signedReceipt as any).voteOffsets]
    }
    const getSigPack = (r: ReceiptType) =>
      'signaturePack' in r.signedReceipt && (r.signedReceipt as any).signaturePack
        ? (r.signedReceipt as any).signaturePack
        : undefined
    let winner
    try {
      winner =
        Crypto.hash(StringUtils.safeStringify(getSigPack(r1)) || '').toLowerCase() <
        Crypto.hash(StringUtils.safeStringify(getSigPack(r2)) || '').toLowerCase()
          ? r1
          : r2
    } catch (e) {
      winner = r1
    }
    expect(selectBestSuccessReceipt([r1, r2])).toBe(winner)
  })

  it('ignores failed receipts even if they have better times', () => {
    const r1 = makeReceipt({ status: 0, voteOffsets: [0, 0, 0] }) // failed
    const r2 = makeReceipt({ status: 1, voteOffsets: [10, 10, 10] }) // success
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r2)
  })

  it('handles missing voteOffsets gracefully', () => {
    const r1 = makeReceipt({ voteOffsets: undefined })
    const r2 = makeReceipt({ voteOffsets: [1, 2, 3] })
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r1) // r1 medianTime = 1000, r2 = 2000
  })

  it('handles missing signaturePack gracefully', () => {
    const r1 = makeReceipt({ signaturePack: undefined })
    const r2 = makeReceipt({ signaturePack: { foo: 2 } })
    expect([r1, r2]).toContain(selectBestSuccessReceipt([r1, r2])) // Should not throw
  })

  it('handles receipts with missing readableReceipt', () => {
    const r1 = makeReceipt({})
    delete (r1.appReceiptData.data as any).readableReceipt
    const r2 = makeReceipt({ status: 1 })
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r2)
  })

  it('returns undefined for empty array', () => {
    expect(selectBestSuccessReceipt([])).toBeUndefined()
  })

  it('returns undefined for undefined input', () => {
    expect(selectBestSuccessReceipt(undefined as any)).toBeUndefined()
  })

  it('handles receipts with empty voteOffsets', () => {
    const r1 = makeReceipt({ voteOffsets: [] })
    const r2 = makeReceipt({ voteOffsets: [1, 2, 3] })
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r1)
  })

  it('handles receipts with non-array voteOffsets', () => {
    const r1 = makeReceipt({ voteOffsets: undefined })
    const r2 = makeReceipt({ voteOffsets: null as any })
    const r3 = makeReceipt({ voteOffsets: 5 as any })
    expect([r1, r2, r3]).toContain(selectBestSuccessReceipt([r1, r2, r3]))
  })

  it('handles receipts with negative voteOffsets', () => {
    const r1 = makeReceipt({ voteOffsets: [-1, -2, -3] })
    const r2 = makeReceipt({ voteOffsets: [1, 2, 3] })
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r1)
  })

  it('handles receipts with future timestamps', () => {
    const now = Date.now()
    const r1 = makeReceipt({ timestamp: now + 1000000 })
    const r2 = makeReceipt({ timestamp: now })
    expect(selectBestSuccessReceipt([r1, r2])).toBe(r2)
  })

  it('handles receipts with malformed signaturePack', () => {
    const r1 = makeReceipt({ signaturePack: null as any })
    const r2 = makeReceipt({ signaturePack: 123 as any })
    expect([r1, r2]).toContain(selectBestSuccessReceipt([r1, r2]))
  })

  it('handles receipts with all fields missing except required', () => {
    const r1 = {
      receiptId: 'id',
      timestamp: 1,
      applyTimestamp: 0,
      cycle: 0,
      globalModification: false,
      tx: { txId: 'tx', timestamp: 1 },
      appReceiptData: { data: { readableReceipt: { status: 1 } } },
      signedReceipt: { sign: { owner: '', sig: '' } },
    } as any
    expect(selectBestSuccessReceipt([r1])).toBe(r1)
  })
})
