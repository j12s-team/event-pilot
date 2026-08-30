import type { MarketSnapshotV1, StrategyV1 } from "@eventpilot/contracts";
import { evaluateStrategy } from "@eventpilot/strategy";

import type { AppConfig } from "./config.js";
import type { EventPilotStore } from "./database.js";
import type { GuardedExecutor } from "./executor.js";
import type { RestartReconciler } from "./reconciler.js";
import type { SettlementClaimWorker } from "./settlement.js";

export class SignerQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export interface LiveRunnerServices {
  walletAddress: string;
  getChainId(): Promise<number>;
  getNativeBalance(): Promise<bigint>;
  getCollateralBalance(asset: "BTC" | "ETH", intervalSeconds: 900 | 3600): Promise<bigint>;
  executor: GuardedExecutor;
  claims: SettlementClaimWorker;
  reconciler: RestartReconciler;
}

export class DemoRunner {
  readonly signerQueue: SignerQueue;
  #strategy: StrategyV1 | null = null;
  #strategyHash: string | null = null;
  #state: "STOPPED" | "ARMED_DRY_RUN" | "ARMED_LIVE" = "STOPPED";
  #evaluationTail: Promise<void> = Promise.resolve();
  #lastClaimScanAtMs = 0;
  #nativeBalanceRaw: string | null = null;
  #collateralBalanceRaw: string | null = null;
  #leaseHolder = crypto.randomUUID();

  constructor(
    private readonly config: AppConfig,
    private readonly store: EventPilotStore,
    signerQueue = new SignerQueue(),
    private readonly live: LiveRunnerServices | null = null,
  ) {
    this.signerQueue = signerQueue;
  }

  async initialize(): Promise<void> {
    const persisted = await this.store.getRunnerState();
    this.#strategyHash = persisted.strategyHash;
    this.#strategy =
      persisted.strategyHash === null ? null : this.store.getStrategy(persisted.strategyHash);
    if (this.live !== null) await this.live.reconciler.reconcile();
    if (persisted.state !== "STOPPED") {
      await this.store.setRunnerState({
        state: "STOPPED",
        strategyHash: this.#strategyHash,
        dryRun: this.config.DRY_RUN,
      });
      await this.store.appendEvent({
        kind: "runner.stopped",
        occurredAtMs: Date.now(),
        marketId: null,
        strategyHash: this.#strategyHash,
        intentKey: null,
        transactionHash: null,
        summary: "Runner recovered after restart and requires explicit operator re-arm.",
      });
    }
  }

  async updateStrategy(strategy: StrategyV1, remoteAddress: string): Promise<string> {
    const hash = await this.store.saveStrategy(strategy);
    this.#strategy = strategy;
    this.#strategyHash = hash;
    await this.store.audit("strategy.updated", hash, remoteAddress);
    return hash;
  }

  async arm(remoteAddress: string): Promise<void> {
    if (this.#strategy === null || this.#strategyHash === null) {
      throw new Error("Set a validated strategy before arming the runner.");
    }
    if (!this.config.DRY_RUN) {
      if (this.live === null) throw new Error("Live runner services are unavailable.");
      if ((await this.live.getChainId()) !== 50_312) {
        throw new Error("Connected RPC is not Somnia Shannon chain 50312.");
      }
      const balance = await this.live.getNativeBalance();
      this.#nativeBalanceRaw = balance.toString();
      if (balance === 0n) throw new Error("Dedicated demo wallet has no native STT for gas.");
      const collateral = await this.live.getCollateralBalance(
        this.#strategy.selector.asset,
        this.#strategy.selector.intervalSeconds,
      );
      this.#collateralBalanceRaw = collateral.toString();
      if (collateral === 0n)
        throw new Error("Dedicated demo wallet has no collateral for the selected live market.");
      if (this.store.hasUnreconciledWrite()) {
        throw new Error("Unresolved signer writes must be reconciled before arming.");
      }
      if (!this.store.acquireRunnerLease(this.live.walletAddress, this.#leaseHolder)) {
        throw new Error("Another control-plane instance holds the demo wallet lease.");
      }
    }
    this.#state = this.config.DRY_RUN ? "ARMED_DRY_RUN" : "ARMED_LIVE";
    await this.store.setRunnerState({
      state: this.#state,
      strategyHash: this.#strategyHash,
      dryRun: this.config.DRY_RUN,
    });
    await this.store.audit("runner.armed", this.#strategyHash, remoteAddress);
    await this.store.appendEvent({
      kind: "runner.started",
      occurredAtMs: Date.now(),
      marketId: null,
      strategyHash: this.#strategyHash,
      intentKey: null,
      transactionHash: null,
      summary: this.config.DRY_RUN
        ? "Runner armed in dry-run mode; transaction submission is disabled."
        : "Runner armed for guarded Shannon testnet writes after chain, gas balance, reconciliation, and lease checks.",
    });
  }

  async stop(remoteAddress: string): Promise<void> {
    this.#state = "STOPPED";
    if (this.live !== null)
      this.store.releaseRunnerLease(this.live.walletAddress, this.#leaseHolder);
    await this.store.setRunnerState({
      state: "STOPPED",
      strategyHash: this.#strategyHash,
      dryRun: this.config.DRY_RUN,
    });
    await this.store.audit("runner.stopped", this.#strategyHash, remoteAddress);
    await this.store.appendEvent({
      kind: "runner.stopped",
      occurredAtMs: Date.now(),
      marketId: null,
      strategyHash: this.#strategyHash,
      intentKey: null,
      transactionHash: null,
      summary: "Runner stopped by an authenticated operator.",
    });
  }

  handleMarkets(markets: MarketSnapshotV1[]): Promise<void> {
    this.#evaluationTail = this.#evaluationTail.then(
      () => this.#evaluateMarkets(markets),
      () => this.#evaluateMarkets(markets),
    );
    return this.#evaluationTail;
  }

  async #evaluateMarkets(markets: MarketSnapshotV1[]): Promise<void> {
    if (this.#state === "STOPPED" || this.#strategy === null || this.#strategyHash === null) return;
    if (
      this.#state === "ARMED_LIVE" &&
      this.live !== null &&
      !this.store.acquireRunnerLease(this.live.walletAddress, this.#leaseHolder)
    ) {
      await this.stop("lease-lost");
      return;
    }
    const now = Date.now();
    if (
      this.#state === "ARMED_LIVE" &&
      this.live !== null &&
      now - this.#lastClaimScanAtMs >= 60_000
    ) {
      this.#lastClaimScanAtMs = now;
      try {
        await this.live.claims.scan();
      } catch (error) {
        await this.store.appendEvent({
          kind: "claim.scan_failed",
          occurredAtMs: now,
          marketId: null,
          strategyHash: this.#strategyHash,
          intentKey: null,
          transactionHash: null,
          summary: `Claim scan unavailable; no claim was submitted. ${error instanceof Error ? error.message : "Unknown scanner failure."}`,
        });
      }
    }
    const market = markets.find(
      (candidate) =>
        candidate.asset === this.#strategy?.selector.asset &&
        candidate.intervalSeconds === this.#strategy?.selector.intervalSeconds,
    );
    if (market === undefined) return;
    const risk = this.store.getRiskSnapshot(market.marketId, market.collateralDecimals, now);
    const decision = await evaluateStrategy({
      strategy: this.#strategy,
      market,
      risk,
      evaluatedAtMs: now,
    });
    if (!decision.eligible) {
      await this.store.appendEvent({
        kind: "evaluation.skipped",
        occurredAtMs: now,
        marketId: market.marketId,
        strategyHash: decision.strategyHash,
        intentKey: decision.intentKey,
        transactionHash: null,
        summary: decision.reasons.join(" "),
      });
      return;
    }
    if (this.#state === "ARMED_DRY_RUN") {
      await this.store.appendEvent({
        kind: "evaluation.eligible",
        occurredAtMs: now,
        marketId: market.marketId,
        strategyHash: decision.strategyHash,
        intentKey: decision.intentKey,
        transactionHash: null,
        summary: "Dry-run decision: would submit at this snapshot; no transaction path was called.",
      });
      return;
    }
    if (this.live === null) throw new Error("Live runner services are unavailable.");
    await this.live.executor.execute(decision, market);
  }

  async status(): Promise<Record<string, unknown>> {
    return {
      state: this.#state,
      strategyHash: this.#strategyHash,
      dryRun: this.config.DRY_RUN,
      network: "Somnia Shannon",
      chainId: 50_312,
      sdkVersion: "0.28.1",
      walletConfigured: Boolean(this.config.DEMO_PRIVATE_KEY),
      walletAddress: this.live?.walletAddress ?? null,
      nativeBalanceRaw: this.#nativeBalanceRaw,
      collateralBalanceRaw: this.#collateralBalanceRaw,
      reconciliationPending: this.store.hasUnreconciledWrite(),
      publicControl: false,
      strategy: this.#strategy,
    };
  }
}
