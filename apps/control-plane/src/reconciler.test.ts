import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventPilotStore } from "./database.js";
import { RestartReconciler } from "./reconciler.js";

const stores: EventPilotStore[] = [];
function store(): EventPilotStore {
  const instance = new EventPilotStore(
    join(mkdtempSync(join(tmpdir(), "eventpilot-reconcile-")), "db.sqlite"),
  );
  stores.push(instance);
  return instance;
}
afterEach(() => stores.splice(0).forEach((instance) => instance.close()));

const intent = {
  version: "1" as const,
  intentKey: "a".repeat(64),
  strategyHash: "b".repeat(64),
  marketId: "market-1",
  poolAddress: "0x1111111111111111111111111111111111111111",
  outcome: "NO" as const,
  priceDecimals: 18,
  quantityDecimals: 18,
  collateralDecimals: 18,
  limitPriceRaw: "540000000000000000",
  quantityRaw: "2000000000000000000",
  maximumCostRaw: "920000000000000000",
  expiryMs: 2_000,
  timeInForce: "IOC" as const,
  state: "PREPARED" as const,
  createdAtMs: 1_000,
};

describe("restart reconciliation", () => {
  it("decodes a successful NO fill and restores exact risk accounting", async () => {
    const database = store();
    expect(database.prepareIntent(intent)).toBe(true);
    database.updateIntentState(intent.intentKey, "SENT", "0xorder");
    const reconciler = new RestartReconciler(
      database,
      {
        lookupReceipt: async (_hash, pool) => {
          expect(pool).toBe(intent.poolAddress);
          return {
            hash: "0xorder",
            status: "success",
            blockNumber: 10n,
            gasUsed: 20n,
            fills: [
              { quantityRaw: 1_000_000_000_000_000_000n, priceRaw: 540_000_000_000_000_000n },
            ],
          };
        },
      },
      () => 1_500,
    );
    expect(await reconciler.reconcile()).toEqual({ inspected: 1, resolved: 1, pending: 0 });
    expect(database.hasUnreconciledWrite()).toBe(false);
    expect(database.getRiskSnapshot(intent.marketId, 18, 1_500)).toMatchObject({
      ordersForMarket: 1,
      dailyCollateralRaw: "460000000000000000",
    });
  });

  it("leaves a missing receipt unresolved and blocks new writes", async () => {
    const database = store();
    database.prepareIntent(intent);
    database.updateIntentState(intent.intentKey, "UNKNOWN", "0xmissing");
    const reconciler = new RestartReconciler(database, { lookupReceipt: async () => null });
    expect(await reconciler.reconcile()).toEqual({ inspected: 1, resolved: 0, pending: 1 });
    expect(database.hasUnreconciledWrite()).toBe(true);
  });

  it("reconciles a sent claim receipt idempotently", async () => {
    const database = store();
    database.prepareClaim({
      claimKey: "c".repeat(64),
      marketId: "market-final",
      walletAddress: "0x1111111111111111111111111111111111111111",
      outcome: "YES",
      amountRaw: "100",
      createdAtMs: 1_000,
    });
    database.updateClaimState("c".repeat(64), "SENT", "0xclaim");
    const reconciler = new RestartReconciler(database, {
      lookupReceipt: async () => ({
        hash: "0xclaim",
        status: "success",
        blockNumber: 11n,
        gasUsed: 21n,
        fills: [],
      }),
    });
    expect(await reconciler.reconcile()).toMatchObject({ resolved: 1, pending: 0 });
    expect(database.hasUnreconciledWrite()).toBe(false);
  });
});
