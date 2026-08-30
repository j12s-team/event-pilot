import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultStrategy } from "@eventpilot/strategy";

import { loadConfig } from "./config.js";
import { EventPilotStore } from "./database.js";
import { GuardedExecutor, type GuardedVenueWriter } from "./executor.js";
import { RestartReconciler } from "./reconciler.js";
import { DemoRunner, SignerQueue, type LiveRunnerServices } from "./runner.js";
import { SettlementClaimWorker, type ClaimVenueWriter } from "./settlement.js";

const stores: EventPilotStore[] = [];
function store(): EventPilotStore {
  const instance = new EventPilotStore(
    join(mkdtempSync(join(tmpdir(), "eventpilot-runner-")), "db.sqlite"),
  );
  stores.push(instance);
  return instance;
}
afterEach(() => stores.splice(0).forEach((instance) => instance.close()));

const config = loadConfig({
  NODE_ENV: "test",
  DRY_RUN: "false",
  MARKET_MODE: "live",
  DEMO_PRIVATE_KEY: `0x${"11".repeat(32)}`,
});

function services(
  database: EventPilotStore,
  queue: SignerQueue,
  overrides: Partial<LiveRunnerServices> = {},
): LiveRunnerServices {
  const orderWriter: GuardedVenueWriter = {
    getChainId: async () => 50_312,
    getMarketStatus: async () => "Trading",
    sendIoc: async () => ({ hash: "0xorder" }),
    waitForReceipt: async () => ({
      hash: "0xorder",
      status: "success",
      blockNumber: 1n,
      gasUsed: 1n,
      fills: [],
    }),
  };
  const claimWriter: ClaimVenueWriter = {
    walletAddress: "0x1111111111111111111111111111111111111111",
    getChainId: async () => 50_312,
    listFinalizedClaimable: async () => [],
    submitClaim: async () => ({
      hash: "0xclaim",
      status: "success",
      blockNumber: 1n,
      gasUsed: 1n,
      fills: [],
    }),
  };
  return {
    walletAddress: claimWriter.walletAddress,
    getChainId: async () => 50_312,
    getNativeBalance: async () => 1n,
    getCollateralBalance: async () => 1n,
    executor: new GuardedExecutor(database, queue, orderWriter),
    claims: new SettlementClaimWorker(database, queue, claimWriter),
    reconciler: new RestartReconciler(database, { lookupReceipt: async () => null }),
    ...overrides,
  };
}

describe("live runner preflight", () => {
  it("rejects wrong chain, missing gas, and missing collateral before arming", async () => {
    for (const override of [
      { getChainId: async () => 1 },
      { getNativeBalance: async () => 0n },
      { getCollateralBalance: async () => 0n },
    ]) {
      const database = store();
      const queue = new SignerQueue();
      const runner = new DemoRunner(config, database, queue, services(database, queue, override));
      await runner.updateStrategy(defaultStrategy, "test");
      await expect(runner.arm("test")).rejects.toThrow();
      expect(await runner.status()).toMatchObject({ state: "STOPPED" });
    }
  });

  it("holds one wallet lease and releases it on stop", async () => {
    const database = store();
    const firstQueue = new SignerQueue();
    const secondQueue = new SignerQueue();
    const first = new DemoRunner(config, database, firstQueue, services(database, firstQueue));
    const second = new DemoRunner(config, database, secondQueue, services(database, secondQueue));
    await first.updateStrategy(defaultStrategy, "first");
    await second.updateStrategy(defaultStrategy, "second");
    await first.arm("first");
    await expect(second.arm("second")).rejects.toThrow("wallet lease");
    await first.stop("first");
    await second.arm("second");
    expect(await second.status()).toMatchObject({ state: "ARMED_LIVE" });
    await second.stop("second");
  });

  it("scans finalized claims even when no selected market snapshot is available", async () => {
    const database = store();
    const queue = new SignerQueue();
    const listFinalizedClaimable = vi.fn(async () => []);
    const claimWriter: ClaimVenueWriter = {
      walletAddress: "0x1111111111111111111111111111111111111111",
      getChainId: async () => 50_312,
      listFinalizedClaimable,
      submitClaim: async () => ({
        hash: "0xclaim",
        status: "success",
        blockNumber: 1n,
        gasUsed: 1n,
        fills: [],
      }),
    };
    const live = services(database, queue, {
      claims: new SettlementClaimWorker(database, queue, claimWriter),
    });
    const runner = new DemoRunner(config, database, queue, live);
    await runner.updateStrategy(defaultStrategy, "test");
    await runner.arm("test");

    await runner.handleMarkets([]);
    await runner.handleMarkets([]);

    expect(listFinalizedClaimable).toHaveBeenCalledTimes(1);
    await runner.stop("test");
  });
});
