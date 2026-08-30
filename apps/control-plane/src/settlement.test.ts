import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EventPilotStore } from "./database.js";
import { SignerQueue } from "./runner.js";
import { SettlementClaimWorker, type ClaimVenueWriter } from "./settlement.js";

const stores: EventPilotStore[] = [];
function store(): EventPilotStore {
  const instance = new EventPilotStore(
    join(mkdtempSync(join(tmpdir(), "eventpilot-claim-")), "db.sqlite"),
  );
  stores.push(instance);
  return instance;
}
afterEach(() => stores.splice(0).forEach((instance) => instance.close()));

function writer(overrides: Partial<ClaimVenueWriter> = {}): ClaimVenueWriter {
  return {
    walletAddress: "0x1111111111111111111111111111111111111111",
    getChainId: async () => 50_312,
    listFinalizedClaimable: async () => [
      {
        marketId: `0x${"22".repeat(32)}`,
        outcome: "YES",
        amountRaw: 2_000_000n,
        estimatedPayoutRaw: 1_980_000n,
      },
    ],
    submitClaim: async () => ({
      hash: "0xclaim",
      status: "success",
      blockNumber: 99n,
      gasUsed: 12n,
      fills: [],
    }),
    ...overrides,
  };
}

describe("settlement claim worker", () => {
  it("discovers finalized positions, verifies a claim receipt, and is idempotent", async () => {
    const database = store();
    const worker = new SettlementClaimWorker(database, new SignerQueue(), writer(), () => 1_000);
    expect(await worker.scan()).toMatchObject({ discovered: 1, submitted: 1, succeeded: 1 });
    expect((await database.listEvents()).map((event) => event.kind)).toEqual([
      "settlement.detected",
      "claim.sent",
      "claim.succeeded",
    ]);
    expect(await worker.scan()).toMatchObject({ discovered: 1, duplicates: 1, submitted: 0 });
  });

  it("records an explicit reverted receipt and rejects the wrong chain", async () => {
    const revertedStore = store();
    const reverted = new SettlementClaimWorker(
      revertedStore,
      new SignerQueue(),
      writer({
        submitClaim: async () => ({
          hash: "0xrevert",
          status: "reverted",
          blockNumber: 100n,
          gasUsed: 13n,
          fills: [],
        }),
      }),
    );
    expect(await reverted.scan()).toMatchObject({ reverted: 1, succeeded: 0 });

    const wrongChain = new SettlementClaimWorker(
      store(),
      new SignerQueue(),
      writer({
        getChainId: async () => 1,
      }),
    );
    await expect(wrongChain.scan()).rejects.toThrow("non-Shannon");
  });

  it("fails closed as unknown when submission cannot be classified", async () => {
    const database = store();
    const worker = new SettlementClaimWorker(
      database,
      new SignerQueue(),
      writer({
        submitClaim: async () => {
          throw new Error("transport ended");
        },
      }),
    );
    expect(await worker.scan()).toMatchObject({ unknown: 1 });
    expect(database.hasUnreconciledWrite()).toBe(true);
    await expect(worker.scan()).rejects.toThrow("unresolved writes");
  });
});
