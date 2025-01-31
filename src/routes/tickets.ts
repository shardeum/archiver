import { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { config } from '../Config'
import * as Logger from '../Logger'
import { type Ticket } from '../schemas/ticketSchema'
import { verifyTickets, VerificationConfig, VerificationError } from '../services/ticketVerification'
import { ApiError, ErrorCodes } from '../types/errors'
import { DevSecurityLevel } from '../types/security'
import { ethers } from 'ethers'

// Define ticket type based on schema
type TicketType = 'silver';

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

function isApiError(error: unknown): error is ApiError {
    return typeof error === 'object' && error !== null && 'statusCode' in error && 'response' in error;
}

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

let isReading = false;
async function readAndValidateTickets(): Promise<Ticket[]> {
    const now = Date.now();
        
    // Check if we have valid cached tickets
    if (isReading || (ticketCache && (now - ticketCache.lastRead) <= CACHE_TTL)) {
        return ticketCache?.tickets || [];
    }

    isReading = true;
    try {
        const jsonData = await readFile(ticketFilePath, 'utf8');
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
    } finally {
        isReading = false;
    }
}

export async function initializeTickets() {
    try {
        await readAndValidateTickets();
    } catch (err) {
        console.error('Failed to initialize tickets:', err);
        console.error('Unable to start server without a valid tickets configuration, shutting down');
        process.exit(1);
    }
}

export const ticketsRouter: FastifyPluginAsync = async function (fastify) {
    // Add initialization
    await initializeTickets();

    // GET / - Get all tickets
    fastify.get('/', async (_request, reply) => {
        try {
            const tickets = await readAndValidateTickets();
            return reply.send(tickets);
        } catch (err) {
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
                if (err.message.includes('Ticket verification failed')) {
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

    const validateTicketType = (request: FastifyRequest): TicketType | ApiError => {      
        const { type } = request.params as { type: TicketType };
        if (!type || typeof type !== 'string') {
            return createApiError(
                'INVALID_TICKET_TYPE',
                'Invalid ticket type parameter'
            );
        }
        return type;
    }

    // GET /:type - Get tickets by type
    fastify.get('/:type', async (request, reply) => {       
        const validationResult = validateTicketType(request);

        if (isApiError(validationResult)) {
            return reply.code(validationResult.statusCode).send(validationResult.response);
        }

        const type = validationResult;

        try {
            const tickets = await readAndValidateTickets();
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

};

export default ticketsRouter 