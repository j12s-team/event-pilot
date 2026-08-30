import { describe, expect, it } from "vitest";

import { FIXTURE_NOW_MS, marketFixture, riskFixture } from "@eventpilot/test-fixtures";

import {
  defaultStrategy,
  evaluateStrategy,
  exportStrategy,
  hashStrategy,
  importStrategy,
  maximumCostRaw,
  parseDecimalToRaw,
  serializeStrategy,
} from "./index.js";

describe("strategy serialization", () => {
  it("normalizes decimal strings into a stable SHA-256 identity", async () => {
    const equivalent = structuredClone(defaultStrategy);
    equivalent.order.quantity = "5.000";
    equivalent.order.maximumCollateral = "3.1000";

    expect(serializeStrategy(equivalent)).toBe(serializeStrategy(defaultStrategy));
    expect(await hashStrategy(equivalent)).toBe(await hashStrategy(defaultStrategy));
    expect(await hashStrategy(defaultStrategy)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("round-trips exported JSON through strict validation", () => {
    expect(importStrategy(exportStrategy(defaultStrategy))).toEqual(defaultStrategy);
  });
});

describe("integer protocol arithmetic", () => {
  it("floors excess decimal precision and rejects scientific notation", () => {
    expect(parseDecimalToRaw("1.2349", 3)).toBe(1_234n);
    expect(() => parseDecimalToRaw("1e3", 18)).toThrow("invalid decimal string");
  });

  it("ceiling-rounds collateral cost", () => {
    expect(
      maximumCostRaw({
        priceRaw: 3n,
        quantityRaw: 2n,
        priceDecimals: 1,
        quantityDecimals: 1,
        collateralDecimals: 1,
      }),
    ).toBe(1n);
  });
});

describe("deterministic evaluation", () => {
  it("returns an exact eligible decision at the threshold boundary", async () => {
    const strategy = structuredClone(defaultStrategy);
    strategy.trigger.bestAskBps.valueBps = 5_400;
    const decision = await evaluateStrategy({
      strategy,
      market: marketFixture(),
      risk: riskFixture(),
      evaluatedAtMs: FIXTURE_NOW_MS,
    });

    expect(decision.eligible).toBe(true);
    expect(decision.limitPriceRaw).toBe("540000000000000000");
    expect(decision.quantityRaw).toBe("5000000000000000000");
    expect(decision.maximumCostRaw).toBe("2700000000000000000");
    expect(decision.guards).toHaveLength(18);
  });

  it.each([
    [
      "stale snapshot",
      marketFixture({ capturedAtMs: FIXTURE_NOW_MS - 20_000 }),
      riskFixture(),
      "SNAPSHOT_FRESH",
    ],
    ["locked market", marketFixture({ chainStatus: "Locked" }), riskFixture(), "CHAIN_TRADING"],
    [
      "empty book",
      marketFixture({ yes: { ...marketFixture().yes, bestAskRaw: null } }),
      riskFixture(),
      "BOOK_AVAILABLE",
    ],
    [
      "cooldown",
      marketFixture(),
      riskFixture({ lastOrderAtMs: FIXTURE_NOW_MS - 10_000 }),
      "COOLDOWN",
    ],
    [
      "daily cap",
      marketFixture(),
      riskFixture({ dailyCollateralRaw: "14900000000000000000" }),
      "DAILY_COLLATERAL",
    ],
    ["failure stop", marketFixture(), riskFixture({ consecutiveFailures: 3 }), "FAILURE_STOP"],
  ])("fails closed for %s", async (_name, market, risk, code) => {
    const decision = await evaluateStrategy({
      strategy: defaultStrategy,
      market,
      risk,
      evaluatedAtMs: FIXTURE_NOW_MS,
    });
    expect(decision.eligible).toBe(false);
    expect(decision.guards.find((item) => item.code === code)?.passed).toBe(false);
  });

  it("never exceeds quantity or collateral caps over boundary quantities", async () => {
    for (const quantity of ["0.000000000000000001", "0.9999", "1", "5.999", "1000"]) {
      const strategy = structuredClone(defaultStrategy);
      strategy.order.quantity = quantity;
      strategy.order.maximumCollateral = "1.000000000000000001";
      strategy.guards.minimumExecutableQuantity = "0.000000000000000001";
      const decision = await evaluateStrategy({
        strategy,
        market: marketFixture({ lotSizeRaw: "1" }),
        risk: riskFixture(),
        evaluatedAtMs: FIXTURE_NOW_MS,
      });
      expect(BigInt(decision.quantityRaw)).toBeLessThanOrEqual(parseDecimalToRaw(quantity, 18));
      expect(BigInt(decision.maximumCostRaw)).toBeLessThanOrEqual(
        parseDecimalToRaw(strategy.order.maximumCollateral, 18),
      );
    }
  });

  it("keys decisions to market identity so rollover cannot inherit an intent", async () => {
    const first = await evaluateStrategy({
      strategy: defaultStrategy,
      market: marketFixture(),
      risk: riskFixture(),
      evaluatedAtMs: FIXTURE_NOW_MS,
    });
    const rolled = await evaluateStrategy({
      strategy: defaultStrategy,
      market: marketFixture({ marketId: "btc-15m-next", sourceBlock: "12345699" }),
      risk: riskFixture({ marketId: "btc-15m-next" }),
      evaluatedAtMs: FIXTURE_NOW_MS,
    });
    expect(rolled.intentKey).not.toBe(first.intentKey);
  });

  it("emits BUY_NO protocol prices in native YES terms while costing in NO terms", async () => {
    const strategy = structuredClone(defaultStrategy);
    strategy.selector.outcome = "NO";
    strategy.trigger.bestAskBps.valueBps = 5_000;
    const decision = await evaluateStrategy({
      strategy,
      market: marketFixture(),
      risk: riskFixture(),
      evaluatedAtMs: FIXTURE_NOW_MS,
    });
    expect(decision.outcomePriceRaw).toBe("460000000000000000");
    expect(decision.limitPriceRaw).toBe("540000000000000000");
    expect(decision.maximumCostRaw).toBe("2300000000000000000");
  });
});
