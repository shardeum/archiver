import { Sign, InternalTXType, DebugTXType } from '../../../../src/types/internalTxType'

describe('internalTxType', () => {
  describe('Sign interface', () => {
    it('should create a valid Sign object with owner and sig properties', () => {
      const sign: Sign = {
        owner: '0x1234567890abcdef',
        sig: '0xabcdef1234567890',
      }

      expect(sign).toBeDefined()
      expect(sign.owner).toBe('0x1234567890abcdef')
      expect(sign.sig).toBe('0xabcdef1234567890')
    })

    it('should accept empty strings for owner and sig', () => {
      const sign: Sign = {
        owner: '',
        sig: '',
      }

      expect(sign.owner).toBe('')
      expect(sign.sig).toBe('')
    })

    it('should accept long strings for owner and sig', () => {
      const longString = 'a'.repeat(1000)
      const sign: Sign = {
        owner: longString,
        sig: longString,
      }

      expect(sign.owner).toHaveLength(1000)
      expect(sign.sig).toHaveLength(1000)
    })

    it('should be assignable with valid properties', () => {
      const sign = {} as Sign
      sign.owner = 'test-owner'
      sign.sig = 'test-signature'

      expect(sign.owner).toBe('test-owner')
      expect(sign.sig).toBe('test-signature')
    })
  })

  describe('InternalTXType enum', () => {
    it('should have correct numeric values for all transaction types', () => {
      expect(InternalTXType.SetGlobalCodeBytes).toBe(0)
      expect(InternalTXType.InitNetwork).toBe(1)
      expect(InternalTXType.NodeReward).toBe(2)
      expect(InternalTXType.ChangeConfig).toBe(3)
      expect(InternalTXType.ApplyChangeConfig).toBe(4)
      expect(InternalTXType.SetCertTime).toBe(5)
      expect(InternalTXType.Stake).toBe(6)
      expect(InternalTXType.Unstake).toBe(7)
      expect(InternalTXType.InitRewardTimes).toBe(8)
      expect(InternalTXType.ClaimReward).toBe(9)
      expect(InternalTXType.ChangeNetworkParam).toBe(10)
      expect(InternalTXType.ApplyNetworkParam).toBe(11)
      expect(InternalTXType.Penalty).toBe(12)
      expect(InternalTXType.TransferFromSecureAccount).toBe(13)
    })

    it('should be able to use enum values in switch statements', () => {
      const testSwitch = (txType: InternalTXType): string => {
        switch (txType) {
          case InternalTXType.Stake:
            return 'stake'
          case InternalTXType.Unstake:
            return 'unstake'
          case InternalTXType.InitNetwork:
            return 'init'
          default:
            return 'other'
        }
      }

      expect(testSwitch(InternalTXType.Stake)).toBe('stake')
      expect(testSwitch(InternalTXType.Unstake)).toBe('unstake')
      expect(testSwitch(InternalTXType.InitNetwork)).toBe('init')
      expect(testSwitch(InternalTXType.Penalty)).toBe('other')
    })

    it('should be able to get string keys from enum values', () => {
      const stakeName = InternalTXType[InternalTXType.Stake]
      expect(stakeName).toBe('Stake')

      const initNetworkName = InternalTXType[InternalTXType.InitNetwork]
      expect(initNetworkName).toBe('InitNetwork')
    })

    it('should be able to check if a value is a valid InternalTXType', () => {
      const validValues = Object.values(InternalTXType).filter((v) => typeof v === 'number')

      expect(validValues).toContain(0)
      expect(validValues).toContain(13)
      expect(validValues).not.toContain(14)
      expect(validValues).not.toContain(-1)
    })

    it('should handle deprecated transaction types correctly', () => {
      // Deprecated types should still have their values
      expect(InternalTXType.SetGlobalCodeBytes).toBe(0)
      expect(InternalTXType.NodeReward).toBe(2)

      // They should still be part of the enum
      expect(InternalTXType[0]).toBe('SetGlobalCodeBytes')
      expect(InternalTXType[2]).toBe('NodeReward')
    })

    it('should maintain correct ordering of enum values', () => {
      const numericValues = Object.values(InternalTXType).filter((v) => typeof v === 'number') as number[]

      // Should be sequential from 0 to 13
      expect(numericValues).toHaveLength(14)
      expect(Math.min(...numericValues)).toBe(0)
      expect(Math.max(...numericValues)).toBe(13)

      // Check they are sequential
      numericValues.sort((a, b) => a - b)
      for (let i = 0; i < numericValues.length; i++) {
        expect(numericValues[i]).toBe(i)
      }
    })
  })

  describe('DebugTXType enum', () => {
    it('should have correct numeric values', () => {
      expect(DebugTXType.Create).toBe(0)
      expect(DebugTXType.Transfer).toBe(1)
    })

    it('should be able to get string keys from enum values', () => {
      expect(DebugTXType[DebugTXType.Create]).toBe('Create')
      expect(DebugTXType[DebugTXType.Transfer]).toBe('Transfer')
    })

    it('should be usable in type guards', () => {
      const isDebugTXType = (value: unknown): value is DebugTXType => {
        return value === DebugTXType.Create || value === DebugTXType.Transfer
      }

      expect(isDebugTXType(0)).toBe(true)
      expect(isDebugTXType(1)).toBe(true)
      expect(isDebugTXType(2)).toBe(false)
      expect(isDebugTXType('Create')).toBe(false)
    })

    it('should work with array includes', () => {
      const validDebugTypes = [DebugTXType.Create, DebugTXType.Transfer]

      expect(validDebugTypes.includes(DebugTXType.Create)).toBe(true)
      expect(validDebugTypes.includes(DebugTXType.Transfer)).toBe(true)
      expect(validDebugTypes.includes(2 as DebugTXType)).toBe(false)
    })
  })

  describe('Type compatibility and edge cases', () => {
    it('should not allow InternalTXType and DebugTXType to be used interchangeably', () => {
      const internalType: InternalTXType = InternalTXType.InitNetwork
      const debugType: DebugTXType = DebugTXType.Create

      // TypeScript should prevent this at compile time, but values are still numbers
      expect(typeof internalType).toBe('number')
      expect(typeof debugType).toBe('number')
      expect(internalType).not.toBe(debugType)
    })

    it('should handle boundary values correctly', () => {
      // Test maximum values
      const maxInternal = InternalTXType.TransferFromSecureAccount
      const maxDebug = DebugTXType.Transfer

      expect(maxInternal).toBe(13)
      expect(maxDebug).toBe(1)

      // Test that next values don't exist
      expect(InternalTXType[14]).toBeUndefined()
      expect(DebugTXType[2]).toBeUndefined()
    })

    it('should be serializable to JSON', () => {
      const data = {
        sign: {
          owner: 'test',
          sig: 'signature',
        } as Sign,
        internalType: InternalTXType.Stake,
        debugType: DebugTXType.Transfer,
      }

      const json = JSON.stringify(data)
      const parsed = JSON.parse(json)

      expect(parsed.sign.owner).toBe('test')
      expect(parsed.sign.sig).toBe('signature')
      expect(parsed.internalType).toBe(6)
      expect(parsed.debugType).toBe(1)
    })
  })
})
