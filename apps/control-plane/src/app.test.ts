import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultStrategy } from "@eventpilot/strategy";
import { FIXTURE_NOW_MS, marketFixture, riskFixture } from "@eventpilot/test-fixtures";

import { buildApp, type AppServices } from "./app.js";
import { loadConfig } from "./config.js";

const openApps: AppServices[] = [];

async function testApp(): Promise<AppServices> {
  const directory = mkdtempSync(join(tmpdir(), "eventpilot-test-"));
  const services = await buildApp(
    loadConfig({
      NODE_ENV: "test",
      DATABASE_PATH: join(directory, "eventpilot.db"),
      ADMIN_TOKEN: "test-admin-token-at-least-24-characters",
      MARKET_MODE: "fixture",
    }),
    { startMarkets: false },
  );
  openApps.push(services);
  return services;
}

afterEach(async () => {
  await Promise.all(openApps.splice(0).map(({ app }) => app.close()));
});

describe("public API", () => {
  it("reports Shannon, dry-run, source, and pinned SDK diagnostics", async () => {
    const { app } = await testApp();
    const response = await app.inject({ method: "GET", url: "/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      chainId: 50_312,
      dryRun: true,
      marketMode: "fixture",
      sdkVersion: "0.28.1",
    });
  });

  it("evaluates explicit snapshots without hidden server state", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluations",
      payload: {
        strategy: defaultStrategy,
        market: marketFixture(),
        risk: riskFixture(),
        evaluatedAtMs: FIXTURE_NOW_MS,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      eligible: true,
      maximumCostRaw: "2700000000000000000",
    });
  });

  it("rejects private-key-shaped request bodies", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "PUT",
      url: "/v1/admin/strategy",
      headers: { "x-admin-token": "test-admin-token-at-least-24-characters" },
      payload: { ...defaultStrategy, privateKey: "0xsecret" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("never accepted");
  });
});

describe("operator API", () => {
  it("requires authentication and persists dry-run lifecycle events", async () => {
    const { app, runner, marketService } = await testApp();
    const unauthorized = await app.inject({ method: "POST", url: "/v1/admin/runner/arm" });
    expect(unauthorized.statusCode).toBe(401);

    const headers = { "x-admin-token": "test-admin-token-at-least-24-characters" };
    const strategy = await app.inject({
      method: "PUT",
      url: "/v1/admin/strategy",
      headers,
      payload: defaultStrategy,
    });
    expect(strategy.statusCode).toBe(200);
    const armed = await app.inject({ method: "POST", url: "/v1/admin/runner/arm", headers });
    expect(armed.json()).toMatchObject({ state: "ARMED_DRY_RUN", publicControl: false });
    const events = await app.inject({ method: "GET", url: "/v1/demo-runner/events?cursor=0" });
    expect(events.json().events).toHaveLength(1);
    expect(events.json().events[0].summary).toContain("transaction submission is disabled");
    const evidence = await app.inject({ method: "GET", url: "/v1/evidence/1" });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json()).toMatchObject({
      event: { kind: "runner.started" },
      strategy: defaultStrategy,
      intent: null,
      transaction: null,
    });
    expect(evidence.body).not.toContain("test-admin-token");
    const latest = await app.inject({ method: "GET", url: "/v1/evidence/latest" });
    expect(latest.statusCode).toBe(404);

    await runner.handleMarkets(marketService.list());
    const evaluated = await app.inject({ method: "GET", url: "/v1/demo-runner/events?cursor=1" });
    expect(evaluated.json().events[0]).toMatchObject({ kind: "evaluation.eligible" });
    expect(evaluated.json().events[0].summary).toContain("would submit at this snapshot");
  });
});
