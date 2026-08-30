## 1. Repository and OpenSpec foundation

- [x] 1.1 Initialize the pnpm TypeScript workspace with `apps/web`, `apps/control-plane`, and shared package directories.
- [ ] 1.2 Initialize OpenSpec for Codex, commit generated workflow files, and confirm `openspec/config.yaml` is active.
- [x] 1.3 Add strict TypeScript, formatting, linting, Vitest, Playwright, and root `check` scripts.
- [x] 1.4 Add environment schema validation with Shannon-only network constants and `DRY_RUN=true` as the default.
- [x] 1.5 Add structured logging with allowlisted fields and automated secret-redaction tests.
- [x] 1.6 Add CI for install, OpenSpec strict validation, lint, typecheck, tests, and production builds.
- [x] 1.7 Add MIT license, contribution notes, and a README skeleton with testnet and educational-use disclaimers.

## 2. DreamDEX read adapter and live market data

- [ ] 2.1 Pin `@somnia-chain/markets-sdk` to `0.28.1`, commit the lockfile, and record the version in diagnostics.
- [x] 2.2 Implement runtime venue and active binary-market discovery without trusting a durable pool address.
- [x] 2.3 Normalize BTC and ETH 15-minute and 1-hour markets into `MarketSnapshotV1` using strike and interval fields.
- [x] 2.4 Read best bid, best ask, depth, spread, expiry, indexer timestamp, and source block where available.
- [x] 2.5 Add authoritative on-chain lifecycle reads and distinguish indexer status from chain status.
- [x] 2.6 Implement snapshot freshness calculation, stale rejection, empty-book behavior, and disconnected behavior.
- [x] 2.7 Implement market rollover keyed by market ID and prove pool reuse does not carry state forward.
- [x] 2.8 Add deterministic market fixtures plus live integration diagnostics for Shannon.
- [x] 2.9 Expose `GET /v1/health`, `GET /v1/markets`, and cursor-backed `GET /v1/markets/stream`.
- [x] 2.10 Add unit and integration tests for discovery, normalization, stale data, empty books, lifecycle states, reconnect, and rollover.

## 3. Strategy policy and deterministic evaluation

- [x] 3.1 Define and validate `StrategyV1`, `MarketSnapshotV1`, `RiskSnapshotV1`, and `DecisionV1` shared schemas.
- [x] 3.2 Implement canonical strategy serialization, hash generation, JSON export, and JSON import validation.
- [x] 3.3 Implement trigger semantics with a separate maximum entry price for both `lte` and `gte` triggers.
- [x] 3.4 Implement integer-only price conversion into venue ticks with cap-preserving rounding.
- [x] 3.5 Implement integer-only quantity conversion into venue lots with quantity- and collateral-preserving rounding.
- [x] 3.6 Implement spread, relative spread, time remaining, snapshot age, depth, lifecycle, cooldown, per-market, daily, and failure-stop guards.
- [x] 3.7 Produce stable guard codes and human-readable explanations for every passing and failing rule.
- [x] 3.8 Generate bounded decision validity, exact raw values, maximum cost, strategy hash, and intent key.
- [x] 3.9 Expose `POST /v1/evaluations` with explicit market and risk snapshots rather than hidden server state.
- [x] 3.10 Add boundary and property tests proving no protocol float use and no cap can be exceeded through rounding.

## 4. Public web experience

- [x] 4.1 Build the responsive application shell with persistent testnet, educational-use, and data-freshness labels.
- [x] 4.2 Build Live Markets cards and detail view with implied probability, bid/ask, spread, depth, status, and countdown.
- [x] 4.3 Build loading, empty-book, stale, disconnected, reconnecting, locked, finalized, and rolled-market states.
- [x] 4.4 Build the guided Strategy Studio for selector, trigger, entry cap, market guards, order limits, and risk limits.
- [x] 4.5 Add immediate validation, plain-English preview, canonical hash display, export, and import.
- [x] 4.6 Build the decision inspector with guard results, exact ticks, lots, cost, snapshot source, and validity.
- [x] 4.7 Add keyboard navigation, visible focus, contrast checks, reduced-motion support, and semantic announcements.
- [x] 4.8 Add desktop and mobile Playwright flows for market discovery, strategy creation, import/export, and evaluate-now.

## 5. Browser-local paper run

- [x] 5.1 Implement a local paper session state machine with start, pause, resume, stop, and clear behavior.
- [x] 5.2 Consume live normalized snapshots and run the shared evaluator without any transaction path.
- [x] 5.3 Persist paper strategy, risk snapshot, and bounded decision history in local storage.
- [x] 5.4 Render eligible and skipped timeline entries with precise reasons and `would submit at this snapshot` language.
- [x] 5.5 Account for local cooldown, orders-per-market, and daily hypothetical collateral without claiming actual fills.
- [x] 5.6 Add browser tests proving paper mode never calls admin or transaction endpoints.
- [x] 5.7 Add recovery tests for reload, corrupted local state, market rollover, stream reset, and strategy replacement.

## 6. Guarded Shannon demo runner

- [x] 6.1 Add SQLite and Drizzle schemas for strategy versions, runner state, risk ledgers, intents, transactions, fills, claims, evidence, and operator audit.
- [x] 6.2 Enable WAL, busy timeout, unique constraints, migrations, persistent-volume paths, and a single-runner wallet lease.
- [x] 6.3 Implement private operator authentication for strategy update, arm, and stop without accepting private keys.
- [x] 6.4 Add startup and pre-arm checks for configured network, RPC chain ID 50312, dedicated wallet, balances, and dry-run status.
- [x] 6.5 Implement the single signer queue used by both orders and claims.
- [x] 6.6 Persist a unique `PREPARED` execution intent before any send and reject duplicate intent keys.
- [x] 6.7 Re-check snapshot age and authoritative on-chain `Trading` status immediately before signing.
- [x] 6.8 Implement cap-preserving IOC order submission with expiry capped at the market expiry.
- [x] 6.9 Extract or fetch the transaction receipt and transition intent state only after explicit success or revert inspection.
- [x] 6.10 Record unfilled, partial, full, reverted, and unknown outcomes with correct risk-ledger effects.
- [x] 6.11 Block new writes while an unknown receipt is awaiting reconciliation.
- [x] 6.12 Reconcile `SENT` and `UNKNOWN` records on restart before accepting new intents.
- [x] 6.13 Add integration tests for wrong chain, stale snapshot, non-Trading market, duplicate intent, receipt revert, partial fill, unfilled IOC, restart, and log redaction.

## 7. Settlement, claims, and evidence

- [x] 7.1 Implement finalized binary-market discovery using the current venue and `Finalized` status.
- [x] 7.2 Detect claimable positions and submit claims through the shared signer queue.
- [x] 7.3 Make claim attempts idempotent and reconcile claim receipts after restart.
- [x] 7.4 Build append-only evidence events linking strategy, snapshot, decision, intent, transaction, receipt, fill, lifecycle, and claim.
- [x] 7.5 Expose public read-only runner status, cursor event history, and evidence detail endpoints.
- [x] 7.6 Build Demo Runner and Evidence Console screens with Somnia explorer links and honest failure states.
- [x] 7.7 Add Judge Mode that opens a prepared strategy and last verified evidence without fabricating current liquidity.
- [ ] 7.8 Produce at least one explorer-verifiable Event Contract testnet write and store its redacted evidence record.
- [ ] 7.9 Produce a verified settlement scan and claim when a traded market finalizes, or document the observed scanner state and retain the most recent valid claim evidence.

## 8. Deployment, quality, and submission

- [ ] 8.1 Deploy the web app to Vercel and the single-replica control plane to Railway with a persistent volume.
- [ ] 8.2 Verify CORS, rate limits, health checks, SSE proxy behavior, restart recovery, and runner lease behavior in deployment.
- [ ] 8.3 Inspect the production browser bundle, logs, database, source history, and fixtures for secrets or operator tokens.
- [ ] 8.4 Run the fresh-checkout install, strict OpenSpec validation, lint, typecheck, unit, integration, Playwright, and production build gates.
- [x] 8.5 Complete responsive and accessibility review for the exact judge journey.
- [ ] 8.6 Freeze feature work on September 5 and move all non-P0 defects or ideas to a post-hackathon OpenSpec change.
- [x] 8.7 Write the final README with setup, architecture, integration, risk model, limitations, judging steps, and evidence links.
- [x] 8.8 Write the SDK and documentation feedback report with reproducible observations and constructive recommendations.
- [ ] 8.9 Record and edit the two-to-three-minute demo video following the agreed script.
- [ ] 8.10 Create the release tag, verify public links, archive completed OpenSpec changes, and submit on September 7.
