## Purpose

Give judges and public users a read-only, durable, and honest record connecting an EventPilot strategy and market snapshot to each testnet execution and settlement result.

## ADDED Requirements

### Requirement: Complete evidence chain
The system SHALL link each execution intent to its strategy hash, market snapshot, deterministic decision, state transitions, transaction hash, receipt summary, fill state, lifecycle state, and related claim when available.

#### Scenario: Confirmed order evidence is opened
- **WHEN** a user opens a confirmed intent
- **THEN** the console displays the strategy and decision identity plus an explorer link to the verified transaction receipt

### Requirement: Append-only historical evidence
Published evidence SHALL remain available after market rollover, application restart, or newer events and SHALL not be silently rewritten to match current market data.

#### Scenario: Market rolls after a transaction
- **WHEN** the active series changes to a new market ID
- **THEN** the prior intent continues to display its original snapshot, decision, and transaction evidence

### Requirement: Honest execution states
The console MUST distinguish prepared, sent, mined-success, mined-reverted, unknown, unfilled, partial-fill, full-fill, finalized, claimable, and claimed states.

#### Scenario: Transaction is mined but unfilled
- **WHEN** an IOC receipt succeeds with zero fill
- **THEN** the console reports a successful transaction and unfilled order rather than a filled trade

#### Scenario: Transaction receipt is unavailable
- **WHEN** an intent remains unresolved
- **THEN** the console reports unknown and reconciliation in progress without claiming success or failure

### Requirement: Public read-only access
Public users SHALL view runner health and evidence without receiving operator credentials, signer controls, or secret-bearing diagnostics.

#### Scenario: Public evidence response is requested
- **WHEN** an unauthenticated user requests a public evidence item
- **THEN** the system returns the redacted evidence model and no private control or secret field

### Requirement: Explorer linking
Every on-chain order and claim record SHALL provide a chain-appropriate explorer link derived from the verified Shannon transaction hash.

#### Scenario: User follows an explorer link
- **WHEN** a verified transaction hash is present
- **THEN** the interface links to the Somnia Shannon explorer and identifies whether the transaction represents an order or claim

### Requirement: Judge Mode
The system SHALL provide a prepared, clearly labeled judge path to the latest verified evidence without fabricating current liquidity or lifecycle state.

#### Scenario: Current live market has no liquidity
- **WHEN** a judge opens Judge Mode during an empty book
- **THEN** the application still shows current live integration and separately opens a previously verified evidence record with its original timestamp

### Requirement: Accessible failure and recovery presentation
The console SHALL make stale, disconnected, stopped, reverted, unknown, and reconciliation states perceivable through text and accessible status semantics, not color alone.

#### Scenario: Runner is stopped after an error
- **WHEN** a user views runner health
- **THEN** the interface states that the runner is stopped, presents the redacted reason and last safe action, and does not imply continued automation
