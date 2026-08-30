import type { DecisionV1, ExecutionIntentV1, MarketSnapshotV1 } from "@eventpilot/contracts";
import { maximumCostRaw, pow10 } from "@eventpilot/strategy";

import type { EventPilotStore } from "./database.js";
import type { SignerQueue } from "./runner.js";

export interface SubmittedTransaction {
  hash: string;
}

export interface VerifiedReceipt {
  hash: string;
  status: "success" | "reverted";
  blockNumber: bigint | null;
  gasUsed: bigint | null;
  fills: Array<{ quantityRaw: bigint; priceRaw: bigint }>;
}

export interface GuardedVenueWriter {
  getChainId(): Promise<number>;
  getMarketStatus(
    marketId: string,
  ): Promise<"Trading" | "Locked" | "Finalized" | "Voided" | "Unknown">;
  sendIoc(input: {
    marketId: string;
    poolAddress: string;
    outcome: "YES" | "NO";
    priceRaw: bigint;
    quantityRaw: bigint;
    expiryNanoseconds: bigint;
  }): Promise<SubmittedTransaction>;
  waitForReceipt(hash: string): Promise<VerifiedReceipt>;
}

export type ExecutionResult =
  | { kind: "duplicate"; intentKey: string }
  | { kind: "rejected"; intentKey: string; reason: string }
  | {
      kind: "unfilled" | "partial" | "filled";
      intentKey: string;
      transactionHash: string;
      filledQuantityRaw: string;
    }
  | { kind: "reverted"; intentKey: string; transactionHash: string }
  | { kind: "unknown"; intentKey: string; transactionHash: string | null };

export class GuardedExecutor {
  constructor(
    private readonly store: EventPilotStore,
    private readonly signerQueue: SignerQueue,
    private readonly writer: GuardedVenueWriter,
    private readonly clock: () => number = Date.now,
  ) {}

  async execute(decision: DecisionV1, market: MarketSnapshotV1): Promise<ExecutionResult> {
    const now = this.clock();
    if (!decision.eligible)
      throw new Error("Ineligible decisions cannot create execution intents.");
    if (decision.marketId !== market.marketId)
      throw new Error("Decision and market identities do not match.");
    if (market.network !== "somnia-shannon")
      throw new Error("Only Somnia Shannon snapshots may execute.");
    if (now > decision.validUntilMs)
      throw new Error("Decision validity expired before intent preparation.");
    if (this.store.hasUnreconciledWrite())
      throw new Error("An unknown or sent transaction must be reconciled first.");

    const intent: ExecutionIntentV1 = {
      version: "1",
      intentKey: decision.intentKey,
      strategyHash: decision.strategyHash,
      marketId: decision.marketId,
      poolAddress: market.poolAddress,
      outcome: decision.outcome,
      priceDecimals: market.priceDecimals,
      quantityDecimals: market.quantityDecimals,
      collateralDecimals: market.collateralDecimals,
      limitPriceRaw: decision.limitPriceRaw,
      quantityRaw: decision.quantityRaw,
      maximumCostRaw: decision.maximumCostRaw,
      expiryMs: Math.min(decision.marketExpiryMs, market.marketExpiryMs),
      timeInForce: "IOC",
      state: "PREPARED",
      createdAtMs: now,
    };
    if (!this.store.prepareIntent(intent, decision, market))
      return { kind: "duplicate", intentKey: decision.intentKey };
    await this.store.appendEvent({
      kind: "intent.prepared",
      occurredAtMs: now,
      marketId: market.marketId,
      strategyHash: decision.strategyHash,
      intentKey: intent.intentKey,
      transactionHash: null,
      summary: "Durable IOC intent prepared before any signer operation.",
    });

    return this.signerQueue.run(async () => {
      let transactionHash: string | null = null;
      try {
        if ((await this.writer.getChainId()) !== 50_312)
          throw new Error("Writer RPC is not Somnia Shannon chain 50312.");
        if (this.clock() > decision.validUntilMs)
          throw new Error("Snapshot became stale while waiting for the signer queue.");
        const status = await this.writer.getMarketStatus(market.marketId);
        if (status !== "Trading")
          throw new Error(`Market is ${status}; Trading is required immediately before signing.`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Pre-write safety check failed.";
        this.store.updateIntentState(intent.intentKey, "REVERTED", null);
        await this.store.appendEvent({
          kind: "evaluation.skipped",
          occurredAtMs: this.clock(),
          marketId: market.marketId,
          strategyHash: decision.strategyHash,
          intentKey: intent.intentKey,
          transactionHash: null,
          summary: reason,
        });
        return { kind: "rejected", intentKey: intent.intentKey, reason };
      }
      try {
        const submitted = await this.writer.sendIoc({
          marketId: market.marketId,
          poolAddress: market.poolAddress,
          outcome: decision.outcome,
          priceRaw: BigInt(decision.limitPriceRaw),
          quantityRaw: BigInt(decision.quantityRaw),
          expiryNanoseconds: BigInt(intent.expiryMs) * 1_000_000n,
        });
        transactionHash = submitted.hash;
        this.store.updateIntentState(intent.intentKey, "SENT", transactionHash);
        await this.store.appendEvent({
          kind: "transaction.sent",
          occurredAtMs: this.clock(),
          marketId: market.marketId,
          strategyHash: decision.strategyHash,
          intentKey: intent.intentKey,
          transactionHash,
          summary: "IOC transaction submitted to Somnia Shannon; receipt verification is pending.",
        });

        const receipt = await this.writer.waitForReceipt(transactionHash);
        this.store.saveTransaction({
          hash: receipt.hash,
          intentKey: intent.intentKey,
          receiptStatus: receipt.status,
          blockNumber: receipt.blockNumber?.toString() ?? null,
          gasUsed: receipt.gasUsed?.toString() ?? null,
        });
        if (receipt.status !== "success") {
          this.store.updateIntentState(intent.intentKey, "REVERTED", transactionHash);
          this.store.recordExecutionOutcome({
            marketId: market.marketId,
            occurredAtMs: this.clock(),
            filledCollateralRaw: "0",
            reverted: true,
          });
          await this.store.appendEvent({
            kind: "transaction.reverted",
            occurredAtMs: this.clock(),
            marketId: market.marketId,
            strategyHash: decision.strategyHash,
            intentKey: intent.intentKey,
            transactionHash,
            summary: "Transaction receipt explicitly reported a revert.",
          });
          return { kind: "reverted", intentKey: intent.intentKey, transactionHash };
        }

        let filled = 0n;
        let filledCollateral = 0n;
        for (const fill of receipt.fills) {
          filled += fill.quantityRaw;
          const outcomePrice =
            decision.outcome === "YES"
              ? fill.priceRaw
              : pow10(market.priceDecimals) - fill.priceRaw;
          filledCollateral += maximumCostRaw({
            priceRaw: outcomePrice,
            quantityRaw: fill.quantityRaw,
            priceDecimals: market.priceDecimals,
            quantityDecimals: market.quantityDecimals,
            collateralDecimals: market.collateralDecimals,
          });
          this.store.saveFill({
            transactionHash,
            intentKey: intent.intentKey,
            quantityRaw: fill.quantityRaw.toString(),
            priceRaw: fill.priceRaw.toString(),
          });
          await this.store.appendEvent({
            kind: "fill.recorded",
            occurredAtMs: this.clock(),
            marketId: market.marketId,
            strategyHash: decision.strategyHash,
            intentKey: intent.intentKey,
            transactionHash,
            summary: `Recorded ${fill.quantityRaw} raw quantity at native YES price ${fill.priceRaw}.`,
          });
        }
        const requested = BigInt(decision.quantityRaw);
        const kind = filled === 0n ? "unfilled" : filled < requested ? "partial" : "filled";
        this.store.updateIntentState(intent.intentKey, "SUCCEEDED", transactionHash);
        this.store.recordExecutionOutcome({
          marketId: market.marketId,
          occurredAtMs: this.clock(),
          filledCollateralRaw: filledCollateral.toString(),
          reverted: false,
        });
        await this.store.appendEvent({
          kind: "transaction.succeeded",
          occurredAtMs: this.clock(),
          marketId: market.marketId,
          strategyHash: decision.strategyHash,
          intentKey: intent.intentKey,
          transactionHash,
          summary: `Receipt succeeded; IOC outcome was ${kind} with ${filled} raw quantity filled.`,
        });
        return {
          kind,
          intentKey: intent.intentKey,
          transactionHash,
          filledQuantityRaw: filled.toString(),
        };
      } catch {
        this.store.updateIntentState(intent.intentKey, "UNKNOWN", transactionHash);
        return { kind: "unknown", intentKey: intent.intentKey, transactionHash };
      }
    });
  }
}
