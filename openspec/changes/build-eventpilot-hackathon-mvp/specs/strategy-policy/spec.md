## Purpose

Let a user create, understand, validate, share, and reproduce a bounded Event Contract strategy policy without connecting a wallet or writing bot code.

## ADDED Requirements

### Requirement: Versioned strategy policy
The system SHALL create a versioned strategy policy that includes network, market selector, outcome, trigger, maximum entry, market guards, IOC order limits, and risk limits.

#### Scenario: User completes a valid policy
- **WHEN** the user provides all required fields within supported bounds
- **THEN** the system creates a valid `StrategyV1` artifact without requiring a wallet

### Requirement: Trigger and entry separation
The system MUST represent the trigger condition separately from the maximum permitted entry price.

#### Scenario: Momentum trigger exceeds safe entry
- **WHEN** a `gte` trigger is satisfied but the current ask is above the configured maximum entry price
- **THEN** the strategy remains ineligible and explains that the entry cap failed

### Requirement: Immediate policy validation
The system SHALL validate field ranges, decimal strings, unsupported combinations, and risk conflicts before a policy can be evaluated or activated.

#### Scenario: Maximum collateral is below minimum possible order cost
- **WHEN** the configured quantity and minimum venue units cannot fit within maximum collateral
- **THEN** the system rejects the policy and identifies the conflicting fields

### Requirement: Human-readable policy preview
The system SHALL render a plain-English preview that preserves the exact semantics of the structured policy.

#### Scenario: User changes a threshold
- **WHEN** the trigger or guard value changes
- **THEN** the preview updates immediately and describes the same comparator, outcome, and limit stored in the policy

### Requirement: Canonical serialization and hash
The system SHALL produce deterministic canonical bytes and a stable strategy hash for semantically identical valid policies.

#### Scenario: Equivalent policy is imported with different JSON key order
- **WHEN** an imported valid policy has the same values but a different object key order
- **THEN** the system produces the same canonical strategy hash

### Requirement: Export and import
The system SHALL allow users to export a valid strategy as JSON and import a supported strategy version with full validation.

#### Scenario: Unsupported strategy version is imported
- **WHEN** a user imports a policy version the application does not support
- **THEN** the system rejects it without silently changing its meaning and reports the unsupported version

### Requirement: Safe product language
The system MUST identify order-book prices as market-implied and MUST NOT claim guaranteed fills, profit, auditing, or production readiness.

#### Scenario: Strategy preview is shown
- **WHEN** the application describes the potential action
- **THEN** it uses bounded execution language and does not present the rule as a prediction or profit guarantee
