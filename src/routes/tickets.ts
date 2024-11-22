import { FastifyPluginCallback } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from '../Config'
import * as Logger from '../Logger'
import { ethers } from 'ethers'
import { Utils } from '@shardus/types'
import * as Ajv from 'ajv'
import { ticketSchema, type Ticket, type Sign } from '../schemas/ticketSchema'

interface TicketData {
    address: string;
}

enum DevSecurityLevel {
    NONE = 0,
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3
}

interface VerificationError {
    type: string;
    message: string;
    validSignatures: number;
}

function verifyMultiSigs(
    rawPayload: object,
    sigs: Sign[],
    allowedPubkeys: { [pubkey: string]: DevSecurityLevel },
    minSigRequired: number,
    requiredSecurityLevel: DevSecurityLevel
): { isValid: boolean; validCount: number } {
    if (sigs.length < minSigRequired) return { isValid: false, validCount: 0 };

    if (sigs.length > Object.keys(allowedPubkeys).length) return { isValid: false, validCount: 0 };

    let validSigs = 0;
    const payload_hash = ethers.keccak256(ethers.toUtf8Bytes(Utils.safeStringify(rawPayload)));
    const seen = new Set();

    for (let i = 0; i < sigs.length; i++) {
        if (
            !seen.has(sigs[i].owner) &&
            allowedPubkeys[sigs[i].owner] &&
            allowedPubkeys[sigs[i].owner] >= requiredSecurityLevel &&
            ethers.verifyMessage(payload_hash, sigs[i].sig) === sigs[i].owner
        ) {
            validSigs++;
            seen.add(sigs[i].owner);
        }
    }

    return { 
        isValid: validSigs >= minSigRequired,
        validCount: validSigs 
    };
}

function verifyTickets(
    tickets: Ticket[],
    allowedTicketSigners?: { [pubkey: string]: DevSecurityLevel },
    configPath: string = join(process.cwd(), 'archiver-config.json')
): { isValid: boolean; errors: VerificationError[] } {
    // First validate against schema
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

    // Load config if allowedTicketSigners not provided
    if (!allowedTicketSigners) {
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        allowedTicketSigners = config.allowedTicketSigners || {};
    }

    const minSigRequired = 5;
    const requiredSecurityLevel = DevSecurityLevel.HIGH;
    const errors: VerificationError[] = [];

    // Continue with signature verification
    for (const ticket of tickets) {
        const { data, sign, type } = ticket;
        
        const messageObj = {
            data,
            type
        };
        
        const verificationResult = verifyMultiSigs(
            messageObj,
            sign,
            allowedTicketSigners,
            minSigRequired,
            requiredSecurityLevel
        );

        if (!verificationResult.isValid) {
            errors.push({
                type,
                message: `Invalid signatures for ticket type ${type}. ` +
                        `Found ${verificationResult.validCount} valid signatures, ` +
                        `required ${minSigRequired} with security level HIGH`,
                validSignatures: verificationResult.validCount
            });
        }
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

// Initialize Ajv with strict mode
const ajv = new Ajv({
    allErrors: true
})

// Add the schema
const validateTicketSchema = ajv.compile(ticketSchema)

export const ticketsRouter: FastifyPluginCallback = function (fastify, opts, done) {
    // GET / - Get all tickets
    fastify.get('/', (_request, reply) => {
        try {
            const filePath = join(__dirname, '..', '..', config.STATIC_FILES.TICKETS_JSON)
            let jsonData: string
            
            try {
                jsonData = readFileSync(filePath, 'utf8')
            } catch (err) {
                Logger.mainLogger.error('Failed to read tickets file:', err)
                reply.code(500).send({ 
                    error: 'Unable to access tickets configuration',
                    code: 'TICKETS_FILE_NOT_ACCESSIBLE'
                })
                return
            }

            try {
                const tickets = JSON.parse(jsonData)
                if (!Array.isArray(tickets)) {
                    Logger.mainLogger.error('Tickets data is not an array')
                    reply.code(500).send({ 
                        error: 'Invalid tickets configuration format',
                        code: 'INVALID_TICKETS_FORMAT'
                    })
                    return
                }

                // Verify tickets before returning
                const verificationResult = verifyTickets(tickets, config.allowedTicketSigners || {});
                if (!verificationResult.isValid) {
                    Logger.mainLogger.error('Ticket verification failed:', verificationResult.errors)
                    reply.code(400).send({
                        error: 'Ticket verification failed',
                        code: 'INVALID_TICKET_SIGNATURES',
                        details: verificationResult.errors
                    })
                    return
                }

                reply.send(tickets)
            } catch (err) {
                Logger.mainLogger.error('Failed to parse tickets JSON:', err)
                reply.code(500).send({ 
                    error: 'Invalid tickets configuration data',
                    code: 'INVALID_TICKETS_DATA'
                })
            }
        } catch (err) {
            Logger.mainLogger.error('Unexpected error in GET /tickets:', err)
            reply.code(500).send({ 
                error: 'Internal server error',
                code: 'INTERNAL_SERVER_ERROR'
            })
        }
    })

    // GET /:type - Get tickets by type
    fastify.get('/:type', (request, reply) => {
        try {
            const { type } = request.params as { type: string }
            
            if (!type || typeof type !== 'string') {
                reply.code(400).send({ 
                    error: 'Invalid ticket type parameter',
                    code: 'INVALID_TICKET_TYPE'
                })
                return
            }

            const filePath = join(__dirname, '..', '..', config.STATIC_FILES.TICKETS_JSON)
            let jsonData: string
            
            try {
                jsonData = readFileSync(filePath, 'utf8')
            } catch (err) {
                Logger.mainLogger.error('Failed to read tickets file:', err)
                reply.code(500).send({ 
                    error: 'Unable to access tickets configuration',
                    code: 'TICKETS_FILE_NOT_ACCESSIBLE'
                })
                return
            }

            try {
                const tickets = JSON.parse(jsonData)
                if (!Array.isArray(tickets)) {
                    Logger.mainLogger.error('Tickets data is not an array')
                    reply.code(500).send({ 
                        error: 'Invalid tickets configuration format',
                        code: 'INVALID_TICKETS_FORMAT'
                    })
                    return
                }

                const ticket = tickets.find((t: { type: string }) => t.type === type)
                
                if (!ticket) {
                    reply.code(404).send({ 
                        error: `No ticket found with type: ${type}`,
                        code: 'TICKET_NOT_FOUND'
                    })
                    return
                }

                // Verify single ticket before returning
                const verificationResult = verifyTickets([ticket], config.allowedTicketSigners || {});
                if (!verificationResult.isValid) {
                    Logger.mainLogger.error('Ticket verification failed:', verificationResult.errors)
                    reply.code(400).send({
                        error: 'Ticket verification failed',
                        code: 'INVALID_TICKET_SIGNATURES',
                        details: verificationResult.errors
                    })
                    return
                }

                reply.send(ticket)
            } catch (err) {
                Logger.mainLogger.error('Failed to parse tickets JSON:', err)
                reply.code(500).send({ 
                    error: 'Invalid tickets configuration data',
                    code: 'INVALID_TICKETS_DATA'
                })
            }
        } catch (err) {
            Logger.mainLogger.error('Unexpected error in GET /tickets/:type:', err)
            reply.code(500).send({ 
                error: 'Internal server error',
                code: 'INTERNAL_SERVER_ERROR'
            })
        }
    })

    done()
}

export default ticketsRouter 