# Deployment runbook

## Prerequisites

- Public Git repository with a frozen lockfile.
- Vercel project for the web app.
- Railway service for the control plane with exactly one replica.
- Railway persistent volume mounted at a path used by `DATABASE_PATH`.
- Dedicated Shannon wallet holding only minimal STT and test collateral.

## Railway control plane

The checked-in `railway.json` selects Railpack, builds only the control plane,
starts its compiled server, and checks `/v1/health`.

Configure:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=<provided by Railway>
DATABASE_PATH=/data/eventpilot.db
SOMNIA_CHAIN_ID=50312
SOMNIA_RPC_URL=https://dream-rpc.somnia.network
SOMNIA_INDEXER_URL=https://dev.smk.somnia.host/v1/graphql
SOMNIA_WS_RPC_URL=wss://api.infra.testnet.somnia.network/ws
MARKET_MODE=live
DRY_RUN=true
ADMIN_TOKEN=<long random server secret>
CORS_ORIGIN=<final Vercel origin>
```

Mount the volume at `/data`. Deploy first in dry-run mode. Confirm health,
market discovery, SSE reconnect, persistence across restart, and that a second
lease holder is rejected.

Only after those checks, add the dedicated wallet key as `DEMO_PRIVATE_KEY`,
verify balances, then deliberately change `DRY_RUN=false`. Never place that key
in Vercel or a browser-readable environment variable.

## Vercel web app

`vercel.json` runs the pinned Nitro Vercel build and writes `.vercel/output` at
the monorepo root. Configure:

```dotenv
VITE_API_ORIGIN=<Railway HTTPS origin>
```

After deployment, inspect the generated browser assets for `ADMIN_TOKEN`,
`DEMO_PRIVATE_KEY`, key-shaped hex values, and server environment strings.

## Production readback

1. `GET /v1/health` returns chain 50312, SDK 0.28.1, and the expected mode.
2. `GET /v1/markets` returns current market IDs without stale fixture labels.
3. SSE reconnect resumes or resets explicitly from the supplied cursor.
4. The public app can evaluate and paper-run without a wallet.
5. Admin routes reject missing/wrong tokens and key-shaped request bodies.
6. Restart preserves events and evidence but leaves the runner stopped.
7. A verified write shows explicit receipt state and an explorer link.
8. A finalized claim shows its independent claim receipt and explorer link.

Do not mark deployment acceptance complete until these checks are performed
against the actual public origins.
