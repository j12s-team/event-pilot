import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { ZodError } from "zod";

import { evaluationRequestV1Schema, strategyV1Schema } from "@eventpilot/contracts";
import { DREAMDEX_SDK_VERSION, DreamDexSdkWriter } from "@eventpilot/dreamdex-adapter";
import { evaluateStrategy } from "@eventpilot/strategy";

import type { AppConfig } from "./config.js";
import { EventPilotStore } from "./database.js";
import { GuardedExecutor } from "./executor.js";
import { loggerOptions } from "./logging.js";
import { MarketService } from "./market-service.js";
import { RestartReconciler } from "./reconciler.js";
import { DemoRunner, SignerQueue, type LiveRunnerServices } from "./runner.js";
import { SdkVenueWriter } from "./sdk-venue-writer.js";
import { SettlementClaimWorker } from "./settlement.js";

function suppliedAdminToken(request: FastifyRequest): string | undefined {
  const bearer = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  const header = request.headers["x-admin-token"];
  return bearer ?? (typeof header === "string" ? header : undefined);
}

function rejectPrivateKeyShape(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(rejectPrivateKeyShape);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(
      ([key, child]) =>
        /private.?key|seed.?phrase|mnemonic/i.test(key) || rejectPrivateKeyShape(child),
    );
  }
  return false;
}

export interface AppServices {
  app: FastifyInstance;
  marketService: MarketService;
  store: EventPilotStore;
  runner: DemoRunner;
}

export async function buildApp(
  config: AppConfig,
  options: { startMarkets?: boolean } = {},
): Promise<AppServices> {
  const app = Fastify({ logger: config.NODE_ENV === "test" ? false : loggerOptions });
  const store = new EventPilotStore(config.DATABASE_PATH);
  const marketService = new MarketService(config);
  const signerQueue = new SignerQueue();
  let venueWriter: SdkVenueWriter | null = null;
  let liveServices: LiveRunnerServices | null = null;
  if (!config.DRY_RUN && config.DEMO_PRIVATE_KEY !== undefined) {
    venueWriter = new SdkVenueWriter(
      new DreamDexSdkWriter({
        privateKey: config.DEMO_PRIVATE_KEY as `0x${string}`,
        httpRpcUrl: config.SOMNIA_RPC_URL,
        indexerUrl: config.SOMNIA_INDEXER_URL,
        wsRpcUrl: config.SOMNIA_WS_RPC_URL,
      }),
    );
    liveServices = {
      walletAddress: venueWriter.walletAddress,
      getChainId: () => venueWriter!.getChainId(),
      getNativeBalance: () => venueWriter!.getNativeBalance(),
      getCollateralBalance: (asset, intervalSeconds) =>
        venueWriter!.getCollateralBalance(asset, intervalSeconds),
      executor: new GuardedExecutor(store, signerQueue, venueWriter),
      claims: new SettlementClaimWorker(store, signerQueue, venueWriter),
      reconciler: new RestartReconciler(store, venueWriter),
    };
  }
  const runner = new DemoRunner(config, store, signerQueue, liveServices);
  await runner.initialize();
  const unsubscribeRunner = marketService.subscribe((event) => runner.handleMarkets(event.markets));

  await app.register(cors, {
    origin: config.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
    methods: ["GET", "POST", "PUT", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
    keyGenerator: (request) => request.ip,
  });

  app.addHook("preValidation", async (request, reply) => {
    if (rejectPrivateKeyShape(request.body)) {
      await reply.code(400).send({ error: "Private key material is never accepted by this API." });
    }
  });

  const requireAdmin = async (
    request: FastifyRequest,
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<void> => {
    if (suppliedAdminToken(request) !== config.ADMIN_TOKEN) {
      await reply.code(401).send({ error: "Unauthorized operator request." });
    }
  };

  app.get("/v1/health", async () => ({
    ok: true,
    service: "eventpilot-control-plane",
    network: "somnia-shannon",
    chainId: config.SOMNIA_CHAIN_ID,
    dryRun: config.DRY_RUN,
    marketMode: config.MARKET_MODE,
    marketError: marketService.lastError,
    sdkVersion: DREAMDEX_SDK_VERSION,
    nowMs: Date.now(),
  }));

  app.get("/v1/markets", async () => ({
    source: marketService.source,
    message: marketService.currentEvent().message,
    markets: marketService.list(),
  }));

  app.get("/v1/markets/stream", async (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "access-control-allow-origin": config.CORS_ORIGIN.split(",")[0] ?? "*",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "content-type": "text/event-stream; charset=utf-8",
      "x-accel-buffering": "no",
    });
    const send = (event: ReturnType<MarketService["currentEvent"]>): void => {
      response.write(
        `id: ${event.cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`,
      );
    };
    const queryCursor = Number.parseInt((request.query as { cursor?: string }).cursor ?? "", 10);
    const headerCursor = Number.parseInt(
      typeof request.headers["last-event-id"] === "string" ? request.headers["last-event-id"] : "",
      10,
    );
    const requestedCursor = Number.isFinite(queryCursor)
      ? queryCursor
      : Number.isFinite(headerCursor)
        ? headerCursor
        : undefined;
    const unsubscribe = marketService.subscribe(send, requestedCursor);
    const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  app.post(
    "/v1/evaluations",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request) => {
      const input = evaluationRequestV1Schema.parse(request.body);
      return evaluateStrategy(input);
    },
  );

  app.get("/v1/demo-runner", async () => runner.status());

  app.get("/v1/demo-runner/events", async (request) => {
    const query = request.query as { cursor?: string; limit?: string };
    const cursor = Number.parseInt(query.cursor ?? "0", 10);
    const limit = Number.parseInt(query.limit ?? "100", 10);
    const events = await store.listEvents(
      Number.isFinite(cursor) ? cursor : 0,
      Number.isFinite(limit) ? limit : 100,
    );
    return {
      events,
      nextCursor: events.at(-1)?.sequence ?? (Number.isFinite(cursor) ? cursor : 0),
    };
  });

  app.get("/v1/evidence/:sequence", async (request, reply) => {
    const sequence = Number.parseInt((request.params as { sequence: string }).sequence, 10);
    if (!Number.isFinite(sequence))
      return reply.code(400).send({ error: "Invalid evidence sequence." });
    const evidence = await store.getEvidence(sequence);
    if (evidence === null) return reply.code(404).send({ error: "Evidence event not found." });
    return evidence;
  });

  app.get("/v1/evidence/latest", async (_request, reply) => {
    const evidence = await store.getLatestVerifiedEvidence();
    if (evidence === null)
      return reply.code(404).send({ error: "No verified receipt evidence is available yet." });
    return evidence;
  });

  app.put("/v1/admin/strategy", { preHandler: requireAdmin }, async (request) => {
    const strategy = strategyV1Schema.parse(request.body);
    const strategyHash = await runner.updateStrategy(strategy, request.ip);
    return { strategyHash };
  });

  app.post("/v1/admin/runner/arm", { preHandler: requireAdmin }, async (request) => {
    await runner.arm(request.ip);
    return runner.status();
  });

  app.post("/v1/admin/runner/stop", { preHandler: requireAdmin }, async (request) => {
    await runner.stop(request.ip);
    return runner.status();
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Validation failed.", issues: error.issues });
    }
    app.log.error({ err: error }, "request failed");
    return reply
      .code(500)
      .send({ error: error instanceof Error ? error.message : "Internal server error." });
  });

  app.addHook("onClose", async () => {
    unsubscribeRunner();
    await marketService.close();
    await venueWriter?.close();
    store.close();
  });

  if (options.startMarkets !== false) await marketService.start();
  else await marketService.refresh();
  return { app, marketService, store, runner };
}
