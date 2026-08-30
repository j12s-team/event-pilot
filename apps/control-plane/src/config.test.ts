import { describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";
import { redactSecrets } from "./logging.js";

describe("environment safety", () => {
  it("defaults to dry-run on Shannon", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.DRY_RUN).toBe(true);
    expect(config.SOMNIA_CHAIN_ID).toBe(50_312);
  });

  it("hard-fails any non-Shannon chain", () => {
    expect(() => loadConfig({ SOMNIA_CHAIN_ID: "1" })).toThrow("Shannon 50312 is required");
  });

  it("requires a server-side key before live mode can start", () => {
    expect(() => loadConfig({ DRY_RUN: "false" })).toThrow("DEMO_PRIVATE_KEY");
  });

  it("refuses live writes against the deterministic fixture feed", () => {
    expect(() =>
      loadConfig({
        DRY_RUN: "false",
        DEMO_PRIVATE_KEY: `0x${"11".repeat(32)}`,
        MARKET_MODE: "fixture",
      }),
    ).toThrow("MARKET_MODE=live");
  });
});

describe("secret redaction", () => {
  it("recursively redacts sensitive fields without touching allowlisted data", () => {
    expect(
      redactSecrets({
        marketId: "btc-15m",
        nested: { privateKey: "0xsecret", authorization: "Bearer secret" },
        ADMIN_TOKEN: "secret",
      }),
    ).toEqual({
      marketId: "btc-15m",
      nested: { privateKey: "[REDACTED]", authorization: "[REDACTED]" },
      ADMIN_TOKEN: "[REDACTED]",
    });
  });
});
