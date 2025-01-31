import { ethers } from 'ethers'
import { Utils } from '@shardeum-foundation/lib-types'
import { Ticket, Sign, TicketMetadata } from '../schemas/ticketSchema'
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

// TODO: consider moving it to Utils.ts
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

export interface TicketValidationResult {
    isValid: boolean;
    errors: VerificationError[];
}

export interface UpdateValidationResult {
    isValid: boolean;
    error?: string;
}

function verifyMetadataSignatures(
    metadata: TicketMetadata,
    signatures: Sign[],
    config: VerificationConfig
): { isValid: boolean; validCount: number } {
    const metadataHash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(metadata)));
    return verifyMultiSigs(
        metadata,
        signatures,
        config.allowedTicketSigners,
        config.minSigRequired,
        config.requiredSecurityLevel
    );
}

function verifyUpdateProof(
    ticket: Ticket,
    newData: any,
    config: VerificationConfig
): UpdateValidationResult {
    if (!ticket.updateProof) {
        return { isValid: false, error: 'Update proof missing' };
    }

    const { operation, updater, previousDataHash, signature } = ticket.updateProof;
    const { metadata } = ticket;

    // Verify timestamp validity
    const now = Date.now();
    if (now < metadata.notBefore || now > metadata.notAfter) {
        return { isValid: false, error: 'Ticket is not valid at current time' };
    }

    // Verify updater is allowed
    if (!metadata.allowedUpdaters.includes(updater.toLowerCase())) {
        return { isValid: false, error: 'Updater not authorized' };
    }

    // Verify operation is allowed
    if (!metadata.allowedOperations.includes(operation as any)) {
        return { isValid: false, error: 'Operation not authorized' };
    }

    // Verify previous data hash matches
    const currentDataHash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(ticket.data)));
    if (previousDataHash !== currentDataHash) {
        return { isValid: false, error: 'Data hash mismatch - possible concurrent modification' };
    }

    // Verify update signature
    const updatePayload = {
        operation,
        ticketType: ticket.type,
        previousDataHash,
        newDataHash: ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(newData))),
        nonce: metadata.nonce
    };
    const updateHash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(updatePayload)));
    
    try {
        const recoveredAddress = ethers.verifyMessage(updateHash, signature).toLowerCase();
        if (recoveredAddress !== updater.toLowerCase()) {
            return { isValid: false, error: 'Invalid update signature' };
        }
    } catch (err) {
        return { isValid: false, error: 'Failed to verify update signature' };
    }

    return { isValid: true };
}

export function verifyTicket(
    ticket: Ticket,
    config: VerificationConfig
): TicketValidationResult {
    // Verify schema
    if (!validateTicketSchema(ticket)) {
        return {
            isValid: false,
            errors: [{
                type: 'schema',
                message: `Schema validation failed: ${ajv.errorsText(validateTicketSchema.errors)}`,
                validSignatures: 0
            }]
        };
    }

    // Verify metadata signatures
    const metadataSigResult = verifyMetadataSignatures(
        ticket.metadata,
        ticket.metadataSignatures,
        config
    );

    if (!metadataSigResult.isValid) {
        return {
            isValid: false,
            errors: [{
                type: 'metadata_signatures',
                message: `Invalid metadata signatures. Found ${metadataSigResult.validCount} valid signatures, required ${config.minSigRequired}`,
                validSignatures: metadataSigResult.validCount
            }]
        };
    }

    // Verify data hash matches metadata
    const currentDataHash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(ticket.data)));
    if (currentDataHash !== ticket.metadata.dataHash) {
        return {
            isValid: false,
            errors: [{
                type: 'data_hash',
                message: 'Data hash mismatch with metadata',
                validSignatures: metadataSigResult.validCount
            }]
        };
    }

    // Verify timestamp validity
    const now = Date.now();
    if (now < ticket.metadata.notBefore || now > ticket.metadata.notAfter) {
        return {
            isValid: false,
            errors: [{
                type: 'timestamp',
                message: 'Ticket is not valid at current time',
                validSignatures: metadataSigResult.validCount
            }]
        };
    }

    return {
        isValid: true,
        errors: []
    };
}

// Export verification functions
export { verifyUpdateProof }; 