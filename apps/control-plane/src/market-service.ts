import type { MarketSnapshotV1 } from "@eventpilot/contracts";
import { DreamDexAdapter, DreamDexSdkSource } from "@eventpilot/dreamdex-adapter";
import { marketFixture } from "@eventpilot/test-fixtures";

import type { AppConfig } from "./config.js";

type Subscriber = (event: MarketStreamEvent) => void;

export interface MarketStreamEvent {
  cursor: number;
  kind: "snapshot" | "reset" | "status";
  occurredAtMs: number;
  source: "fixture" | "dreamdex-live";
  markets: MarketSnapshotV1[];
  message: string;
}

function nextExpiry(nowMs: number, intervalSeconds: 900 | 3600): number {
  const intervalMs = intervalSeconds * 1_000;
  const boundary = Math.ceil(nowMs / intervalMs) * intervalMs;
  return boundary - nowMs < 180_000 ? boundary + intervalMs : boundary;
}

function fixtureMarkets(nowMs: number): MarketSnapshotV1[] {
  const definitions = [
    {
      asset: "BTC" as const,
      intervalSeconds: 900 as const,
      ask: "540000000000000000",
      bid: "530000000000000000",
    },
    {
      asset: "BTC" as const,
      intervalSeconds: 3600 as const,
      ask: "580000000000000000",
      bid: "565000000000000000",
    },
    {
      asset: "ETH" as const,
      intervalSeconds: 900 as const,
      ask: "470000000000000000",
      bid: "455000000000000000",
    },
    {
      asset: "ETH" as const,
      intervalSeconds: 3600 as const,
      ask: "510000000000000000",
      bid: "500000000000000000",
    },
  ];
  return definitions.map((definition, index) => {
    const expiry = nextExpiry(nowMs, definition.intervalSeconds);
    return marketFixture({
      marketId: `${definition.asset.toLowerCase()}-${definition.intervalSeconds}-${expiry / 1_000}`,
      poolAddress: `0x${String(index + 1).repeat(40)}`,
      asset: definition.asset,
      intervalSeconds: definition.intervalSeconds,
      marketExpiryMs: expiry,
      capturedAtMs: nowMs,
      indexerTimestampMs: nowMs - 250,
      sourceBlock: String(90_000_000 + Math.floor(nowMs / 100)),
      yes: {
        bestBidRaw: definition.bid,
        bestAskRaw: definition.ask,
        bidDepthRaw: "18000000000000000000",
        askDepthRaw: "12000000000000000000",
      },
    });
  });
}

export class MarketService {
  #markets: MarketSnapshotV1[] = [];
  #cursor = 0;
  #timer: NodeJS.Timeout | null = null;
  #subscribers = new Set<Subscriber>();
  #history: MarketStreamEvent[] = [];
  #adapter: DreamDexAdapter | null = null;
  #lastError: string | null = null;

  constructor(private readonly config: AppConfig) {
    if (config.MARKET_MODE === "live") {
      this.#adapter = new DreamDexAdapter(
        new DreamDexSdkSource({
          indexerUrl: config.SOMNIA_INDEXER_URL,
          wsRpcUrl: config.SOMNIA_WS_RPC_URL,
        }),
      );
    }
  }

  get source(): "fixture" | "dreamdex-live" {
    return this.config.MARKET_MODE === "live" ? "dreamdex-live" : "fixture";
  }

  get lastError(): string | null {
    return this.#lastError;
  }

  list(): MarketSnapshotV1[] {
    return this.#markets;
  }

  currentEvent(kind: MarketStreamEvent["kind"] = "snapshot"): MarketStreamEvent {
    return {
      cursor: this.#cursor,
      kind,
      occurredAtMs: Date.now(),
      source: this.source,
      markets: this.#markets,
      message:
        this.#lastError ??
        (this.source === "fixture"
          ? "Deterministic local fixture feed."
          : "Connected to DreamDEX Shannon."),
    };
  }

  async refresh(): Promise<void> {
    try {
      this.#markets =
        this.#adapter === null ? fixtureMarkets(Date.now()) : await this.#adapter.refresh();
      this.#lastError = null;
      this.#cursor += 1;
      this.#publish(this.currentEvent());
    } catch (error) {
      this.#lastError = error instanceof Error ? error.message : "Unknown market refresh error";
      this.#markets = this.#adapter?.markDisconnected() ?? [];
      this.#cursor += 1;
      this.#publish(this.currentEvent("status"));
    }
  }

  async start(): Promise<void> {
    await this.refresh();
    this.#timer = setInterval(
      () => void this.refresh(),
      this.source === "fixture" ? 2_000 : 10_000,
    );
  }

  subscribe(subscriber: Subscriber, afterCursor?: number): () => void {
    this.#subscribers.add(subscriber);
    if (afterCursor === undefined) {
      subscriber(this.currentEvent("reset"));
    } else {
      const oldestCursor = this.#history[0]?.cursor ?? this.#cursor;
      if (afterCursor < oldestCursor - 1) {
        subscriber(this.currentEvent("reset"));
      } else {
        for (const event of this.#history) {
          if (event.cursor > afterCursor) subscriber(event);
        }
      }
    }
    return () => this.#subscribers.delete(subscriber);
  }

  #publish(event: MarketStreamEvent): void {
    this.#history.push(event);
    if (this.#history.length > 100) this.#history.splice(0, this.#history.length - 100);
    for (const subscriber of this.#subscribers) subscriber(event);
  }

  async close(): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    await this.#adapter?.close();
  }
}
