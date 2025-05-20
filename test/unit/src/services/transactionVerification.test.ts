import { promises as fs } from 'fs'
import * as path from 'path'
import * as os from 'os'

/* eslint-disable @typescript-eslint/no-var-requires */
describe('Transaction Verification Service secureAccounts override', () => {
  const originalEnv = process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS
  const modulePath = '../../../../src/services/transactionVerification'

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS
    } else {
      process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = originalEnv
    }
    jest.resetModules()
  })

  it('should load secure accounts from absolute path', async () => {
    jest.resetModules()
    const tempFilePath = path.join(os.tmpdir(), `test-secure-accounts-abs-${Date.now()}.json`)
    const testData = [
      {
        Name: 'TestAbs',
        SourceFundsAddress: '0xabc',
        RecipientFundsAddress: '0xdef',
        SecureAccountAddress: '0x123',
      },
    ]
    await fs.writeFile(tempFilePath, JSON.stringify(testData), 'utf8')
    process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = tempFilePath
    const { getSecureAccounts } = require(modulePath)
    const map = getSecureAccounts()
    const account = map.get('TestAbs')
    expect(account).toBeDefined()
    expect(account.SourceFundsAddress).toBe('0xabc')
    await fs.unlink(tempFilePath)
  })

  it('should load secure accounts from relative path', async () => {
    jest.resetModules()
    // Mock fs.existsSync and fs.readFileSync for relative path
    const fsActual = require('fs')
    const staticDir = path.join(process.cwd(), 'static')
    const testFilename = `test-secure-accounts-rel-${Date.now()}.json`
    const filePath = path.join(staticDir, testFilename)
    const testData = [
      {
        Name: 'TestRel',
        SourceFundsAddress: '0xabc',
        RecipientFundsAddress: '0xdef',
        SecureAccountAddress: '0x456',
      },
    ]
    const existsSyncSpy = jest.spyOn(fsActual, 'existsSync').mockImplementation((p) => p === filePath)
    const readFileSyncSpy = jest.spyOn(fsActual, 'readFileSync').mockImplementation(() => JSON.stringify(testData))
    process.env.LOAD_JSON_GENESIS_SECURE_ACCOUNTS = testFilename
    const { getSecureAccounts } = require(modulePath)
    const map = getSecureAccounts()
    const account = map.get('TestRel')
    expect(account).toBeDefined()
    expect(account.SecureAccountAddress).toBe('0x456')
    // restore fs spies
    existsSyncSpy.mockRestore()
    readFileSyncSpy.mockRestore()
  })
})
