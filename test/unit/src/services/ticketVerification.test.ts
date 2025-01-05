import { verifyMultiSigs, verifyTickets, VerificationConfig } from '../../../../src/services/ticketVerification'
import { DevSecurityLevel } from '../../../../src/types/security'
import { Utils } from '@shardeum-foundation/lib-types'
import { ethers } from 'ethers'

describe('Ticket Verification Service', () => {
    // Create real wallets for testing with valid private keys
    const signer1 = new ethers.Wallet('0x' + '1'.repeat(64));
    const signer2 = new ethers.Wallet('0x' + '2'.repeat(64));
    const signer3 = new ethers.Wallet('0x' + '3'.repeat(64));

    const mockConfig: VerificationConfig = {
        allowedTicketSigners: {
            [signer1.address]: DevSecurityLevel.HIGH,
            [signer2.address]: DevSecurityLevel.HIGH
        },
        minSigRequired: 1,
        requiredSecurityLevel: DevSecurityLevel.HIGH
    };

    const mockPayload = {
        type: "silver",
        data: [{ address: ethers.Wallet.createRandom().address }]
    };

    async function createSignature(wallet: ethers.Wallet, payload: object): Promise<string> {
        // Convert payload to string in a deterministic way and hash it
        const message = Utils.safeStringify(payload);
        const hash = ethers.keccak256(ethers.toUtf8Bytes(message));
        // Sign the hash directly
        return wallet.signMessage(hash);
    }

    let mockValidSigs: { owner: string; sig: string }[];

    beforeEach(async () => {
        // Create real signature for the payload
        const sig = await createSignature(signer1, mockPayload);
        mockValidSigs = [{
            owner: signer1.address,
            sig
        }];
    });

    describe('verifyMultiSigs', () => {

        it('should return false if signatures count is less than required', async () => {
            const config = { ...mockConfig, minSigRequired: 2 };
            const sig = await createSignature(signer1, mockPayload);
            const sigs = [{
                owner: signer1.address,
                sig
            }];
            const result = verifyMultiSigs(mockPayload, sigs, config.allowedTicketSigners, config.minSigRequired, config.requiredSecurityLevel);
            expect(result.isValid).toBe(false);
            expect(result.validCount).toBe(0); // we early return if signatures count is less than required
        });

        it('should return false if signatures count exceeds allowed signers', async () => {
            const sig1 = await createSignature(signer1, mockPayload);
            const sig2 = await createSignature(signer2, mockPayload);
            const sig3 = await createSignature(signer3, mockPayload);
            
            const extraSigs = [
                { owner: signer1.address, sig: sig1 },
                { owner: signer2.address, sig: sig2 },
                { owner: signer3.address, sig: sig3 }
            ];
            const result = verifyMultiSigs(mockPayload, extraSigs, mockConfig.allowedTicketSigners, mockConfig.minSigRequired, mockConfig.requiredSecurityLevel);
            expect(result.isValid).toBe(false);
        });

        it('should verify signatures correctly', async () => {
            const sig = await createSignature(signer1, mockPayload);
            const sigs = [{
                owner: signer1.address,
                sig
            }];
            const result = verifyMultiSigs(mockPayload, sigs, mockConfig.allowedTicketSigners, mockConfig.minSigRequired, mockConfig.requiredSecurityLevel);
            expect(result.isValid).toBe(true);
            expect(result.validCount).toBe(1);
        });

        it('should handle duplicate signers', async () => {
            const sig = await createSignature(signer1, mockPayload);
            const duplicateSigs = [
                { owner: signer1.address, sig },
                { owner: signer1.address, sig }
            ];
            const result = verifyMultiSigs(mockPayload, duplicateSigs, mockConfig.allowedTicketSigners, mockConfig.minSigRequired, mockConfig.requiredSecurityLevel);
            expect(result.isValid).toBe(true);
            expect(result.validCount).toBe(1);
        });
    });

    describe('verifyTickets', () => {
        let mockValidTicket: any;

        beforeEach(async () => {
            const ticketData = {
                data: [{ address: ethers.Wallet.createRandom().address }],
                type: "silver"
            };
            const sig = await createSignature(signer1, ticketData);
            mockValidTicket = {
                ...ticketData,
                sign: [{
                    owner: signer1.address,
                    sig
                }]
            };
        });

        it('should validate schema', () => {
            const invalidTicket = {
                data: [{ invalid: "field" }],
                sign: mockValidSigs,
                type: "silver"
            };
            const result = verifyTickets([invalidTicket as any], mockConfig);
            expect(result.isValid).toBe(false);
            expect(result.errors[0].type).toBe('schema');
        });

        it('should verify valid tickets', async () => {
            const ticketData = {
                data: [{ address: ethers.Wallet.createRandom().address }],
                type: "silver"
            };
            const sig = await createSignature(signer1, ticketData);
            const validTicket = {
                ...ticketData,
                sign: [{
                    owner: signer1.address,
                    sig
                }]
            };
            const result = verifyTickets([validTicket], mockConfig);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should handle invalid signatures', async () => {
            const invalidSig = await createSignature(signer3, mockPayload);
            const invalidTicket = {
                ...mockValidTicket,
                sign: [{
                    owner: signer3.address,
                    sig: invalidSig
                }]
            };
            const result = verifyTickets([invalidTicket], mockConfig);
            expect(result.isValid).toBe(false);
            expect(result.errors[0].type).toBe('silver');
            expect(result.errors[0].validSignatures).toBe(0);
        });

        it('should verify multiple tickets', async () => {
            const ticketData = {
                data: [{ address: ethers.Wallet.createRandom().address }],
                type: "silver"
            };
            const sig = await createSignature(signer1, ticketData);
            const validTicket = {
                ...ticketData,
                sign: [{
                    owner: signer1.address,
                    sig
                }]
            };
            const tickets = [validTicket, validTicket];
            const result = verifyTickets(tickets, mockConfig);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should handle mixed valid and invalid tickets', async () => {
            const invalidTicket = {
                ...mockValidTicket,
                type: "gold"
            };
            
            const tickets = [mockValidTicket, invalidTicket];
            const result = verifyTickets(tickets, mockConfig);
            expect(result.isValid).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].type).toBe('schema');
        });
    });
}); 