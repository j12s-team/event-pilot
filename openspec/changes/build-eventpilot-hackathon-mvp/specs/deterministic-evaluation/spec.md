## Purpose

Produce repeatable, explainable, and exactly bounded strategy decisions from explicit policy, market, risk, and time inputs for both browser simulation and testnet execution.

## ADDED Requirements

### Requirement: Explicit deterministic inputs
The evaluator SHALL accept a strategy policy, market snapshot, risk snapshot, and evaluation time as explicit inputs and SHALL return the same decision for identical inputs.

#### Scenario: Evaluation is repeated
- **WHEN** the evaluator receives byte-equivalent valid inputs twice
- **THEN** it returns decisions with identical eligibility, guard outcomes, exact units, strategy hash, and intent key

### Requirement: Complete guard evaluation
The evaluator SHALL report a stable pass or fail result and human-readable reason for trigger, entry cap, spread, relative spread, depth, freshness, lifecycle, time remaining, cooldown, per-market limit, daily cap, and failure-stop guards.

#### Scenario: Multiple guards fail
- **WHEN** a snapshot is stale and the spread also exceeds the policy limit
- **THEN** the decision is ineligible and reports both failures rather than only the first one

### Requirement: Integer-only protocol arithmetic
The evaluator and protocol conversion layer MUST NOT use JavaScript floating-point values for protocol price, quantity, collateral, tick, or lot calculations.

#### Scenario: Decimal user input is converted
- **WHEN** a valid decimal-string quantity and basis-point price are evaluated
- **THEN** the decision exposes integer tick, lot, raw quantity, raw price, and maximum raw cost values

### Requirement: Cap-preserving quantization
Price and quantity quantization MUST never cause the resulting order to exceed the configured maximum entry price, quantity, or collateral.

#### Scenario: Requested price is between ticks
- **WHEN** a buy limit falls between two valid venue ticks
- **THEN** the evaluator selects a valid tick that does not exceed the configured maximum entry price

#### Scenario: Requested quantity is between lots
- **WHEN** a requested quantity falls between two valid venue lots
- **THEN** the evaluator rounds down to a valid lot quantity and never rounds above the requested quantity or collateral cap

### Requirement: Decision validity
An eligible decision SHALL include a short validity deadline no later than market expiry and SHALL become unusable after that deadline.

#### Scenario: Runner receives an expired decision
- **WHEN** current time is later than the decision validity deadline
- **THEN** the runner rejects the decision and obtains a new snapshot and evaluation before any write

### Requirement: Stable strategy and intent identity
The evaluator SHALL include the canonical strategy hash and a deterministic intent key based on strategy and market evaluation identity.

#### Scenario: Same policy evaluates a new market window
- **WHEN** the same strategy evaluates a new market ID after rollover
- **THEN** the strategy hash remains the same and the intent key changes

### Requirement: No hidden funded-runner state
The public evaluation API MUST NOT depend on undisclosed server risk state.

#### Scenario: Public evaluation includes a risk snapshot
- **WHEN** a client requests an evaluation with valid policy, market, risk, and time inputs
- **THEN** the response is fully explainable from those inputs without consulting the funded runner's private ledger
