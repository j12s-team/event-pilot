# OpenSpec Workflow for EventPilot

OpenSpec remains a committed, first-class part of EventPilot. It is the planning and acceptance layer for the hackathon sprint and for later development.

## Why OpenSpec belongs in this project

EventPilot combines live market data, deterministic policy evaluation, risk accounting, a funded testnet runner, persistence, and public evidence. Small ambiguities can create unsafe or misleading behavior. OpenSpec makes each behavior change reviewable before code is written and turns acceptance scenarios into a durable contract.

## Repository layout

```text
openspec/
|-- config.yaml
|-- specs/                       # source of truth after changes are archived
`-- changes/
    |-- archive/
    `-- build-eventpilot-hackathon-mvp/
        |-- .openspec.yaml
        |-- proposal.md
        |-- design.md
        |-- tasks.md
        `-- specs/
```

## Setup

```bash
npm install -g @fission-ai/openspec@latest
openspec init
```

Select Codex during initialization. Codex consumes OpenSpec skills directly.

## Required loop

1. `openspec-explore` - sharpen the problem without changing code.
2. `openspec-propose` - create the reviewable change folder.
3. Review and correct `proposal.md`, delta specs, `design.md`, and `tasks.md`.
4. `openspec-apply-change` - implement the checked plan.
5. `openspec-verify-change` - compare implementation with requirements.
6. `openspec-archive-change` - update the main specs and retain change history.

## Sprint slicing

The umbrella MVP change can be implemented in these internal slices:

1. `bootstrap-eventpilot`
2. `add-live-market-discovery`
3. `add-strategy-policy-engine`
4. `add-paper-run`
5. `add-guarded-testnet-runner`
6. `add-evidence-console`
7. `prepare-hackathon-submission`

When implementation begins, splitting the umbrella change into these smaller proposals is preferred if the team can preserve the September 7 internal submission target.

## Definition of ready

A change is ready to apply only when:

- The user-visible problem and non-goals are clear.
- Every new capability has a delta spec.
- Requirements use testable SHALL or MUST language.
- Every requirement has at least one WHEN/THEN scenario.
- Protocol and security failure cases are represented.
- Technical decisions and alternatives are documented.
- Tasks are dependency ordered and small enough for one focused session.

## Definition of done

A change is done only when:

- Every task checkbox is complete.
- `openspec validate <change> --strict` passes.
- Lint, typecheck, unit, integration, and relevant browser tests pass.
- No secret appears in source, logs, bundles, fixtures, or persisted data.
- Protocol writes are demonstrably Shannon-only and receipt checked.
- The implementation is verified against the change specs.
- The change is archived so `openspec/specs/` describes the shipped system.
