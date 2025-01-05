import { ethers } from 'ethers'
import { Utils } from '@shardeum-foundation/lib-types'
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
    allowedPubkeys: { [pubkey: string]: DevSecurityLevel },
    minSigRequired: number,
    requiredSecurityLevel: DevSecurityLevel
): { isValid: boolean; validCount: number } {
    if (!rawPayload || !sigs || !allowedPubkeys || !Array.isArray(sigs)) {
      return { isValid: false, validCount: 0 }
    }
    if (sigs.length < minSigRequired) return { isValid: false, validCount: 0 }
  
    // no reason to allow more signatures than allowedPubkeys exist
    // this also prevent loop exhaustion
    if (sigs.length > Object.keys(allowedPubkeys).length) return { isValid: false, validCount: 0 }
  
    let validSigs = 0
    const payload_hash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(rawPayload)))
    const seen = new Set()
  
    for (let i = 0; i < sigs.length; i++) {
      /* eslint-disable security/detect-object-injection */
      // The sig owner has not been seen before
      // The sig owner is listed on the server
      // The sig owner has enough security clearance
      // The signature is valid
      if (
        !seen.has(sigs[i].owner) &&
        allowedPubkeys[sigs[i].owner] &&
        allowedPubkeys[sigs[i].owner] >= requiredSecurityLevel &&
        ethers.verifyMessage(payload_hash, sigs[i].sig).toLowerCase() === sigs[i].owner.toLowerCase()
      ) {
        validSigs++
        seen.add(sigs[i].owner)
      }
      /* eslint-enable security/detect-object-injection */
  
      if (validSigs >= minSigRequired) break
    }
  
    return {
        isValid: validSigs >= minSigRequired,
        validCount: validSigs
    }
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
            config.allowedTicketSigners,
            config.minSigRequired,
            config.requiredSecurityLevel
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