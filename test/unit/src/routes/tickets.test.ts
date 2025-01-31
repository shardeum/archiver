// Mock modules before importing routes
jest.mock('fs/promises', () => ({
    readFile: jest.fn().mockResolvedValue(JSON.stringify([{
        data: [{ address: "0x37a9FCf5628B1C198A01C9eDaB0BF5C4d453E928" }],
        sign: [{
            owner: "0x891DF765C855E9848A18Ed18984B9f57cb3a4d47",
            sig: "0x5f1aad2caa2cca1f725715ed050b1928527f0c4eb815fb282fad113ca866a63568d9c003b5310e16de67103521bf284fda10728b4fffc66055c55fde5934438d1b"
        }],
        type: "silver"
    }])),
    writeFile: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../../../../src/Logger', () => ({
    mainLogger: {
        debug: jest.fn(),
        error: jest.fn(),
        info: jest.fn()
    }
}));

jest.mock('../../../../src/services/ticketVerification', () => {
    const originalModule = jest.requireActual('../../../../src/services/ticketVerification');
    return {
        ...originalModule,
        verifyTickets: jest.fn().mockReturnValue({ isValid: true, errors: [] })
    };
});

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

// Mock process.exit to prevent test termination
const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('Process.exit called');
});

// Mock Date.now for consistent TTL tests
const mockNow = jest.spyOn(Date, 'now').mockReturnValue(1000);

// Import after mocks
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync } from 'fs'
import { readFile } from 'fs/promises'
import { ticketsRouter, ticketCache } from '../../../../src/routes/tickets'
import { verifyTickets } from '../../../../src/services/ticketVerification'
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
    
    beforeEach(async () => {
        // Reset the cache
        (ticketCache as any) = null;

        // Set initial Date.now value
        mockNow.mockReturnValue(1000);
        
        // Create mock Fastify instance with proper route registration
        routes = {};
        mockFastify = {
            get: jest.fn((path: string, handler: Function) => {
                routes[path] = handler;
                return mockFastify;
            }),
            register: jest.fn().mockImplementation(async (plugin) => {
                // Mock successful initialization
                (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockValidTickets));
                await plugin(mockFastify, {});
            })
        } as unknown as FastifyInstance;

        await ticketsRouter(mockFastify, {});
    });
    
    afterEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
    });

    describe('GET /', () => {
        it('should handle file not found error', async () => {
            const { reply, send, code } = createMockReply();
            
            (ticketCache as any) = null;
            
            (readFile as jest.Mock).mockRejectedValueOnce(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }));

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
            
            (readFile as jest.Mock).mockResolvedValueOnce('invalid json');

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
            
            (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify({ not: "an array" }));

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

            // Set up cache with valid tickets
            (ticketCache as any) = {
                tickets: mockValidTickets,
                lastRead: 1000
            };

            // Reset readFile mock to ensure it's not called
            (readFile as jest.Mock).mockClear();

            await routes['/:type'](
                { params: { type: 'silver' } } as unknown as FastifyRequest,
                reply
            );

            expect(readFile).not.toHaveBeenCalled();
            expect(send).toHaveBeenCalledWith(mockValidTickets[0]);
        });
    });

    describe('Cache invalidation', () => {
        it('should reload tickets after TTL expires', async () => {
            const { reply, send } = createMockReply();
            
            // First call to populate cache
            await routes['/']({} as FastifyRequest, reply);
            
            // Reset readFile mock to track new calls
            (readFile as jest.Mock).mockClear();
            
            // Set time to after TTL expiration (60 seconds + 1ms)
            mockNow.mockReturnValue(61001);
            
            // Make another request that should trigger cache reload
            await routes['/']({} as FastifyRequest, reply);
            
            // Verify that the file was read again
            expect(readFile).toHaveBeenCalledTimes(1);
            expect(readFile).toHaveBeenCalledWith(TICKETS_PATH, 'utf8');
        });

        it('should handle concurrent reads with isReading flag', async () => {
            const { reply: reply1 } = createMockReply();
            const { reply: reply2 } = createMockReply();
            
            // Reset cache and mock
            (ticketCache as any) = null;
            (readFile as jest.Mock).mockClear();
            (readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockValidTickets));
            
            // Start first read but don't let it complete
            const firstRead = routes['/']({} as FastifyRequest, reply1);
            
            // Attempt second read while first is in progress
            const secondRead = routes['/']({} as FastifyRequest, reply2);
            
            // Complete both reads
            await Promise.all([firstRead, secondRead]);
            
            // Should only read file once due to isReading flag
            expect(readFile).toHaveBeenCalledTimes(1);
        });

        it('should reset isReading flag even if validation fails', async () => {
            const { reply: reply1 } = createMockReply();
            const { reply: reply2 } = createMockReply();
            
            // Reset cache and mock
            (ticketCache as any) = null;
            (readFile as jest.Mock).mockClear();
            
            // First call with invalid data
            (readFile as jest.Mock)
                .mockResolvedValueOnce('invalid json')
                .mockResolvedValueOnce(JSON.stringify(mockValidTickets));

            await routes['/']({} as FastifyRequest, reply1).catch(() => {});
            await routes['/']({} as FastifyRequest, reply2);
            
            expect(readFile).toHaveBeenCalledTimes(2);
        });
    });

    describe('Validation and Verification', () => {
        beforeEach(() => {
            // Reset verifyTickets mock for each test
            (verifyTickets as jest.Mock).mockReturnValue({ isValid: true, errors: [] });
            // Reset readFile mock for each test
            (readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockValidTickets));
            // Reset cache for each test
            (ticketCache as any) = null;
        });

        it('should reject tickets with invalid signatures', async () => {
            const { reply, send, code } = createMockReply();
            
            const invalidTickets = [{
                ...mockValidTickets[0],
                sign: [{
                    owner: "0x891DF765C855E9848A18Ed18984B9f57cb3a4d47",
                    sig: "0xinvalidsignature"
                }]
            }];
            
            (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(invalidTickets));
            (verifyTickets as jest.Mock).mockReturnValueOnce({ 
                isValid: false, 
                errors: [{ type: 'signature', message: 'Invalid signature', validSignatures: 0 }] 
            });

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(400);
            expect(send).toHaveBeenCalledWith({
                code: 'INVALID_TICKET_SIGNATURES',
                error: 'Ticket verification failed'
            });
        });

        it('should reject tickets with insufficient security level', async () => {
            const { reply, send, code } = createMockReply();
            
            const lowSecurityTickets = [{
                ...mockValidTickets[0],
                sign: [{
                    owner: "0x891DF765C855E9848A18Ed18984B9f57cb3a4d47",
                    sig: mockValidTickets[0].sign[0].sig
                }]
            }];
            
            (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(lowSecurityTickets));
            (verifyTickets as jest.Mock).mockReturnValueOnce({ 
                isValid: false, 
                errors: [{ type: 'security', message: 'Insufficient security level', validSignatures: 0 }] 
            });

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(400);
            expect(send).toHaveBeenCalledWith({
                code: 'INVALID_TICKET_SIGNATURES',
                error: 'Ticket verification failed'
            });
        });

        it('should reject tickets with insufficient signatures', async () => {
            const { reply, send, code } = createMockReply();
            
            (readFile as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockValidTickets));
            (verifyTickets as jest.Mock).mockReturnValueOnce({ 
                isValid: false, 
                errors: [{ type: 'count', message: 'Insufficient signatures', validSignatures: 1 }] 
            });

            await routes['/'](
                {} as FastifyRequest,
                reply
            );

            expect(code).toHaveBeenCalledWith(400);
            expect(send).toHaveBeenCalledWith({
                code: 'INVALID_TICKET_SIGNATURES',
                error: 'Ticket verification failed'
            });
        });
    });

    describe('Cache TTL behavior', () => {
        beforeEach(() => {
            // Reset Date.now mock for each test
            mockNow.mockReturnValue(1000);
            // Reset readFile mock for each test
            (readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockValidTickets));
        });

        it('should use cache exactly at TTL boundary', async () => {
            const { reply, send } = createMockReply();
            
            // First call to populate cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Reset mock
            (readFile as jest.Mock).mockClear();

            // Set cache to exactly TTL age
            mockNow.mockReturnValue(61000); // 60 seconds later
            (ticketCache as any) = {
                tickets: mockValidTickets,
                lastRead: 1000 // Original time
            };

            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Should still use cache at exactly TTL
            expect(readFile).not.toHaveBeenCalled();
        });

        it('should reload cache just after TTL boundary', async () => {
            const { reply, send } = createMockReply();
            
            // First call to populate cache
            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Reset mock
            (readFile as jest.Mock).mockClear();

            // Set cache to just over TTL
            mockNow.mockReturnValue(61001); // Just over 60 seconds later
            (ticketCache as any) = {
                tickets: mockValidTickets,
                lastRead: 1000 // Original time
            };

            await routes['/'](
                {} as FastifyRequest,
                reply
            );
            
            // Should reload just after TTL
            expect(readFile).toHaveBeenCalledTimes(1);
        });
    });
}); 