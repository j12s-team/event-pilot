import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { asc, eq, gt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
  decisionV1Schema,
  executionIntentV1Schema,
  marketSnapshotV1Schema,
  runnerEventV1Schema,
  strategyV1Schema,
  type DecisionV1,
  type ExecutionIntentV1,
  type MarketSnapshotV1,
  type RunnerEventV1,
  type StrategyV1,
  type RiskSnapshotV1,
} from "@eventpilot/contracts";
import { hashStrategy, serializeStrategy } from "@eventpilot/strategy";

import { operatorAudit, runnerEvents, runnerState, strategyVersions } from "./schema.js";

export class EventPilotStore {
  readonly sqlite: Database.Database;
  readonly db;

  constructor(path: string) {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    this.sqlite = new Database(absolute);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("busy_timeout = 5000");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS strategy_versions (
        hash TEXT PRIMARY KEY,
        body TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runner_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state TEXT NOT NULL,
        strategy_hash TEXT,
        dry_run INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS execution_intents (
        intent_key TEXT PRIMARY KEY,
        strategy_hash TEXT NOT NULL,
        market_id TEXT NOT NULL,
        state TEXT NOT NULL,
        body TEXT NOT NULL,
        decision_body TEXT,
        snapshot_body TEXT,
        transaction_hash TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS execution_intents_key_unique
        ON execution_intents(intent_key);
      CREATE TABLE IF NOT EXISTS runner_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        market_id TEXT,
        strategy_hash TEXT,
        intent_key TEXT,
        transaction_hash TEXT,
        summary TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS operator_audit (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        occurred_at_ms INTEGER NOT NULL,
        strategy_hash TEXT,
        remote_address TEXT
      );
      CREATE TABLE IF NOT EXISTS transactions (
        hash TEXT PRIMARY KEY,
        intent_key TEXT NOT NULL,
        receipt_status TEXT NOT NULL,
        block_number TEXT,
        gas_used TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY,
        transaction_hash TEXT NOT NULL,
        intent_key TEXT NOT NULL,
        quantity_raw TEXT NOT NULL,
        price_raw TEXT NOT NULL,
        recorded_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS claims (
        claim_key TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        outcome TEXT NOT NULL,
        amount_raw TEXT NOT NULL,
        state TEXT NOT NULL,
        transaction_hash TEXT,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS risk_ledgers (
        day TEXT NOT NULL,
        market_id TEXT NOT NULL,
        order_count INTEGER NOT NULL,
        collateral_raw TEXT NOT NULL,
        consecutive_failures INTEGER NOT NULL,
        last_order_at_ms INTEGER,
        PRIMARY KEY (day, market_id)
      );
      CREATE TABLE IF NOT EXISTS runner_leases (
        wallet_address TEXT PRIMARY KEY,
        holder_id TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
    `);
    const claimColumns = this.sqlite.pragma("table_info('claims')") as Array<{ name: string }>;
    if (!claimColumns.some((column) => column.name === "wallet_address")) {
      this.sqlite.exec(
        "ALTER TABLE claims ADD COLUMN wallet_address TEXT NOT NULL DEFAULT 'legacy-unknown'",
      );
    }
    const intentColumns = this.sqlite.pragma("table_info('execution_intents')") as Array<{
      name: string;
    }>;
    if (!intentColumns.some((column) => column.name === "decision_body")) {
      this.sqlite.exec("ALTER TABLE execution_intents ADD COLUMN decision_body TEXT");
    }
    if (!intentColumns.some((column) => column.name === "snapshot_body")) {
      this.sqlite.exec("ALTER TABLE execution_intents ADD COLUMN snapshot_body TEXT");
    }
    this.sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS claims_market_wallet_outcome_unique
        ON claims(market_id, wallet_address, outcome)
    `);
    this.db = drizzle(this.sqlite, {
      schema: { operatorAudit, runnerEvents, runnerState, strategyVersions },
    });
  }

  getStrategy(hash: string): StrategyV1 | null {
    const row = this.sqlite
      .prepare("SELECT body FROM strategy_versions WHERE hash = ? LIMIT 1")
      .get(hash) as { body: string } | undefined;
    if (row === undefined) return null;
    const parsed = JSON.parse(row.body) as unknown;
    // saveStrategy only persists validated canonical strategies. Parsing again
    // keeps restart recovery fail-closed if the database was edited externally.
    return strategyV1Schema.parse(parsed);
  }

  async saveStrategy(strategy: StrategyV1): Promise<string> {
    const hash = await hashStrategy(strategy);
    await this.db
      .insert(strategyVersions)
      .values({ hash, body: serializeStrategy(strategy), createdAtMs: Date.now() })
      .onConflictDoNothing();
    return hash;
  }

  async setRunnerState(input: {
    state: "STOPPED" | "ARMED_DRY_RUN" | "ARMED_LIVE";
    strategyHash: string | null;
    dryRun: boolean;
  }): Promise<void> {
    await this.db
      .insert(runnerState)
      .values({ singleton: 1, updatedAtMs: Date.now(), ...input })
      .onConflictDoUpdate({
        target: runnerState.singleton,
        set: { updatedAtMs: Date.now(), ...input },
      });
  }

  async getRunnerState(): Promise<{
    state: string;
    strategyHash: string | null;
    dryRun: boolean;
    updatedAtMs: number;
  }> {
    const [row] = await this.db.select().from(runnerState).where(eq(runnerState.singleton, 1));
    return row ?? { state: "STOPPED", strategyHash: null, dryRun: true, updatedAtMs: Date.now() };
  }

  async appendEvent(
    event: Omit<RunnerEventV1, "version" | "sequence" | "id">,
  ): Promise<RunnerEventV1> {
    const id = crypto.randomUUID();
    const [row] = await this.db
      .insert(runnerEvents)
      .values({ id, ...event })
      .returning({ sequence: runnerEvents.sequence });
    if (row === undefined) throw new Error("Failed to persist runner event.");
    return runnerEventV1Schema.parse({ version: "1", sequence: row.sequence, id, ...event });
  }

  prepareIntent(
    intent: ExecutionIntentV1,
    decision: DecisionV1 | null = null,
    snapshot: MarketSnapshotV1 | null = null,
  ): boolean {
    const parsed = executionIntentV1Schema.parse(intent);
    const parsedDecision = decision === null ? null : decisionV1Schema.parse(decision);
    const parsedSnapshot = snapshot === null ? null : marketSnapshotV1Schema.parse(snapshot);
    const result = this.sqlite
      .prepare(`
      INSERT OR IGNORE INTO execution_intents
        (intent_key, strategy_hash, market_id, state, body, decision_body, snapshot_body,
         created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .run(
        parsed.intentKey,
        parsed.strategyHash,
        parsed.marketId,
        parsed.state,
        JSON.stringify(parsed),
        parsedDecision === null ? null : JSON.stringify(parsedDecision),
        parsedSnapshot === null ? null : JSON.stringify(parsedSnapshot),
        parsed.createdAtMs,
        parsed.createdAtMs,
      );
    return result.changes === 1;
  }

  async getEvidence(sequence: number): Promise<Record<string, unknown> | null> {
    const [event] = await this.listEvents(sequence - 1, 1);
    if (event?.sequence !== sequence) return null;

    const intentRow =
      event.intentKey === null
        ? undefined
        : (this.sqlite
            .prepare(`
              SELECT body, state, transaction_hash AS transactionHash,
                decision_body AS decisionBody, snapshot_body AS snapshotBody
              FROM execution_intents WHERE intent_key = ? LIMIT 1
            `)
            .get(event.intentKey) as
            | {
                body: string;
                state: ExecutionIntentV1["state"];
                transactionHash: string | null;
                decisionBody: string | null;
                snapshotBody: string | null;
              }
            | undefined);
    const intent =
      intentRow === undefined
        ? null
        : executionIntentV1Schema.parse({
            ...(JSON.parse(intentRow.body) as Record<string, unknown>),
            state: intentRow.state,
          });
    const transactionHash = event.transactionHash ?? intentRow?.transactionHash ?? null;
    const transaction =
      transactionHash === null
        ? null
        : ((this.sqlite
            .prepare(`
              SELECT hash, intent_key AS intentKey, receipt_status AS receiptStatus,
                block_number AS blockNumber, gas_used AS gasUsed, created_at_ms AS createdAtMs
              FROM transactions WHERE hash = ? LIMIT 1
            `)
            .get(transactionHash) as Record<string, unknown> | undefined) ?? null);
    const fills =
      transactionHash === null
        ? []
        : (this.sqlite
            .prepare(`
              SELECT id, transaction_hash AS transactionHash, intent_key AS intentKey,
                quantity_raw AS quantityRaw, price_raw AS priceRaw, recorded_at_ms AS recordedAtMs
              FROM fills WHERE transaction_hash = ? ORDER BY recorded_at_ms
            `)
            .all(transactionHash) as Array<Record<string, unknown>>);
    const claim =
      event.intentKey === null
        ? null
        : ((this.sqlite
            .prepare(`
              SELECT claim_key AS claimKey, market_id AS marketId, wallet_address AS walletAddress,
                outcome, amount_raw AS amountRaw, state, transaction_hash AS transactionHash,
                created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs
              FROM claims WHERE claim_key = ? LIMIT 1
            `)
            .get(event.intentKey) as Record<string, unknown> | undefined) ?? null);

    return {
      event,
      strategy: event.strategyHash === null ? null : this.getStrategy(event.strategyHash),
      snapshot:
        intentRow?.snapshotBody === null || intentRow?.snapshotBody === undefined
          ? null
          : marketSnapshotV1Schema.parse(JSON.parse(intentRow.snapshotBody) as unknown),
      decision:
        intentRow?.decisionBody === null || intentRow?.decisionBody === undefined
          ? null
          : decisionV1Schema.parse(JSON.parse(intentRow.decisionBody) as unknown),
      intent,
      transaction,
      fills,
      claim,
      explorer:
        transactionHash === null
          ? null
          : `https://shannon-explorer.somnia.network/tx/${transactionHash}`,
    };
  }

  async getLatestVerifiedEvidence(): Promise<Record<string, unknown> | null> {
    const row = this.sqlite
      .prepare(`
        SELECT sequence FROM runner_events
        WHERE transaction_hash IS NOT NULL
          AND kind IN (
            'transaction.succeeded', 'transaction.reverted',
            'claim.succeeded', 'claim.reverted', 'reconciliation.completed'
          )
        ORDER BY sequence DESC LIMIT 1
      `)
      .get() as { sequence: number } | undefined;
    return row === undefined ? null : this.getEvidence(row.sequence);
  }

  updateIntentState(
    intentKey: string,
    state: ExecutionIntentV1["state"],
    transactionHash: string | null,
  ): void {
    this.sqlite
      .prepare(`
      UPDATE execution_intents
      SET state = ?, transaction_hash = COALESCE(?, transaction_hash), updated_at_ms = ?
      WHERE intent_key = ?
    `)
      .run(state, transactionHash, Date.now(), intentKey);
  }

  hasUnreconciledWrite(): boolean {
    const intent = this.sqlite
      .prepare(
        "SELECT 1 AS present FROM execution_intents WHERE state IN ('SENT', 'UNKNOWN') LIMIT 1",
      )
      .get() as { present: number } | undefined;
    if (intent?.present === 1) return true;
    const claim = this.sqlite
      .prepare("SELECT 1 AS present FROM claims WHERE state IN ('SENT', 'UNKNOWN') LIMIT 1")
      .get() as { present: number } | undefined;
    return claim?.present === 1;
  }

  listUnresolvedIntents(): Array<{
    intentKey: string;
    transactionHash: string | null;
    body: ExecutionIntentV1;
  }> {
    const rows = this.sqlite
      .prepare(`
      SELECT intent_key AS intentKey, transaction_hash AS transactionHash, body
      FROM execution_intents WHERE state IN ('SENT', 'UNKNOWN') ORDER BY created_at_ms
    `)
      .all() as Array<{ intentKey: string; transactionHash: string | null; body: string }>;
    return rows.map((row) => ({
      intentKey: row.intentKey,
      transactionHash: row.transactionHash,
      body: executionIntentV1Schema.parse(JSON.parse(row.body) as unknown),
    }));
  }

  saveTransaction(input: {
    hash: string;
    intentKey: string;
    receiptStatus: "success" | "reverted";
    blockNumber: string | null;
    gasUsed: string | null;
  }): void {
    this.sqlite
      .prepare(`
      INSERT OR REPLACE INTO transactions
        (hash, intent_key, receipt_status, block_number, gas_used, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(
        input.hash,
        input.intentKey,
        input.receiptStatus,
        input.blockNumber,
        input.gasUsed,
        Date.now(),
      );
  }

  saveFill(input: {
    transactionHash: string;
    intentKey: string;
    quantityRaw: string;
    priceRaw: string;
  }): void {
    this.sqlite
      .prepare(`
      INSERT INTO fills (id, transaction_hash, intent_key, quantity_raw, price_raw, recorded_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
      .run(
        crypto.randomUUID(),
        input.transactionHash,
        input.intentKey,
        input.quantityRaw,
        input.priceRaw,
        Date.now(),
      );
  }

  prepareClaim(input: {
    claimKey: string;
    marketId: string;
    walletAddress: string;
    outcome: "YES" | "NO";
    amountRaw: string;
    createdAtMs: number;
  }): boolean {
    const result = this.sqlite
      .prepare(`
      INSERT OR IGNORE INTO claims
        (claim_key, market_id, wallet_address, outcome, amount_raw, state, created_at_ms, updated_at_ms)
      VALUES (?, ?, ?, ?, ?, 'PREPARED', ?, ?)
    `)
      .run(
        input.claimKey,
        input.marketId,
        input.walletAddress.toLowerCase(),
        input.outcome,
        input.amountRaw,
        input.createdAtMs,
        input.createdAtMs,
      );
    return result.changes === 1;
  }

  updateClaimState(
    claimKey: string,
    state: "PREPARED" | "SENT" | "SUCCEEDED" | "REVERTED" | "UNKNOWN",
    transactionHash: string | null,
  ): void {
    this.sqlite
      .prepare(`
      UPDATE claims
      SET state = ?, transaction_hash = COALESCE(?, transaction_hash), updated_at_ms = ?
      WHERE claim_key = ?
    `)
      .run(state, transactionHash, Date.now(), claimKey);
  }

  listUnresolvedClaims(): Array<{
    claimKey: string;
    marketId: string;
    outcome: "YES" | "NO";
    amountRaw: string;
    transactionHash: string | null;
  }> {
    return this.sqlite
      .prepare(`
      SELECT claim_key AS claimKey, market_id AS marketId, outcome, amount_raw AS amountRaw,
        transaction_hash AS transactionHash
      FROM claims WHERE state IN ('SENT', 'UNKNOWN') ORDER BY created_at_ms
    `)
      .all() as Array<{
      claimKey: string;
      marketId: string;
      outcome: "YES" | "NO";
      amountRaw: string;
      transactionHash: string | null;
    }>;
  }

  getRiskSnapshot(
    marketId: string,
    collateralDecimals: number,
    nowMs = Date.now(),
  ): RiskSnapshotV1 {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    const market = this.sqlite
      .prepare(`
      SELECT order_count AS orderCount, collateral_raw AS collateralRaw,
        consecutive_failures AS consecutiveFailures, last_order_at_ms AS lastOrderAtMs
      FROM risk_ledgers WHERE day = ? AND market_id = ?
    `)
      .get(day, marketId) as
      | {
          orderCount: number;
          collateralRaw: string;
          consecutiveFailures: number;
          lastOrderAtMs: number | null;
        }
      | undefined;
    const dailyRows = this.sqlite
      .prepare("SELECT collateral_raw AS collateralRaw FROM risk_ledgers WHERE day = ?")
      .all(day) as Array<{ collateralRaw: string }>;
    const dailyCollateralRaw = dailyRows.reduce(
      (total, row) => total + BigInt(row.collateralRaw),
      0n,
    );
    return {
      version: "1",
      marketId,
      ordersForMarket: market?.orderCount ?? 0,
      dailyCollateralRaw: dailyCollateralRaw.toString(),
      consecutiveFailures: market?.consecutiveFailures ?? 0,
      lastOrderAtMs: market?.lastOrderAtMs ?? null,
      collateralDecimals,
      asOfMs: nowMs,
    };
  }

  recordExecutionOutcome(input: {
    marketId: string;
    occurredAtMs: number;
    filledCollateralRaw: string;
    reverted: boolean;
  }): void {
    const day = new Date(input.occurredAtMs).toISOString().slice(0, 10);
    const current = this.getRiskSnapshot(input.marketId, 0, input.occurredAtMs);
    const marketRow = this.sqlite
      .prepare(`
      SELECT collateral_raw AS collateralRaw FROM risk_ledgers WHERE day = ? AND market_id = ?
    `)
      .get(day, input.marketId) as { collateralRaw: string } | undefined;
    const nextCollateral =
      BigInt(marketRow?.collateralRaw ?? "0") + BigInt(input.filledCollateralRaw);
    this.sqlite
      .prepare(`
      INSERT INTO risk_ledgers
        (day, market_id, order_count, collateral_raw, consecutive_failures, last_order_at_ms)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(day, market_id) DO UPDATE SET
        order_count = excluded.order_count,
        collateral_raw = excluded.collateral_raw,
        consecutive_failures = excluded.consecutive_failures,
        last_order_at_ms = excluded.last_order_at_ms
    `)
      .run(
        day,
        input.marketId,
        current.ordersForMarket + 1,
        nextCollateral.toString(),
        input.reverted ? current.consecutiveFailures + 1 : 0,
        input.occurredAtMs,
      );
  }

  acquireRunnerLease(
    walletAddress: string,
    holderId: string,
    nowMs = Date.now(),
    ttlMs = 30_000,
  ): boolean {
    const result = this.sqlite
      .prepare(`
      INSERT INTO runner_leases (wallet_address, holder_id, expires_at_ms)
      VALUES (?, ?, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET
        holder_id = excluded.holder_id,
        expires_at_ms = excluded.expires_at_ms
      WHERE runner_leases.expires_at_ms < ? OR runner_leases.holder_id = ?
    `)
      .run(walletAddress.toLowerCase(), holderId, nowMs + ttlMs, nowMs, holderId);
    return result.changes === 1;
  }

  releaseRunnerLease(walletAddress: string, holderId: string): void {
    this.sqlite
      .prepare("DELETE FROM runner_leases WHERE wallet_address = ? AND holder_id = ?")
      .run(walletAddress.toLowerCase(), holderId);
  }

  async listEvents(cursor = 0, limit = 100): Promise<RunnerEventV1[]> {
    const rows = await this.db
      .select()
      .from(runnerEvents)
      .where(gt(runnerEvents.sequence, cursor))
      .orderBy(asc(runnerEvents.sequence))
      .limit(Math.min(limit, 250));
    return rows.map((row) => runnerEventV1Schema.parse({ version: "1", ...row }));
  }

  async audit(action: string, strategyHash: string | null, remoteAddress: string): Promise<void> {
    await this.db.insert(operatorAudit).values({
      action,
      occurredAtMs: Date.now(),
      strategyHash,
      remoteAddress,
    });
  }

  close(): void {
    this.sqlite.close();
  }
}
