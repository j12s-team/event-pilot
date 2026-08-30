import { z } from "zod";

export const SHANNON_CHAIN_ID = 50_312 as const;
export const SHANNON_NETWORK = "somnia-shannon" as const;
export const STRATEGY_VERSION = "1" as const;

export const unsignedIntegerStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)$/, "must be an unsigned integer string");

export const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, "must be a non-negative decimal string")
  .refine((value) => !value.includes("e") && !value.includes("E"), {
    message: "scientific notation is not allowed",
  });

const bpsSchema = z.number().int().min(0).max(10_000);
const positiveDecimalSchema = decimalStringSchema.refine(
  (value) => !/^0(?:\.0+)?$/.test(value),
  "must be greater than zero",
);

export const strategyV1Schema = z
  .object({
    version: z.literal(STRATEGY_VERSION),
    network: z.literal(SHANNON_NETWORK),
    name: z.string().trim().min(1).max(80),
    selector: z.object({
      asset: z.enum(["BTC", "ETH"]),
      intervalSeconds: z.union([z.literal(900), z.literal(3600)]),
      outcome: z.enum(["YES", "NO"]),
    }),
    trigger: z.object({
      bestAskBps: z.object({
        operator: z.enum(["lte", "gte"]),
        valueBps: bpsSchema,
      }),
    }),
    guards: z.object({
      maximumEntryBps: bpsSchema,
      maximumAbsoluteSpreadBps: z.number().int().min(0).max(10_000),
      maximumRelativeSpreadPpm: z.number().int().min(0).max(1_000_000),
      minimumSecondsRemaining: z.number().int().min(0).max(86_400),
      maximumSnapshotAgeMs: z.number().int().min(100).max(300_000),
      minimumExecutableQuantity: positiveDecimalSchema,
    }),
    order: z.object({
      timeInForce: z.literal("IOC"),
      quantity: positiveDecimalSchema,
      maximumCollateral: positiveDecimalSchema,
    }),
    risk: z.object({
      maximumOrdersPerMarket: z.number().int().min(1).max(100),
      maximumDailyCollateral: positiveDecimalSchema,
      cooldownSeconds: z.number().int().min(0).max(86_400),
      maximumConsecutiveFailures: z.number().int().min(1).max(100),
    }),
  })
  .strict()
  .superRefine((strategy, context) => {
    const trigger = strategy.trigger.bestAskBps;
    if (trigger.operator === "gte" && strategy.guards.maximumEntryBps < trigger.valueBps) {
      context.addIssue({
        code: "custom",
        path: ["guards", "maximumEntryBps"],
        message: "maximum entry must be at least the gte trigger threshold",
      });
    }
  });

export type StrategyV1 = z.infer<typeof strategyV1Schema>;

export const lifecycleStatusSchema = z.enum([
  "Trading",
  "Locked",
  "Finalized",
  "Voided",
  "Unknown",
]);

export const bookSideV1Schema = z.object({
  bestBidRaw: unsignedIntegerStringSchema.nullable(),
  bestAskRaw: unsignedIntegerStringSchema.nullable(),
  bidDepthRaw: unsignedIntegerStringSchema,
  askDepthRaw: unsignedIntegerStringSchema,
});

export const marketSnapshotV1Schema = z
  .object({
    version: z.literal("1"),
    network: z.literal(SHANNON_NETWORK),
    venueId: z.string().min(1),
    marketId: z.string().min(1),
    poolAddress: z.string().min(1),
    asset: z.enum(["BTC", "ETH"]),
    intervalSeconds: z.union([z.literal(900), z.literal(3600)]),
    strikeRaw: unsignedIntegerStringSchema.nullable(),
    marketExpiryMs: z.number().int().positive(),
    capturedAtMs: z.number().int().nonnegative(),
    indexerTimestampMs: z.number().int().nonnegative().nullable(),
    sourceBlock: unsignedIntegerStringSchema.nullable(),
    indexerStatus: lifecycleStatusSchema,
    chainStatus: lifecycleStatusSchema,
    connection: z.enum(["live", "reconnecting", "disconnected"]),
    priceDecimals: z.number().int().min(0).max(36),
    quantityDecimals: z.number().int().min(0).max(36),
    collateralDecimals: z.number().int().min(0).max(36),
    tickSizeRaw: unsignedIntegerStringSchema.refine((value) => value !== "0"),
    lotSizeRaw: unsignedIntegerStringSchema.refine((value) => value !== "0"),
    yes: bookSideV1Schema,
    no: bookSideV1Schema,
  })
  .strict();

export type MarketSnapshotV1 = z.infer<typeof marketSnapshotV1Schema>;

export const riskSnapshotV1Schema = z
  .object({
    version: z.literal("1"),
    marketId: z.string().min(1),
    ordersForMarket: z.number().int().nonnegative(),
    dailyCollateralRaw: unsignedIntegerStringSchema,
    consecutiveFailures: z.number().int().nonnegative(),
    lastOrderAtMs: z.number().int().nonnegative().nullable(),
    collateralDecimals: z.number().int().min(0).max(36),
    asOfMs: z.number().int().nonnegative(),
  })
  .strict();

export type RiskSnapshotV1 = z.infer<typeof riskSnapshotV1Schema>;

export const guardCodeSchema = z.enum([
  "NETWORK_MATCH",
  "SELECTOR_MATCH",
  "CONNECTION_LIVE",
  "CHAIN_TRADING",
  "BOOK_AVAILABLE",
  "SNAPSHOT_FRESH",
  "TIME_REMAINING",
  "TRIGGER_MATCH",
  "ENTRY_CAP",
  "ABSOLUTE_SPREAD",
  "RELATIVE_SPREAD",
  "EXECUTABLE_DEPTH",
  "QUANTITY_CAP",
  "COLLATERAL_CAP",
  "ORDERS_PER_MARKET",
  "DAILY_COLLATERAL",
  "COOLDOWN",
  "FAILURE_STOP",
]);

export type GuardCode = z.infer<typeof guardCodeSchema>;

export const guardResultV1Schema = z.object({
  code: guardCodeSchema,
  passed: z.boolean(),
  explanation: z.string().min(1),
  observed: z.string().optional(),
  limit: z.string().optional(),
});

export const decisionV1Schema = z
  .object({
    version: z.literal("1"),
    eligible: z.boolean(),
    strategyHash: z.string().regex(/^[a-f0-9]{64}$/),
    intentKey: z.string().regex(/^[a-f0-9]{64}$/),
    marketId: z.string().min(1),
    outcome: z.enum(["YES", "NO"]),
    snapshotTimestampMs: z.number().int().nonnegative(),
    sourceBlock: unsignedIntegerStringSchema.nullable(),
    validUntilMs: z.number().int().nonnegative(),
    marketExpiryMs: z.number().int().positive(),
    chainStatus: lifecycleStatusSchema,
    bestBidRaw: unsignedIntegerStringSchema.nullable(),
    bestAskRaw: unsignedIntegerStringSchema.nullable(),
    outcomePriceRaw: unsignedIntegerStringSchema,
    /** Native DreamDEX YES-term price passed to placeOrder, including for BUY_NO. */
    limitPriceRaw: unsignedIntegerStringSchema,
    quantityRaw: unsignedIntegerStringSchema,
    maximumCostRaw: unsignedIntegerStringSchema,
    executableQuantityRaw: unsignedIntegerStringSchema,
    priceTickRaw: unsignedIntegerStringSchema,
    quantityLotRaw: unsignedIntegerStringSchema,
    guards: z.array(guardResultV1Schema).min(1),
    reasons: z.array(z.string()),
  })
  .strict();

export type DecisionV1 = z.infer<typeof decisionV1Schema>;
export type GuardResultV1 = z.infer<typeof guardResultV1Schema>;

export const executionIntentV1Schema = z.object({
  version: z.literal("1"),
  intentKey: z.string().regex(/^[a-f0-9]{64}$/),
  strategyHash: z.string().regex(/^[a-f0-9]{64}$/),
  marketId: z.string().min(1),
  poolAddress: z.string().min(1),
  outcome: z.enum(["YES", "NO"]),
  priceDecimals: z.number().int().min(0).max(36),
  quantityDecimals: z.number().int().min(0).max(36),
  collateralDecimals: z.number().int().min(0).max(36),
  limitPriceRaw: unsignedIntegerStringSchema,
  quantityRaw: unsignedIntegerStringSchema,
  maximumCostRaw: unsignedIntegerStringSchema,
  expiryMs: z.number().int().positive(),
  timeInForce: z.literal("IOC"),
  state: z.enum(["PREPARED", "SENT", "SUCCEEDED", "REVERTED", "UNKNOWN"]),
  createdAtMs: z.number().int().nonnegative(),
});

export type ExecutionIntentV1 = z.infer<typeof executionIntentV1Schema>;

export const runnerEventKindSchema = z.enum([
  "runner.started",
  "runner.stopped",
  "evaluation.eligible",
  "evaluation.skipped",
  "intent.prepared",
  "transaction.sent",
  "transaction.succeeded",
  "transaction.reverted",
  "fill.recorded",
  "settlement.detected",
  "claim.sent",
  "claim.succeeded",
  "claim.reverted",
  "claim.unknown",
  "claim.scan_failed",
  "reconciliation.completed",
]);

export const runnerEventV1Schema = z.object({
  version: z.literal("1"),
  sequence: z.number().int().positive(),
  id: z.string().min(1),
  kind: runnerEventKindSchema,
  occurredAtMs: z.number().int().nonnegative(),
  marketId: z.string().nullable(),
  strategyHash: z.string().nullable(),
  intentKey: z.string().nullable(),
  transactionHash: z.string().nullable(),
  summary: z.string().min(1),
});

export type RunnerEventV1 = z.infer<typeof runnerEventV1Schema>;

export const evaluationRequestV1Schema = z.object({
  strategy: strategyV1Schema,
  market: marketSnapshotV1Schema,
  risk: riskSnapshotV1Schema,
  evaluatedAtMs: z.number().int().nonnegative().optional(),
});

export type EvaluationRequestV1 = z.infer<typeof evaluationRequestV1Schema>;
