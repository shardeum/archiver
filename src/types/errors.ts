export interface ApiError {
    statusCode: number;
    response: {
        error: string;
        code: string;
        details?: unknown;
    };
}

export const ErrorCodes = {
    TICKETS_FILE_NOT_ACCESSIBLE: 'TICKETS_FILE_NOT_ACCESSIBLE',
    INVALID_TICKETS_FORMAT: 'INVALID_TICKETS_FORMAT',
    INVALID_TICKETS_DATA: 'INVALID_TICKETS_DATA',
    INVALID_TICKET_SIGNATURES: 'INVALID_TICKET_SIGNATURES',
    TICKET_NOT_FOUND: 'TICKET_NOT_FOUND',
    INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
    INVALID_TICKET_TYPE: 'INVALID_TICKET_TYPE'
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes]; 