# EventPilot Agent Instructions

## Source of truth

- Read `openspec/config.yaml` before planning or implementing changes.
- Read the relevant files under `openspec/specs/` and `openspec/changes/` before modifying behavior.
- Product behavior is defined by OpenSpec requirements and scenarios, not by chat history.

## Change workflow

For every behavior change:

1. Explore the problem and inspect existing specs.
2. Create or update an OpenSpec change proposal.
3. Review proposal, delta specs, design, and tasks before coding.
4. Apply tasks in dependency order and update checkboxes only after verification.
5. Run strict OpenSpec validation and the full project checks.
6. Verify implementation against the specs.
7. Archive the change after completion.

Do not bypass OpenSpec for user-visible behavior, protocol integration, risk controls, authentication, persistence, or deployment changes.

## Non-negotiable protocol rules

- Never perform a mainnet write.
- Live execution must hard-fail unless chain ID is `50312` and the configured network is Shannon testnet.
- Default every executor to dry-run mode.
- Never send JavaScript floating-point values into DreamDEX protocol calls.
- Represent protocol prices, quantities, collateral, ticks, and lots as bigint-backed values.
- Confirm on-chain `Trading` status immediately before every order.
- Use IOC orders for EventPilot strategy execution.
- Cap order expiry at market expiry.
- Explicitly assert transaction receipt success.
- Serialize orders and claims through one signer queue.
- Persist idempotency intents before sending transactions.
- Never accept or return private keys through HTTP APIs.
- Never include secrets in source, logs, browser bundles, fixtures, screenshots, or databases.

## Product language

- Say `market-implied probability`, not objective probability.
- Say `would submit at this snapshot` for paper decisions unless a real fill is verified.
- Do not claim profitability, auditing, production readiness, or guaranteed fills.
- Clearly label testnet, educational use, and risk of loss.

## Completion gates

A task is not complete until relevant tests pass and the implementation satisfies the associated OpenSpec scenarios. A protocol-write task additionally requires receipt inspection, secret-redaction review, and testnet-chain verification.
