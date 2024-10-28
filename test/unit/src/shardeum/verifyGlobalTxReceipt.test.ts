import { P2P } from '@shardus/types'
import { Receipt, SignedReceipt } from '../../../../src/dbstore/receipts'
import { InternalTXType, verifyGlobalTxAccountChange } from '../../../../src/shardeum/verifyGlobalTxReceipt'
import { accountSpecificHash } from '../../../../src/shardeum/calculateAccountHash'
describe('verifyGlobalTxAccountChange', () => {
  let mockReceipt: Receipt
  let failedReasons: string[] = []
  let nestedCounterMessages: string[] = []
  beforeEach(() => {
    mockReceipt = {
      receiptId: 'ad84863faee5bc2ad64cf490dfd6d275143d376b4925c8f00a2b3d6020768e85',
      tx: {
        originalTxData: {
          tx: {
            change: {
              change: {
                p2p: {
                  minNodes: 7,
                },
              },
              cycle: 23,
            },
            from: 'fromacc',
            internalTXType: 4,
            isInternalTx: true,
            network: '1000000000000000000000000000000000000000000000000000000000000001',
            timestamp: 1730101530472,
          },
        },
        timestamp: 1730101530472,
        txId: 'ad84863faee5bc2ad64cf490dfd6d275143d376b4925c8f00a2b3d6020768e85',
      },
      cycle: 20,
      applyTimestamp: 1730101530472,
      timestamp: 1730101530472,
      signedReceipt: {
        signs: [
          {
            owner: 'ed4aaf1a342740954d15cb8da44258a24751a0be9e318d9ff3284d98685fefa6',
            sig: '8cec63f94d530b083dd3bbab6d4a190485e28a6f34c194de376de19d01c7fc16a1b65621692ddf60902126587b18897ab3e9f80a9bc3eee70b41933e56b5f10d55f84ac01d3d1d9aa03e05a69041c0959aaa64ef8cb5badbadf976656f2441ac',
          },
        ],
        tx: {
          address: '1000000000000000000000000000000000000000000000000000000000000001',
          addressHash: 'bde86cbbd114082ab47894b39813b10ec0695ae56a154d598b089f273faae398',
          source: 'fromacc',
          value: {
            change: {
              change: {
                p2p: {
                  minNodes: 7,
                },
              },
              cycle: 23,
            },
            from: 'fromacc',
            internalTXType: 4,
            isInternalTx: true,
            network: '1000000000000000000000000000000000000000000000000000000000000001',
            timestamp: 1730101530472,
          },
          when: 1730101530472,
        },
      } as SignedReceipt | P2P.GlobalAccountsTypes.GlobalTxReceipt,
      afterStates: [
        {
          accountId: '1000000000000000000000000000000000000000000000000000000000000001',
          data: {
            accountType: 5,
            current: {
              activeVersion: '1.14.2',
              archiver: {
                activeVersion: '3.5.6',
                latestVersion: '3.5.6',
                minVersion: '3.5.6',
              },
              title: 'Initial parameters',
              txPause: false,
            },
            hash: 'dcf777471e2b171edeb0fb4b4fc76a2a5124f52bdd8d76f9db3b2791b831e199',
            id: '1000000000000000000000000000000000000000000000000000000000000001',
            listOfChanges: [
              {
                change: {
                  crypto: {
                    hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
                    keyPairConfig: {
                      keyPairJsonFile: 'secrets.json',
                      useKeyPairFromFile: true,
                    },
                  },
                  debug: {
                    beforeStateFailChance: 0,
                    canDataRepair: false,
                    useShardusMemoryPatterns: true,
                    voteFlipChance: 0,
                  },
                  features: {
                    startInServiceMode: false,
                  },
                  globalAccount: '1000000000000000000000000000000000000000000000000000000000000001',
                  heartbeatInterval: 5,
                  loadDetection: {
                    queueLimit: 320,
                  },
                  network: {
                    timeout: 5,
                  },
                  nonceMode: true,
                  p2p: {
                    writeSyncProtocolV2: true,
                  },
                  transactionExpireTime: 5,
                },
                cycle: 1,
              },
              {
                change: {
                  p2p: {
                    minNodes: 7,
                  },
                },
                cycle: 23,
              },
            ],
            mode: 'debug',
            next: {},
            timestamp: 1730101530472,
          },
          hash: 'dcf777471e2b171edeb0fb4b4fc76a2a5124f52bdd8d76f9db3b2791b831e199',
          isGlobal: true,
          timestamp: 1730101530472,
        },
      ],
      beforeStates: [
        {
          accountId: '1000000000000000000000000000000000000000000000000000000000000001',
          data: {
            accountType: 5,
            current: {
              activeVersion: '1.14.2',
              archiver: {
                activeVersion: '3.5.6',
                latestVersion: '3.5.6',
                minVersion: '3.5.6',
              },
              title: 'Initial parameters',
              txPause: false,
            },
            hash: 'dcf777471e2b171edeb0fb4b4fc76a2a5124f52bdd8d76f9db3b2791b831e199',
            id: '1000000000000000000000000000000000000000000000000000000000000001',
            listOfChanges: [
              {
                change: {
                  crypto: {
                    hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
                    keyPairConfig: {
                      keyPairJsonFile: 'secrets.json',
                      useKeyPairFromFile: true,
                    },
                  },
                  debug: {
                    beforeStateFailChance: 0,
                    canDataRepair: false,
                    useShardusMemoryPatterns: true,
                    voteFlipChance: 0,
                  },
                  features: {
                    startInServiceMode: false,
                  },
                  globalAccount: '1000000000000000000000000000000000000000000000000000000000000001',
                  heartbeatInterval: 5,
                  loadDetection: {
                    queueLimit: 320,
                  },
                  network: {
                    timeout: 5,
                  },
                  nonceMode: true,
                  p2p: {
                    writeSyncProtocolV2: true,
                  },
                  transactionExpireTime: 5,
                },
                cycle: 1,
              },
              {
                change: {
                  p2p: {
                    minNodes: 7,
                  },
                },
                cycle: 23,
              },
            ],
            mode: 'debug',
            next: {},
            timestamp: 1730101530472,
          },
          hash: 'bde86cbbd114082ab47894b39813b10ec0695ae56a154d598b089f273faae398',
          isGlobal: false,
          timestamp: 1730100436585,
        },
      ],
      appReceiptData: {
        accountId: 'ad84863faee5bc2ad64cf490dfd6d275143d376b4925c8f00a2b3d6020768e85',
        data: {
          accountType: 12,
          amountSpent: '0x0',
          hash: '344fd275ba5fa8460a8164168725bd61f2b27dbf7f0a6e38434b3e9f35f39258',
          readableReceipt: {
            blockHash: '0x42b9f1e93e51007a9d8d41a0decd42c2f77eaff52192f6360c7d408233aa161c',
            blockNumber: '0xd8',
            contractAddress: null,
            cumulativeGasUsed: '0x0',
            data: '0x0',
            from: 'fromacc',
            gasRefund: '0x0',
            gasUsed: '0x0',
            internalTx: {
              change: {
                change: {
                  p2p: {
                    minNodes: 7,
                  },
                },
                cycle: 23,
              },
              from: 'fromacc',
              internalTXType: 4,
              isInternalTx: true,
              network: '1000000000000000000000000000000000000000000000000000000000000001',
              sign: null,
              timestamp: 1730101530472,
            },
            isInternalTx: true,
            logs: [],
            logsBloom: '',
            nonce: '0x0',
            status: 1,
            to: '1000000000000000000000000000000000000000000000000000000000000001',
            transactionHash: '0xad84863faee5bc2ad64cf490dfd6d275143d376b4925c8f00a2b3d6020768e85',
            transactionIndex: '0x1',
            value: '0x0',
          },
          receipt: null,
          timestamp: 1730101530472,
          txFrom: 'fromacc',
          txId: 'ad84863faee5bc2ad64cf490dfd6d275143d376b4925c8f00a2b3d6020768e85',
        },
        stateId: '344fd275ba5fa8460a8164168725bd61f2b27dbf7f0a6e38434b3e9f35f39258',
        timestamp: 1730101530472,
      },
      executionShardKey: 'fromacc',
      globalModification: true,
    }
    failedReasons = []
    nestedCounterMessages = []
  })

  it('should return true for InitNetwork internalTXType', () => {
    if ('tx' in mockReceipt.signedReceipt) {
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = InternalTXType.InitNetwork
      mockReceipt.signedReceipt.tx.value = txValue
    }

    const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

    expect(result).toBe(true)
    expect(failedReasons).toHaveLength(0)
    expect(nestedCounterMessages).toHaveLength(0)
  })

  it('should return false if unexpected account found in beforeStates', () => {
    if ('tx' in mockReceipt.signedReceipt) {
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = InternalTXType.ApplyChangeConfig
      mockReceipt.signedReceipt.tx.value = txValue
      mockReceipt.signedReceipt.tx.address = 'testAddress'
      mockReceipt.signedReceipt.tx.addressHash = 'testHash'
      mockReceipt.beforeStates = [
        { accountId: 'unexpectedAddress', data: {}, timestamp: 0, hash: '', isGlobal: false },
      ]
      const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      expect(result).toBe(false)
      expect(failedReasons).toContain(
        `Unexpected account found in before accounts ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
      )
      expect(nestedCounterMessages).toContain('Unexpected account found in before accounts')
    }
  })

  it('should return false if account hash mismatch in beforeStates', () => {
    // Mock the accountSpecificHash function before modifying mockReceipt
    jest
      .spyOn(require('../../../../src/shardeum/calculateAccountHash'), 'accountSpecificHash')
      .mockReturnValue('wrongHash')

    // Modify mockReceipt for this test case
    if ('tx' in mockReceipt.signedReceipt) {
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = InternalTXType.ApplyChangeConfig
      mockReceipt.signedReceipt.tx.value = txValue
      mockReceipt.signedReceipt.tx.address = 'testAddress'
      mockReceipt.signedReceipt.tx.addressHash = 'testHash'
      const beforeStateData = { someData: 'test' }
      const beforeStateTimestamp = 1730101530472
      mockReceipt.beforeStates = [
        {
          accountId: 'testAddress',
          data: beforeStateData,
          timestamp: beforeStateTimestamp,
          hash: 'actualHash',
          isGlobal: false,
        },
      ]

      const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      expect(result).toBe(false)
      expect(failedReasons).toContain(
        `Account hash before does not match in globalModification tx - testAddress , ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
      )
      expect(nestedCounterMessages).toContain('Account hash before does not match in globalModification tx')

      // Verify accountSpecificHash was called with correct parameters
      expect(accountSpecificHash).toHaveBeenCalledWith(beforeStateData)
    }

    // Clean up mock
    jest.restoreAllMocks()
  })

  it('should return false and add appropriate error messages', () => {
    // Mock the accountSpecificHash function to return a different hash
    jest
      .spyOn(require('../../../../src/shardeum/calculateAccountHash'), 'accountSpecificHash')
      .mockReturnValue('wrongHash')

    // Execute the function
    const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

    // Verify the result is false
    expect(result).toBe(false)

    // Verify error message was added to failedReasons
    const expectedError = `Account hash before does not match in globalModification tx - ${mockReceipt.beforeStates[0].accountId} , ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
    expect(failedReasons).toContain(expectedError)

    // Verify counter message was added
    expect(nestedCounterMessages).toContain('Account hash before does not match in globalModification tx')

    // Verify accountSpecificHash was called with correct parameters
    expect(accountSpecificHash).toHaveBeenCalledWith(mockReceipt.beforeStates[0].data)
  })

  afterEach(() => {
    // Clean up mocks
    jest.restoreAllMocks()
  })

  it('should return false if no network account found in beforeStates', () => {
    if ('tx' in mockReceipt.signedReceipt) {
      // Setup the transaction type
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = InternalTXType.ApplyChangeConfig
      mockReceipt.signedReceipt.tx.address = 'networkAccountId'
      mockReceipt.signedReceipt.tx.addressHash = ''

      // Empty beforeStates to simulate missing network account
      mockReceipt.beforeStates = []
      mockReceipt.afterStates = [
        {
          accountId: 'networkAccountId',
          data: {},
          hash: 'hash',
          timestamp: 0,
          isGlobal: true,
        },
      ]

      const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      expect(result).toBe(false)
      expect(failedReasons).toContain(
        `No network account found in accounts ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
      )
      expect(nestedCounterMessages).toContain('No network account found in accounts')
    }
  })
  //new
  it('should return false if unexpected account found in afterStates', () => {
    if ('tx' in mockReceipt.signedReceipt) {
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = InternalTXType.ApplyChangeConfig
      mockReceipt.signedReceipt.tx.value = txValue
      mockReceipt.signedReceipt.tx.address = 'testAddress'
      mockReceipt.signedReceipt.tx.addressHash = 'testHash'

      // Set valid beforeStates
      mockReceipt.beforeStates = [
        {
          accountId: mockReceipt.signedReceipt.tx.address,
          data: {},
          timestamp: mockReceipt.tx.timestamp,
          hash: 'testHash',
          isGlobal: false,
        },
      ]

      // Set invalid afterStates
      mockReceipt.afterStates = [
        {
          accountId: 'unexpectedAddress',
          data: {},
          timestamp: 0,
          hash: '',
          isGlobal: false,
        },
      ]

      // Mock accountSpecificHash to return the expected hash
      jest
        .spyOn(require('../../../../src/shardeum/calculateAccountHash'), 'accountSpecificHash')
        .mockReturnValue('testHash')

      const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      expect(result).toBe(false)
      expect(failedReasons).toContain(
        `Unexpected account found in accounts ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
      )
      expect(nestedCounterMessages).toContain('Unexpected account found in accounts')
    }
  })

  it('should return false for invalid internalTXType', () => {
    if ('tx' in mockReceipt.signedReceipt) {
      const txValue = mockReceipt.signedReceipt.tx.value as { internalTXType: InternalTXType }
      txValue.internalTXType = 999 as InternalTXType // Invalid type
      mockReceipt.signedReceipt.tx.value = txValue

      const result = verifyGlobalTxAccountChange(mockReceipt, failedReasons, nestedCounterMessages)

      expect(result).toBe(false)
      expect(failedReasons).toContain(
        `Unexpected internal transaction type in the globalModification tx ${mockReceipt.tx.txId} , ${mockReceipt.cycle} , ${mockReceipt.tx.timestamp}`
      )
    }
  })
})
