import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const strategyVersions = sqliteTable("strategy_versions", {
  hash: text("hash").primaryKey(),
  body: text("body").notNull(),
  createdAtMs: integer("created_at_ms").notNull(),
});

export const runnerState = sqliteTable("runner_state", {
  singleton: integer("singleton").primaryKey(),
  state: text("state").notNull(),
  strategyHash: text("strategy_hash"),
  dryRun: integer("dry_run", { mode: "boolean" }).notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const executionIntents = sqliteTable(
  "execution_intents",
  {
    intentKey: text("intent_key").primaryKey(),
    strategyHash: text("strategy_hash").notNull(),
    marketId: text("market_id").notNull(),
    state: text("state").notNull(),
    body: text("body").notNull(),
    decisionBody: text("decision_body"),
    snapshotBody: text("snapshot_body"),
    transactionHash: text("transaction_hash"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [uniqueIndex("execution_intents_key_unique").on(table.intentKey)],
);

export const runnerEvents = sqliteTable("runner_events", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  id: text("id").notNull().unique(),
  kind: text("kind").notNull(),
  occurredAtMs: integer("occurred_at_ms").notNull(),
  marketId: text("market_id"),
  strategyHash: text("strategy_hash"),
  intentKey: text("intent_key"),
  transactionHash: text("transaction_hash"),
  summary: text("summary").notNull(),
});

export const operatorAudit = sqliteTable("operator_audit", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(),
  occurredAtMs: integer("occurred_at_ms").notNull(),
  strategyHash: text("strategy_hash"),
  remoteAddress: text("remote_address"),
});

export const transactions = sqliteTable("transactions", {
  hash: text("hash").primaryKey(),
  intentKey: text("intent_key").notNull(),
  receiptStatus: text("receipt_status").notNull(),
  blockNumber: text("block_number"),
  gasUsed: text("gas_used"),
  createdAtMs: integer("created_at_ms").notNull(),
});

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(),
  transactionHash: text("transaction_hash").notNull(),
  intentKey: text("intent_key").notNull(),
  quantityRaw: text("quantity_raw").notNull(),
  priceRaw: text("price_raw").notNull(),
  recordedAtMs: integer("recorded_at_ms").notNull(),
});

export const claims = sqliteTable("claims", {
  claimKey: text("claim_key").primaryKey(),
  marketId: text("market_id").notNull(),
  walletAddress: text("wallet_address").notNull(),
  outcome: text("outcome").notNull(),
  amountRaw: text("amount_raw").notNull(),
  state: text("state").notNull(),
  transactionHash: text("transaction_hash"),
  createdAtMs: integer("created_at_ms").notNull(),
  updatedAtMs: integer("updated_at_ms").notNull(),
});

export const riskLedgers = sqliteTable("risk_ledgers", {
  day: text("day").notNull(),
  marketId: text("market_id").notNull(),
  orderCount: integer("order_count").notNull(),
  collateralRaw: text("collateral_raw").notNull(),
  consecutiveFailures: integer("consecutive_failures").notNull(),
  lastOrderAtMs: integer("last_order_at_ms"),
});
