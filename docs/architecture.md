# Architecture and trust boundaries

## Evidence flow

```text
StrategyV1
  → canonical SHA-256 strategy hash
  → immutable MarketSnapshotV1
  → deterministic DecisionV1 + intent key
  → durable PREPARED ExecutionIntentV1
  → SENT transaction hash
  → explicit receipt status
  → zero/partial/full fill records
  → Finalized lifecycle detection
  → idempotent claim record and receipt
```

The `execution_intents` row stores the original snapshot and decision bodies.
Later market rollover never rewrites historical evidence. Public evidence
responses join only persisted allowlisted records and derive explorer URLs from
the recorded Shannon transaction hash.

## Trust boundaries

### Public browser

- Can read current markets, request stateless evaluations, and inspect runner
  evidence.
- Stores strategy and bounded paper history in local storage.
- Has no wallet connector, signer, private key, or runner-control route.
- Uses the shared evaluator for paper decisions and exact local risk state.

### Control plane

- Owns admin authentication, SQLite state, risk ledgers, signer queue, and
  receipt reconciliation.
- Rejects key-shaped request fields before route handling.
- Logs an allowlisted redacted model rather than arbitrary request bodies.
- Restarts stopped and requires explicit operator re-arm.

### Dedicated demo signer

- Exists only when the server starts in live mode with a server-only key.
- Is restricted to Somnia Shannon chain ID 50312.
- Uses a minimal-funds wallet and a single-instance lease.
- Serializes orders and claims through one nonce queue.

## Write boundary

Before an IOC order, EventPilot verifies that the decision is eligible and
fresh, the market identity still matches, no unresolved write exists, the RPC
is Shannon, and authoritative status is `Trading`. It persists `PREPARED`
before calling the writer, caps expiry at market expiry, and records success
only after inspecting the receipt.

Claim scanning is periodic and independent of current trigger eligibility. It
discovers current venue markets with `Finalized` status, checks the dedicated
wallet’s claimable outcomes, creates one claim key per wallet/market/outcome,
and uses the same signer queue.

## Recovery model

- `SENT` and `UNKNOWN` orders and claims block new writes.
- Startup receipt lookup reconciles known hashes and restores exact fill risk.
- Missing receipts remain pending; EventPilot does not guess success or revert.
- The runner is stopped after restart even when reconciliation succeeds.
- Browser-local malformed strategies or paper histories are discarded with a
  visible recovery message.
