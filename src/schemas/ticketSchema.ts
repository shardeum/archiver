import { TicketData } from '../types/tickets'

type Sign = {
    owner: string;
    sig: string;
}

type Ticket = {
    data: TicketData[];
    sign: Sign[];
    type: string;
}

export const ticketSchema = {
    type: 'array',
    items: {
        type: 'object',
        required: ['data', 'sign', 'type'],
        properties: {
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
            sign: {
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
            type: {
                type: 'string',
                enum: ['silver'] // Only silver tickets for now
            }
        },
        additionalProperties: false
    }
} as const

export type { Sign, Ticket } 