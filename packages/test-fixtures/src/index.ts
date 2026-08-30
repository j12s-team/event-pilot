import type { MarketSnapshotV1, RiskSnapshotV1 } from "@eventpilot/contracts";

export const FIXTURE_NOW_MS = 1_787_942_400_000;

export function marketFixture(overrides: Partial<MarketSnapshotV1> = {}): MarketSnapshotV1 {
  return {
    version: "1",
    network: "somnia-shannon",
    venueId: "fixture-venue",
    marketId: "btc-15m-1787943300",
    poolAddress: "0x1111111111111111111111111111111111111111",
    asset: "BTC",
    intervalSeconds: 900,
    strikeRaw: "11150000000000",
    marketExpiryMs: FIXTURE_NOW_MS + 600_000,
    capturedAtMs: FIXTURE_NOW_MS - 1_000,
    indexerTimestampMs: FIXTURE_NOW_MS - 1_200,
    sourceBlock: "12345678",
    indexerStatus: "Trading",
    chainStatus: "Trading",
    connection: "live",
    priceDecimals: 18,
    quantityDecimals: 18,
    collateralDecimals: 18,
    tickSizeRaw: "100000000000000",
    lotSizeRaw: "1000000000000000000",
    yes: {
      bestBidRaw: "530000000000000000",
      bestAskRaw: "540000000000000000",
      bidDepthRaw: "18000000000000000000",
      askDepthRaw: "12000000000000000000",
    },
    no: {
      bestBidRaw: "450000000000000000",
      bestAskRaw: "460000000000000000",
      bidDepthRaw: "12000000000000000000",
      askDepthRaw: "18000000000000000000",
    },
    ...overrides,
  };
}

export function riskFixture(overrides: Partial<RiskSnapshotV1> = {}): RiskSnapshotV1 {
  return {
    version: "1",
    marketId: "btc-15m-1787943300",
    ordersForMarket: 0,
    dailyCollateralRaw: "0",
    consecutiveFailures: 0,
    lastOrderAtMs: null,
    collateralDecimals: 18,
    asOfMs: FIXTURE_NOW_MS,
    ...overrides,
  };
}
