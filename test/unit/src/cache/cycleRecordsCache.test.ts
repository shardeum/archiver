import {
  updateCacheFromDB,
  addCyclesToCache,
  getLatestCycleRecordsFromCache,
} from '../../../../src/cache/cycleRecordsCache'
import { P2P } from '@shardeum-foundation/lib-types'
import { queryLatestCycleRecords } from '../../../../src/dbstore/cycles'
import * as Crypto from '../../../../src/Crypto'
import { ArchiverCycleResponse } from '../../../../src/Data/Cycles'

// Mock dependencies
jest.mock('../../../../src/Config', () => ({
  config: {
    REQUEST_LIMIT: {
      MAX_CYCLES_PER_REQUEST: 10,
    },
  },
}))

jest.mock('../../../../src/dbstore/cycles', () => ({
  queryLatestCycleRecords: jest.fn(),
}))

jest.mock('../../../../src/Crypto', () => ({
  sign: jest.fn(),
}))

// Mock console.log to avoid test output pollution
const originalConsoleLog = console.log
beforeAll(() => {
  console.log = jest.fn()
})

afterAll(() => {
  console.log = originalConsoleLog
})

describe('cycleRecordsCache', () => {
  const mockCycleData = (counter: number): P2P.CycleCreatorTypes.CycleData => {
    return {
      counter,
      cycleMarker: `marker-${counter}`,
      networkId: 'test-network',
      previous: counter > 0 ? `marker-${counter - 1}` : '',
      start: 1000 + counter * 100,
      duration: 60,
      networkConfigHash: 'config-hash',
      mode: 'normal',
    } as unknown as P2P.CycleCreatorTypes.CycleData
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('updateCacheFromDB', () => {
    it('should update cache with cycles from database', async () => {
      const mockCycles = [mockCycleData(3), mockCycleData(2), mockCycleData(1)]
      ;(queryLatestCycleRecords as jest.Mock).mockResolvedValue(mockCycles)

      await updateCacheFromDB()

      expect(queryLatestCycleRecords).toHaveBeenCalledWith(10)
    })

    it('should handle database errors gracefully', async () => {
      const error = new Error('Database error')
      ;(queryLatestCycleRecords as jest.Mock).mockRejectedValue(error)

      await updateCacheFromDB()

      expect(console.log).toHaveBeenCalledWith('Error updating latest cache: ', error)
    })

    it('should prevent concurrent updates', async () => {
      let resolveQuery: Function
      const queryPromise = new Promise((resolve) => {
        resolveQuery = resolve
      })
      ;(queryLatestCycleRecords as jest.Mock).mockReturnValue(queryPromise)

      // Start first update
      const update1 = updateCacheFromDB()

      // Try to start second update while first is running
      const update2 = updateCacheFromDB()

      // Resolve the query
      resolveQuery!([mockCycleData(1)])

      await Promise.all([update1, update2])

      // Should only call database once
      expect(queryLatestCycleRecords).toHaveBeenCalledTimes(1)
    })
  })

  describe('addCyclesToCache', () => {
    it('should handle empty cycles array', async () => {
      await addCyclesToCache([])
      // Should not throw error
    })

    it('should sort input cycles by counter', async () => {
      const unsortedCycles = [mockCycleData(3), mockCycleData(1), mockCycleData(2)]

      await addCyclesToCache(unsortedCycles)

      // Check that the input array was sorted
      expect(unsortedCycles[0].counter).toBe(1)
      expect(unsortedCycles[1].counter).toBe(2)
      expect(unsortedCycles[2].counter).toBe(3)
    })
  })

  describe('getLatestCycleRecordsFromCache', () => {
    it('should return signed cycles', async () => {
      const mockCycles = [mockCycleData(3), mockCycleData(2), mockCycleData(1)]
      ;(queryLatestCycleRecords as jest.Mock).mockResolvedValue(mockCycles)

      const mockSignedResponse: ArchiverCycleResponse = {
        cycleInfo: mockCycles.slice(0, 2),
        sign: { owner: 'test', sig: 'test-sig' },
      }
      ;(Crypto.sign as jest.Mock).mockReturnValue(mockSignedResponse)

      const result = await getLatestCycleRecordsFromCache(2)

      expect(Crypto.sign).toHaveBeenCalled()
      expect(result).toBe(mockSignedResponse)
    })

    it('should handle count of zero', async () => {
      ;(queryLatestCycleRecords as jest.Mock).mockResolvedValue([mockCycleData(1)])

      const mockSignedResponse: ArchiverCycleResponse = {
        cycleInfo: [],
        sign: { owner: 'test', sig: 'test-sig' },
      }
      ;(Crypto.sign as jest.Mock).mockReturnValue(mockSignedResponse)

      const result = await getLatestCycleRecordsFromCache(0)

      expect(Crypto.sign).toHaveBeenCalledWith({ cycleInfo: [] })
      expect(result.cycleInfo).toHaveLength(0)
    })
  })
})
