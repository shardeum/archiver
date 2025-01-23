import path = require('path')
import fs = require('fs')
import { Utils as StringUtils } from '@shardeum-foundation/lib-types'
import * as Logger from '../Logger'
import { verifyMultiSigs } from '../services/ticketVerification'
import { DevSecurityLevel } from '../types/security'
import { Sign } from '../schemas/ticketSchema'

interface AllowedArchiversConfig {
    allowedArchivers: Array<{
        ip: string
        port: number
        publicKey: string
    }>
    signatures: Sign[]
}

class AllowedArchiversManager {
    private currentConfig: AllowedArchiversConfig | null = null
    private configPath: string = ''
    private isInitialized: boolean = false
    private globalAccountAllowedSigners: { [key: string]: number } = {}
    private globalAccountMinSigRequired: number = 0

    public initialize(configPath: string): void {
        if (this.isInitialized) {
            return
        }

        try {
            if (!configPath) {
                Logger.mainLogger.error('Config path is required')
                return
            }

            this.configPath = path.resolve(configPath)

            if (!fs.existsSync(this.configPath)) {
                Logger.mainLogger.error('Config file does not exist')
                return
            }

            // Load initial configuration
            this.loadAndVerifyConfig()

            // Watch for file changes
            fs.watchFile(this.configPath, { persistent: true }, (curr, prev) => {
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
        if (this.isInitialized && this.configPath) {
            fs.unwatchFile(this.configPath)
            this.isInitialized = false
        }
    }

    public setGlobalAccountConfig(allowedSigners?: { [key: string]: DevSecurityLevel }, minSigRequired?: number): void {
        if (allowedSigners) {
            this.globalAccountAllowedSigners = allowedSigners
        }
        if (minSigRequired >= 1) {
            this.globalAccountMinSigRequired = minSigRequired
        }
        if (!allowedSigners && !minSigRequired) {
            return
        }
        this.loadAndVerifyConfig() // Reload config to apply changes
    }

    private getArchiverWhitelistConfig(): AllowedArchiversConfig | null {
        try {
            if (!this.configPath) {
                Logger.mainLogger.error('Config path not set')
                return null
            }

            const data = fs.readFileSync(this.configPath, 'utf8')
            const newConfig = StringUtils.safeJsonParse(data)

            if (!this.validateConfig(newConfig)) {
                Logger.mainLogger.error('Invalid config structure')
                return null
            }

            return {
                signatures: newConfig.signatures,
                allowedArchivers: newConfig.allowedArchivers
            }
        } catch (error) {
            Logger.mainLogger.error('Failed to read configuration:', error)
            return null
        }
    }

    private validateConfig(config: any): boolean {
        return !!(
            config &&
            Array.isArray(config.allowedArchivers) &&
            Array.isArray(config.signatures)
        )
    }

    private loadAndVerifyConfig(): void {
        try {
            const getArchiverConfig = this.getArchiverWhitelistConfig()
            if (!getArchiverConfig) {
                Logger.mainLogger.error('Failed to get archiver config')
                return
            }

            const payload = {
                allowedArchivers: getArchiverConfig.allowedArchivers
            }
            const isValidList = verifyMultiSigs(
                payload,
                getArchiverConfig.signatures,
                this.globalAccountAllowedSigners,
                this.globalAccountMinSigRequired,
                DevSecurityLevel.HIGH
            )
            if (!isValidList.isValid) {
                Logger.mainLogger.error('Invalid signatures in new config')
                return
            }
            this.currentConfig = getArchiverConfig
        } catch (error) {
            Logger.mainLogger.error('Error loading/verifying config:', error)
        }
    }

    public getCurrentConfig(): AllowedArchiversConfig | null {
        return this.currentConfig
    }

    public isArchiverAllowed(publicKey: string): boolean {
        if (!publicKey || !this.currentConfig) {
            return false
        }
        return this.currentConfig.allowedArchivers.some(
            archiver => archiver.publicKey === publicKey
        )
    }
}

export const allowedArchiversManager = new AllowedArchiversManager()