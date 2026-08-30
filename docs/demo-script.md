# EventPilot demo script (2–3 minutes)

## 0:00–0:20 — Problem and promise

“DreamDEX Event Contracts move quickly, but a safe automation demo should not
require every user to connect a wallet or write a bot. EventPilot turns an
exact, bounded policy into a simulation and a verifiable Shannon evidence
chain.”

Show the persistent Shannon testnet and educational labels.

## 0:20–0:50 — Live Markets

Show the current BTC/ETH series, market IDs, implied probabilities, spread,
depth, status, data age, and expiry. Point out that rollover discovers a new
market ID instead of trusting an old pool address.

## 0:50–1:25 — Strategy Studio

Select a market, choose YES or NO, change the threshold, maximum entry,
quantity, collateral, and time guard. Show the plain-English preview and
strategy hash. Choose **Evaluate now** and expand every guard. Mention that the
native YES-term price and outcome price are shown separately.

## 1:25–1:50 — Paper run

Start Paper run. Show “would submit at this snapshot” or the exact skipped
reason. Explain that cooldown, per-market count, and daily hypothetical
collateral are browser-local and use the same evaluator; no wallet or admin
route is called.

## 1:50–2:30 — Demo runner and evidence

Open Demo runner. Show server-only wallet configuration, network, chain,
balances, reconciliation status, and public-controls-disabled notice. Open
Evidence and follow this chain:

`Strategy → Snapshot → Decision → Intent → Tx → Receipt → Fill → Settlement → Claim`

Open the verified Shannon explorer link. State the actual receipt outcome; do
not call an unfilled IOC a fill.

If no funded evidence exists yet, show the honest external-gate warning rather
than recording this segment as if a transaction happened.

## 2:30–2:50 — Safety close

“Every write is Shannon-only, IOC, capped by policy, rechecked for Trading,
persisted before signing, receipt-verified, and serialized with claims. Unknown
receipts block the runner until reconciliation. EventPilot is a testnet
education and automation studio—not a profit promise.”
