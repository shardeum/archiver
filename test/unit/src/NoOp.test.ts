import { describe, expect, it } from '@jest/globals'

describe('NoOp', () => {
  it('should be an empty module', () => {
    // NoOp.ts is intentionally empty (no-op file)
    // This test verifies the file exists and can be imported without errors
    expect(() => require('../../../src/NoOp')).not.toThrow()
  })

  it('should not export anything', () => {
    const noOpModule = require('../../../src/NoOp')
    expect(Object.keys(noOpModule)).toHaveLength(0)
  })
})
