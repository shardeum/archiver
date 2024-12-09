import { addSchema } from '../../utils/serialization/SchemaHelpers';
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum';
// Define the schema for AccountsCopy
const schemaAccountsCopy = {
    type: 'object',
    properties: {
        accountId: { type: 'string' },
        data: { type: 'object', additionalProperties: true }, // Allows nested objects with dynamic keys
        timestamp: { type: 'integer', minimum:0 },
        hash: { type: 'string' },
        cycleNumber: { type: 'integer', nullable: true }, // Optional field
        isGlobal: { type: 'boolean' }
    },
    required: ['accountId', 'data', 'timestamp', 'hash', 'isGlobal'] // cycleNumber is optional
};

// Define the schema for DbAccountCopy
const schemaDbAccountCopy = {
    type: 'object',
    properties: {
        ...schemaAccountsCopy.properties,
        data: { type: 'string' } // Overriding the `data` field to be a string in DbAccountCopy
    },
    required: ['accountId', 'data', 'timestamp', 'hash', 'isGlobal'] // Required fields remain the same
};

// Function to initialize schemas
export function initAccounts(): void {
    addSchemaDependencies();
    addSchemas();
}

// Function to add schema dependencies
function addSchemaDependencies(): void {
    // No external dependencies
}

// Function to register schemas
function addSchemas(): void {
    addSchema( AJVSchemaEnum.AccountsCopy, schemaAccountsCopy);
}
