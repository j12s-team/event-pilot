# DreamDEX SDK and documentation feedback

Integration target: `@somnia-chain/markets-sdk` 0.28.1 on Somnia Shannon.

## What worked well

- Venue and binary-market listing provides enough metadata to follow rolling
  BTC/ETH Event Contract series dynamically.
- Explicit market status and finalized-market filtering support fail-closed
  execution and settlement scanning.
- Order-book reads expose native integer values, allowing EventPilot to retain
  bigint arithmetic through evaluation and execution.
- The Bot Kit demonstrates valuable defensive patterns for venue scoping,
  funding checks, order construction, receipt handling, and redemption.

## Reproducible integration observations

1. Native order price is expressed in YES terms. A BUY NO UI therefore needs
   to preserve the selected NO outcome price for guards/cost while submitting
   `priceScale - noPrice` to the order call. A prominent SDK type comment or
   example for both outcomes would reduce integration mistakes.
2. Active pool addresses are lifecycle bindings, not durable product IDs.
   Examples should key automation state by market ID and rediscover the current
   venue/series after rollover.
3. A confirmed high-level order helper can return after mining, while a durable
   automation engine needs the hash persisted in a SENT state before receipt
   classification. Exposing separate submit and wait primitives consistently
   would make crash recovery simpler.
4. Claim automation needs both `listBinaryMarkets({ status: "Finalized" })`
   and wallet-specific claimability checks. A first-party end-to-end claim
   example covering YES and NO would reduce ambiguity.
5. Receipt event decoding benefits from exported order-book event ABIs. A
   typed helper returning unfilled/partial/full quantities would prevent each
   integration from rebuilding this classification.

## Suggested additions

- Publish one Shannon Event Contract automation example with dynamic discovery,
  on-chain `Trading` recheck, IOC-only orders, expiry capping, explicit receipt
  status, and restart reconciliation.
- Document price, quantity, collateral decimals, tick size, and lot size in one
  conversion table with raw-value examples.
- Document retry semantics separately for read failures, pre-send failures,
  known transaction hashes, and unknown send outcomes.
- Add an idempotent finalized-position claim example that uses one nonce queue
  for orders and claims.

These are implementation notes from EventPilot, not claims that the SDK is
unsafe or audited.
