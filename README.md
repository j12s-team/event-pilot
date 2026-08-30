# EventPilot

EventPilot is a deterministic automation studio and public evidence console for
DreamDEX Event Contracts on Somnia Shannon testnet.

It lets anyone discover current BTC/ETH markets, build a bounded strategy,
evaluate the exact snapshot, and run the same policy locally in the browser.
A dedicated server-side demo runner can submit guarded IOC orders and redeem
finalized positions without exposing wallet controls to public users.

> Educational testnet software. EventPilot does not promise fills, profit,
> audit status, production readiness, or investment outcomes.

## Judge path

1. Open **Markets** and confirm the source, stream status, market ID, lifecycle,
   probabilities, spread, depth, and countdown.
2. Select a market, adjust the policy, and choose **Evaluate now**.
3. Inspect every guard plus the exact native YES price, quantity, maximum cost,
   strategy hash, and deterministic intent key.
4. Open **Paper run**, start the browser-local session, and observe eligible and
   skipped decisions using “would submit at this snapshot” language.
5. Open **Demo runner** and **Evidence** to inspect durable runner events,
   receipt states, fills, claims, and Shannon explorer links when verified
   testnet evidence exists.

The repository intentionally shows an honest empty-evidence state until a
funded Shannon wallet produces a verified receipt.

## Architecture

```text
Browser (no wallet, no secrets)
  ├─ Live Markets / Strategy Studio
  ├─ shared deterministic evaluator
  └─ localStorage paper ledger
             │ public HTTP + SSE
             ▼
Fastify control plane ── SQLite WAL evidence store
  ├─ dynamic DreamDEX discovery
  ├─ evaluation API
  ├─ guarded demo runner
  ├─ one signer queue
  ├─ restart reconciler
  └─ finalized-market claim worker
             │ Shannon-only SDK adapter
             ▼
DreamDEX indexer + Somnia Shannon RPC (chain 50312)
```

The complete trust boundaries and state flow are in
[`docs/architecture.md`](docs/architecture.md).

## Workspace

- `apps/web` — responsive Vinext/React UI, TanStack Query, browser paper mode,
  and Playwright flows.
- `apps/control-plane` — Fastify API, SSE service, SQLite persistence, runner,
  executor, reconciler, and claim worker.
- `packages/contracts` — strict versioned schemas shared across processes.
- `packages/strategy` — canonical hashing, bigint conversion, evaluator, and
  risk guards.
- `packages/dreamdex-adapter` — read discovery and guarded SDK writer.
- `packages/test-fixtures` — deterministic Shannon-shaped fixtures.
- `openspec/changes/build-eventpilot-hackathon-mvp` — active requirements,
  design decisions, and acceptance checklist.

## Local setup

Requirements: Node.js 22.13 or newer and pnpm 10.14.0.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Open `http://127.0.0.1:3000`. The API listens on
`http://127.0.0.1:4100`.

The default is safe and deterministic:

```dotenv
DRY_RUN=true
MARKET_MODE=fixture
```

For read-only current DreamDEX discovery, set `MARKET_MODE=live` while leaving
`DRY_RUN=true`. Live writes require all of the following:

- `MARKET_MODE=live`
- `DRY_RUN=false`
- a server-only `DEMO_PRIVATE_KEY`
- an RPC that reports Shannon chain ID `50312`
- minimal native STT and selected-market collateral
- no unresolved order or claim receipt
- an acquired single-wallet runner lease

Never prefix a secret with `VITE_`. The API rejects private-key-shaped request
bodies and never returns the configured key.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/health` | Network, mode, source, and pinned SDK diagnostics |
| `GET` | `/v1/markets` | Current normalized market snapshots |
| `GET` | `/v1/markets/stream` | Cursor-backed SSE snapshots and reset events |
| `POST` | `/v1/evaluations` | Stateless strategy + market + risk evaluation |
| `GET` | `/v1/demo-runner` | Redacted public runner health |
| `GET` | `/v1/demo-runner/events?cursor=…` | Append-only event history |
| `GET` | `/v1/evidence/:sequence` | Linked public evidence detail |
| `PUT` | `/v1/admin/strategy` | Authenticated strategy update |
| `POST` | `/v1/admin/runner/arm` | Authenticated explicit arm |
| `POST` | `/v1/admin/runner/stop` | Authenticated stop |

Admin routes require `x-admin-token`. They never accept a private key.

## Exact execution model

- Prices, quantities, costs, ticks, and lots remain bigint-backed decimal
  strings across protocol boundaries.
- A BUY NO decision preserves the NO outcome price for cost accounting but
  converts the submitted limit to DreamDEX’s native YES-price term.
- Price and quantity round down to venue increments; the evaluator proves the
  rounded order cannot exceed either quantity or collateral caps.
- Every send rechecks chain ID, decision freshness, and authoritative on-chain
  `Trading` status.
- Orders are IOC only, and expiry is capped at market expiry.
- A unique `PREPARED` intent is committed before signer work. Orders and claims
  share one queue, and unknown receipts block further writes.
- Startup reconciliation resolves persisted `SENT`/`UNKNOWN` records before an
  operator can re-arm the runner.

## Verification

```bash
pnpm check
pnpm test:e2e
pnpm --filter @eventpilot/web build:vercel
```

`pnpm check` performs strict OpenSpec validation, formatting verification,
type-aware lint, TypeScript checks, Vitest, and production builds. CI also
installs Chromium and runs the desktop/mobile Playwright suite.

## Deployment

- `vercel.json` builds the web app with the Vinext Nitro Vercel adapter and
  emits the Vercel Build Output API directory.
- `railway.json` builds and starts the control plane, checks `/v1/health`, and
  uses a restart-on-failure policy.
- Railway must run exactly one replica with a persistent volume mounted for
  `DATABASE_PATH`; configure `HOST=0.0.0.0` and the platform-provided `PORT`.
- Set Vercel `VITE_API_ORIGIN` to the Railway public origin and Railway
  `CORS_ORIGIN` to the final Vercel origin.

See [`docs/deployment.md`](docs/deployment.md) for the release checklist.

## Current evidence and limitations

Verified locally: deterministic fixtures, live read adapter diagnostics,
integer/risk behavior, guarded/reverted/partial/unfilled/unknown paths,
restart reconciliation, claim idempotency, public API security, responsive
browser flows, normal builds, and Vercel-target output.

Still requires operator credentials or external time/state:

- funded Shannon IOC transaction and explorer evidence;
- a traded market reaching Finalized and its claim receipt;
- Vercel and Railway production deployment/readback;
- final demo recording, release tag, and DoraHacks submission.

No transaction hash or deployment URL is fabricated in their absence.

## Submission material

- [`HACKATHON_PROPOSAL.md`](HACKATHON_PROPOSAL.md)
- [`docs/demo-script.md`](docs/demo-script.md)
- [`docs/sdk-feedback.md`](docs/sdk-feedback.md)
- [`docs/build-progress.md`](docs/build-progress.md)

MIT licensed. Defensive integration patterns are attributed to the DreamDEX
Bot Kit; protocol calls use `@somnia-chain/markets-sdk` 0.28.1.
