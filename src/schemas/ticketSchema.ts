import { TicketData, TicketMetadata, Sign, TicketType, Ticket } from '../types/tickets'

export const ticketSchema = {
    type: 'object',
    required: ['type', 'data', 'metadata', 'metadataSignatures'],
    properties: {
        type: {
            type: 'string',
            enum: ['silver'] // Only silver tickets for now
        },
        data: {
            type: 'array',
            items: {
                type: 'object',
                required: ['address'],
                properties: {
                    address: {
                        type: 'string',
                        pattern: '^0x[a-fA-F0-9]{40}$' // Ethereum address format
                    }
                },
                additionalProperties: false
            },
            minItems: 1
        },
        metadata: {
            type: 'object',
            required: ['version', 'notBefore', 'notAfter', 'allowedUpdaters', 'allowedOperations', 'dataHash', 'nonce'],
            properties: {
                version: {
                    type: 'number',
                    minimum: 1
                },
                notBefore: {
                    type: 'number',
                    minimum: 0
                },
                notAfter: {
                    type: 'number',
                    minimum: 0
                },
                allowedUpdaters: {
                    type: 'array',
                    items: {
                        type: 'string',
                        pattern: '^0x[a-fA-F0-9]{40}$' // Ethereum address format
                    },
                    minItems: 1
                },
                allowedOperations: {
                    type: 'array',
                    items: {
                        type: 'string',
                        enum: ['ADD_ADDRESS', 'REMOVE_ADDRESS']
                    },
                    minItems: 1
                },
                dataHash: {
                    type: 'string',
                    pattern: '^0x[a-fA-F0-9]{64}$' // keccak256 hash format
                },
                nonce: {
                    type: 'number',
                    minimum: 0
                }
            },
            additionalProperties: false
        },
        metadataSignatures: {
            type: 'array',
            items: {
                type: 'object',
                required: ['owner', 'sig'],
                properties: {
                    owner: {
                        type: 'string',
                        pattern: '^0x[a-fA-F0-9]{40}$' // Ethereum address format
                    },
                    sig: {
                        type: 'string',
                        pattern: '^0x[a-fA-F0-9]{130}$' // Ethereum signature format (65 bytes)
                    }
                },
                additionalProperties: false
            },
            minItems: 1
        },
        updateProof: {
            type: 'object',
            required: ['operation', 'updater', 'previousDataHash', 'signature'],
            properties: {
                operation: {
                    type: 'string',
                    enum: ['ADD_ADDRESS', 'REMOVE_ADDRESS']
                },
                updater: {
                    type: 'string',
                    pattern: '^0x[a-fA-F0-9]{40}$' // Ethereum address format
                },
                previousDataHash: {
                    type: 'string',
                    pattern: '^0x[a-fA-F0-9]{64}$' // keccak256 hash format
                },
                signature: {
                    type: 'string',
                    pattern: '^0x[a-fA-F0-9]{130}$' // Ethereum signature format (65 bytes)
                }
            },
            additionalProperties: false
        }
    },
    additionalProperties: false
} as const;

export type { TicketData, TicketMetadata, Sign, TicketType, Ticket }; 