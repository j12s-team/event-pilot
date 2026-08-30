import {
  SHANNON_NETWORK,
  decisionV1Schema,
  marketSnapshotV1Schema,
  riskSnapshotV1Schema,
  strategyV1Schema,
  type DecisionV1,
  type GuardCode,
  type GuardResultV1,
  type MarketSnapshotV1,
  type RiskSnapshotV1,
  type StrategyV1,
} from "@eventpilot/contracts";

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(\.\d+)?$/;

export function normalizeDecimalString(value: string): string {
  if (!DECIMAL_PATTERN.test(value)) return value;
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length === 0 ? whole : `${whole}.${trimmed}`;
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "string") return normalizeDecimalString(value);
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function serializeStrategy(strategy: StrategyV1): string {
  const parsed = strategyV1Schema.parse(strategy);
  return JSON.stringify(canonicalize(parsed));
}

function bytesToHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(digest);
}

export async function hashStrategy(strategy: StrategyV1): Promise<string> {
  return sha256Hex(serializeStrategy(strategy));
}

export function exportStrategy(strategy: StrategyV1): string {
  return `${JSON.stringify(canonicalize(strategyV1Schema.parse(strategy)), null, 2)}\n`;
}

export function importStrategy(input: string): StrategyV1 {
  return strategyV1Schema.parse(JSON.parse(input) as unknown);
}

export function pow10(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new RangeError("decimals must be an integer between 0 and 36");
  }
  return 10n ** BigInt(decimals);
}

export function parseDecimalToRaw(value: string, decimals: number): bigint {
  if (!DECIMAL_PATTERN.test(value)) throw new TypeError("invalid decimal string");
  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * pow10(decimals) + BigInt(normalizedFraction || "0");
}

export function alignDown(value: bigint, increment: bigint): bigint {
  if (increment <= 0n) throw new RangeError("increment must be positive");
  return value - (value % increment);
}

export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n;
}

export function priceBpsToRaw(valueBps: number, priceDecimals: number): bigint {
  return (BigInt(valueBps) * pow10(priceDecimals)) / 10_000n;
}

export function priceRawToBps(priceRaw: bigint, priceDecimals: number): bigint {
  return (priceRaw * 10_000n) / pow10(priceDecimals);
}

export function maximumCostRaw(input: {
  priceRaw: bigint;
  quantityRaw: bigint;
  priceDecimals: number;
  quantityDecimals: number;
  collateralDecimals: number;
}): bigint {
  const numerator = input.priceRaw * input.quantityRaw * pow10(input.collateralDecimals);
  const denominator = pow10(input.priceDecimals) * pow10(input.quantityDecimals);
  return ceilDiv(numerator, denominator);
}

function maximumQuantityForCollateral(input: {
  collateralRaw: bigint;
  priceRaw: bigint;
  priceDecimals: number;
  quantityDecimals: number;
  collateralDecimals: number;
}): bigint {
  if (input.priceRaw === 0n) return 0n;
  return (
    (input.collateralRaw * pow10(input.priceDecimals) * pow10(input.quantityDecimals)) /
    (input.priceRaw * pow10(input.collateralDecimals))
  );
}

function guard(
  code: GuardCode,
  passed: boolean,
  explanation: string,
  observed?: string,
  limit?: string,
): GuardResultV1 {
  return {
    code,
    passed,
    explanation,
    ...(observed === undefined ? {} : { observed }),
    ...(limit === undefined ? {} : { limit }),
  };
}

export interface EvaluationInput {
  strategy: StrategyV1;
  market: MarketSnapshotV1;
  risk: RiskSnapshotV1;
  evaluatedAtMs?: number | undefined;
}

export async function evaluateStrategy(input: EvaluationInput): Promise<DecisionV1> {
  const strategy = strategyV1Schema.parse(input.strategy);
  const market = marketSnapshotV1Schema.parse(input.market);
  const risk = riskSnapshotV1Schema.parse(input.risk);
  const evaluatedAtMs = input.evaluatedAtMs ?? Date.now();
  const side = strategy.selector.outcome === "YES" ? market.yes : market.no;
  const bestAsk = side.bestAskRaw === null ? null : BigInt(side.bestAskRaw);
  const bestBid = side.bestBidRaw === null ? null : BigInt(side.bestBidRaw);
  const askDepth = BigInt(side.askDepthRaw);
  const tick = BigInt(market.tickSizeRaw);
  const lot = BigInt(market.lotSizeRaw);
  const priceScale = pow10(market.priceDecimals);
  const desiredQuantity = parseDecimalToRaw(strategy.order.quantity, market.quantityDecimals);
  const minimumQuantity = parseDecimalToRaw(
    strategy.guards.minimumExecutableQuantity,
    market.quantityDecimals,
  );
  const orderCollateralCap = parseDecimalToRaw(
    strategy.order.maximumCollateral,
    market.collateralDecimals,
  );
  const dailyCollateralCap = parseDecimalToRaw(
    strategy.risk.maximumDailyCollateral,
    risk.collateralDecimals,
  );
  const maximumEntryRaw = priceBpsToRaw(strategy.guards.maximumEntryBps, market.priceDecimals);
  const outcomePrice = alignDown(bestAsk === null ? maximumEntryRaw : bestAsk, tick);
  // DreamDEX's native binary order price is always expressed in YES terms.
  // BUY_NO collateral is quantity * (one - yesPrice), so retain the outcome
  // price for risk math while emitting the inverted native limit for execution.
  const limitPrice = strategy.selector.outcome === "NO" ? priceScale - outcomePrice : outcomePrice;
  const collateralQuantityCap = maximumQuantityForCollateral({
    collateralRaw: orderCollateralCap,
    priceRaw: outcomePrice,
    priceDecimals: market.priceDecimals,
    quantityDecimals: market.quantityDecimals,
    collateralDecimals: market.collateralDecimals,
  });
  const executableQuantity = alignDown(
    [desiredQuantity, askDepth, collateralQuantityCap].reduce((minimum, value) =>
      value < minimum ? value : minimum,
    ),
    lot,
  );
  const cost = maximumCostRaw({
    priceRaw: outcomePrice,
    quantityRaw: executableQuantity,
    priceDecimals: market.priceDecimals,
    quantityDecimals: market.quantityDecimals,
    collateralDecimals: market.collateralDecimals,
  });
  const askBps = bestAsk === null ? null : priceRawToBps(bestAsk, market.priceDecimals);
  const spread =
    bestAsk === null || bestBid === null || bestAsk < bestBid ? null : bestAsk - bestBid;
  const spreadBps = spread === null ? null : priceRawToBps(spread, market.priceDecimals);
  const relativeSpreadPpm =
    spread === null || bestAsk === null || bestAsk === 0n ? null : (spread * 1_000_000n) / bestAsk;
  const snapshotAgeMs = Math.max(0, evaluatedAtMs - market.capturedAtMs);
  const secondsRemaining = Math.floor((market.marketExpiryMs - evaluatedAtMs) / 1_000);
  const cooldownUntil =
    risk.lastOrderAtMs === null ? 0 : risk.lastOrderAtMs + strategy.risk.cooldownSeconds * 1_000;
  const trigger = strategy.trigger.bestAskBps;
  const triggerPassed =
    askBps !== null &&
    (trigger.operator === "lte"
      ? askBps <= BigInt(trigger.valueBps)
      : askBps >= BigInt(trigger.valueBps));
  const projectedDailyCollateral = BigInt(risk.dailyCollateralRaw) + cost;

  const selectorMatches =
    market.asset === strategy.selector.asset &&
    market.intervalSeconds === strategy.selector.intervalSeconds;
  const bookAvailable = bestAsk !== null && bestBid !== null;
  const snapshotFresh = snapshotAgeMs <= strategy.guards.maximumSnapshotAgeMs;
  const enoughTime = secondsRemaining >= strategy.guards.minimumSecondsRemaining;
  const entryInsideCap = bestAsk !== null && bestAsk <= maximumEntryRaw;
  const absoluteSpreadInside =
    spreadBps !== null && spreadBps <= BigInt(strategy.guards.maximumAbsoluteSpreadBps);
  const relativeSpreadInside =
    relativeSpreadPpm !== null &&
    relativeSpreadPpm <= BigInt(strategy.guards.maximumRelativeSpreadPpm);
  const depthEnough = executableQuantity >= minimumQuantity;
  const quantityInsideCap = executableQuantity <= desiredQuantity;
  const collateralInsideCap = cost <= orderCollateralCap;
  const ordersInsideLimit = risk.ordersForMarket < strategy.risk.maximumOrdersPerMarket;
  const dailyInsideCap = projectedDailyCollateral <= dailyCollateralCap;
  const cooldownElapsed = evaluatedAtMs >= cooldownUntil;
  const failuresInsideLimit = risk.consecutiveFailures < strategy.risk.maximumConsecutiveFailures;

  const guards: GuardResultV1[] = [
    guard(
      "NETWORK_MATCH",
      market.network === SHANNON_NETWORK,
      market.network === SHANNON_NETWORK
        ? "Snapshot is from Somnia Shannon."
        : "Snapshot is not from Somnia Shannon.",
    ),
    guard(
      "SELECTOR_MATCH",
      selectorMatches,
      selectorMatches
        ? "Market asset and interval match the strategy selector."
        : "Market asset or interval does not match the strategy selector.",
      `${market.asset}/${market.intervalSeconds}`,
      `${strategy.selector.asset}/${strategy.selector.intervalSeconds}`,
    ),
    guard(
      "CONNECTION_LIVE",
      market.connection === "live",
      market.connection === "live"
        ? "Market data connection is live."
        : `Market data connection is ${market.connection}.`,
      market.connection,
      "live",
    ),
    guard(
      "CHAIN_TRADING",
      market.chainStatus === "Trading",
      market.chainStatus === "Trading"
        ? "Authoritative on-chain state is Trading."
        : `Authoritative on-chain state is ${market.chainStatus}, not Trading.`,
      market.chainStatus,
      "Trading",
    ),
    guard(
      "BOOK_AVAILABLE",
      bookAvailable,
      bookAvailable
        ? "Selected outcome has both a bid and an ask."
        : "Selected outcome is missing an executable bid or ask.",
    ),
    guard(
      "SNAPSHOT_FRESH",
      snapshotFresh,
      snapshotFresh
        ? "Snapshot is inside the freshness window."
        : "Snapshot is older than the configured freshness window.",
      `${snapshotAgeMs}ms`,
      `${strategy.guards.maximumSnapshotAgeMs}ms`,
    ),
    guard(
      "TIME_REMAINING",
      enoughTime,
      enoughTime
        ? "Market has enough time remaining."
        : "Market has less time remaining than the configured minimum.",
      `${secondsRemaining}s`,
      `${strategy.guards.minimumSecondsRemaining}s`,
    ),
    guard(
      "TRIGGER_MATCH",
      triggerPassed,
      triggerPassed
        ? `Best ask satisfies the ${trigger.operator} trigger.`
        : `Best ask does not satisfy the ${trigger.operator} trigger.`,
      askBps === null ? "none" : `${askBps}bps`,
      `${trigger.valueBps}bps`,
    ),
    guard(
      "ENTRY_CAP",
      entryInsideCap,
      entryInsideCap
        ? "Best ask does not exceed the entry cap."
        : "Best ask is unavailable or exceeds the entry cap.",
      bestAsk?.toString() ?? "none",
      maximumEntryRaw.toString(),
    ),
    guard(
      "ABSOLUTE_SPREAD",
      absoluteSpreadInside,
      absoluteSpreadInside
        ? "Absolute spread is within policy."
        : "Absolute spread is unavailable or exceeds policy.",
      spreadBps === null ? "none" : `${spreadBps}bps`,
      `${strategy.guards.maximumAbsoluteSpreadBps}bps`,
    ),
    guard(
      "RELATIVE_SPREAD",
      relativeSpreadInside,
      relativeSpreadInside
        ? "Relative spread is within policy."
        : "Relative spread is unavailable or exceeds policy.",
      relativeSpreadPpm === null ? "none" : `${relativeSpreadPpm}ppm`,
      `${strategy.guards.maximumRelativeSpreadPpm}ppm`,
    ),
    guard(
      "EXECUTABLE_DEPTH",
      depthEnough,
      depthEnough
        ? "Executable ask depth meets the configured minimum."
        : "Executable ask depth is below the configured minimum.",
      executableQuantity.toString(),
      minimumQuantity.toString(),
    ),
    guard(
      "QUANTITY_CAP",
      quantityInsideCap,
      quantityInsideCap
        ? "Lot-rounded quantity does not exceed the configured quantity."
        : "Lot-rounded quantity exceeds the configured quantity.",
      executableQuantity.toString(),
      desiredQuantity.toString(),
    ),
    guard(
      "COLLATERAL_CAP",
      collateralInsideCap,
      collateralInsideCap
        ? "Ceiling-rounded maximum cost stays inside the order collateral cap."
        : "Ceiling-rounded maximum cost exceeds the order collateral cap.",
      cost.toString(),
      orderCollateralCap.toString(),
    ),
    guard(
      "ORDERS_PER_MARKET",
      ordersInsideLimit,
      ordersInsideLimit
        ? "Per-market order count is below its limit."
        : "Per-market order count has reached its limit.",
      String(risk.ordersForMarket),
      String(strategy.risk.maximumOrdersPerMarket),
    ),
    guard(
      "DAILY_COLLATERAL",
      dailyInsideCap,
      dailyInsideCap
        ? "Projected daily collateral stays inside its cap."
        : "Projected daily collateral would exceed its cap.",
      projectedDailyCollateral.toString(),
      dailyCollateralCap.toString(),
    ),
    guard(
      "COOLDOWN",
      cooldownElapsed,
      cooldownElapsed ? "Strategy cooldown has elapsed." : "Strategy cooldown is still active.",
      String(evaluatedAtMs),
      String(cooldownUntil),
    ),
    guard(
      "FAILURE_STOP",
      failuresInsideLimit,
      failuresInsideLimit
        ? "Consecutive failures are below the stop threshold."
        : "Consecutive failures reached the stop threshold.",
      String(risk.consecutiveFailures),
      String(strategy.risk.maximumConsecutiveFailures),
    ),
  ];

  const strategyHash = await hashStrategy(strategy);
  const intentKey = await sha256Hex(
    [
      strategyHash,
      market.marketId,
      strategy.selector.outcome,
      market.sourceBlock ?? String(market.capturedAtMs),
    ].join(":"),
  );
  const reasons = guards.filter((result) => !result.passed).map((result) => result.explanation);
  const decision = {
    version: "1" as const,
    eligible: reasons.length === 0,
    strategyHash,
    intentKey,
    marketId: market.marketId,
    outcome: strategy.selector.outcome,
    snapshotTimestampMs: market.capturedAtMs,
    sourceBlock: market.sourceBlock,
    validUntilMs: Math.min(
      market.marketExpiryMs,
      market.capturedAtMs + strategy.guards.maximumSnapshotAgeMs,
    ),
    marketExpiryMs: market.marketExpiryMs,
    chainStatus: market.chainStatus,
    bestBidRaw: side.bestBidRaw,
    bestAskRaw: side.bestAskRaw,
    outcomePriceRaw: outcomePrice.toString(),
    limitPriceRaw: limitPrice.toString(),
    quantityRaw: executableQuantity.toString(),
    maximumCostRaw: cost.toString(),
    executableQuantityRaw: executableQuantity.toString(),
    priceTickRaw: tick.toString(),
    quantityLotRaw: lot.toString(),
    guards,
    reasons,
  };
  return decisionV1Schema.parse(decision);
}

export const defaultStrategy: StrategyV1 = {
  version: "1",
  network: SHANNON_NETWORK,
  name: "BTC 15m guarded YES",
  selector: { asset: "BTC", intervalSeconds: 900, outcome: "YES" },
  trigger: { bestAskBps: { operator: "lte", valueBps: 6_000 } },
  guards: {
    maximumEntryBps: 6_200,
    maximumAbsoluteSpreadBps: 250,
    maximumRelativeSpreadPpm: 50_000,
    minimumSecondsRemaining: 120,
    maximumSnapshotAgeMs: 15_000,
    minimumExecutableQuantity: "1",
  },
  order: { timeInForce: "IOC", quantity: "5", maximumCollateral: "3.1" },
  risk: {
    maximumOrdersPerMarket: 2,
    maximumDailyCollateral: "15",
    cooldownSeconds: 60,
    maximumConsecutiveFailures: 3,
  },
};
