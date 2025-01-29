import { FastifyPluginCallback } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from '../Config'
import * as Logger from '../Logger'
import { type Ticket } from '../schemas/ticketSchema'
import { verifyTickets, VerificationConfig, VerificationError } from '../services/ticketVerification'
import { ApiError, ErrorCodes } from '../types/errors'
import { DevSecurityLevel } from '../types/security'

const ticketFilePath = join(__dirname, '..', '..', 'static', 'tickets.json')

// Export for testing
export let ticketCache: TicketCache | null = null;

const CACHE_TTL = 60 * 1000; // 1 minute in milliseconds

interface TicketCache {
    tickets: Ticket[];
    lastRead: number;
}

const verificationConfig: VerificationConfig = {
    allowedTicketSigners: config.tickets.allowedTicketSigners,
    minSigRequired: config.tickets.minSigRequired,
    requiredSecurityLevel: config.tickets.requiredSecurityLevel as DevSecurityLevel
};

function createApiError(code: keyof typeof ErrorCodes, message: string, details?: unknown): ApiError {
    let statusCode = 500;
    
    // Map error codes to appropriate HTTP status codes
    if (code.startsWith('INVALID')) {
        statusCode = 400;
    } else if (code === 'TICKET_NOT_FOUND') {
        statusCode = 404;
    }

    return {
        statusCode,
        response: {
            error: message,
            code: ErrorCodes[code],
            ...(details && { details })
        }
    };
}

function handleFileError(err: Error): ApiError {
    Logger.mainLogger.error('Failed to read tickets file:', err);
    return createApiError(
        'TICKETS_FILE_NOT_ACCESSIBLE',
        `Unable to access tickets configuration: ${ticketFilePath}`
    );
}

function handleJsonParseError(err: Error): ApiError {
    Logger.mainLogger.error('Failed to parse tickets JSON:', err);
    return createApiError(
        'INVALID_TICKETS_DATA',
        'Invalid tickets configuration data'
    );
}

function handleVerificationError(errors: VerificationError[]): ApiError {
    Logger.mainLogger.error('Ticket verification failed:', errors);
    return createApiError(
        'INVALID_TICKET_SIGNATURES',
        'Ticket verification failed',
        errors
    );
}

function validateTicketsArray(tickets: unknown): tickets is Ticket[] {
    if (!Array.isArray(tickets)) {
        Logger.mainLogger.error('Tickets data is not an array');
        return false;
    }
    return true;
}

function readAndValidateTickets(): Ticket[] {
    const now = Date.now();
        
    // Check if we have valid cached tickets
    if (ticketCache && (now - ticketCache.lastRead) < CACHE_TTL) {
        return ticketCache.tickets;
    }

    console.log('Reading tickets from file:', ticketFilePath);
    const jsonData = readFileSync(ticketFilePath, 'utf8');
    console.log('JSON data:', jsonData);
    const tickets = JSON.parse(jsonData);

    if (!validateTicketsArray(tickets)) {
        throw new Error('Invalid tickets format');
    }

    const verificationResult = verifyTickets(tickets, verificationConfig);
    if (!verificationResult.isValid) {
        throw new Error(`Ticket verification failed: ${verificationResult.errors.map(e => e.message).join(', ')}`);
    }
    // Update cache
    ticketCache = {
        tickets,
        lastRead: now
    };

    return tickets;
}

export function initializeTickets(): void {
    try {
        readAndValidateTickets();
    } catch (err) {
        console.log('caught the error 3', err);
        throw err; // This will prevent server from starting if tickets are invalid
    }
}

export const ticketsRouter: FastifyPluginCallback = function (fastify, opts, done) {
    // Add initialization before route handlers
    try {
        initializeTickets();
    } catch (err) {
        done(err as Error);
        return;
    }

    // GET / - Get all tickets
    fastify.get('/', (_request, reply) => {
        try {
            console.log('bout to go');
            const tickets = readAndValidateTickets();
            console.log('got the tickets');
            return reply.send(tickets);
        } catch (err) {
            console.log('caught the error', err);
            if (err instanceof Error) {
                if (err.message.includes('ENOENT')) {
                    const error = handleFileError(err);
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err instanceof SyntaxError) {
                    const error = handleJsonParseError(err);
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err.message === 'Invalid tickets format') {
                    const error = createApiError(
                        'INVALID_TICKETS_FORMAT',
                        'Invalid tickets configuration format'
                    );
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err.message === 'Ticket verification failed') {
                    const error = createApiError(
                        'INVALID_TICKET_SIGNATURES',
                        'Ticket verification failed'
                    );
                    return reply.code(error.statusCode).send(error.response);
                }
            }
            
            const error = createApiError(
                'INTERNAL_SERVER_ERROR',
                'Internal server error'
            );
            return reply.code(error.statusCode).send(error.response);
        }
    });

    // GET /:type - Get tickets by type
    fastify.get('/:type', (request, reply) => {
        const { type } = request.params as { type: string };
        
        if (!type || typeof type !== 'string') {
            const error = createApiError(
                'INVALID_TICKET_TYPE',
                'Invalid ticket type parameter'
            );
            return reply.code(error.statusCode).send(error.response);
        }

        try {
            const tickets = readAndValidateTickets();
            const ticket = tickets.find((t) => t.type === type);
            
            if (!ticket) {
                const error = createApiError(
                    'TICKET_NOT_FOUND',
                    `No ticket found with type: ${type}`
                );
                return reply.code(error.statusCode).send(error.response);
            }

            return reply.send(ticket);
        } catch (err) {
            console.log('caught the error', err);
            if (err instanceof Error) {
                if (err.message.includes('ENOENT')) {
                    const error = handleFileError(err);
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err instanceof SyntaxError) {
                    const error = handleJsonParseError(err);
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err.message === 'Invalid tickets format') {
                    const error = createApiError(
                        'INVALID_TICKETS_FORMAT',
                        'Invalid tickets configuration format'
                    );
                    return reply.code(error.statusCode).send(error.response);
                }
                if (err.message === 'Ticket verification failed') {
                    const error = createApiError(
                        'INVALID_TICKET_SIGNATURES',
                        'Ticket verification failed'
                    );
                    return reply.code(error.statusCode).send(error.response);
                }
            }
            
            const error = createApiError(
                'INTERNAL_SERVER_ERROR',
                'Internal server error'
            );
            return reply.code(error.statusCode).send(error.response);
        }
    });

    done();
};

export default ticketsRouter 