import { describe, expect, it } from "vitest";

import type { DreamDexMarketSource, DiscoveredBinaryMarket, HydratedMarket } from "./index.js";
import { DreamDexAdapter, normalizeHydratedMarket, toLifecycleFromChain } from "./index.js";

const first: DiscoveredBinaryMarket = {
  marketId: `0x${"1".repeat(64)}`,
  poolAddress: `0x${"2".repeat(40)}`,
  venueId: "0x45564e54",
  asset: "BTC",
  intervalSeconds: 900,
  strikeRaw: "10000000000000",
  expirySeconds: "1787943000",
  indexerStatus: "Trading",
  priceDecimals: 6,
  quantityDecimals: 6,
  collateralDecimals: 6,
};

function hydrated(market = first): HydratedMarket {
  return {
    market,
    book: {
      yesBids: [{ price: 530_000n, quantity: 2_000_000n }],
      yesAsks: [{ price: 540_000n, quantity: 3_000_000n }],
      noBids: [{ price: 450_000n, quantity: 3_000_000n }],
      noAsks: [{ price: 460_000n, quantity: 2_000_000n }],
    },
    params: { tickSize: 1_000n, lotSize: 1_000_000n, minQuantity: 1_000_000n },
    chainStatus: 1,
    capturedAtMs: 1_787_942_400_000,
    indexerTimestampMs: null,
    sourceBlock: "123",
  };
}

describe("DreamDEX normalization", () => {
  it("keeps raw bigint book values as strings", () => {
    const snapshot = normalizeHydratedMarket(hydrated());
    expect(snapshot.yes.bestAskRaw).toBe("540000");
    expect(snapshot.yes.askDepthRaw).toBe("3000000");
    expect(snapshot.priceDecimals).toBe(6);
  });

  it("maps authoritative lifecycle states conservatively", () => {
    expect(toLifecycleFromChain(1)).toBe("Trading");
    expect(toLifecycleFromChain(2)).toBe("Locked");
    expect(toLifecycleFromChain(5)).toBe("Voided");
    expect(toLifecycleFromChain(99)).toBe("Unknown");
  });
});

describe("market rollover", () => {
  it("replaces a recycled pool by market ID instead of carrying old state", async () => {
    const rolled = { ...first, marketId: `0x${"3".repeat(64)}` };
    let cycle = 0;
    const source: DreamDexMarketSource = {
      discoverActive: async () => (cycle++ === 0 ? [first] : [rolled]),
      hydrate: async (market) => hydrated(market),
    };
    const adapter = new DreamDexAdapter(source);
    expect((await adapter.refresh()).map((item) => item.marketId)).toEqual([first.marketId]);
    expect((await adapter.refresh()).map((item) => item.marketId)).toEqual([rolled.marketId]);
  });

  it("represents an empty book without invented probability", () => {
    const input = hydrated();
    input.book = { yesBids: [], yesAsks: [], noBids: [], noAsks: [] };
    const snapshot = normalizeHydratedMarket(input);
    expect(snapshot.yes.bestBidRaw).toBeNull();
    expect(snapshot.yes.bestAskRaw).toBeNull();
    expect(snapshot.yes.askDepthRaw).toBe("0");
  });
});
