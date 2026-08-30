import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultStrategy, evaluateStrategy } from "@eventpilot/strategy";
import { FIXTURE_NOW_MS, marketFixture, riskFixture } from "@eventpilot/test-fixtures";

import { EventPilotStore } from "./database.js";
import { GuardedExecutor, type GuardedVenueWriter, type VerifiedReceipt } from "./executor.js";
import { SignerQueue } from "./runner.js";

const stores: EventPilotStore[] = [];
function store(): EventPilotStore {
  const instance = new EventPilotStore(
    join(mkdtempSync(join(tmpdir(), "eventpilot-executor-")), "db.sqlite"),
  );
  stores.push(instance);
  return instance;
}
afterEach(() => stores.splice(0).forEach((instance) => instance.close()));

function writer(overrides: Partial<GuardedVenueWriter> = {}): GuardedVenueWriter {
  let receipt: VerifiedReceipt = {
    hash: "0xabc",
    status: "success",
    blockNumber: 123n,
    gasUsed: 45n,
    fills: [],
  };
  return {
    getChainId: async () => 50_312,
    getMarketStatus: async () => "Trading",
    sendIoc: async () => ({ hash: receipt.hash }),
    waitForReceipt: async () => receipt,
    ...overrides,
  };
}

async function eligibleDecision() {
  return evaluateStrategy({
    strategy: defaultStrategy,
    market: marketFixture(),
    risk: riskFixture(),
    evaluatedAtMs: FIXTURE_NOW_MS,
  });
}

describe("guarded execution", () => {
  it("persists one intent, verifies success, and classifies an unfilled IOC", async () => {
    const database = store();
    const executor = new GuardedExecutor(
      database,
      new SignerQueue(),
      writer(),
      () => FIXTURE_NOW_MS,
    );
    const decision = await eligibleDecision();
    const result = await executor.execute(decision, marketFixture());
    expect(result).toMatchObject({ kind: "unfilled", transactionHash: "0xabc" });
    expect((await database.listEvents()).map((event) => event.kind)).toEqual([
      "intent.prepared",
      "transaction.sent",
      "transaction.succeeded",
    ]);
    await expect(database.getEvidence(3)).resolves.toMatchObject({
      snapshot: { marketId: marketFixture().marketId, sourceBlock: "12345678" },
      decision: { intentKey: decision.intentKey, eligible: true },
      intent: { intentKey: decision.intentKey, state: "SUCCEEDED" },
      transaction: { hash: "0xabc", receiptStatus: "success" },
      fills: [],
      explorer: "https://shannon-explorer.somnia.network/tx/0xabc",
    });
    await expect(database.getLatestVerifiedEvidence()).resolves.toMatchObject({
      event: { sequence: 3, kind: "transaction.succeeded" },
      transaction: { hash: "0xabc" },
    });
    expect(await executor.execute(decision, marketFixture())).toMatchObject({ kind: "duplicate" });
  });

  it("records a partial fill using exact raw quantities", async () => {
    const database = store();
    const receiptWriter = writer({
      waitForReceipt: async () => ({
        hash: "0xpartial",
        status: "success",
        blockNumber: 124n,
        gasUsed: 46n,
        fills: [{ quantityRaw: 1_000_000_000_000_000_000n, priceRaw: 540_000_000_000_000_000n }],
      }),
      sendIoc: async () => ({ hash: "0xpartial" }),
    });
    const result = await new GuardedExecutor(
      database,
      new SignerQueue(),
      receiptWriter,
      () => FIXTURE_NOW_MS,
    ).execute(await eligibleDecision(), marketFixture());
    expect(result).toMatchObject({ kind: "partial", filledQuantityRaw: "1000000000000000000" });
    expect(database.getRiskSnapshot(marketFixture().marketId, 18, FIXTURE_NOW_MS)).toMatchObject({
      ordersForMarket: 1,
      dailyCollateralRaw: "540000000000000000",
      consecutiveFailures: 0,
    });
  });

  it("fails closed for wrong chain or a non-Trading pre-write state", async () => {
    const wrongChainStore = store();
    const wrongChain = new GuardedExecutor(
      wrongChainStore,
      new SignerQueue(),
      writer({ getChainId: async () => 1 }),
      () => FIXTURE_NOW_MS,
    );
    expect(await wrongChain.execute(await eligibleDecision(), marketFixture())).toMatchObject({
      kind: "rejected",
    });
    expect(wrongChainStore.hasUnreconciledWrite()).toBe(false);

    const lockedStore = store();
    const locked = new GuardedExecutor(
      lockedStore,
      new SignerQueue(),
      writer({ getMarketStatus: async () => "Locked" }),
      () => FIXTURE_NOW_MS,
    );
    expect(await locked.execute(await eligibleDecision(), marketFixture())).toMatchObject({
      kind: "rejected",
    });
  });

  it("records an explicit reverted order receipt and failure-stop risk", async () => {
    const database = store();
    const receiptWriter = writer({
      waitForReceipt: async () => ({
        hash: "0xreverted",
        status: "reverted",
        blockNumber: 125n,
        gasUsed: 47n,
        fills: [],
      }),
      sendIoc: async () => ({ hash: "0xreverted" }),
    });
    const result = await new GuardedExecutor(
      database,
      new SignerQueue(),
      receiptWriter,
      () => FIXTURE_NOW_MS,
    ).execute(await eligibleDecision(), marketFixture());
    expect(result).toMatchObject({ kind: "reverted", transactionHash: "0xreverted" });
    expect(database.getRiskSnapshot(marketFixture().marketId, 18, FIXTURE_NOW_MS)).toMatchObject({
      ordersForMarket: 1,
      dailyCollateralRaw: "0",
      consecutiveFailures: 1,
    });
  });

  it("blocks later writes when an order receipt cannot be classified", async () => {
    const database = store();
    const receiptWriter = writer({
      waitForReceipt: vi.fn(async () => {
        throw new Error("receipt transport ended");
      }),
      sendIoc: async () => ({ hash: "0xunknown" }),
    });
    const executor = new GuardedExecutor(
      database,
      new SignerQueue(),
      receiptWriter,
      () => FIXTURE_NOW_MS,
    );
    expect(await executor.execute(await eligibleDecision(), marketFixture())).toMatchObject({
      kind: "unknown",
      transactionHash: "0xunknown",
    });
    expect(database.hasUnreconciledWrite()).toBe(true);
    await expect(executor.execute(await eligibleDecision(), marketFixture())).rejects.toThrow(
      "reconciled",
    );
  });

  it("refuses an eligible decision after its bounded validity expires", async () => {
    const decision = await eligibleDecision();
    const database = store();
    const executor = new GuardedExecutor(
      database,
      new SignerQueue(),
      writer(),
      () => decision.validUntilMs + 1,
    );
    await expect(executor.execute(decision, marketFixture())).rejects.toThrow("validity expired");
  });

  it("serializes every signer operation through one queue", async () => {
    const queue = new SignerQueue();
    const order: string[] = [];
    const first = queue.run(async () => {
      order.push("order-start");
      await Promise.resolve();
      order.push("order-end");
    });
    const claim = queue.run(async () => {
      order.push("claim-start");
      order.push("claim-end");
    });
    await Promise.all([first, claim]);
    expect(order).toEqual(["order-start", "order-end", "claim-start", "claim-end"]);
  });
});
