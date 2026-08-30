import {
  DreamDexSdkWriter,
  type ClaimableOutcome,
  type ConfirmedIocResult,
} from "@eventpilot/dreamdex-adapter";

import type { ClaimVenueWriter } from "./settlement.js";
import type { GuardedVenueWriter, VerifiedReceipt } from "./executor.js";
import type { ReceiptLookup } from "./reconciler.js";

function toReceipt(result: ConfirmedIocResult): VerifiedReceipt {
  return {
    hash: result.hash,
    status: result.receipt.status,
    blockNumber: result.receipt.blockNumber,
    gasUsed: result.receipt.gasUsed,
    fills: result.fills,
  };
}

/**
 * Adapts the receipt-confirming DreamDEX SDK to EventPilot's durable state
 * machine. PREPARED is always stored before the SDK call. The SDK returns only
 * after mining, so the transient SENT state is persisted immediately after the
 * confirmed result and before EventPilot inspects that receipt.
 */
export class SdkVenueWriter implements GuardedVenueWriter, ClaimVenueWriter, ReceiptLookup {
  #confirmed = new Map<string, VerifiedReceipt>();

  constructor(readonly sdk: DreamDexSdkWriter) {}

  get walletAddress(): string {
    return this.sdk.walletAddress;
  }

  getChainId(): Promise<number> {
    return this.sdk.getChainId();
  }

  getNativeBalance(): Promise<bigint> {
    return this.sdk.getNativeBalance();
  }

  getCollateralBalance(asset: "BTC" | "ETH", intervalSeconds: 900 | 3600): Promise<bigint> {
    return this.sdk.getCollateralBalance(asset, intervalSeconds);
  }

  getMarketStatus(marketId: string) {
    return this.sdk.getMarketStatus(marketId);
  }

  async sendIoc(input: {
    marketId: string;
    poolAddress: string;
    outcome: "YES" | "NO";
    priceRaw: bigint;
    quantityRaw: bigint;
    expiryNanoseconds: bigint;
  }): Promise<{ hash: string }> {
    const result = await this.sdk.submitIoc({
      poolAddress: input.poolAddress,
      outcome: input.outcome,
      nativeYesPriceRaw: input.priceRaw,
      quantityRaw: input.quantityRaw,
      expiryNanoseconds: input.expiryNanoseconds,
    });
    this.#confirmed.set(result.hash, toReceipt(result));
    return { hash: result.hash };
  }

  async waitForReceipt(hash: string): Promise<VerifiedReceipt> {
    const cached = this.#confirmed.get(hash);
    if (cached !== undefined) {
      this.#confirmed.delete(hash);
      return cached;
    }
    return toReceipt(await this.sdk.getConfirmedReceipt(hash));
  }

  listFinalizedClaimable(): Promise<ClaimableOutcome[]> {
    return this.sdk.listFinalizedClaimable();
  }

  async submitClaim(input: {
    marketId: string;
    outcome: "YES" | "NO";
    amountRaw: bigint;
  }): Promise<VerifiedReceipt> {
    const result = await this.sdk.submitClaim(input);
    return {
      hash: result.hash,
      status: result.receipt.status,
      blockNumber: result.receipt.blockNumber,
      gasUsed: result.receipt.gasUsed,
      fills: [],
    };
  }

  async lookupReceipt(hash: string, poolAddress?: string): Promise<VerifiedReceipt | null> {
    try {
      return toReceipt(await this.sdk.getConfirmedReceipt(hash, poolAddress));
    } catch {
      return null;
    }
  }

  close(): Promise<void> {
    return this.sdk.close();
  }
}
