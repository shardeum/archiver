import { ethers } from 'ethers'
import { Utils } from '@shardus/types'
import { Ticket, Sign } from '../schemas/ticketSchema'
import { DevSecurityLevel } from '../types/security'
import * as Ajv from 'ajv'
import { ticketSchema } from '../schemas/ticketSchema'

export interface VerificationError {
    type: string;
    message: string;
    validSignatures: number;
}

export interface VerificationConfig {
    allowedTicketSigners: { [pubkey: string]: DevSecurityLevel };
    minSigRequired: number;
    requiredSecurityLevel: DevSecurityLevel;
}

const ajv = new Ajv({ allErrors: true })
const validateTicketSchema = ajv.compile(ticketSchema)

function validateVerificationConfig(config: VerificationConfig): void {
    if (!config.allowedTicketSigners || typeof config.allowedTicketSigners !== 'object') {
        throw new Error('Invalid allowedTicketSigners configuration');
    }
    if (typeof config.minSigRequired !== 'number' || config.minSigRequired < 1) {
        throw new Error('minSigRequired must be a positive number');
    }
    if (typeof config.requiredSecurityLevel !== 'number') {
        throw new Error('Invalid requiredSecurityLevel');
    }
}

export function verifyMultiSigs(
    rawPayload: object,
    sigs: Sign[],
    config: VerificationConfig
): { isValid: boolean; validCount: number } {
    validateVerificationConfig(config);
    
    if (sigs.length < config.minSigRequired) {
        return { isValid: false, validCount: 0 };
    }

    if (sigs.length > Object.keys(config.allowedTicketSigners).length) {
        return { isValid: false, validCount: 0 };
    }

    let validSigs = 0;
    const message = Utils.safeStringify(rawPayload);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(message));
    const seen = new Set<string>();

    for (const sig of sigs) {
        try {
            const recoveredAddress = ethers.verifyMessage(hash, sig.sig);
            
            if (
                !seen.has(sig.owner) &&
                config.allowedTicketSigners[sig.owner] &&
                config.allowedTicketSigners[sig.owner] >= config.requiredSecurityLevel &&
                recoveredAddress.toLowerCase() === sig.owner.toLowerCase()
            ) {
                validSigs++;
                seen.add(sig.owner);
            }
        } catch (error) {
            continue;
        }
    }

    return { 
        isValid: validSigs >= config.minSigRequired,
        validCount: validSigs 
    };
}

export function verifyTickets(
    tickets: Ticket[],
    config: VerificationConfig
): { isValid: boolean; errors: VerificationError[] } {
    validateVerificationConfig(config);

    if (!validateTicketSchema(tickets)) {
        return {
            isValid: false,
            errors: [{
                type: 'schema',
                message: `Schema validation failed: ${ajv.errorsText(validateTicketSchema.errors)}`,
                validSignatures: 0
            }]
        };
    }
    
    const errors: VerificationError[] = [];

    for (const ticket of tickets) {
        const { data, sign, type } = ticket;
        const messageObj = { data, type };
        
        const verificationResult = verifyMultiSigs(
            messageObj,
            sign,
            config
        );

        if (!verificationResult.isValid) {
            errors.push({
                type,
                message: `Invalid signatures for ticket type ${type}. Found ${verificationResult.validCount} valid signatures, required ${config.minSigRequired} with security level ${DevSecurityLevel[config.requiredSecurityLevel]}`,
                validSignatures: verificationResult.validCount
            });
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
} 