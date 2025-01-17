import { ethers } from 'ethers';
import * as fs from 'fs';
import { Utils as StringUtils } from '@shardeum-foundation/lib-types';

interface ConfigData {
    allowedArchivers: string[];
}

interface SignaturePayload {
    allowedArchivers: string[];
}

async function generateSignature(): Promise<void> {
    try {

        // Get private key from env or command line
        const privateKey = process.env.PRIVATE_KEY || process.argv[2];
        if (!privateKey) {
            throw new Error('Private key not provided. Set PRIVATE_KEY in .env or provide as command line argument');
        }

        // Read and parse config file
        const configData: ConfigData = StringUtils.safeJsonParse(
            fs.readFileSync('./allowed-archivers.json', 'utf8')
        );

        // Create payload
        const rawPayload: SignaturePayload = {
            allowedArchivers: configData.allowedArchivers
        };

        // Generate hash of payload
        const payloadHash = ethers.keccak256(
            ethers.toUtf8Bytes(StringUtils.safeStringify(rawPayload))
        );

        console.log('Payload hash:', payloadHash);

        // Initialize wallet and sign
        const wallet = new ethers.Wallet(privateKey);
        const signature = await wallet.signMessage(payloadHash);
        console.log('Signature:', signature);
    } catch (error) {
        console.error('Error generating signature:', error);
        process.exit(1);
    }
}

// Execute if running directly
if (require.main === module) {
    generateSignature();
}