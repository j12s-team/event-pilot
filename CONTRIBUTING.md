# Contributing to EventPilot

EventPilot is an educational testnet project. Changes must preserve its safety
boundary: Shannon testnet only, `DRY_RUN=true` by default, integer-only protocol
math, and no private keys in browser code, API payloads, logs, fixtures, or
commits.

Before opening a change, update the active OpenSpec proposal when behavior or
architecture changes. Run `pnpm check` and `pnpm test:e2e` before submitting.
Never use a funded production wallet for development.
