## Purpose

Provide a wallet-free browser experience that continuously applies the real deterministic evaluator to live market snapshots without sending orders or overstating hypothetical outcomes.

## ADDED Requirements

### Requirement: No-wallet paper session
The system SHALL let a user start, pause, resume, and stop a paper session without connecting a wallet or supplying a key.

#### Scenario: User starts a paper session
- **WHEN** a valid strategy and current market stream are available
- **THEN** the browser begins evaluating snapshots locally without calling any transaction or admin endpoint

### Requirement: Shared evaluator behavior
The paper session SHALL use the same strategy schema and deterministic evaluation logic as the funded runner.

#### Scenario: Browser and server evaluate the same inputs
- **WHEN** both runtimes receive equivalent strategy, market, risk, and time inputs
- **THEN** they produce equivalent guard results and exact order bounds

### Requirement: Honest outcome language
The paper session MUST describe an eligible result as `would submit at this snapshot` and MUST NOT represent it as a guaranteed fill, realized trade, or profit.

#### Scenario: Order book contains eligible ask liquidity
- **WHEN** all strategy guards pass in a paper session
- **THEN** the timeline records a hypothetical submission decision and clearly distinguishes it from an on-chain fill

### Requirement: Decision timeline
The system SHALL display eligible and skipped evaluations with timestamp, market ID, strategy hash, guard results, and exact bounded order values when applicable.

#### Scenario: Evaluation is skipped by cooldown
- **WHEN** the local paper risk snapshot is inside the configured cooldown
- **THEN** the timeline records a skipped decision with the cooldown reason and remaining duration

### Requirement: Local persistence and recovery
The browser SHALL persist a bounded paper history and SHALL recover valid local state after reload without creating funded-runner state.

#### Scenario: Browser reloads during a paper session
- **WHEN** saved policy and history are valid
- **THEN** the application restores them and requires an explicit user action before resuming live evaluation

#### Scenario: Saved local state is corrupt
- **WHEN** local paper data fails schema validation
- **THEN** the application discards or quarantines the invalid portion, reports recovery, and does not send it to the control plane

### Requirement: Market rollover behavior
The paper session SHALL start a new per-market risk context when the selected series rolls to a new market ID.

#### Scenario: Current window expires and a new market appears
- **WHEN** the live selector resolves to a new market ID
- **THEN** the timeline records the rollover and does not count the prior market's per-market order limit against the new market
