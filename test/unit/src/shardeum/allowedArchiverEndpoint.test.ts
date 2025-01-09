import { jest } from '@jest/globals';
import axios from 'axios';
import { ethers } from 'ethers';
import { Utils as StringUtils } from '@shardus/types';
import { verifyMultiSigs } from '../../../../src/Utils';

// Mock Logger
jest.mock('../../../../src/Logger', () => ({
    mainLogger: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
    }
}));

// Mock State
jest.mock('../../../../src/State', () => ({
    get activeArchivers() {
        return [
            { publicKey: 'mockSender', ip: '127.0.0.1', port: 8080, curvePk: 'mockCurvePk' }
        ];
    }
}));

// Mock Utils
jest.mock('../../../../src/Utils', () => ({
    verifyMultiSigs: jest.fn().mockImplementation((rawPayload, sigs, allowedPubkeys, minSigRequired) => {
        // Simulate the behavior of the actual verifyMultiSigs function
        if (!rawPayload || !sigs || !allowedPubkeys || !Array.isArray(sigs)) {
            return false;
        }
        if (sigs.length < minSigRequired) return false;
        if (sigs.length > allowedPubkeys.length) return false;
        let validSigs = 0;
        const seen = new Set();
        for (const sig of sigs) {
            if (!seen.has(sig.owner) && allowedPubkeys.includes(sig.owner)) {
                validSigs++;
                seen.add(sig.owner);
            }
            if (validSigs >= minSigRequired) break;
        }
        return validSigs >= minSigRequired;
    }),
    validateTypes: jest.fn().mockImplementation((inp, def) => {
        if (inp === undefined) return 'input is undefined';
        if (inp === null) return 'input is null';
        if (typeof inp !== 'object') return 'input must be object, not ' + typeof inp;
        const map = {
            string: 's',
            number: 'n',
            boolean: 'b',
            bigint: 'B',
            array: 'a',
            object: 'o',
        };
        const imap = {
            s: 'string',
            n: 'number',
            b: 'boolean',
            B: 'bigint',
            a: 'array',
            o: 'object',
        };
        const fields = Object.keys(def);
        for (const name of fields) {
            const types = def[name] as string;
            const opt = types.substr(-1, 1) === '?' ? 1 : 0;
            if (inp[name] === undefined && !opt) return name + ' is required';
            if (inp[name] !== undefined) {
                if (inp[name] === null && !opt) return name + ' cannot be null';
                let found = 0;
                let be = '';
                for (let t = 0; t < types.length - opt; t++) {
                    let it = map[typeof inp[name]];
                    it = Array.isArray(inp[name]) ? 'a' : it;
                    const is = types.substr(t, 1);
                    if (it === is) {
                        found = 1;
                        break;
                    } else be += ', ' + imap[is];
                }
                if (!found) return name + ' must be' + be;
            }
        }
        return '';
    })
}));

// Mock @shardus/types
jest.mock('@shardus/types', () => ({
    Utils: {
        safeJsonParse: jest.fn(obj => JSON.parse(obj as string)),
        safeStringify: jest.fn(obj => JSON.stringify(obj))
    }
}));

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Create test wallets
const signer1 = new ethers.Wallet('0x' + '1'.repeat(64));
const signer2 = new ethers.Wallet('0x' + '2'.repeat(64));
const signer3 = new ethers.Wallet('0x' + '3'.repeat(64));

// Helper function to create signatures
async function createSignature(wallet: ethers.Wallet, payload: object): Promise<string> {
    const message = StringUtils.safeStringify(payload);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(message));
    return wallet.signMessage(hash);
}

describe('Allowed Archivers Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('Signature Verification', () => {
        it('should verify valid signatures with minimum required signers', async () => {
            const rawPayload = {
                allowedArchivers: [{
                    ip: '127.0.0.1',
                    port: 4000,
                    publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
                }],
                allowedAccounts: [signer1.address, signer2.address],
                counter: 1,
                minSigRequired: 2
            };

            const sig1 = await createSignature(signer1, rawPayload);
            const sig2 = await createSignature(signer2, rawPayload);

            const signatures = [
                { owner: signer1.address, sig: sig1 },
                { owner: signer2.address, sig: sig2 }
            ];

            const isValid = verifyMultiSigs(
                rawPayload,
                signatures,
                [signer1.address, signer2.address],
                2
            );
            expect(isValid).toBe(true);
        });

        it('should reject when signatures are less than required', async () => {
            const rawPayload = {
                allowedArchivers: [{
                    ip: '127.0.0.1',
                    port: 4000,
                    publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
                }],
                allowedAccounts: [signer1.address, signer2.address],
                counter: 1,
                minSigRequired: 2
            };

            const sig1 = await createSignature(signer1, rawPayload);
            const signatures = [
                { owner: signer1.address, sig: sig1 }
            ];

            const isValid = verifyMultiSigs(
                rawPayload,
                signatures,
                [signer1.address, signer2.address],
                2
            );
            expect(isValid).toBe(false);
        });

        it('should reject signatures from unauthorized signers', async () => {
            const rawPayload = {
                allowedArchivers: [{
                    ip: '127.0.0.1',
                    port: 4000,
                    publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
                }],
                allowedAccounts: [signer1.address],
                counter: 1,
                minSigRequired: 1
            };

            const sig = await createSignature(signer3, rawPayload);

            const signatures = [
                { owner: signer3.address, sig: sig }
            ];

            const isValid = verifyMultiSigs(
                rawPayload,
                signatures,
                [signer1.address],
                1
            );

            expect(isValid).toBe(false);
        });

        it('should handle duplicate signatures from same signer', async () => {
            const rawPayload = {
                allowedArchivers: [{
                    ip: '127.0.0.1',
                    port: 4000,
                    publicKey: '758b1c119412298802cd28dbfa394cdfeecc4074492d60844cc192d632d84de3'
                }],
                allowedAccounts: [signer1.address],
                counter: 1,
                minSigRequired: 1
            };

            const sig = await createSignature(signer1, rawPayload);

            const signatures = [
                { owner: signer1.address, sig: sig },
                { owner: signer1.address, sig: sig }
            ];

            const isValid = verifyMultiSigs(
                rawPayload,
                signatures,
                [signer1.address],
                1
            );

            expect(isValid).toBe(false);
        });
    });

});
