## Purpose

Execute a narrowly bounded operator-approved Event Contract policy on Somnia Shannon testnet while preventing wrong-chain writes, duplicate intents, unsafe precision, nonce races, and unreconciled failures.

## ADDED Requirements

### Requirement: Testnet-only execution
The runner MUST default to dry-run mode and MUST refuse to arm or write unless the configured network and connected chain ID are Somnia Shannon testnet chain ID 50312.

#### Scenario: RPC reports a non-Shannon chain
- **WHEN** the runner is configured for live execution but the RPC reports a chain ID other than 50312
- **THEN** the runner hard-fails before signing and records no transaction intent as sent

### Requirement: Private operator control
Only an authenticated operator SHALL update the active strategy or arm and stop the funded runner, and the API MUST NOT accept or expose a private key.

#### Scenario: Public client attempts to arm the runner
- **WHEN** a request lacks valid operator authentication
- **THEN** the system rejects it, records a redacted security event, and does not change runner state

### Requirement: Pre-write revalidation
Immediately before every order the runner MUST reject stale decisions and MUST confirm the authoritative on-chain market status is Trading.

#### Scenario: Market locks after evaluation
- **WHEN** a previously eligible decision reaches the send boundary but the on-chain status is no longer Trading
- **THEN** the runner records a lifecycle skip and sends no transaction

### Requirement: IOC-only bounded order
EventPilot strategy execution MUST use IOC orders whose quantized price, quantity, maximum cost, and expiry remain within the approved decision and policy limits.

#### Scenario: Unfilled IOC
- **WHEN** a valid IOC reaches the chain but no quantity fills
- **THEN** the system records an unfilled attempt, leaves no intentional resting remainder, and does not charge filled collateral to the risk ledger

### Requirement: Explicit receipt verification
The runner MUST inspect transaction receipt success before recording an order or claim as successful.

#### Scenario: SDK write resolves but transaction reverted
- **WHEN** a write call returns transaction information and the receipt status is reverted
- **THEN** the runner records `MINED_REVERTED`, increments execution failure state, and does not report a fill or success

### Requirement: Durable idempotency
The runner MUST persist a unique prepared intent before sending and MUST prevent more than one live transaction for the same intent key.

#### Scenario: Process restarts after send
- **WHEN** an intent is `SENT` or `UNKNOWN` at startup
- **THEN** the runner reconciles its receipt before allowing a retry or a new conflicting intent

### Requirement: Serialized signer writes
Orders and claims using the funded wallet MUST pass through one serialized signer queue.

#### Scenario: Claim scan and order become ready together
- **WHEN** both operations require the same signer
- **THEN** the system submits them in a deterministic serial order and does not allocate the same nonce twice

### Requirement: Risk ledger behavior
The runner SHALL enforce orders-per-market, daily filled-collateral, cooldown, and consecutive execution-failure limits using durable state.

#### Scenario: IOC is unfilled
- **WHEN** an IOC confirms successfully with zero filled quantity
- **THEN** the runner records the attempt but does not treat it as a mined execution failure or consume filled-collateral budget

#### Scenario: Receipt status is unknown
- **WHEN** the system cannot determine whether a sent transaction succeeded
- **THEN** the runner enters reconciliation mode and blocks a duplicate action for that intent

### Requirement: Finalized-market claims
The runner SHALL scan current-venue binary markets with status `Finalized`, identify claimable positions, and submit idempotent claims through the signer queue.

#### Scenario: A traded market finalizes with a claimable outcome
- **WHEN** the claim scanner finds an unclaimed eligible position
- **THEN** the runner creates a unique claim intent, verifies its receipt, and publishes the claim evidence

### Requirement: Secret-safe operation
The system MUST NOT store or emit private keys, seed phrases, reusable operator tokens, or unredacted secret-bearing errors in source, logs, browser bundles, fixtures, or the database.

#### Scenario: Dependency error contains a configured secret
- **WHEN** an exception message includes a known secret value
- **THEN** structured logging redacts the value before persistence or output
