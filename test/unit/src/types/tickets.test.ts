import { TicketData } from '../../../../src/types/tickets'

describe('tickets types', () => {
  describe('TicketData type', () => {
    it('should create a valid TicketData object with address property', () => {
      const ticket: TicketData = {
        address: '0x1234567890abcdef1234567890abcdef12345678'
      }
      
      expect(ticket).toBeDefined()
      expect(ticket.address).toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    it('should accept empty string for address', () => {
      const ticket: TicketData = {
        address: ''
      }
      
      expect(ticket.address).toBe('')
    })

    it('should accept various address formats', () => {
      const tickets: TicketData[] = [
        { address: '0x0000000000000000000000000000000000000000' },
        { address: 'localhost:8080' },
        { address: '192.168.1.1:3000' },
        { address: 'node1.example.com' },
        { address: 'http://example.com:8080' },
        { address: 'https://secure.example.com' },
        { address: '::1' }, // IPv6
        { address: '2001:db8::1' }, // IPv6
      ]
      
      tickets.forEach((ticket, index) => {
        expect(ticket).toHaveProperty('address')
        expect(typeof ticket.address).toBe('string')
      })
    })

    it('should be assignable with valid properties', () => {
      const ticket = {} as TicketData
      ticket.address = 'new-address'
      
      expect(ticket.address).toBe('new-address')
    })

    it('should work with array of tickets', () => {
      const tickets: TicketData[] = [
        { address: 'node1' },
        { address: 'node2' },
        { address: 'node3' },
      ]
      
      expect(tickets).toHaveLength(3)
      expect(tickets[0].address).toBe('node1')
      expect(tickets[1].address).toBe('node2')
      expect(tickets[2].address).toBe('node3')
    })

    it('should be serializable to JSON', () => {
      const ticket: TicketData = {
        address: 'test-address:8080'
      }
      
      const json = JSON.stringify(ticket)
      const parsed = JSON.parse(json) as TicketData
      
      expect(parsed.address).toBe('test-address:8080')
      expect(parsed).toEqual(ticket)
    })

    it('should work with object destructuring', () => {
      const ticket: TicketData = {
        address: 'destructured-address'
      }
      
      const { address } = ticket
      expect(address).toBe('destructured-address')
    })

    it('should work with spread operator', () => {
      const original: TicketData = {
        address: 'original-address'
      }
      
      const copy: TicketData = { ...original }
      expect(copy.address).toBe('original-address')
      expect(copy).not.toBe(original) // Different object reference
      expect(copy).toEqual(original) // Same content
    })

    it('should handle undefined and null values during runtime', () => {
      // TypeScript would prevent this at compile time, but testing runtime behavior
      const createTicket = (address: any): TicketData => {
        return { address }
      }
      
      const nullTicket = createTicket(null)
      const undefinedTicket = createTicket(undefined)
      
      expect(nullTicket.address).toBeNull()
      expect(undefinedTicket.address).toBeUndefined()
    })

    it('should work with type guards', () => {
      const isTicketData = (obj: unknown): obj is TicketData => {
        return obj !== null &&
               typeof obj === 'object' &&
               'address' in obj &&
               typeof (obj as TicketData).address === 'string'
      }
      
      expect(isTicketData({ address: 'valid' })).toBe(true)
      expect(isTicketData({ address: 123 })).toBe(false)
      expect(isTicketData({ wrongField: 'value' })).toBe(false)
      expect(isTicketData(null)).toBe(false)
      expect(isTicketData(undefined)).toBe(false)
      expect(isTicketData('string')).toBe(false)
      expect(isTicketData([])).toBe(false)
    })

    it('should work with array methods', () => {
      const tickets: TicketData[] = [
        { address: 'node1.example.com' },
        { address: 'node2.example.com' },
        { address: 'node3.example.com' },
      ]
      
      const filtered = tickets.filter(t => t.address.includes('node2'))
      expect(filtered).toHaveLength(1)
      expect(filtered[0].address).toBe('node2.example.com')
      
      const mapped = tickets.map(t => t.address)
      expect(mapped).toEqual([
        'node1.example.com',
        'node2.example.com',
        'node3.example.com'
      ])
      
      const found = tickets.find(t => t.address === 'node3.example.com')
      expect(found).toBeDefined()
      expect(found?.address).toBe('node3.example.com')
    })

    it('should handle very long addresses', () => {
      const longAddress = 'a'.repeat(10000)
      const ticket: TicketData = {
        address: longAddress
      }
      
      expect(ticket.address).toHaveLength(10000)
      expect(ticket.address).toBe(longAddress)
    })

    it('should work with Map and Set', () => {
      const ticket1: TicketData = { address: 'addr1' }
      const ticket2: TicketData = { address: 'addr2' }
      
      const ticketMap = new Map<string, TicketData>()
      ticketMap.set(ticket1.address, ticket1)
      ticketMap.set(ticket2.address, ticket2)
      
      expect(ticketMap.get('addr1')).toBe(ticket1)
      expect(ticketMap.has('addr2')).toBe(true)
      
      const ticketSet = new Set<string>()
      ticketSet.add(ticket1.address)
      ticketSet.add(ticket2.address)
      
      expect(ticketSet.has('addr1')).toBe(true)
      expect(ticketSet.size).toBe(2)
    })

    it('should be usable in function parameters and return types', () => {
      const processTicket = (ticket: TicketData): string => {
        return `Processing ticket for ${ticket.address}`
      }
      
      const createTicket = (address: string): TicketData => {
        return { address }
      }
      
      const ticket = createTicket('test-address')
      const result = processTicket(ticket)
      
      expect(result).toBe('Processing ticket for test-address')
    })

    it('should handle special characters in addresses', () => {
      const specialAddresses: TicketData[] = [
        { address: 'address with spaces' },
        { address: 'address@with@special#chars' },
        { address: 'address/with/slashes' },
        { address: 'address\\with\\backslashes' },
        { address: 'address"with"quotes' },
        { address: "address'with'apostrophes" },
        { address: 'address\nwith\nnewlines' },
        { address: 'address\twith\ttabs' },
        { address: '🚀emoji🌟address💫' },
        { address: '中文地址' },
        { address: 'العنوان العربي' },
      ]
      
      specialAddresses.forEach(ticket => {
        expect(ticket).toHaveProperty('address')
        expect(typeof ticket.address).toBe('string')
        
        // Should serialize and deserialize correctly
        const json = JSON.stringify(ticket)
        const parsed = JSON.parse(json) as TicketData
        expect(parsed.address).toBe(ticket.address)
      })
    })
  })
})