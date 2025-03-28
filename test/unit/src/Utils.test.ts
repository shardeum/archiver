import * as Utils from '../../../src/Utils'
import { DevSecurityLevel } from '../../../src/types/security'
import { Sign } from '../../../src/types/internalTxType'
import { Wallet } from 'ethers'
import { safeStringify } from '@shardeum-foundation/lib-types/build/src/utils/functions/stringify'
import * as fs from 'fs'
import * as crypto from '@shardeum-foundation/lib-crypto-utils'

// Mock Logger.mainLogger to avoid errors
jest.mock('../../../src/Logger', () => ({
  mainLogger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

describe('Utils', () => {
  describe('getRandom', () => {
    it('should return n random elements from array', () => {
      const arr = [1, 2, 3, 4, 5]
      const result = Utils.getRandom(arr, 3)
      expect(result).toHaveLength(3)
      result.forEach((item) => expect(arr).toContain(item))
    })

    it('should return all elements if n > array length', () => {
      const arr = [1, 2, 3]
      const result = Utils.getRandom(arr, 5)
      expect(result).toHaveLength(3)
      expect(result.sort()).toEqual(arr.sort())
    })

    it('should handle empty array', () => {
      const result = Utils.getRandom([], 3)
      expect(result).toHaveLength(0)
    })
  })

  describe('shuffleArray', () => {
    it('should shuffle array in place', () => {
      const arr = [1, 2, 3, 4, 5]
      const original = [...arr]
      Utils.shuffleArray(arr)
      expect(arr).toEqual(expect.arrayContaining(original))
      expect(arr).not.toEqual(original)
    })

    it('should handle empty array', () => {
      const arr: number[] = []
      Utils.shuffleArray(arr)
      expect(arr).toEqual([])
    })

    it('should handle single element array', () => {
      const arr = [1]
      Utils.shuffleArray(arr)
      expect(arr).toEqual([1])
    })
  })

  describe('robustPromiseAll', () => {
    it('should resolve all successful promises', async () => {
      const promises = [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]
      const [resolved, errors] = await Utils.robustPromiseAll(promises)
      expect(resolved).toEqual([1, 2, 3])
      expect(errors).toHaveLength(0)
    })

    it('should handle mixed success and failures', async () => {
      const promises = [Promise.resolve(1), Promise.reject(new Error('test error')), Promise.resolve(3)]
      const [resolved, errors] = await Utils.robustPromiseAll(promises)
      expect(resolved).toEqual([1, 3])
      expect(errors).toHaveLength(1)
      expect(errors[0].message).toEqual('test error')
    })

    it('should handle all rejected promises', async () => {
      const promises = [Promise.reject(new Error('error1')), Promise.reject(new Error('error2'))]
      const [resolved, errors] = await Utils.robustPromiseAll(promises)
      expect(resolved).toEqual([])
      expect(errors).toHaveLength(2)
    })
  })

  /*
    TODO: Fix the computeMedian function
    It returns the wrong median for both sorted array and unsorted array
  */
  describe('computeMedian', () => {
    it.skip('should compute median for odd length array', () => {
      expect(Utils.computeMedian([1, 2, 3])).toEqual(2)
    })

    it.skip('should compute median for even length array', () => {
      expect(Utils.computeMedian([1, 2, 3, 4])).toEqual(2.5)
    })

    it('should handle empty array', () => {
      expect(Utils.computeMedian([])).toEqual(0)
    })

    it('should handle single element array', () => {
      expect(Utils.computeMedian([5])).toEqual(5)
    })

    it.skip('should handle unsorted array', () => {
      expect(Utils.computeMedian([3, 1, 4, 2], false)).toEqual(2.5)
    })
  })

  describe('binarySearch', () => {
    it('should find existing element', () => {
      const arr = [1, 2, 3, 4, 5]
      expect(Utils.binarySearch(arr, 3)).toEqual(2)
    })

    /*
            Returns -6 for non-existing element
        */
    it.skip('should return -1 for non-existing element', () => {
      const arr = [1, 2, 3, 4, 5]
      expect(Utils.binarySearch(arr, 6)).toEqual(-1)
    })

    it('should work with custom comparator', () => {
      const arr = [{ val: 1 }, { val: 2 }, { val: 3 }]
      const comparator = (a: { val: number }, b: { val: number }) => a.val - b.val
      expect(Utils.binarySearch(arr, { val: 2 }, comparator)).toEqual(1)
    })
  })

  describe('validateTypes', () => {
    it('should validate correct types', () => {
      const input = { num: 42, str: 'test', bool: true }
      const def = { num: 'number', str: 'string', bool: 'boolean' }
      expect(Utils.validateTypes(input, def)).toEqual('')
    })

    it('should detect type mismatches', () => {
      const input = { num: '42' }
      const def = { num: 'number' }
      expect(Utils.validateTypes(input, def)).toContain(
        'num must be, number, undefined, undefined, boolean, undefined, undefined'
      )
    })

    it('should handle missing properties', () => {
      const input = { num: 42 }
      const def = { num: 'number', str: 'string' }
      expect(Utils.validateTypes(input, def)).toContain('str is required')
    })
  })

  describe('isUndefined', () => {
    it('should return true for undefined', () => {
      expect(Utils.isUndefined(undefined)).toBe(true)
    })

    it('should return false for null', () => {
      expect(Utils.isUndefined(null)).toBe(false)
    })

    it('should return false for other values', () => {
      expect(Utils.isUndefined(0)).toBe(false)
      expect(Utils.isUndefined('')).toBe(false)
      expect(Utils.isUndefined({})).toBe(false)
    })
  })

  describe('attempt', () => {
    it('should resolve on successful attempt', async () => {
      const result = await Utils.attempt(async () => 'success')
      expect(result).toEqual('success')
    })
  })

  describe('verifyMultiSigs', () => {
    const requiredSigs = 1
    const objectToSign = { type: 'test', data: [{ address: '0xd79eFA2f9bB9C780e4Ce05D6b8a15541915e4636' }] }
    const testWallet = new Wallet('0x1234567890123456789012345678901234567890123456789012345678901234')
    const testAddress = testWallet.address
    const devPublicKeys = {
      [testAddress]: DevSecurityLevel.HIGH,
    }

    const getTestSignatureObject = async (): Promise<Sign> => {
      const messageToSign = safeStringify(objectToSign)
      const signature = await testWallet.signMessage(messageToSign)
      return {
        owner: testAddress,
        sig: signature,
      }
    }

    /*
            Fix the verifyMultiSigs: Sign the payload instead of hash of the payload
            Already reported: SHARD-2110
        */
    it.skip('should return true', async () => {
      const signatureObject = await getTestSignatureObject()
      const isValidSig = Utils.verifyMultiSigs(
        objectToSign,
        [signatureObject],
        devPublicKeys,
        requiredSigs,
        DevSecurityLevel.HIGH
      )

      expect(isValidSig.isValid).toBe(true)
      expect(isValidSig.validCount).toEqual(1)
    })

    it('should return false because of invalid payload', async () => {
      const isValidSig = Utils.verifyMultiSigs(
        { type: 'gold', data: [{ address: '0x01' }] },
        [await getTestSignatureObject()],
        devPublicKeys,
        requiredSigs,
        DevSecurityLevel.HIGH
      )

      expect(isValidSig.isValid).toBe(false)
    })

    it('should return false because of signer is not a multi sig signer', async () => {
      const isValidSig = Utils.verifyMultiSigs(
        objectToSign,
        [await getTestSignatureObject()],
        { '0x1e5e12568b7103E8B22cd680A6fa6256DD66ED76': DevSecurityLevel.HIGH },
        requiredSigs,
        DevSecurityLevel.HIGH
      )

      expect(isValidSig.isValid).toBe(false)
    })

    it('should return false if no signatures provided', () => {
      const isValidSig = Utils.verifyMultiSigs(objectToSign, [], devPublicKeys, requiredSigs, DevSecurityLevel.HIGH)

      expect(isValidSig.isValid).toBe(false)
      expect(isValidSig.validCount).toBe(0)
    })

    it('should return false if security level is insufficient', async () => {
      const isValidSig = Utils.verifyMultiSigs(
        objectToSign,
        [await getTestSignatureObject()],
        { [testAddress]: DevSecurityLevel.MEDIUM },
        requiredSigs,
        DevSecurityLevel.HIGH
      )

      expect(isValidSig.isValid).toBe(false)
    })

    it('should return false if not enough valid signatures', async () => {
      const isValidSig = Utils.verifyMultiSigs(
        objectToSign,
        [await getTestSignatureObject()],
        devPublicKeys,
        2, // Require 2 signatures
        DevSecurityLevel.HIGH
      )

      expect(isValidSig.isValid).toBe(false)
      expect(isValidSig.validCount).toBe(0)
    })
  })

  describe('sequentialQuery', () => {
    it('should query nodes sequentially until verification passes', async () => {
      const nodes = ['node1', 'node2', 'node3']
      const queryFn = jest
        .fn()
        .mockImplementationOnce(() => Promise.resolve('fail'))
        .mockImplementationOnce(() => Promise.resolve('success'))
        .mockImplementationOnce(() => Promise.resolve('not needed'))
      const verifyFn = (result) => result === 'success'
      const result = await Utils.sequentialQuery(nodes, queryFn, verifyFn)
      expect(queryFn).toHaveBeenCalledTimes(3)
      expect(result.result).toBe('success')
    })

    it('should handle all failed queries', async () => {
      const nodes = ['node1', 'node2']
      const queryFn = jest.fn().mockImplementation(() => Promise.resolve('fail'))

      const verifyFn = (result) => result === 'success'

      const result = await Utils.sequentialQuery(nodes, queryFn, verifyFn)

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(result.result).toBeUndefined()
      expect(result.errors).toHaveLength(2)
    })

    it('should handle query errors', async () => {
      const nodes = ['node1', 'node2']
      const queryError = new Error('query failed')
      const queryFn = jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(queryError))
        .mockImplementationOnce(() => Promise.resolve('success'))

      const verifyFn = (result) => result === 'success'

      const result = await Utils.sequentialQuery(nodes, queryFn, verifyFn)

      expect(queryFn).toHaveBeenCalledTimes(2)
      expect(result.result).toBe('success')
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toBe(queryError)
    })
  })

  describe('deepCopy', () => {
    it('should create a deep copy of an object', () => {
      const original = {
        a: 1,
        b: { c: 2 },
        d: [1, 2, { e: 3 }],
      }

      const copy = Utils.deepCopy(original)

      expect(copy).toEqual(original)
      expect(copy).not.toBe(original)
      expect(copy.b).not.toBe(original.b)
      expect(copy.d).not.toBe(original.d)
      expect(copy.d[2]).not.toBe(original.d[2])
    })
  })

  describe('insertSorted', () => {
    it('should insert item in correct position with default comparator', () => {
      const arr = [1, 3, 5]
      Utils.insertSorted(arr, 4)
      expect(arr).toEqual([1, 3, 4, 5])
    })

    it('should insert item in correct position with custom comparator', () => {
      const arr = [{ val: 1 }, { val: 3 }, { val: 5 }]
      Utils.insertSorted(arr, { val: 4 }, (a, b) => a.val - b.val)
      expect(arr).toEqual([{ val: 1 }, { val: 3 }, { val: 4 }, { val: 5 }])
    })

    it('should handle empty arrays', () => {
      const arr = []
      Utils.insertSorted(arr, 1)
      expect(arr).toEqual([1])
    })
  })

  describe('getRandomItemFromArr', () => {
    it('should return n random items', () => {
      const arr = [1, 2, 3, 4, 5]
      const result = Utils.getRandomItemFromArr(arr, 0, 2)

      // Add proper checks to handle possible undefined result
      if (result) {
        expect(result).toHaveLength(2)
        result.forEach((item) => expect(arr).toContain(item))
      } else {
        fail('Result should not be undefined')
      }
    })

    it('should return undefined for empty array', () => {
      expect(Utils.getRandomItemFromArr([], 0, 2)).toBeUndefined()
    })
  })

  describe('sleep', () => {
    it('should wait for specified time', async () => {
      jest.useFakeTimers()

      const sleepPromise = Utils.sleep(100)

      // Fast-forward time
      jest.advanceTimersByTime(100)

      const result = await sleepPromise
      expect(result).toBe(true)

      jest.useRealTimers()
    })
  })

  describe('byIdAsc', () => {
    it('should sort objects by id ascending', () => {
      const a = { id: 1 }
      const b = { id: 2 }

      expect(Utils.byIdAsc(a, b)).toBe(-1)
      expect(Utils.byIdAsc(b, a)).toBe(1)
      expect(Utils.byIdAsc(a, a)).toBe(0)
    })
  })

  describe('createDirectories', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'mkdirSync').mockImplementation()
    })

    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('should create directories recursively', () => {
      const fsExistsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false)

      Utils.createDirectories('/test/path')

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
      fsExistsSyncSpy.mockRestore()
    })
  })

  describe('generateTxId', () => {
    crypto.init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')

    it('should generate unique id for transaction object', () => {
      const tx = {
        raw: '0x1234567890123456789012345678901234567890123456789012345678901234',
      }
      const txId = Utils.generateTxId(tx)
      expect(txId).toBeDefined()
      expect(txId).toBe('309e2f767fd559e65938c1a85703567c26acff72e690ef709701d19fcd13530e')
    })

    it('should generate different ids for different transaction objects', () => {
      const tx1 = { raw: '0x1234567890123456789012345678901234567890123456789012345678901234' }
      const tx2 = { raw: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef' }
      const txId1 = Utils.generateTxId(tx1)
      const txId2 = Utils.generateTxId(tx2)
      expect(txId1).not.toEqual(txId2)
    })

    it('should handle transaction object without raw property', () => {
      const tx = { data: 'some data' }
      const txId = Utils.generateTxId(tx)
      expect(txId).toBeDefined()
    })

    it('should throw an error for invalid transaction object', () => {
      const tx = null
      expect(() => Utils.generateTxId(tx)).toThrow()
    })
  })

  describe('robustQuery', () => {
    it('should throw if no nodes provided', async () => {
      const queryFn = jest.fn()
      await expect(Utils.robustQuery([], queryFn)).rejects.toThrow('No nodes given.')
    })

    it('should throw if invalid queryFn provided', async () => {
      const nodes = ['node1', 'node2']
      const invalidQueryFn = 'not a function' as any
      await expect(Utils.robustQuery(nodes, invalidQueryFn)).rejects.toThrow('Provided queryFn')
    })

    it('should query nodes until finding redundant matching responses', async () => {
      const nodes = ['node1', 'node2', 'node3']
      const expectedResponse = 'valid response'
      const queryFn = jest.fn().mockResolvedValue(expectedResponse)

      const result = await Utils.robustQuery(nodes, queryFn)

      expect(result).toEqual({
        value: expectedResponse,
        count: 3,
        nodes: expect.arrayContaining(['node1', 'node2', 'node3']),
      })
      expect(queryFn).toHaveBeenCalledTimes(3)
    })

    it('should handle node errors gracefully', async () => {
      const nodes = ['node1', 'node2', 'node3', 'node4']
      const queryFn = jest.fn().mockRejectedValueOnce(new Error('Node error')).mockResolvedValue('response1')

      const result = await Utils.robustQuery(nodes, queryFn)

      expect(result).toEqual({
        value: 'response1',
        count: 3,
        nodes: expect.any(Array),
      })
      expect(queryFn).toHaveBeenCalledTimes(4)
    })

    it('should use custom equality function if provided', async () => {
      const nodes = ['node1', 'node2', 'node3']
      const response = { id: 1, data: 'a' }
      const queryFn = jest.fn().mockResolvedValue(response)
      const customEqualityFn = (a: any, b: any) => a.id === b.id

      const result = await Utils.robustQuery(nodes, queryFn, customEqualityFn)

      expect(result).toEqual({
        value: response,
        count: 3,
        nodes: expect.arrayContaining(['node1', 'node2', 'node3']),
      })
    })

    it('should respect redundancy parameter', async () => {
      const nodes = ['node1', 'node2', 'node3', 'node4', 'node5']
      const queryFn = jest.fn().mockResolvedValue('response')

      const result = await Utils.robustQuery(nodes, queryFn, undefined, 2)

      expect(result).toEqual({
        value: 'response',
        count: 2,
        nodes: expect.any(Array),
      })
      expect(result.nodes).toHaveLength(2)
    })

    it('should return best result when redundancy not reached', async () => {
      const nodes = ['node1', 'node2']
      const queryFn = jest.fn().mockResolvedValueOnce('response1').mockResolvedValueOnce('response2')

      const result = await Utils.robustQuery(nodes, queryFn, undefined, 3)

      expect(result).toEqual({
        value: expect.any(String),
        count: 1,
        nodes: expect.any(Array),
      })
      expect(result.nodes).toHaveLength(1)
    })

    it('should apply delay when querying nodes', async () => {
      jest.useFakeTimers()
      const nodes = ['node1', 'node2', 'node3', 'node4']
      const queryFn = jest.fn().mockResolvedValue('response')
      const delayTimeInMS = 100

      const queryPromise = Utils.robustQuery(nodes, queryFn, undefined, 3, false, delayTimeInMS)

      // Fast forward time to simulate delay
      jest.advanceTimersByTime(delayTimeInMS)

      const result = await queryPromise

      expect(result).toEqual({
        value: 'response',
        count: 3,
        nodes: expect.any(Array),
      })

      jest.useRealTimers()
    })

    it('should shuffle nodes when shuffleNodes is true', async () => {
      const nodes = ['node1', 'node2', 'node3', 'node4', 'node5']
      const queryFn = jest.fn().mockResolvedValue('response')

      const result = await Utils.robustQuery(nodes, queryFn, undefined, 3, true)

      expect(result).toEqual({
        value: 'response',
        count: 3,
        nodes: expect.any(Array),
      })
      // Verify that at least 3 nodes were queried
      expect(result.nodes.length).toBeGreaterThanOrEqual(3)
    })
  })
})
