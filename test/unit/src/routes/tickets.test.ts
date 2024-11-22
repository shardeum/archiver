import { FastifyInstance } from 'fastify'
import { readFileSync } from 'fs'
import { join } from 'path'
import { config } from '../../../../src/Config'
import { ticketsRouter } from '../../../../src/routes/tickets'

// Mock Logger
jest.mock('../../../../src/Logger', () => ({
  mainLogger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn()
  }
}))

describe('Ticket Routes', () => {
  // Read the actual tickets file once at the start
  const tickets = JSON.parse(
    readFileSync(join(process.cwd(), config.STATIC_FILES.TICKETS_JSON), 'utf8')
  )

  describe('GET /', () => {
    it('should return all tickets', async () => {
      const mockReply = {
        send: jest.fn(),
        code: jest.fn().mockReturnThis()
      }

      const mockFastify = {
        get: jest.fn()
      } as unknown as FastifyInstance

      // Call the plugin with the required arguments
      ticketsRouter(mockFastify, {}, (err) => {
        if (err) throw err
      })
      
      // Get the handler that was registered
      const handler = mockFastify.get.mock.calls[0][1]
      
      // Call the handler directly
      await handler({}, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(tickets)
      expect(mockFastify.get).toHaveBeenCalledWith('/', expect.any(Function))
    })
  })

  describe('GET /:type', () => {
    it('should return silver ticket when requested', async () => {
      const mockReply = {
        send: jest.fn(),
        code: jest.fn().mockReturnThis()
      }

      const mockFastify = {
        get: jest.fn()
      } as unknown as FastifyInstance

      ticketsRouter(mockFastify, {}, (err) => {
        if (err) throw err
      })
      
      const handler = mockFastify.get.mock.calls[1][1]
      await handler({ params: { type: 'silver' } }, mockReply)

      expect(mockReply.send).toHaveBeenCalledWith(tickets[0])
    })

    it('should return 404 for non-existent ticket type', async () => {
      const mockReply = {
        send: jest.fn(),
        code: jest.fn().mockReturnThis()
      }

      const mockFastify = {
        get: jest.fn()
      } as unknown as FastifyInstance

      ticketsRouter(mockFastify, {}, (err) => {
        if (err) throw err
      })
      
      const handler = mockFastify.get.mock.calls[1][1]
      await handler({ params: { type: 'gold' } }, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(404)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'No ticket found with type: gold',
        code: 'TICKET_NOT_FOUND'
      })
    })

    it('should handle invalid type parameter', async () => {
      const mockReply = {
        send: jest.fn(),
        code: jest.fn().mockReturnThis()
      }

      const mockFastify = {
        get: jest.fn()
      } as unknown as FastifyInstance

      ticketsRouter(mockFastify, {}, (err) => {
        if (err) throw err
      })
      
      const handler = mockFastify.get.mock.calls[1][1]
      await handler({ params: { type: undefined } }, mockReply)

      expect(mockReply.code).toHaveBeenCalledWith(400)
      expect(mockReply.send).toHaveBeenCalledWith({
        error: 'Invalid ticket type parameter',
        code: 'INVALID_TICKET_TYPE'
      })
    })
  })
}) 