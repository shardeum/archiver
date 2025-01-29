// Mock modules before importing routes
jest.mock('fs', () => ({
    readFileSync: jest.fn().mockReturnValue(JSON.stringify([]))
}));

jest.mock('../../../../src/Logger', () => ({
    mainLogger: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
    }
}));

jest.mock('../../../../src/Config', () => ({
    config: {
        tickets: {
            allowedTicketSigners: {
                "0x891DF765C855E9848A18Ed18984B9f57cb3a4d47": 3 // HIGH = 3
            },
            minSigRequired: 1,
            requiredSecurityLevel: 3
        }
    }
}));

// Import after mocks
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync } from 'fs'
import { ticketsRouter, ticketCache } from '../../../../src/routes/tickets'
import * as path from 'path';

// Updated mock data to match schema
const mockValidTickets = [{
    data: [{ address: "0x37a9FCf5628B1C198A01C9eDaB0BF5C4d453E928" }],
    sign: [{
        owner: "0x891DF765C855E9848A18Ed18984B9f57cb3a4d47",
        sig: "0x5f1aad2caa2cca1f725715ed050b1928527f0c4eb815fb282fad113ca866a63568d9c003b5310e16de67103521bf284fda10728b4fffc66055c55fde5934438d1b"
    }],
    type: "silver"
}];

const TICKETS_PATH = path.resolve(process.cwd(), 'static', 'tickets.json');

function createMockReply() {
    const mockSend = jest.fn();
    const mockCode = jest.fn().mockImplementation((code) => ({
        send: mockSend
    }));
    
    return {
        reply: {
            send: mockSend,
            code: mockCode,
            header: jest.fn().mockReturnThis(),
            status: jest.fn().mockReturnThis(),
            type: jest.fn().mockReturnThis(),
        } as unknown as FastifyReply,
        send: mockSend,
        code: mockCode
    };
}

describe('Ticket Routes', () => {
    let mockFastify: FastifyInstance;
    let routes: { [key: string]: Function } = {};
    
    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        (readFileSync as jest.Mock).mockReturnValueOnce(JSON.stringify(mockValidTickets));
        // Reset the cache
        (ticketCache as any) = null;
        
        // Create mock Fastify instance
        mockFastify = {
            get: jest.fn((path: string, handler: Function) => {
                routes[path] = handler;
            })
        } as unknown as FastifyInstance;

        // Initialize the router with valid tickets first
        (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockValidTickets));
        
        ticketsRouter(mockFastify, {}, (err) => {
            if (err) throw err;
        });
    });

    describe('GET /', () => {
        it('should handle file not found error', async () => {
            const { reply, send, code } = createMockReply();
            
            (ticketCache as any) = null;
            
            (readFileSync as jest.Mock).mockImplementationOnce(() => {
                const error: NodeJS.ErrnoException = new Error('ENOENT: no such file');
                error.code = 'ENOENT';
                throw error;
            });

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(500);
            expect(send).toHaveBeenCalledWith({
                code: 'TICKETS_FILE_NOT_ACCESSIBLE',
                error: `Unable to access tickets configuration: ${TICKETS_PATH}`
            });
        });

        it('should handle invalid JSON format', async () => {
            const { reply, send, code } = createMockReply();
            
            (ticketCache as any) = null;
            
            (readFileSync as jest.Mock).mockReturnValueOnce('invalid json');

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(400);
            expect(send).toHaveBeenCalledWith({
                code: 'INVALID_TICKETS_DATA',
                error: 'Invalid tickets configuration data'
            });
        });

        it('should handle non-array tickets data', async () => {
            const { reply, send, code } = createMockReply();
            
            (ticketCache as any) = null;
            
            (readFileSync as jest.Mock).mockReturnValueOnce(JSON.stringify({ not: "an array" }));

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(400);
            expect(send).toHaveBeenCalledWith({
                code: 'INVALID_TICKETS_FORMAT',
                error: 'Invalid tickets configuration format'
            });
        });
    });

    describe('GET /:type', () => {
        it('should use cached tickets for type lookup', async () => {
            const { reply, send } = createMockReply();

            await routes['/:type'](
                { params: { type: 'silver' } } as unknown as FastifyRequest,
                reply
            );

            expect(readFileSync).toHaveBeenCalledTimes(1);
            expect(send).toHaveBeenCalledWith(mockValidTickets[0]);
        });
    });

    describe('Cache invalidation', () => {
        it('should reload tickets after TTL expires', async () => {
            const { reply } = createMockReply();
            
            // First call to populate cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Reset mock
            (readFileSync as jest.Mock).mockClear();

            // Force cache invalidation
            (ticketCache as any) = {
                tickets: mockValidTickets,
                lastRead: Date.now() - (70 * 1000) // 70 seconds ago
            };

            // Second call should reload due to expired cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            expect(readFileSync).toHaveBeenCalledTimes(1);
        });

        it('should use cache within TTL', async () => {
            const { reply, send } = createMockReply();
            
            // First call to populate cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Reset mock
            (readFileSync as jest.Mock).mockClear();

            // Second call within TTL should use cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            expect(readFileSync).not.toHaveBeenCalled();
        });
    });
}); 