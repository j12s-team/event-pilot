# EventPilot build progress

OpenSpec task checkboxes are marked complete only after the corresponding
behavior is implemented and verified.

## 2026-08-30

- Implemented the full workspace, strict schemas, canonical policy hashing,
  bigint tick/lot conversion, deterministic evaluator, and durable risk ledger.
- Implemented dynamic DreamDEX market discovery, lifecycle reads, rollover,
  SSE cursor replay, guarded Shannon writer, explicit receipt classification,
  restart reconciliation, and finalized-position claims.
- Implemented responsive Markets, Strategy, Paper run, Demo runner, and
  Evidence screens, including browser-local recovery and risk accounting.
- Added public evidence detail linking strategy, original snapshot, decision,
  intent, receipt, fill, claim, and explorer URL without secret-bearing fields.
- Added Vercel Nitro and Railway release configurations, CI browser coverage,
  social preview artwork, architecture, deployment, demo, and SDK notes.
- Verified 45 Vitest tests, 10 desktop/mobile Playwright flows, strict OpenSpec,
  formatting, type-aware lint, typecheck, normal builds, frozen-lockfile
  install, and the local Vercel-target build.
- Scanned source and generated browser assets for key-shaped values and private
  key material; no application secret was found.
- Remaining external gates: funded Shannon order/claim evidence, production
  deployment/readback, final video, release tag, and DoraHacks submission.
