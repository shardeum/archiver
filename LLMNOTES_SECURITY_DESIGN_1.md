# Ticket Security Design Challenge

## Current Design
- Tickets contain: `{ data: TicketData[], sign: Sign[], type: string }`
- Each ticket requires multisig verification from allowed signers
- Current approach requires entire request body to be signed for updates
- TicketData currently only contains `address` field

## Problems with Current Design
1. Requires full payload signing for each update
2. No way to verify partial updates
3. No way to verify ticket validity over time
4. No built-in mechanism for update authorization

## Potential Solutions to Explore

### 1. Signed Metadata Approach
Add signed metadata to ticket structure that includes:
- Version number
- Valid time range (notBefore, notAfter)
- Allowed operations/mutations
- Allowed updaters (addresses that can update)
- Hash of immutable data

This would allow:
- Partial updates without full resigning
- Time-bound validity
- Operation-specific authorization
- Immutable data verification

### 2. Merkle Tree Approach
Restructure ticket data as a merkle tree where:
- Root is signed by multisig
- Leaves contain individual data elements
- Updates provide merkle proofs
- New data must fit within allowed mutation paths

Benefits:
- Granular updates
- Efficient verification
- Structural validation

### 3. Capability-based Approach
Add a capabilities system where:
- Base ticket is signed with capabilities
- Each capability defines allowed mutations
- Updates must provide valid capability proof
- Capabilities can be delegated

Benefits:
- Fine-grained access control
- Delegatable permissions
- Audit trail

## Initial Recommendation
The Signed Metadata approach seems most suitable because:
1. Simpler to implement and understand
2. Provides necessary security guarantees
3. Flexible for future extensions
4. Maintains compatibility with current verification system 