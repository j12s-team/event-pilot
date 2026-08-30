import { sha256Hex } from "@eventpilot/strategy";

import type { EventPilotStore } from "./database.js";
import type { VerifiedReceipt } from "./executor.js";
import type { SignerQueue } from "./runner.js";

export interface ClaimVenueWriter {
  readonly walletAddress: string;
  getChainId(): Promise<number>;
  listFinalizedClaimable(): Promise<
    Array<{
      marketId: string;
      outcome: "YES" | "NO";
      amountRaw: bigint;
      estimatedPayoutRaw: bigint;
    }>
  >;
  submitClaim(input: {
    marketId: string;
    outcome: "YES" | "NO";
    amountRaw: bigint;
  }): Promise<VerifiedReceipt>;
}

export type ClaimScanResult = {
  discovered: number;
  submitted: number;
  succeeded: number;
  reverted: number;
  unknown: number;
  duplicates: number;
};

export class SettlementClaimWorker {
  constructor(
    private readonly store: EventPilotStore,
    private readonly signerQueue: SignerQueue,
    private readonly writer: ClaimVenueWriter,
    private readonly clock: () => number = Date.now,
  ) {}

  async scan(): Promise<ClaimScanResult> {
    if ((await this.writer.getChainId()) !== 50_312) {
      throw new Error("Claim scanner refuses a non-Shannon chain.");
    }
    if (this.store.hasUnreconciledWrite()) {
      throw new Error("Claim scanner is blocked until unresolved writes are reconciled.");
    }
    const positions = await this.writer.listFinalizedClaimable();
    const result: ClaimScanResult = {
      discovered: positions.length,
      submitted: 0,
      succeeded: 0,
      reverted: 0,
      unknown: 0,
      duplicates: 0,
    };

    for (const position of positions) {
      const claimKey = await sha256Hex(
        [this.writer.walletAddress.toLowerCase(), position.marketId, position.outcome].join(":"),
      );
      const createdAtMs = this.clock();
      if (
        !this.store.prepareClaim({
          claimKey,
          marketId: position.marketId,
          walletAddress: this.writer.walletAddress,
          outcome: position.outcome,
          amountRaw: position.amountRaw.toString(),
          createdAtMs,
        })
      ) {
        result.duplicates += 1;
        continue;
      }
      await this.store.appendEvent({
        kind: "settlement.detected",
        occurredAtMs: createdAtMs,
        marketId: position.marketId,
        strategyHash: null,
        intentKey: claimKey,
        transactionHash: null,
        summary: `Finalized ${position.outcome} position is claimable for ${position.amountRaw} raw outcome units.`,
      });

      await this.signerQueue.run(async () => {
        let transactionHash: string | null = null;
        try {
          if ((await this.writer.getChainId()) !== 50_312) {
            throw new Error("Claim send boundary is not Somnia Shannon chain 50312.");
          }
          const receipt = await this.writer.submitClaim({
            marketId: position.marketId,
            outcome: position.outcome,
            amountRaw: position.amountRaw,
          });
          transactionHash = receipt.hash;
          result.submitted += 1;
          this.store.updateClaimState(claimKey, "SENT", transactionHash);
          await this.store.appendEvent({
            kind: "claim.sent",
            occurredAtMs: this.clock(),
            marketId: position.marketId,
            strategyHash: null,
            intentKey: claimKey,
            transactionHash,
            summary:
              "Claim transaction submitted to Somnia Shannon; receipt verification is required.",
          });
          this.store.saveTransaction({
            hash: receipt.hash,
            intentKey: claimKey,
            receiptStatus: receipt.status,
            blockNumber: receipt.blockNumber?.toString() ?? null,
            gasUsed: receipt.gasUsed?.toString() ?? null,
          });
          if (receipt.status === "reverted") {
            this.store.updateClaimState(claimKey, "REVERTED", transactionHash);
            result.reverted += 1;
            await this.store.appendEvent({
              kind: "claim.reverted",
              occurredAtMs: this.clock(),
              marketId: position.marketId,
              strategyHash: null,
              intentKey: claimKey,
              transactionHash,
              summary: "Claim receipt explicitly reported a revert.",
            });
            return;
          }
          this.store.updateClaimState(claimKey, "SUCCEEDED", transactionHash);
          result.succeeded += 1;
          await this.store.appendEvent({
            kind: "claim.succeeded",
            occurredAtMs: this.clock(),
            marketId: position.marketId,
            strategyHash: null,
            intentKey: claimKey,
            transactionHash,
            summary: `Claim receipt succeeded; estimated payout before confirmation was ${position.estimatedPayoutRaw} raw collateral units.`,
          });
        } catch {
          this.store.updateClaimState(claimKey, "UNKNOWN", transactionHash);
          result.unknown += 1;
          await this.store.appendEvent({
            kind: "claim.unknown",
            occurredAtMs: this.clock(),
            marketId: position.marketId,
            strategyHash: null,
            intentKey: claimKey,
            transactionHash,
            summary:
              "Claim outcome is unknown; all signer writes are blocked pending reconciliation.",
          });
        }
      });
    }
    return result;
  }
}
