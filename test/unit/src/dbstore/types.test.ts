import { Cycle, DbCycle } from '../../../../src/dbstore/types'
import { P2P, StateManager } from '@shardeum-foundation/lib-types'

describe('dbstore types', () => {
  // Helper function to create a mock CycleData
  const createMockCycleData = (): P2P.CycleCreatorTypes.CycleData => {
    return {
      networkId: 'test-network',
      counter: 1,
      previous: 'previous-cycle-marker',
      start: 1000000,
      duration: 60,
      networkConfigHash: 'config-hash-123',
      marker: 'cycle-marker-123',
      certificate: {
        marker: 'cycle-marker-123',
        score: 100,
        sign: {
          owner: '0xowner123',
          sig: '0xsignature123'
        }
      },
      mode: 'forming',
      safetyMode: false,
      joined: [],
      returned: [],
      lost: [],
      refuted: [],
      appRemoved: [],
      apoptosized: [],
      nodeListHash: 'node-list-hash',
      archiverListHash: 'archiver-list-hash',
      standbyNodeListHash: 'standby-list-hash',
      random: Math.random()
    } as P2P.CycleCreatorTypes.CycleData
  }

  describe('Cycle interface', () => {
    it('should create a valid Cycle object', () => {
      const cycleData = createMockCycleData()
      const cycle: Cycle = {
        counter: 1,
        cycleRecord: cycleData,
        cycleMarker: 'test-marker-123'
      }

      expect(cycle).toBeDefined()
      expect(cycle.counter).toBe(1)
      expect(cycle.cycleRecord).toBe(cycleData)
      expect(cycle.cycleMarker).toBe('test-marker-123')
    })

    it('should accept counter from cycleRecord', () => {
      const cycleData = createMockCycleData()
      cycleData.counter = 42
      
      const cycle: Cycle = {
        counter: cycleData.counter,
        cycleRecord: cycleData,
        cycleMarker: 'marker-42'
      }

      expect(cycle.counter).toBe(42)
      expect(cycle.counter).toBe(cycle.cycleRecord.counter)
    })

    it('should handle different counter values', () => {
      const cycleData = createMockCycleData()
      
      const testCases = [0, 1, 100, 999999, Number.MAX_SAFE_INTEGER]
      
      testCases.forEach(counter => {
        cycleData.counter = counter
        const cycle: Cycle = {
          counter: counter,
          cycleRecord: cycleData,
          cycleMarker: `marker-${counter}`
        }
        
        expect(cycle.counter).toBe(counter)
      })
    })

    it('should be serializable to JSON', () => {
      const cycleData = createMockCycleData()
      const cycle: Cycle = {
        counter: 5,
        cycleRecord: cycleData,
        cycleMarker: 'test-marker'
      }

      const json = JSON.stringify(cycle)
      const parsed = JSON.parse(json)

      expect(parsed.counter).toBe(5)
      expect(parsed.cycleMarker).toBe('test-marker')
      expect(parsed.cycleRecord.networkId).toBe('test-network')
    })

    it('should handle empty cycleMarker', () => {
      const cycle: Cycle = {
        counter: 1,
        cycleRecord: createMockCycleData(),
        cycleMarker: ''
      }

      expect(cycle.cycleMarker).toBe('')
    })

    it('should work with object destructuring', () => {
      const cycle: Cycle = {
        counter: 10,
        cycleRecord: createMockCycleData(),
        cycleMarker: 'destructure-test'
      }

      const { counter, cycleRecord, cycleMarker } = cycle
      
      expect(counter).toBe(10)
      expect(cycleRecord).toBeDefined()
      expect(cycleMarker).toBe('destructure-test')
    })

    it('should work with spread operator', () => {
      const original: Cycle = {
        counter: 20,
        cycleRecord: createMockCycleData(),
        cycleMarker: 'spread-test'
      }

      const copy: Cycle = { ...original }
      
      expect(copy).not.toBe(original)
      expect(copy.counter).toBe(original.counter)
      expect(copy.cycleRecord).toBe(original.cycleRecord) // Same reference
      expect(copy.cycleMarker).toBe(original.cycleMarker)
    })
  })

  describe('DbCycle type', () => {
    it('should create a valid DbCycle object with string cycleRecord', () => {
      // DbCycle is meant to be used as a database representation
      // where cycleRecord is serialized to string
      const dbCycle = {
        counter: 1,
        cycleRecord: JSON.stringify(createMockCycleData()),
        cycleMarker: 'db-marker-123'
      } as DbCycle

      expect(dbCycle).toBeDefined()
      expect(dbCycle.counter).toBe(1)
      expect(typeof dbCycle.cycleRecord).toBe('string')
      expect(dbCycle.cycleMarker).toBe('db-marker-123')
    })

    it('should handle conversion between Cycle and DbCycle', () => {
      const cycleData = createMockCycleData()
      const cycle: Cycle = {
        counter: 5,
        cycleRecord: cycleData,
        cycleMarker: 'convert-test'
      }

      // Convert Cycle to DbCycle
      const dbCycle = {
        ...cycle,
        cycleRecord: JSON.stringify(cycle.cycleRecord)
      } as DbCycle

      expect(dbCycle.counter).toBe(cycle.counter)
      expect(dbCycle.cycleMarker).toBe(cycle.cycleMarker)
      expect(typeof dbCycle.cycleRecord).toBe('string')

      // Convert back
      const parsedCycleRecord = JSON.parse(dbCycle.cycleRecord)
      const restoredCycle: Cycle = {
        ...dbCycle,
        cycleRecord: parsedCycleRecord
      }

      expect(restoredCycle.counter).toBe(cycle.counter)
      expect(restoredCycle.cycleMarker).toBe(cycle.cycleMarker)
      expect(restoredCycle.cycleRecord.networkId).toBe(cycleData.networkId)
    })

    it('should handle large serialized cycleRecord', () => {
      const cycleData = createMockCycleData()
      // Add large arrays to make the cycleRecord larger
      cycleData.joined = Array(1000).fill(null).map((_, i) => `node-${i}`)
      
      const dbCycle = {
        counter: 100,
        cycleRecord: JSON.stringify(cycleData),
        cycleMarker: 'large-record'
      } as DbCycle

      expect(dbCycle.cycleRecord.length).toBeGreaterThan(10000)
      
      // Should still be parseable
      const parsed = JSON.parse(dbCycle.cycleRecord)
      expect(parsed.joined).toHaveLength(1000)
    })

    it('should work with type guards', () => {
      const isDbCycle = (obj: unknown): obj is DbCycle => {
        return obj !== null &&
               typeof obj === 'object' &&
               'counter' in obj &&
               'cycleRecord' in obj &&
               'cycleMarker' in obj &&
               typeof (obj as DbCycle).counter === 'number' &&
               typeof (obj as DbCycle).cycleRecord === 'string' &&
               typeof (obj as DbCycle).cycleMarker === 'string'
      }

      const validDbCycle = {
        counter: 1,
        cycleRecord: '{"test": true}',
        cycleMarker: 'marker'
      } as DbCycle

      const invalidDbCycle = {
        counter: 1,
        cycleRecord: { test: true }, // Not a string
        cycleMarker: 'marker'
      }

      expect(isDbCycle(validDbCycle)).toBe(true)
      expect(isDbCycle(invalidDbCycle)).toBe(false)
      expect(isDbCycle(null)).toBe(false)
      expect(isDbCycle(undefined)).toBe(false)
      expect(isDbCycle({})).toBe(false)
    })

    it('should handle empty string cycleRecord', () => {
      const dbCycle = {
        counter: 0,
        cycleRecord: '',
        cycleMarker: 'empty-record'
      } as DbCycle

      expect(dbCycle.cycleRecord).toBe('')
      
      // Parsing empty string would throw, but that's expected
      expect(() => JSON.parse(dbCycle.cycleRecord)).toThrow()
    })

    it('should maintain type compatibility between Cycle and DbCycle', () => {
      const dbCycle = {
        counter: 50,
        cycleRecord: '{}',
        cycleMarker: 'compat-test'
      } as DbCycle

      // DbCycle extends Cycle, so shared properties should be compatible
      const counter: number = dbCycle.counter
      const marker: StateManager.StateMetaDataTypes.CycleMarker = dbCycle.cycleMarker
      
      expect(counter).toBe(50)
      expect(marker).toBe('compat-test')
    })

    it('should work with arrays of DbCycle', () => {
      const dbCycles = Array(5).fill(null).map((_, i) => ({
        counter: i,
        cycleRecord: JSON.stringify({ counter: i }),
        cycleMarker: `marker-${i}`
      } as DbCycle))

      expect(dbCycles).toHaveLength(5)
      
      const filtered = dbCycles.filter(c => c.counter > 2)
      expect(filtered).toHaveLength(2)
      
      const markers = dbCycles.map(c => c.cycleMarker)
      expect(markers).toEqual(['marker-0', 'marker-1', 'marker-2', 'marker-3', 'marker-4'])
    })

    it('should handle special characters in cycleMarker', () => {
      const specialMarkers = [
        'marker with spaces',
        'marker\nwith\nnewlines',
        'marker\twith\ttabs',
        'marker"with"quotes',
        'marker/with/slashes',
        'marker\\with\\backslashes',
        '🚀emoji🌟marker💫',
        '中文标记',
        'مارکر عربی'
      ]

      specialMarkers.forEach(marker => {
        const dbCycle = {
          counter: 1,
          cycleRecord: '{}',
          cycleMarker: marker
        } as DbCycle

        expect(dbCycle.cycleMarker).toBe(marker)
        
        // Should serialize correctly
        const json = JSON.stringify(dbCycle)
        const parsed = JSON.parse(json)
        expect(parsed.cycleMarker).toBe(marker)
      })
    })
  })

  describe('Edge cases and error scenarios', () => {
    it('should handle negative counter values', () => {
      const cycle: Cycle = {
        counter: -1,
        cycleRecord: createMockCycleData(),
        cycleMarker: 'negative-counter'
      }

      expect(cycle.counter).toBe(-1)
    })

    it('should handle floating point counter values', () => {
      const cycle: Cycle = {
        counter: 3.14159,
        cycleRecord: createMockCycleData(),
        cycleMarker: 'float-counter'
      }

      expect(cycle.counter).toBe(3.14159)
    })

    it('should handle very long cycleMarker strings', () => {
      const longMarker = 'x'.repeat(10000)
      const cycle: Cycle = {
        counter: 1,
        cycleRecord: createMockCycleData(),
        cycleMarker: longMarker
      }

      expect(cycle.cycleMarker).toHaveLength(10000)
    })

    it('should maintain reference equality for cycleRecord in Cycle', () => {
      const cycleData = createMockCycleData()
      const cycle1: Cycle = {
        counter: 1,
        cycleRecord: cycleData,
        cycleMarker: 'ref-test-1'
      }
      const cycle2: Cycle = {
        counter: 2,
        cycleRecord: cycleData,
        cycleMarker: 'ref-test-2'
      }

      expect(cycle1.cycleRecord).toBe(cycle2.cycleRecord) // Same reference
    })
  })
})