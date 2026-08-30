import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { MarketService, type MarketStreamEvent } from "./market-service.js";

describe("market stream recovery", () => {
  it("replays missed cursor events in order", async () => {
    const service = new MarketService(loadConfig({ NODE_ENV: "test", MARKET_MODE: "fixture" }));
    await service.refresh();
    await service.refresh();
    const received: MarketStreamEvent[] = [];
    const unsubscribe = service.subscribe((event) => received.push(event), 1);
    expect(received.map((event) => event.cursor)).toEqual([2]);
    await service.refresh();
    expect(received.map((event) => event.cursor)).toEqual([2, 3]);
    unsubscribe();
    await service.close();
  });

  it("sends reset when the requested cursor fell out of retained history", async () => {
    const service = new MarketService(loadConfig({ NODE_ENV: "test", MARKET_MODE: "fixture" }));
    for (let index = 0; index < 102; index += 1) await service.refresh();
    const received: MarketStreamEvent[] = [];
    const unsubscribe = service.subscribe((event) => received.push(event), 1);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ kind: "reset", cursor: 102 });
    unsubscribe();
    await service.close();
  });
});
