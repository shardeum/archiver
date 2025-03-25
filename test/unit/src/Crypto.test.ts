import * as Crypto from '../../../src/Crypto'
import * as State from '../../../src/State'
import { publicKey } from '@shardeum-foundation/lib-crypto-utils'
import { init } from '@shardeum-foundation/lib-crypto-utils'

// Mock State module
jest.mock('../../../src/State', () => ({
    getSecretKey: jest.fn(),
    getNodeInfo: jest.fn(),
    getCurveSk: jest.fn()
}))

describe('Crypto', () => {
    const mockSecretKey = '3be00019f23847529bd63e41124864983175063bb524bd54ea3c155f2fa12969758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
    const mockPublicKey = '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
    const mockCurveSk = '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc'
    const mockNodeInfo = { publicKey: mockPublicKey }
    init('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
    beforeEach(() => {
        jest.clearAllMocks()
            ; (State.getSecretKey as jest.Mock).mockReturnValue(mockSecretKey)
            ; (State.getNodeInfo as jest.Mock).mockReturnValue(mockNodeInfo)
            ; (State.getCurveSk as jest.Mock).mockReturnValue(mockCurveSk)
        Crypto.setCryptoHashKey('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
    })

    describe('setCryptoHashKey', () => {
        it('should set crypto hash key without throwing error', () => {
            expect(() => {
                Crypto.setCryptoHashKey('69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc')
            }).not.toThrow()
        })

        it('should throw error for empty hash key', () => {
            expect(() => {
                Crypto.setCryptoHashKey('')
            }).toThrow()
        })

        it('should throw error for hash key not being 32 bytes', () => {
            expect(() => {
                Crypto.setCryptoHashKey('shortHashKey')
            }).toThrow()
        })
    })

    describe('hash and hashObj', () => {
        it('should hash a string correctly', () => {
            const input = 'test'
            const hash = Crypto.hash(input)
            expect(typeof hash).toBe('string')
            expect(hash.length).toBeGreaterThan(0)
        })

        it('should hash an object correctly', () => {
            const input = { test: 'value' }
            const hash = Crypto.hashObj(input)
            expect(typeof hash).toBe('string')
            expect(hash.length).toBeGreaterThan(0)
        })

        it('should produce consistent hashes for same input', () => {
            const input = 'test'
            const hash1 = Crypto.hash(input)
            const hash2 = Crypto.hash(input)
            expect(hash1).toBe(hash2)
        })
    })
    describe('sign and verify', () => {
        const testObj = { data: 'test' }

        it('should sign an object and return signed object', () => {
            const signedObj = Crypto.sign(testObj)
            expect(signedObj).toHaveProperty('sign')
            expect(signedObj).toHaveProperty('sign.owner')
            expect(signedObj).toHaveProperty('sign.sig')
            expect(signedObj.data).toBe(testObj.data)
        })

        it('should verify a correctly signed object', () => {
            const signedObj = Crypto.sign(testObj)
            const isValid = Crypto.verify(signedObj)
            expect(isValid).toBe(true)
        })

        it('should fail verification for tampered object', () => {
            const signedObj = Crypto.sign(testObj)
            signedObj.data = 'tampered'
            const isValid = Crypto.verify(signedObj)
            expect(isValid).toBe(false)
        })

        it('should handle empty object signing', () => {
            const emptyObj = {}
            const signedObj = Crypto.sign(emptyObj)
            expect(signedObj).toHaveProperty('sign')
            expect(signedObj).toHaveProperty('sign.owner')
            expect(signedObj).toHaveProperty('sign.sig')
        })
    })

    describe('getOrCreateCurvePk', () => {
        it('should create and cache curve public key', () => {
            const pk = mockPublicKey as publicKey
            const curvePk1 = Crypto.getOrCreateCurvePk(pk)
            const curvePk2 = Crypto.getOrCreateCurvePk(pk)

            expect(curvePk1).toBeDefined()
            expect(curvePk1).toBe(curvePk2) // Should return cached value
        })

        it('should handle different public keys', () => {
            const pk1 = mockPublicKey as publicKey
            const pk2 = 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' as publicKey

            const curvePk1 = Crypto.getOrCreateCurvePk(pk1)
            const curvePk2 = Crypto.getOrCreateCurvePk(pk2)

            expect(curvePk1).not.toBe(curvePk2) // Different keys should give different curve pk
        })
    })

    describe('getOrCreateSharedKey', () => {
        it('should create and cache shared key', () => {
            const pk = mockPublicKey as publicKey
            const sharedKey1 = Crypto.getOrCreateSharedKey(pk)
            const sharedKey2 = Crypto.getOrCreateSharedKey(pk)

            expect(sharedKey1).toBeDefined()
            expect(sharedKey1).toEqual(sharedKey2) // Changed toBe to toEqual for Buffer comparison
        })

        it('should handle different recipient public keys', () => {
            const pk1 = mockPublicKey as publicKey
            const pk2 = 'e8a5c26b9e2c3c31eb7c7d73eaed9484374c16d983ce95f3ab18a62521964a94' as publicKey

            const sharedKey1 = Crypto.getOrCreateSharedKey(pk1)
            const sharedKey2 = Crypto.getOrCreateSharedKey(pk2)

            expect(sharedKey1).not.toEqual(sharedKey2) // Different keys should give different shared keys
        })
    })

    describe('tag and authenticate', () => {
        const testObj = { data: 'test' }
        const recipientPk = mockPublicKey as publicKey

        it('should tag an object and return tagged message', () => {
            const taggedMsg = Crypto.tag(testObj, recipientPk)
            expect(taggedMsg).toHaveProperty('tag')
            expect(taggedMsg).toHaveProperty('publicKey')
            expect(taggedMsg.data).toBe(testObj.data)
        })

        it('should authenticate a correctly tagged message', () => {
            const taggedMsg = Crypto.tag(testObj, recipientPk)
            const isValid = Crypto.authenticate(taggedMsg)
            expect(isValid).toBe(true)
        })

        it('should fail authentication for tampered message', () => {
            const taggedMsg = Crypto.tag(testObj, recipientPk)
            taggedMsg.data = 'tampered'
            const isValid = Crypto.authenticate(taggedMsg)
            expect(isValid).toBe(false)
        })

        it('should handle empty object tagging', () => {
            const emptyObj = {}
            const taggedMsg = Crypto.tag(emptyObj, recipientPk)
            expect(taggedMsg).toHaveProperty('tag')
            expect(taggedMsg).toHaveProperty('publicKey')
        })

        it('should handle complex nested objects', () => {
            const complexObj = {
                data: 'test',
                nested: {
                    array: [1, 2, 3],
                    object: {
                        value: true
                    }
                }
            }
            const taggedMsg = Crypto.tag(complexObj, recipientPk)
            expect(taggedMsg).toHaveProperty('tag')
            const isValid = Crypto.authenticate(taggedMsg)
            expect(isValid).toBe(true)
        })
    })
}) 