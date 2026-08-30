## Purpose

Provide a trustworthy, current, and recoverable view of DreamDEX BTC and ETH Event Contract markets for users, simulations, and the funded testnet runner.

## ADDED Requirements

### Requirement: Dynamic market discovery
The system SHALL discover current supported Event Contract venues and active markets from live DreamDEX data rather than relying on a hard-coded pool address.

#### Scenario: Active supported markets are available
- **WHEN** DreamDEX exposes active BTC or ETH Event Contracts for a supported interval
- **THEN** the system includes each discovered market with its current venue ID and market ID

#### Scenario: A venue identifier changes
- **WHEN** current market data reports a venue ID different from a previously observed venue
- **THEN** the system updates discovery and does not continue writing against the stale venue solely because it was configured earlier

### Requirement: Normalized market identity
The system SHALL identify market state by market ID and SHALL derive asset, interval, strike, and expiry from structured fields instead of parsing display-question text.

#### Scenario: A pool is reused for a new window
- **WHEN** a new Event Contract window uses a previously observed pool address with a new market ID
- **THEN** the system treats it as a new market and does not reuse the prior market's risk or execution state

### Requirement: Observable market snapshot
The system SHALL expose a normalized snapshot containing bid, ask, spread, executable depth, strike, interval, expiry, source timestamp, source block when available, indexer status, and authoritative on-chain status.

#### Scenario: A user opens a live market
- **WHEN** a valid current snapshot is available
- **THEN** the interface displays market-implied pricing, spread, depth, lifecycle, freshness, and time remaining without describing the price as an objective probability

### Requirement: Freshness and lifecycle handling
The system MUST mark snapshots stale after the configured freshness bound and MUST distinguish Trading, locked, finalized, voided, and unknown lifecycle states.

#### Scenario: Snapshot becomes stale
- **WHEN** a snapshot exceeds the configured maximum age
- **THEN** the system marks it stale and excludes it from eligible execution decisions

#### Scenario: Indexer and chain status disagree
- **WHEN** the indexer reports an actionable state but the authoritative chain status is not Trading
- **THEN** the system displays the disagreement and treats the market as ineligible for a write

### Requirement: Stream recovery
The system SHALL provide live normalized updates with cursor-based history and an explicit reset path when retained history is unavailable.

#### Scenario: Client reconnects within retained history
- **WHEN** a client reconnects with its last received cursor
- **THEN** the system returns missed events in order and resumes the live stream without duplicating cursor identities

#### Scenario: Client cursor is too old
- **WHEN** the requested cursor is no longer retained
- **THEN** the system sends a reset indication and the client fetches a current snapshot before resuming

### Requirement: Empty and unavailable data states
The system SHALL represent empty books, unavailable markets, disconnected sources, and reconnection attempts as explicit states.

#### Scenario: Market has no ask liquidity
- **WHEN** the selected outcome has no executable ask
- **THEN** the system displays a no-liquidity state and the evaluator receives an ineligible snapshot rather than a fabricated price
