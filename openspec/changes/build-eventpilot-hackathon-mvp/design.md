## Context

See `proposal.md` for motivation and scope. EventPilot must demonstrate meaningful DreamDEX Event Contract integration in a short hackathon sprint while giving judges a reliable no-wallet experience and preserving a strict separation between the public browser and the funded Shannon signer.

The official Bot Kit documents several protocol sharp edges: venue identifiers can move, indexer state can lag the chain, reverted writes may resolve, floating-point prices can fall off the tick grid, unfilled non-IOC orders can leave escrowed balances, order expiry is mandatory, lot sizing must be exact, markets roll to new IDs, claims share the signer nonce, and finalized markets require a dedicated binary-market scan.

## Goals / Non-Goals

**Goals:**

- Deliver a polished no-wallet strategy builder and deterministic paper decision experience.
- Use the same versioned policy and evaluator for simulation and the funded runner.
- Demonstrate at least one explorer-verifiable DreamDEX Event Contract write on Shannon.
- Make every runner action explainable and linked to durable evidence.
- Preserve exact arithmetic, bounded risk, testnet-only writes, receipt verification, idempotency, and restart recovery.
- Keep OpenSpec as the repository's durable planning and acceptance system.

**Non-Goals:**

- Mainnet execution, public custody, or user-managed hosted keys.
- Price prediction, AI-generated signals, guaranteed fills, or return calculations.
- Custom smart contracts or protocol modifications.
- Multi-replica signer execution.
- Full historical exchange simulation.

## Decisions

### 1. Use the OpenSpec `spec-driven` workflow

**Decision:** Commit `openspec/config.yaml`, active changes, main specs, and archives. Require proposal, delta specs, design, tasks, verification, and archive for behavior changes.

**Rationale:** The product spans UI, protocol, risk, persistence, and security boundaries. Durable scenarios prevent chat-only assumptions and give judges inspectable engineering evidence.

**Alternative considered:** Keep only `AGENTS.md` and ad hoc plans. Rejected because it does not create a testable behavior contract or history of shipped intent.

### 2. Keep React and Vite for the public app

**Decision:** Use a client-first React/Vite app with Tailwind and accessible headless components.

**Rationale:** The product does not require server rendering or SEO to satisfy the hackathon. Vite reduces framework surface while the dedicated Fastify service owns streaming and runner APIs.

**Alternative considered:** Next.js. Rejected for the sprint because it adds another server boundary without improving the core judging path.

### 3. Use a TypeScript pnpm monorepo

**Decision:** Create `apps/web`, `apps/control-plane`, `packages/strategy`, `packages/dreamdex-adapter`, `packages/contracts`, and `packages/test-fixtures`.

**Rationale:** Shared schemas and evaluator code must compile for browser and Node runtimes. Workspace boundaries make protocol code independently testable.

**Alternative considered:** One application package. Rejected because it increases the risk of importing signer or secret-bearing code into the browser bundle.

### 4. Pin the DreamDEX SDK for the sprint

**Decision:** Pin `@somnia-chain/markets-sdk` to `0.28.1` and commit the lockfile.

**Rationale:** The current official Bot Kit uses this version. A fixed version makes the short sprint reproducible and prevents an unreviewed SDK update from changing behavior near submission.

**Alternative considered:** `^0.28.1` or `>=0.28.0`. Rejected until after submission because it permits behavior changes without a corresponding OpenSpec proposal and validation cycle.

### 5. Normalize external data before product use

**Decision:** The adapter converts DreamDEX/indexer and on-chain data into `MarketSnapshotV1`. UI and strategy code never consume raw SDK responses directly.

**Rationale:** Normalization isolates SDK changes, records data source and freshness, and prevents the browser and runner from interpreting lifecycle fields differently.

**Alternative considered:** Use SDK market objects throughout. Rejected because it couples every layer to unstable external shapes and makes canonical evidence difficult.

### 6. Discover venue and market identities dynamically

**Decision:** Read venue and market IDs from current market data. Key state by market ID, never by reusable pool address or question text.

**Rationale:** Venue IDs and market windows can change. Strike and interval fields are more reliable than parsing display questions.

**Alternative considered:** Environment-configured venue and pool addresses only. Rejected as the source of truth; configuration may be used as a narrow filter but must be verified against current discovery.

### 7. Make `StrategyV1` canonical and portable

**Decision:** Validate a versioned strategy schema, serialize it with deterministic key ordering and normalized decimal strings, and hash the canonical bytes.

**Rationale:** A strategy hash lets the evidence console prove that builder, paper runner, and funded runner used the same artifact.

**Alternative considered:** Store strategies as unversioned database rows. Rejected because row shape and implicit defaults cannot be independently verified or shared.

### 8. Separate trigger from maximum entry price

**Decision:** A trigger can use `lte` or `gte`, but every buy order also has an independent maximum entry price.

**Rationale:** A breakout trigger must not become permission to cross the book at an unbounded price.

**Alternative considered:** One threshold for trigger and limit. Rejected because it is ambiguous for `gte` momentum rules.

### 9. Keep protocol arithmetic integer-only

**Decision:** User-facing basis points and decimal strings are converted to integer tick and lot units. Raw protocol values remain bigint-backed. Price and quantity snap in the direction that cannot exceed configured price, quantity, or collateral caps.

**Rationale:** JavaScript floating-point values can create invalid 18-decimal prices and unsafe rounding.

**Alternative considered:** Decimal number libraries at the final SDK boundary. Rejected because a number conversion can still reintroduce floating-point error; exact integer units are simpler to audit.

### 10. Define the evaluator as a pure function with explicit state input

**Decision:** Evaluate `StrategyV1 + MarketSnapshotV1 + RiskSnapshotV1 + EvaluationTime` into `DecisionV1`.

**Rationale:** Cooldowns, daily caps, orders-per-market, and failure stops are stateful even though evaluation can remain deterministic and side-effect free.

**Alternative considered:** A stateless endpoint that reads hidden server state. Rejected because the same request could produce unexplained results and browser simulation would diverge.

### 11. Keep paper runs browser-local

**Decision:** Store paper strategies, risk snapshots, and decision history in browser local storage. Label results as `would submit at this snapshot` and never calculate guaranteed fill or profit.

**Rationale:** This removes wallet friction and avoids taking custody of public user policies or creating a false exchange simulator.

**Alternative considered:** Hosted public automations. Rejected for the sprint because it adds authentication, custody expectations, background job scaling, and abuse risk.

### 12. Use SSE for market and runner events

**Decision:** The control plane publishes normalized events over SSE and exposes cursor-based history for reconnection.

**Rationale:** The browser needs one-way live updates and transparent recovery. SSE is simpler than a bidirectional socket and works well with standard HTTP infrastructure.

**Alternative considered:** Browser connects directly to DreamDEX WebSocket. Rejected because normalized snapshots, freshness policy, evidence IDs, and reconnect history must be consistent with the runner.

### 13. Restrict product execution to IOC orders

**Decision:** EventPilot strategy execution sends IOC orders only. Any maker fixture used to prepare test liquidity is a separate operator-only test utility and is never represented as strategy execution.

**Rationale:** IOC prevents unexpected resting remainder and escrow. Separating fixtures keeps evidence honest.

**Alternative considered:** Optional resting orders. Rejected for the MVP because open-order tracking, cancellation, escrow recovery, and crash behavior expand the critical path.

### 14. Enforce Shannon at process and write boundaries

**Decision:** The runner defaults to dry run, validates configured network and RPC chain ID at startup, and validates chain ID again before enabling writes. Any mismatch hard-fails.

**Rationale:** A configuration typo must not create a mainnet write.

**Alternative considered:** One startup check. Rejected because runtime provider changes or incorrect dependency injection could bypass it.

### 15. Re-check on-chain status immediately before every write

**Decision:** An eligible decision is short-lived. Before signing, the runner rejects stale snapshots and fetches the authoritative on-chain market status; only `Trading` proceeds.

**Rationale:** The indexer can lag and a market can lock between snapshot and send.

**Alternative considered:** Trust the normalized indexer snapshot. Rejected because it is not authoritative for writes.

### 16. Explicitly verify receipt success

**Decision:** A resolved SDK call is recorded as `SENT`, not successful. The adapter extracts or fetches the receipt and asserts success before recording `MINED_SUCCESS`.

**Rationale:** DreamDEX write helpers can resolve even when the transaction reverted.

**Alternative considered:** Treat a returned transaction hash or order object as success. Rejected because it produces false evidence and corrupts risk accounting.

### 17. Persist intents before sending

**Decision:** Create a unique intent key from strategy version, strategy hash, market ID, outcome, and evaluation window or source block. Insert `PREPARED` durably before send, then transition through `SENT`, `MINED_SUCCESS`, `MINED_REVERTED`, or `UNKNOWN`.

The prepared intent also snapshots the current pool address and unit decimals used for that market ID. The pool is not an identity key; these fields are retained only so restart reconciliation can decode that transaction's pool-scoped fill logs and restore exact risk accounting after the pool has been recycled.

**Rationale:** A nonce queue prevents concurrent sends but not duplicate sends after a crash.

**Alternative considered:** In-memory deduplication. Rejected because restart recovery is a required acceptance case.

### 18. Use one signer queue for orders and claims

**Decision:** The runner and claim scanner submit through one serialized queue in one control-plane replica.

**Rationale:** Two senders using the same key can race nonces. A single queue gives deterministic ordering.

**Alternative considered:** Separate workers with a distributed nonce lock. Rejected for the hackathon because it adds infrastructure and failure modes without product value.

### 19. Use SQLite with one Railway replica

**Decision:** Persist strategy versions, risk ledger, intents, transactions, claims, and evidence in SQLite with WAL, busy timeout, unique constraints, and a persistent volume. Refuse a second live runner lease for the wallet.

**Rationale:** The workload is small and benefits from local transactional semantics. One process matches the signer-serialization model.

**Alternative considered:** Managed Postgres. Acceptable later, but rejected for the sprint because operational setup exceeds the data requirements.

### 20. Keep admin controls out of the normal public browser

**Decision:** Public routes are read-only. Operator strategy updates and arm/stop actions use a private CLI or separately protected operator page with a server-validated token. The API never accepts a key.

**Rationale:** Bundling an admin token or exposing a funded control surface would undermine the security story.

**Alternative considered:** Publicly visible admin screen with a static token. Rejected because browser storage and bundles are not secret boundaries.

### 21. Treat evidence as an append-only product record

**Decision:** Persist normalized snapshots, decisions, intent transitions, receipt summaries, fills, market lifecycle, and claims. Public responses redact secrets and internal error material.

**Rationale:** Evidence must survive restart and must not change when live market data rolls forward.

**Alternative considered:** Reconstruct evidence from current APIs and explorer pages. Rejected because external data can disappear, reorder, or no longer correspond to the original decision.

## Data contracts

### `StrategyV1`

```ts
type StrategyV1 = {
  version: "1";
  network: "somnia-shannon";
  selector: {
    asset: "BTC" | "ETH";
    intervalSec: 900 | 3600;
    outcome: "YES" | "NO";
  };
  trigger: {
    field: "bestAskBps";
    operator: "lte" | "gte";
    valueBps: number;
  };
  guards: {
    maximumEntryBps: number;
    maximumAbsoluteSpreadBps: number;
    maximumRelativeSpreadPpm: number;
    minimumSecondsRemaining: number;
    maximumSnapshotAgeMs: number;
    minimumExecutableQuantity: string;
  };
  order: {
    type: "IOC";
    quantity: string;
    maximumCollateral: string;
  };
  risk: {
    maximumOrdersPerMarket: number;
    maximumDailyCollateral: string;
    cooldownSeconds: number;
    maximumConsecutiveExecutionFailures: number;
  };
};
```

### `DecisionV1`

```ts
type DecisionV1 = {
  version: "1";
  eligible: boolean;
  strategyHash: string;
  intentKey: string;
  marketId: string;
  venueId: string;
  chainId: 50312;
  snapshotTimestamp: string;
  sourceBlockNumber: string;
  validUntil: string;
  status: string;
  guardResults: Array<{
    code: string;
    passed: boolean;
    message: string;
    actual?: string;
    limit?: string;
  }>;
  priceTicks: string | null;
  priceRaw: string | null;
  quantityLots: string | null;
  quantityRaw: string | null;
  maximumCostRaw: string | null;
};
```

## Persistence model

Minimum tables:

- `strategy_versions`
- `runner_state`
- `risk_days`
- `market_risk`
- `execution_intents`
- `transactions`
- `fills`
- `claim_scans`
- `claims`
- `evidence_events`
- `operator_audit`

Unique constraints:

- `strategy_versions.hash`
- `execution_intents.intent_key`
- `transactions.tx_hash`
- `claims.market_id + claims.wallet_address`
- one active runner lease per wallet and network

## API and event behavior

The API validates all payloads with shared schemas. Public endpoints are rate limited and CORS restricted to configured origins. SSE events contain monotonically increasing cursors and event timestamps. A reconnecting client requests history after its last cursor, then resumes the live stream. If history has expired, the client receives a reset event and fetches the current snapshot.

## Risk accounting

- Dry-run and paper decisions do not consume funded-runner collateral limits.
- An unfilled IOC records an attempt but does not count as an execution failure.
- Partial and full fills consume actual filled collateral.
- A mined revert counts as an execution failure.
- An RPC timeout with unknown receipt moves the runner to reconciliation and blocks a retry for that intent.
- Stale data and non-Trading lifecycle states are skips, not failures.
- Daily risk resets according to an explicit UTC boundary stored with the ledger.

## Security boundaries

- Browser: public data, local paper state, no secrets.
- Public API: normalized reads and stateless evaluation inputs, no signer control.
- Operator API/CLI: strategy activation and runner control, authenticated and audited.
- Runner process: signer and limited testnet funds.
- Database: no raw private key, seed phrase, or reusable operator token.
- Logs: structured allowlist fields with redaction tests.

## Risks / Trade-offs

- **Live liquidity may be absent during judging** -> Provide Judge Mode with last verified evidence and accurately label live IOC outcomes.
- **Market can lock after evaluation** -> Use short decision validity, stale rejection, and immediate on-chain status recheck.
- **SDK or indexer shape may change** -> Normalize at one adapter boundary and pin the SDK for the sprint.
- **SQLite cannot support horizontal signer scale** -> Deliberately run one replica and refuse a second runner lease.
- **Paper mode is not a fill simulator** -> Use `would submit` language and expose the limitation in the UI.
- **Claim timing may not align with the video window** -> Implement the real scanner early and retain the most recent verified claim evidence.
- **OpenSpec work can become process overhead** -> Keep proposals concise, tasks small, and split only where it reduces implementation risk.

## Migration Plan

1. Initialize the repository and OpenSpec at the root.
2. Create the workspace and shared packages without enabling writes.
3. Deliver read-only live-market and evaluator capabilities first.
4. Deploy public read paths and verify no signer code enters the web bundle.
5. Add the database and dry-run runner.
6. Fund a dedicated Shannon wallet with minimal test assets.
7. Enable writes only after chain-gate, receipt, intent, and restart tests pass.
8. Produce evidence and explorer links.
9. Freeze features on September 5.
10. Verify, archive completed OpenSpec changes, tag, and submit by September 7.

Rollback is disabling the runner, revoking its deployment secret, and returning the public application to read-only mode. Existing evidence remains readable.
