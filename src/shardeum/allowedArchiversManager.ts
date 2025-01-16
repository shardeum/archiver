import path = require('path')
import fs = require('fs')
import { ethers } from 'ethers'
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import * as Logger from '../Logger'
import { verifyMultiSigs } from '../services/ticketVerification'
import { DevSecurityLevel } from '../types/security'
import { getGlobalNetworkAccount } from '../GlobalAccount'
import { Sign } from '../schemas/ticketSchema'

interface AllowedArchiversConfig {
    allowedArchivers: Array<{
        ip: string
        port: number
        publicKey: string
    }>
    allowedAccounts: { [pubkey: string]: DevSecurityLevel }
    minSigRequired: number
    counter: number
    signatures: Sign[]
}

class AllowedArchiversManager {
    private currentConfig: AllowedArchiversConfig | null = null
    private previousConfigHash: string = ''
    private lastSeenCounter: number = 0
    private configPath: string
    private isInitialized: boolean = false
    private useGlobalAccount: boolean = false
    private globalAccountAllowedSigners: { [key: string]: number } = {}
    private globalAccountMinSigRequired: number = 0

    constructor() {
        this.configPath = ''
    }

    public initialize(configPath: string): void {
        if (this.isInitialized) return

        try {
            this.configPath = path.resolve(configPath)

            // Load initial configuration
            this.loadAndVerifyConfig()

            // Watch for file changes
            fs.watchFile(this.configPath, (curr, prev) => {
                if (curr.mtime !== prev.mtime) {
                    this.loadAndVerifyConfig()
                }
            })

            this.isInitialized = true
        } catch (error) {
            Logger.mainLogger.error('Failed to initialize AllowedArchiversManager:', error)
        }
    }

    public stopWatching(): void {
        if (this.isInitialized) {
            fs.unwatchFile(this.configPath)
            this.isInitialized = false
        }
    }

    public setGlobalAccountConfig(allowedSigners: { [key: string]: DevSecurityLevel }, minSigRequired: number): void {
        // Set initial values
        this.globalAccountAllowedSigners = allowedSigners;
        this.globalAccountMinSigRequired = minSigRequired;
        this.useGlobalAccount = true;

        // Get and apply any updates from the global account
        const globalAccount = getGlobalNetworkAccount(false);
        if (globalAccount) {
            this.applyLatestGlobalAccountChanges(globalAccount);
        }
    }

    private getArchiverWhitelistConfig(): {
        allowedAccounts: { [key: string]: DevSecurityLevel }, minSigRequired: number, signatures: Sign[], counter: number, allowedArchivers: { ip: string, port: number, publicKey: string }[]
    } {
        try {
            const data = fs.readFileSync(this.configPath, 'utf8')
            const newConfig = StringUtils.safeJsonParse(data)
            const allowedAccounts = this.useGlobalAccount ? this.globalAccountAllowedSigners : newConfig.allowedAccounts
            const minSigRequired = this.useGlobalAccount ? this.globalAccountMinSigRequired : newConfig.minSigRequired
            return {
                allowedAccounts: allowedAccounts,
                minSigRequired: minSigRequired,
                signatures: newConfig.signatures,
                counter: newConfig.counter,
                allowedArchivers: newConfig.allowedArchivers
            }
        } catch (error) {
            throw new Error('Failed to read configuration from file')
        }
    }

    private loadAndVerifyConfig(): void {
        try {
            const getArchiverConfig = this.getArchiverWhitelistConfig()
            const payload = {
                allowedArchivers: getArchiverConfig.allowedArchivers,
                counter: getArchiverConfig.counter
            }
            const isValidList = verifyMultiSigs(
                payload,
                getArchiverConfig.signatures,
                getArchiverConfig.allowedAccounts,
                getArchiverConfig.minSigRequired,
                DevSecurityLevel.HIGH
            )
            if (!isValidList.isValid) {
                Logger.mainLogger.error('Invalid signatures in new config')
                return
            }

            const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(StringUtils.safeStringify(payload)))
            if (this.previousConfigHash === '') {
                this.previousConfigHash = payloadHash
                this.currentConfig = getArchiverConfig
                this.lastSeenCounter = payload.counter // Needed in case of archiver restart
                return
            }

            if (this.previousConfigHash !== payloadHash) {
                if (payload.counter > this.lastSeenCounter) {
                    this.lastSeenCounter = payload.counter
                    this.previousConfigHash = payloadHash
                    this.currentConfig = getArchiverConfig
                } else {
                    Logger.mainLogger.error('Rejected config update: counter not incrementing')
                }
            }
        } catch (error) {
            Logger.mainLogger.error('Error loading/verifying config:', error)
        }
    }

    public getCurrentConfig(): AllowedArchiversConfig | null {
        if (!this.currentConfig) {
            Logger.mainLogger.error('No current config found')
            return null
        }
        return this.currentConfig
    }

    public isArchiverAllowed(publicKey: string): boolean {
        if (!this.currentConfig) return false
        return this.currentConfig.allowedArchivers.some(
            archiver => archiver.publicKey === publicKey
        )
    }

    private applyLatestGlobalAccountChanges(globalAccountData: any): void {
        try {
            const changes = globalAccountData.data.listOfChanges;
            if (!changes || changes.length === 0) return;

            // Find the latest change
            const latestChange = changes.reduce((prev, current) => {
                return (current.cycle > prev.cycle) ? current : prev;
            });

            // Check if the latest change affects multisigKeys or archiverWhitelistMinSigRequired
            if (latestChange.change?.debug) {
                if (latestChange.change?.debug?.multisigKeys && latestChange.change?.debug?.multisigKeys.length > 0) {
                    this.globalAccountAllowedSigners = latestChange.change.debug.multisigKeys;
                }
                if (latestChange.change?.debug?.minSigRequiredForArchiverWhitelist !== undefined) {
                    this.globalAccountMinSigRequired = latestChange.change.debug.minSigRequiredForArchiverWhitelist;
                }
            }
        } catch (error) {
            Logger.mainLogger.error('Error applying latest global account changes:', error)
        }

    }
}

export const allowedArchiversManager = new AllowedArchiversManager()