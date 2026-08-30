## Why

DreamDEX Event Contract automation currently requires bot code, protocol-specific precision, wallet operations, and careful lifecycle handling. EventPilot will let users create and understand a bounded strategy without a wallet while proving that the same deterministic policy can execute safely and verifiably on Somnia Shannon testnet.

## What Changes

- Add live BTC and ETH Event Contract discovery with order-book, lifecycle, freshness, and rollover handling.
- Add a guided, versioned strategy policy builder with plain-English preview, canonical JSON export/import, and hashing.
- Add a shared deterministic evaluator that produces exact tick, lot, cost, guard, and risk results without floating-point protocol values.
- Add browser-local paper sessions that report eligible and skipped decisions without sending transactions or implying guaranteed fills.
- Add a private, funded Shannon testnet runner with dry-run default, IOC-only execution, on-chain status gating, receipt verification, durable idempotency, nonce serialization, risk limits, restart reconciliation, and finalized-market claims.
- Add a public evidence console connecting a strategy hash and snapshot to the decision, transaction, receipt, fill state, finalization, and claim.
- Add responsive, accessible judge-critical flows, deployment, documentation, SDK feedback, and submission evidence.
- Keep OpenSpec in the repository and require propose, review, apply, verify, and archive for behavior changes.

## Non-Goals

- Mainnet writes or production custody.
- Custom Solidity contracts.
- Generative AI, outcome forecasting, guaranteed fills, or profitability claims.
- Public control of the funded runner.
- Advanced portfolio optimization, additional assets, or horizontal runner scaling.

## Capabilities

### New Capabilities

- `live-market-data`: Discover and stream current DreamDEX Event Contract markets with normalized book, lifecycle, freshness, and rollover behavior.
- `strategy-policy`: Create, validate, explain, export, import, and hash a versioned risk-limited Event Contract policy.
- `deterministic-evaluation`: Evaluate a strategy against market and risk snapshots using exact arithmetic and explicit guard outcomes.
- `paper-run`: Run wallet-free browser-local decision simulations and preserve an honest decision timeline.
- `guarded-demo-runner`: Execute operator-approved policies on Shannon testnet with strict write, risk, idempotency, recovery, and claim safeguards.
- `evidence-console`: Publish a read-only, auditable chain from strategy and snapshot through execution and settlement evidence.

### Modified Capabilities

- None. This is the initial EventPilot behavior set.

## Impact

The change creates the TypeScript monorepo, public web application, Fastify control plane, shared strategy package, DreamDEX adapter, SQLite schema, signer queue, test suite, CI, deployment configuration, OpenSpec project configuration, and submission documentation. It introduces a funded testnet execution boundary, so chain enforcement, authentication, secret handling, receipt checks, and restart reconciliation are release-blocking requirements.
