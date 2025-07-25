import { describe, expect, it } from '@jest/globals'
import { ApiError, ErrorCodes, ErrorCode } from '../../../../src/types/errors'

describe('types/errors', () => {
  describe('ApiError interface', () => {
    it('should accept valid ApiError structure', () => {
      const error: ApiError = {
        statusCode: 404,
        response: {
          error: 'Not Found',
          code: 'RESOURCE_NOT_FOUND',
        },
      }

      expect(error.statusCode).toBe(404)
      expect(error.response.error).toBe('Not Found')
      expect(error.response.code).toBe('RESOURCE_NOT_FOUND')
    })

    it('should accept ApiError with optional details', () => {
      const error: ApiError = {
        statusCode: 400,
        response: {
          error: 'Bad Request',
          code: 'INVALID_INPUT',
          details: {
            field: 'email',
            reason: 'Invalid format',
          },
        },
      }

      expect(error.response.details).toEqual({
        field: 'email',
        reason: 'Invalid format',
      })
    })

    it('should accept details of any type', () => {
      const stringDetails: ApiError = {
        statusCode: 500,
        response: {
          error: 'Internal Error',
          code: 'INTERNAL_ERROR',
          details: 'Something went wrong',
        },
      }

      const arrayDetails: ApiError = {
        statusCode: 400,
        response: {
          error: 'Multiple Errors',
          code: 'MULTIPLE_ERRORS',
          details: ['Error 1', 'Error 2'],
        },
      }

      expect(stringDetails.response.details).toBe('Something went wrong')
      expect(arrayDetails.response.details).toEqual(['Error 1', 'Error 2'])
    })
  })

  describe('ErrorCodes', () => {
    it('should have all expected error codes', () => {
      expect(ErrorCodes.TICKETS_FILE_NOT_ACCESSIBLE).toBe('TICKETS_FILE_NOT_ACCESSIBLE')
      expect(ErrorCodes.INVALID_TICKETS_FORMAT).toBe('INVALID_TICKETS_FORMAT')
      expect(ErrorCodes.INVALID_TICKETS_DATA).toBe('INVALID_TICKETS_DATA')
      expect(ErrorCodes.INVALID_TICKET_SIGNATURES).toBe('INVALID_TICKET_SIGNATURES')
      expect(ErrorCodes.TICKET_NOT_FOUND).toBe('TICKET_NOT_FOUND')
      expect(ErrorCodes.INTERNAL_SERVER_ERROR).toBe('INTERNAL_SERVER_ERROR')
      expect(ErrorCodes.INVALID_TICKET_TYPE).toBe('INVALID_TICKET_TYPE')
    })

    it('should be a readonly object', () => {
      // TypeScript ensures this at compile time, but we can verify the values don't change
      const originalValue = ErrorCodes.TICKETS_FILE_NOT_ACCESSIBLE
      expect(ErrorCodes.TICKETS_FILE_NOT_ACCESSIBLE).toBe(originalValue)
    })

    it('should have exactly 7 error codes', () => {
      const errorCodeKeys = Object.keys(ErrorCodes)
      expect(errorCodeKeys).toHaveLength(7)
    })

    it('should have matching keys and values', () => {
      Object.entries(ErrorCodes).forEach(([key, value]) => {
        expect(key).toBe(value)
      })
    })
  })

  describe('ErrorCode type', () => {
    it('should accept valid error code values', () => {
      const errorCode1: ErrorCode = 'TICKETS_FILE_NOT_ACCESSIBLE'
      const errorCode2: ErrorCode = 'INVALID_TICKETS_FORMAT'
      const errorCode3: ErrorCode = 'INVALID_TICKETS_DATA'
      const errorCode4: ErrorCode = 'INVALID_TICKET_SIGNATURES'
      const errorCode5: ErrorCode = 'TICKET_NOT_FOUND'
      const errorCode6: ErrorCode = 'INTERNAL_SERVER_ERROR'
      const errorCode7: ErrorCode = 'INVALID_TICKET_TYPE'

      expect(errorCode1).toBe('TICKETS_FILE_NOT_ACCESSIBLE')
      expect(errorCode2).toBe('INVALID_TICKETS_FORMAT')
      expect(errorCode3).toBe('INVALID_TICKETS_DATA')
      expect(errorCode4).toBe('INVALID_TICKET_SIGNATURES')
      expect(errorCode5).toBe('TICKET_NOT_FOUND')
      expect(errorCode6).toBe('INTERNAL_SERVER_ERROR')
      expect(errorCode7).toBe('INVALID_TICKET_TYPE')
    })

    it('should be assignable from ErrorCodes values', () => {
      const codes: ErrorCode[] = Object.values(ErrorCodes)
      expect(codes).toHaveLength(7)
      codes.forEach((code) => {
        expect(typeof code).toBe('string')
      })
    })
  })

  describe('Usage examples', () => {
    it('should work in error creation functions', () => {
      function createApiError(code: ErrorCode, message: string, statusCode = 500): ApiError {
        return {
          statusCode,
          response: {
            error: message,
            code,
          },
        }
      }

      const error = createApiError(ErrorCodes.TICKET_NOT_FOUND, 'Ticket ID 123 not found', 404)
      expect(error.statusCode).toBe(404)
      expect(error.response.code).toBe('TICKET_NOT_FOUND')
      expect(error.response.error).toBe('Ticket ID 123 not found')
    })

    it('should work in error handling switch statements', () => {
      function getErrorMessage(code: ErrorCode): string {
        switch (code) {
          case ErrorCodes.TICKETS_FILE_NOT_ACCESSIBLE:
            return 'Cannot access tickets file'
          case ErrorCodes.INVALID_TICKETS_FORMAT:
            return 'Invalid tickets format'
          case ErrorCodes.INVALID_TICKETS_DATA:
            return 'Invalid tickets data'
          case ErrorCodes.INVALID_TICKET_SIGNATURES:
            return 'Invalid ticket signatures'
          case ErrorCodes.TICKET_NOT_FOUND:
            return 'Ticket not found'
          case ErrorCodes.INTERNAL_SERVER_ERROR:
            return 'Internal server error'
          case ErrorCodes.INVALID_TICKET_TYPE:
            return 'Invalid ticket type'
          default:
            // This ensures exhaustive checking
            const _exhaustive: never = code
            return 'Unknown error'
        }
      }

      expect(getErrorMessage(ErrorCodes.TICKET_NOT_FOUND)).toBe('Ticket not found')
      expect(getErrorMessage(ErrorCodes.INTERNAL_SERVER_ERROR)).toBe('Internal server error')
    })
  })
})
