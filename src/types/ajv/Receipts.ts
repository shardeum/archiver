import { addSchema } from '../../utils/serialization/SchemaHelpers';
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum';
// import { schemaAccountsCopy } from './Accounts'; // Import the schema from Accounts.ts

// Define the regex for IPv4 validation (if needed in nested objects)
const ipv4Regex = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

// Define schemas for nested components
const schemaProposal = {
    type: 'object',
    properties: {
        applied: { type: 'boolean' },
        cant_preApply: { type: 'boolean' },
        accountIDs: { type: 'array', items: { type: 'string' } },
        beforeStateHashes: { type: 'array', items: { type: 'string' } },
        afterStateHashes: { type: 'array', items: { type: 'string' } },
        appReceiptDataHash: { type: 'string' },
        txid: { type: 'string' }
    },
    required: ['applied', 'cant_preApply', 'accountIDs', 'beforeStateHashes', 'afterStateHashes', 'appReceiptDataHash', 'txid'],
    additionalProperties: false
};

const schemaSignature = {
    type: 'object',
    properties: {
        owner: { type: 'string' },
        sig: { type: 'string' }
    },
    required: ['owner', 'sig'],
    additionalProperties: false
};

const schemaSignedReceipt = {
    type: 'object',
    properties: {
        proposal: schemaProposal,
        proposalHash: { type: 'string' },
        signaturePack: {
            type: 'array',
            items: schemaSignature
        },
        voteOffsets: {
            type: 'array',
            items: { type: 'integer' }
        },
        sign: { type: 'object', ...schemaSignature },
        txGroupCycle: { type: 'integer', minimum: 0 }
    },
    required: ['proposal', 'proposalHash', 'signaturePack', 'voteOffsets'],
    additionalProperties: false
};

const schemaGlobalTxReceipt = {
    type: 'object',
    properties: {
        signs: {
            type: 'array',
            items: schemaSignature
        },
        tx: {
            type: 'object',
            properties: {
                address: { type: 'string' },
                addressHash: { type: 'string' },
                value: {},
                when: { type: 'integer' },
                source: { type: 'string' }
            },
            required: ['address', 'addressHash', 'value', 'when', 'source'],
            additionalProperties: false
        },
        txGroupCycle: { type: 'integer', minimum: 0 }
    },
    required: ['signs', 'tx'],
    additionalProperties: false // Excludes `consensusGroup` by default
};


const schemaAppReceiptData = {
    type: 'object',
    properties: {
        accountId: { type: 'string' },
        data: { type: 'object', additionalProperties: true }
    },
    required: ['data'],
    additionalProperties: true
};

const schemaTx = {
    type: 'object',
    properties: {
        originalTxData: { type: 'object', additionalProperties: true },
        txId: { type: 'string' },
        timestamp: { type: 'integer', minimum: 0 }
    },
    required: ['originalTxData', 'txId', 'timestamp'],
    additionalProperties: false
};

// Define the main ArchiverReceipt schema
const schemaArchiverReceipt = {
    type: 'object',
    properties: {
        tx: schemaTx,
        cycle: { type: 'integer', minimum: 0 },
        signedReceipt: { oneOf: [schemaSignedReceipt, schemaGlobalTxReceipt] },
        afterStates: { type: 'array', items: { $ref: AJVSchemaEnum.AccountsCopy } }, // Using imported schema
        beforeStates: { type: 'array', items: { $ref: AJVSchemaEnum.AccountsCopy } }, // Using imported schema
        appReceiptData: schemaAppReceiptData,
        executionShardKey: { type: 'string' },
        globalModification: { type: 'boolean' }
    },
    required: ['tx', 'cycle', 'signedReceipt', 'appReceiptData', 'executionShardKey', 'globalModification'],
    additionalProperties: false
};


const schemaAppliedVote = {
    type: 'object',
    properties: {
        txid: { type: 'string' },
        transaction_result: { type: 'boolean' },
        account_id: {
            type: 'array',
            items: { type: 'string' }
        },
        account_state_hash_after: {
            type: 'array',
            items: { type: 'string' }
        },
        account_state_hash_before: {
            type: 'array',
            items: { type: 'string' }
        },
        cant_apply: { type: 'boolean' },
        node_id: { type: 'string' },
        sign: schemaSignature, // Reference to schemaSignature
        app_data_hash: { type: 'string' }
    },
    required: [
        'txid',
        'transaction_result',
        'account_id',
        'account_state_hash_after',
        'account_state_hash_before',
        'cant_apply',
        'node_id',
        'sign',
        'app_data_hash'
    ],
    additionalProperties: false
};

const schemaConfirmOrChallengeMessage = {
    type: 'object',
    properties: {
        message: { type: 'string' },
        nodeId: { type: 'string' },
        appliedVote: schemaAppliedVote ,
        sign: schemaSignature 
    },
    required: ['message', 'nodeId', 'appliedVote', 'sign'], // All properties are required
    additionalProperties: false
};


// Define the main Receipt schema
const schemaReceipt = {
    type: 'object',
    properties: {
        receiptId: { type: 'string' },
        timestamp: { type: 'integer' },
        applyTimestamp: { type: 'integer' },
        ...schemaArchiverReceipt.properties
    },
    required: ['receiptId', 'timestamp', 'applyTimestamp', ...schemaArchiverReceipt.required
],
    additionalProperties: false
};

// Function to initialize schemas
export function initReceipts(): void {
    addSchemaDependencies();
    addSchemas();
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
    // No external dependencies
}

// Function to register schemas
function addSchemas(): void {
    // addSchema('ReceiptTx', schemaTx);
    addSchema(AJVSchemaEnum.ArchiverReceipt, schemaArchiverReceipt);
    addSchema(AJVSchemaEnum.Receipt, schemaReceipt);
    addSchema(AJVSchemaEnum.GlobalTxReceipt, schemaGlobalTxReceipt);
}
