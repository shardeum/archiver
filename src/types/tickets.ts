export type TicketData = {
    address: string;
}

export type TicketMetadata = {
    version: number;
    notBefore: number;  // Unix timestamp
    notAfter: number;   // Unix timestamp
    allowedUpdaters: string[];  // Ethereum addresses
    allowedOperations: ('ADD_ADDRESS' | 'REMOVE_ADDRESS')[];
    dataHash: string;   // keccak256 hash of immutable data
    nonce: number;      // For replay protection
}

export type Sign = {
    owner: string;
    sig: string;
}

export type TicketType = 'silver';

export type Ticket = {
    type: TicketType;
    data: TicketData[];
    metadata: TicketMetadata;
    metadataSignatures: Sign[];  // Signatures of metadata by allowed signers
    updateProof?: {
        operation: string;
        updater: string;
        previousDataHash: string;
        signature: string;  // Signature by an allowed updater
    };
} 