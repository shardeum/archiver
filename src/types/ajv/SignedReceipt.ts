import { addSchema } from '../../utils/serialization/SchemaHelpers'
import { AJVSchemaEnum } from '../enum/AJVSchemaEnum'

export const schemaSign = {
  type: 'object',
  properties: {
    owner: { type: 'string' },
    sig: { type: 'string' },
  },
  required: ['owner', 'sig'],
  additionalProperties: false,
}

export const schemaProposal = {
  type: 'object',
  properties: {
    applied: { type: 'boolean' },
    cant_preApply: { type: 'boolean' },
    accountIDs: {
      type: 'array',
      items: { type: 'string' },
    },
    beforeStateHashes: {
      type: 'array',
      items: { type: 'string' },
    },
    afterStateHashes: {
      type: 'array',
      items: { type: 'string' },
    },
    appReceiptDataHash: { type: 'string' },
    txid: { type: 'string' },
    executionShardKey: { type: 'string' },
  },
  required: [
    'applied',
    'cant_preApply',
    'accountIDs',
    'beforeStateHashes',
    'afterStateHashes',
    'appReceiptDataHash',
    'txid',
  ],
  additionalProperties: false,
}

export const schemaSignedReceipt = {
  type: 'object',
  properties: {
    proposal: schemaProposal,
    proposalHash: { type: 'string' },
    signaturePack: {
      type: 'array',
      items: schemaSign,
    },
    voteOffsets: {
      type: 'array',
      items: { type: 'integer' },
    },
    sign: schemaSign,
  },
  required: ['proposal', 'proposalHash', 'signaturePack', 'voteOffsets'],
  additionalProperties: false,
}

export function initSignedReceiptSchema(): void {
  addSchema(AJVSchemaEnum.SignedReceipt, schemaSignedReceipt)
}
