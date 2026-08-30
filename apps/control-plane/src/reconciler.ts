import { maximumCostRaw, pow10 } from "@eventpilot/strategy";

import type { EventPilotStore } from "./database.js";
import type { VerifiedReceipt } from "./executor.js";

export interface ReceiptLookup {
  lookupReceipt(hash: string, poolAddress?: string): Promise<VerifiedReceipt | null>;
}

export interface ReconciliationResult {
  inspected: number;
  resolved: number;
  pending: number;
}

function fillCollateralRaw(input: {
  outcome: "YES" | "NO";
  priceRaw: bigint;
  quantityRaw: bigint;
  priceDecimals: number;
  quantityDecimals: number;
  collateralDecimals: number;
}): bigint {
  const outcomePrice =
    input.outcome === "YES" ? input.priceRaw : pow10(input.priceDecimals) - input.priceRaw;
  return maximumCostRaw({ ...input, priceRaw: outcomePrice });
}

export class RestartReconciler {
  constructor(
    private readonly store: EventPilotStore,
    private readonly receipts: ReceiptLookup,
    private readonly clock: () => number = Date.now,
  ) {}

  async reconcile(): Promise<ReconciliationResult> {
    const unresolvedIntents = this.store.listUnresolvedIntents();
    const unresolvedClaims = this.store.listUnresolvedClaims();
    const result: ReconciliationResult = {
      inspected: unresolvedIntents.length + unresolvedClaims.length,
      resolved: 0,
      pending: 0,
    };

    for (const unresolved of unresolvedIntents) {
      if (unresolved.transactionHash === null) {
        result.pending += 1;
        continue;
      }
      const receipt = await this.receipts.lookupReceipt(
        unresolved.transactionHash,
        unresolved.body.poolAddress,
      );
      if (receipt === null) {
        result.pending += 1;
        continue;
      }
      this.store.saveTransaction({
        hash: receipt.hash,
        intentKey: unresolved.intentKey,
        receiptStatus: receipt.status,
        blockNumber: receipt.blockNumber?.toString() ?? null,
        gasUsed: receipt.gasUsed?.toString() ?? null,
      });
      if (receipt.status === "reverted") {
        this.store.updateIntentState(unresolved.intentKey, "REVERTED", receipt.hash);
        this.store.recordExecutionOutcome({
          marketId: unresolved.body.marketId,
          occurredAtMs: this.clock(),
          filledCollateralRaw: "0",
          reverted: true,
        });
      } else {
        let collateral = 0n;
        for (const fill of receipt.fills) {
          this.store.saveFill({
            transactionHash: receipt.hash,
            intentKey: unresolved.intentKey,
            quantityRaw: fill.quantityRaw.toString(),
            priceRaw: fill.priceRaw.toString(),
          });
          collateral += fillCollateralRaw({
            outcome: unresolved.body.outcome,
            priceRaw: fill.priceRaw,
            quantityRaw: fill.quantityRaw,
            priceDecimals: unresolved.body.priceDecimals,
            quantityDecimals: unresolved.body.quantityDecimals,
            collateralDecimals: unresolved.body.collateralDecimals,
          });
        }
        this.store.updateIntentState(unresolved.intentKey, "SUCCEEDED", receipt.hash);
        this.store.recordExecutionOutcome({
          marketId: unresolved.body.marketId,
          occurredAtMs: this.clock(),
          filledCollateralRaw: collateral.toString(),
          reverted: false,
        });
      }
      await this.store.appendEvent({
        kind: "reconciliation.completed",
        occurredAtMs: this.clock(),
        marketId: unresolved.body.marketId,
        strategyHash: unresolved.body.strategyHash,
        intentKey: unresolved.intentKey,
        transactionHash: receipt.hash,
        summary: `Restart reconciliation inspected an order receipt with status ${receipt.status}.`,
      });
      result.resolved += 1;
    }

    for (const unresolved of unresolvedClaims) {
      if (unresolved.transactionHash === null) {
        result.pending += 1;
        continue;
      }
      const receipt = await this.receipts.lookupReceipt(unresolved.transactionHash);
      if (receipt === null) {
        result.pending += 1;
        continue;
      }
      this.store.saveTransaction({
        hash: receipt.hash,
        intentKey: unresolved.claimKey,
        receiptStatus: receipt.status,
        blockNumber: receipt.blockNumber?.toString() ?? null,
        gasUsed: receipt.gasUsed?.toString() ?? null,
      });
      this.store.updateClaimState(
        unresolved.claimKey,
        receipt.status === "success" ? "SUCCEEDED" : "REVERTED",
        receipt.hash,
      );
      await this.store.appendEvent({
        kind: "reconciliation.completed",
        occurredAtMs: this.clock(),
        marketId: unresolved.marketId,
        strategyHash: null,
        intentKey: unresolved.claimKey,
        transactionHash: receipt.hash,
        summary: `Restart reconciliation inspected a claim receipt with status ${receipt.status}.`,
      });
      result.resolved += 1;
    }
    return result;
  }
}
