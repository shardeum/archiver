# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

### Build and Development
- **Build the project**: `npm run compile` or `npm run build`
- **Start the archiver**: `npm start` (builds first, then runs)
- **Clean build artifacts**: `npm run clean`
- **Watch mode development**: Use TypeScript compiler directly with `tsc --watch`

### Code Quality
- **Lint code**: `npm run lint`
- **Fix linting issues**: `npm run fix`
- **Format check**: `npm run format-check`
- **Format fix**: `npm run format-fix`

### Testing
- **Run all tests**: `npm test`
- **Run tests in watch mode**: `npm run test:watch`
- **Run a single test file**: `npx jest test/unit/path/to/test.test.ts`
- **Run tests matching pattern**: `npx jest -t "test description pattern"`

### Release Process
- **Release patch**: `npm run release:patch`
- **Release minor**: `npm run release:minor`
- **Pre-release**: `npm run release:prerelease`

## High-Level Architecture

### System Overview
The Shardeum Archiver is a distributed node that maintains the complete state and history of the Shardus/Shardeum blockchain network. It works alongside Consensors (validator nodes) to ensure data integrity and availability.

### Core Responsibilities
1. **Data Archival**: Stores complete network history including transactions, receipts, and state changes
2. **Network Discovery**: Publishes lists of active network participants for new nodes joining
3. **Data Synchronization**: Syncs data between multiple archiver instances
4. **API Services**: Provides REST APIs for querying historical data

### Key Architectural Components

#### Data Flow
1. **Consensors** → **Archivers**: Consensors send cycle data, transactions, and receipts to subscribed archivers
2. **Archivers** ↔ **Archivers**: Archivers synchronize data using the sync-v2 protocol
3. **Clients** → **Archivers**: External clients query archivers for historical data via REST APIs

#### Database Layer (`/src/dbstore/`)
- Uses SQLite3 for persistent storage
- Separate databases for different data types (cycles, transactions, receipts, etc.)
- Implements connection pooling and query optimization
- Key stores: `cycles.ts`, `transactions.ts`, `receipts.ts`, `accounts.ts`

#### Synchronization Protocol (`/src/sync-v2/`)
- Distributed synchronization between archiver nodes
- Uses range-based queries for efficient data transfer
- Implements data validation and verification
- Handles network partitions and rejoins

#### API Layer (`/src/API.ts` and `/src/routes/`)
- Fastify-based REST API server
- Rate limiting and CORS protection
- Endpoints for querying transactions, accounts, cycles, and network state
- WebSocket support for real-time updates

#### Data Collection (`/src/Data/`)
- `Collector.ts`: Main data collection orchestrator
- `Cycles.ts`: Processes cycle chain data
- `Transactions.ts`: Handles transaction processing
- Implements data validation and schema verification

### Important Design Patterns

1. **Event-Driven Architecture**: Uses event emitters for loosely coupled components
2. **Database Abstraction**: All DB operations go through the dbstore layer
3. **Type Safety**: Extensive TypeScript types in `/src/types/`
4. **Error Handling**: Uses Result types (neverthrow library) for error handling
5. **Logging**: Structured logging with log4js throughout the codebase

### Configuration
- Runtime config: `archiver-config.json`
- Logging config: `archiver-log.json`
- Network whitelist: `allowed-archivers.json`
- Environment-specific genesis files in `/static/`

### Testing Strategy
- Unit tests mirror source structure in `/test/unit/`
- Mock external dependencies (database, network calls)
- Focus on data validation and transformation logic
- Use Jest fake timers for time-dependent tests