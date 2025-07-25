// @ts-nocheck - Type definitions are complex and would require extensive mocking
import { expect, describe, it, beforeEach, jest } from '@jest/globals'
import { P2P } from '@shardeum-foundation/lib-types'
import {
  verifyValidatorList,
  verifyStandbyList,
  verifyArchiverList,
  verifyTxList,
  verifyCycleRecord,
} from '../../../../src/sync-v2/verify'

// Mock the crypto utils module
jest.mock('@shardeum-foundation/lib-crypto-utils', () => ({
  hashObj: jest.fn((obj: any) => {
    // Simple mock hash function that creates a deterministic hash from object
    try {
      return 'hash_' + JSON.stringify(obj).length
    } catch (e) {
      // Handle circular references
      return 'hash_circular_ref'
    }
  }),
  Signature: jest.fn(),
}))

// Mock dependencies
jest.mock('../../../../src/Data/Cycles', () => ({
  computeCycleMarker: jest.fn(),
}))

// Import after mocks
import { hashObj } from '@shardeum-foundation/lib-crypto-utils'
import { computeCycleMarker } from '../../../../src/Data/Cycles'

describe('sync-v2/verify', () => {
  const mockedComputeCycleMarker = computeCycleMarker as jest.MockedFunction<typeof computeCycleMarker>

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('verifyValidatorList', () => {
    const mockValidatorList: P2P.NodeListTypes.Node[] = [
      {
        id: 'node1',
        publicKey: 'pubkey1',
        externalIp: '192.168.1.1',
        externalPort: 8080,
        internalIp: '10.0.0.1',
        internalPort: 8081,
        address: 'address1',
        joinRequestTimestamp: 1234567890,
        activeTimestamp: 1234567891,
      },
      {
        id: 'node2',
        publicKey: 'pubkey2',
        externalIp: '192.168.1.2',
        externalPort: 8080,
        internalIp: '10.0.0.2',
        internalPort: 8081,
        address: 'address2',
        joinRequestTimestamp: 1234567892,
        activeTimestamp: 1234567893,
      },
    ]

    it('should return ok(true) when hash matches', () => {
      const expectedHash = hashObj(mockValidatorList)
      const result = verifyValidatorList(mockValidatorList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should return error when hash does not match', () => {
      const wrongHash = 'wronghash123'
      const result = verifyValidatorList(mockValidatorList, wrongHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch for validator list')
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${wrongHash}`)
    })

    it('should handle empty validator list', () => {
      const emptyList: P2P.NodeListTypes.Node[] = []
      const expectedHash = hashObj(emptyList)
      const result = verifyValidatorList(emptyList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should handle validator list with sign property', () => {
      const listWithSign = [...mockValidatorList] as any
      listWithSign.sign = { owner: 'owner', sig: 'signature' }
      const expectedHash = hashObj(listWithSign)
      const result = verifyValidatorList(listWithSign, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })
  })

  describe('verifyStandbyList', () => {
    const mockStandbyList: P2P.JoinTypes.JoinRequest[] = [
      {
        nodeInfo: {
          publicKey: 'pubkey1',
          externalIp: '192.168.1.1',
          externalPort: 8080,
          internalIp: '10.0.0.1',
          internalPort: 8081,
          address: 'address1',
          joinRequestTimestamp: 1234567890,
          activeTimestamp: 0,
        },
        appJoinData: { version: '1.0.0' },
        sign: { owner: 'owner1', sig: 'sig1' },
      },
      {
        nodeInfo: {
          publicKey: 'pubkey2',
          externalIp: '192.168.1.2',
          externalPort: 8080,
          internalIp: '10.0.0.2',
          internalPort: 8081,
          address: 'address2',
          joinRequestTimestamp: 1234567892,
          activeTimestamp: 0,
        },
        appJoinData: { version: '1.0.0' },
        sign: { owner: 'owner2', sig: 'sig2' },
      },
    ]

    it('should return ok(true) when hash matches', () => {
      const expectedHash = hashObj(mockStandbyList)
      const result = verifyStandbyList(mockStandbyList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should return error when hash does not match', () => {
      const wrongHash = 'wronghash456'
      const result = verifyStandbyList(mockStandbyList, wrongHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch for standby list')
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${wrongHash}`)
    })

    it('should handle empty standby list', () => {
      const emptyList: P2P.JoinTypes.JoinRequest[] = []
      const expectedHash = hashObj(emptyList)
      const result = verifyStandbyList(emptyList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })
  })

  describe('verifyArchiverList', () => {
    const mockArchiverList: P2P.ArchiversTypes.JoinedArchiver[] = [
      {
        publicKey: 'archiver1',
        ip: '192.168.1.100',
        port: 4000,
        joinRequestTimestamp: 1234567890,
      },
      {
        publicKey: 'archiver2',
        ip: '192.168.1.101',
        port: 4000,
        joinRequestTimestamp: 1234567891,
      },
    ]

    it('should return ok(true) when hash matches', () => {
      const expectedHash = hashObj(mockArchiverList)
      const result = verifyArchiverList(mockArchiverList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should return error when hash does not match', () => {
      const wrongHash = 'wronghash789'
      const result = verifyArchiverList(mockArchiverList, wrongHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch for archiver list')
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${wrongHash}`)
    })

    it('should handle empty archiver list', () => {
      const emptyList: P2P.ArchiversTypes.JoinedArchiver[] = []
      const expectedHash = hashObj(emptyList)
      const result = verifyArchiverList(emptyList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should handle single archiver in list', () => {
      const singleArchiver: P2P.ArchiversTypes.JoinedArchiver[] = [mockArchiverList[0]]
      const expectedHash = hashObj(singleArchiver)
      const result = verifyArchiverList(singleArchiver, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })
  })

  describe('verifyTxList', () => {
    const mockTxList: P2P.ServiceQueueTypes.NetworkTxEntry[] = [
      {
        hash: 'tx1hash',
        tx: { type: 'transfer', from: 'addr1', to: 'addr2', amount: 100 },
        timestamp: 1234567890,
        cycleNumber: 1,
      } as P2P.ServiceQueueTypes.NetworkTxEntry,
      {
        hash: 'tx2hash',
        tx: { type: 'transfer', from: 'addr2', to: 'addr3', amount: 50 },
        timestamp: 1234567891,
        cycleNumber: 1,
      } as P2P.ServiceQueueTypes.NetworkTxEntry,
    ]

    it('should return ok(true) when hash matches', () => {
      const expectedHash = hashObj(mockTxList)
      const result = verifyTxList(mockTxList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should return error when hash does not match', () => {
      const wrongHash = 'wrongtxhash'
      const result = verifyTxList(mockTxList, wrongHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch for txList')
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${wrongHash}`)
    })

    it('should handle empty tx list', () => {
      const emptyList: P2P.ServiceQueueTypes.NetworkTxEntry[] = []
      const expectedHash = hashObj(emptyList)
      const result = verifyTxList(emptyList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should handle large tx list', () => {
      const largeTxList: P2P.ServiceQueueTypes.NetworkTxEntry[] = []
      for (let i = 0; i < 1000; i++) {
        largeTxList.push({
          hash: `tx${i}hash`,
          tx: { type: 'transfer', from: `addr${i}`, to: `addr${i + 1}`, amount: i },
          timestamp: 1234567890 + i,
          cycleNumber: Math.floor(i / 100),
        } as P2P.ServiceQueueTypes.NetworkTxEntry)
      }
      const expectedHash = hashObj(largeTxList)
      const result = verifyTxList(largeTxList, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })
  })

  describe('verifyCycleRecord', () => {
    const mockCycleRecord: P2P.CycleCreatorTypes.CycleRecord = {
      counter: 1,
      cycleMarker: 'marker1',
      mode: 'forming',
      previous: 'prev1',
      start: 1234567890,
      duration: 60,
      networkConfigHash: 'confighash',
      networkId: 'network1',
      desired: 10,
      activatedPublicKeys: ['key1', 'key2'],
      active: 8,
      activated: 2,
      apoptosized: ['key3'],
      appRemoved: [],
      archiverListHash: 'archiverhash',
      removed: [],
      refuted: [],
      lostSyncing: [],
      joinedArchivers: [],
      refreshedArchivers: [],
      refreshedConsensors: [],
      leavingArchivers: [],
      joinedConsensors: [],
      standbyAdd: [],
      standbyRemove: [],
      standbyNodeListHash: 'standbyhash',
      syncing: 0,
      txlisthash: 'txhash',
      expired: 0,
      joined: [],
      returned: [],
      lost: [],
      lostArchivers: [],
      refutedArchivers: [],
      removedArchivers: [],
    } as P2P.CycleCreatorTypes.CycleRecord

    it('should return ok(true) when hash matches', () => {
      const expectedHash = 'correcthash'
      mockedComputeCycleMarker.mockReturnValue(expectedHash)

      const result = verifyCycleRecord(mockCycleRecord, expectedHash)

      expect(mockedComputeCycleMarker).toHaveBeenCalledWith(mockCycleRecord)
      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should return error when hash does not match', () => {
      const expectedHash = 'expectedhash'
      const actualHash = 'actualhash'
      mockedComputeCycleMarker.mockReturnValue(actualHash)

      const result = verifyCycleRecord(mockCycleRecord, expectedHash)

      expect(mockedComputeCycleMarker).toHaveBeenCalledWith(mockCycleRecord)
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch for cycle')
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${expectedHash}, got ${actualHash}`)
    })

    it('should handle cycle record with minimal fields', () => {
      const minimalCycleRecord = {
        counter: 0,
        cycleMarker: '',
        mode: 'forming',
      } as P2P.CycleCreatorTypes.CycleRecord

      const expectedHash = 'minimalhash'
      mockedComputeCycleMarker.mockReturnValue(expectedHash)

      const result = verifyCycleRecord(minimalCycleRecord, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should handle empty hash strings', () => {
      const expectedHash = ''
      mockedComputeCycleMarker.mockReturnValue('')

      const result = verifyCycleRecord(mockCycleRecord, expectedHash)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toBe(true)
    })

    it('should handle hash case sensitivity', () => {
      const expectedHash = 'ABC123'
      const actualHash = 'abc123'
      mockedComputeCycleMarker.mockReturnValue(actualHash)

      const result = verifyCycleRecord(mockCycleRecord, expectedHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain(`expected ${expectedHash}, got ${actualHash}`)
    })
  })

  describe('Edge cases and error scenarios', () => {
    it('should handle null/undefined in arrays gracefully', () => {
      // Test with arrays containing null/undefined - TypeScript should prevent this,
      // but we're testing runtime behavior
      const invalidList = [null, undefined] as any
      const hash = hashObj(invalidList)

      const result = verifyValidatorList(invalidList, hash)
      expect(result.isOk()).toBe(true)
    })

    it('should handle objects with circular references', () => {
      // Since we're mocking hashObj, we can test that verify functions don't crash with circular refs
      const obj1: any = { id: 'node1' }
      const obj2: any = { id: 'node2', ref: obj1 }
      obj1.ref = obj2 // Create circular reference

      const list = [obj1, obj2] as any

      // Our mock hashObj won't have issues with circular refs
      // Test that the verify function handles it gracefully
      const result = verifyValidatorList(list, 'some_hash')
      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch')
    })

    it('should handle very long hash strings', () => {
      const longHash = 'a'.repeat(1000)
      const result = verifyValidatorList([], longHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch')
    })

    it('should handle special characters in hash', () => {
      const specialHash = '!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\`~'
      const result = verifyValidatorList([], specialHash)

      expect(result.isErr()).toBe(true)
      expect(result._unsafeUnwrapErr().message).toContain('hash mismatch')
    })
  })
})
