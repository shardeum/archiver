
import { addSchema } from '../../utils/serialization/SchemaHelpers';
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum';

// Define the schema for OriginalTxData
const schemaOriginalTxData = {
  type: 'object',
  properties: {
    txId: { type: 'string' },                   // txId must be a string
    timestamp: { type: 'integer', minimum: 0 },             // timestamp must be an integer
    cycle: { type: 'integer', minimum: 0 },                 // cycle must be an integer
    originalTxData: { type: 'object' },         // originalTxData must be an object
    // Uncomment if sign is required:
    // sign: { type: 'string' }                 // Sign (if used) must be a string
  },
  required: ['txId', 'timestamp', 'cycle', 'originalTxData'], // Required fields
  additionalProperties: false,                 // Disallow other fields
};


// Function to initialize schemas
export function initOriginalTxData(): void {
    addSchemaDependencies();
    addSchemas();
  }
  
  // Function to add schema dependencies (if any external schemas are needed)
  function addSchemaDependencies(): void {
    // No external dependencies for now
  }
  
  // Function to register schemas
  function addSchemas(): void {
    addSchema(AJVSchemaEnum.OriginalTxData, schemaOriginalTxData);
    
  }
  