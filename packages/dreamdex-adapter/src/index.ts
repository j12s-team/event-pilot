import {
  SOMNIA_TESTNET_ADDRESSES,
  ORDER_TYPE,
  orderBookEventsAbi,
  SomniaMarkets,
  type BinaryBookParams,
  type BinaryMarket,
  type BinaryMarketStatus,
  type BinaryOrderBook,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, decodeEventLog, http } from "viem";
import { marketSnapshotV1Schema, type MarketSnapshotV1 } from "@eventpilot/contracts";

export const DREAMDEX_SDK_VERSION = "0.28.1" as const;
export const DEFAULT_INDEXER_URL = "https://dev.smk.somnia.host/v1/graphql";
export const DEFAULT_WS_RPC_URL = "wss://api.infra.testnet.somnia.network/ws";

export interface DiscoveredBinaryMarket {
  marketId: string;
  poolAddress: string;
  venueId: string;
  asset: "BTC" | "ETH";
  intervalSeconds: 900 | 3600;
  strikeRaw: string;
  expirySeconds: string;
  indexerStatus: BinaryMarketStatus;
  priceDecimals: number;
  quantityDecimals: number;
  collateralDecimals: number;
}

export interface HydratedMarket {
  market: DiscoveredBinaryMarket;
  book: BinaryOrderBook;
  params: BinaryBookParams;
  chainStatus: number;
  capturedAtMs: number;
  indexerTimestampMs: number | null;
  sourceBlock: string | null;
}

export interface DreamDexMarketSource {
  discoverActive(): Promise<DiscoveredBinaryMarket[]>;
  hydrate(market: DiscoveredBinaryMarket): Promise<HydratedMarket>;
  close?(): Promise<void>;
}

function toInterval(market: BinaryMarket): 900 | 3600 | null {
  const raw = Number(market.intervalSec ?? Number(market.expiry) - Number(market.tradingStart));
  if (raw === 900 || raw === 3600) return raw;
  return null;
}

function toAsset(value: string): "BTC" | "ETH" | null {
  const upper = value.toUpperCase();
  return upper === "BTC" || upper === "ETH" ? upper : null;
}

function toLifecycleFromIndexer(status: BinaryMarketStatus): MarketSnapshotV1["indexerStatus"] {
  switch (status) {
    case "Trading":
      return "Trading";
    case "Locked":
    case "Settling":
    case "Resolved":
    case "Listed":
      return "Locked";
    case "Finalized":
      return "Finalized";
    case "Voided":
      return "Voided";
  }
}

export function toLifecycleFromChain(status: number): MarketSnapshotV1["chainStatus"] {
  switch (status) {
    case 1:
      return "Trading";
    case 2:
    case 3:
      return "Locked";
    case 4:
      return "Finalized";
    case 5:
      return "Voided";
    default:
      return "Unknown";
  }
}

function top(levels: BinaryOrderBook["yesBids"]): bigint | null {
  return levels[0]?.price ?? null;
}

function depth(levels: BinaryOrderBook["yesBids"]): bigint {
  return levels.reduce((total, level) => total + level.quantity, 0n);
}

export function normalizeHydratedMarket(input: HydratedMarket): MarketSnapshotV1 {
  const { market, book, params } = input;
  return marketSnapshotV1Schema.parse({
    version: "1",
    network: "somnia-shannon",
    venueId: market.venueId,
    marketId: market.marketId,
    poolAddress: market.poolAddress,
    asset: market.asset,
    intervalSeconds: market.intervalSeconds,
    strikeRaw: market.strikeRaw,
    marketExpiryMs: Number(market.expirySeconds) * 1_000,
    capturedAtMs: input.capturedAtMs,
    indexerTimestampMs: input.indexerTimestampMs,
    sourceBlock: input.sourceBlock,
    indexerStatus: toLifecycleFromIndexer(market.indexerStatus),
    chainStatus: toLifecycleFromChain(input.chainStatus),
    connection: "live",
    priceDecimals: market.priceDecimals,
    quantityDecimals: market.quantityDecimals,
    collateralDecimals: market.collateralDecimals,
    tickSizeRaw: params.tickSize.toString(),
    lotSizeRaw: params.lotSize.toString(),
    yes: {
      bestBidRaw: top(book.yesBids)?.toString() ?? null,
      bestAskRaw: top(book.yesAsks)?.toString() ?? null,
      bidDepthRaw: depth(book.yesBids).toString(),
      askDepthRaw: depth(book.yesAsks).toString(),
    },
    no: {
      bestBidRaw: top(book.noBids)?.toString() ?? null,
      bestAskRaw: top(book.noAsks)?.toString() ?? null,
      bidDepthRaw: depth(book.noBids).toString(),
      askDepthRaw: depth(book.noAsks).toString(),
    },
  });
}

export interface SdkSourceOptions {
  indexerUrl?: string;
  wsRpcUrl?: string;
}

export class DreamDexSdkSource implements DreamDexMarketSource {
  readonly exchange: SomniaMarkets;

  constructor(options: SdkSourceOptions = {}) {
    this.exchange = new SomniaMarkets({
      chain: somniaShannon,
      indexerUrl: options.indexerUrl ?? DEFAULT_INDEXER_URL,
      wsRpcUrl: options.wsRpcUrl ?? DEFAULT_WS_RPC_URL,
      addresses: SOMNIA_TESTNET_ADDRESSES,
    });
  }

  async discoverActive(): Promise<DiscoveredBinaryMarket[]> {
    const markets = await this.exchange.client.listLiveBinaryMarkets({ status: "Trading" });
    return markets.flatMap((market) => {
      const asset = toAsset(market.asset);
      const intervalSeconds = toInterval(market);
      if (asset === null || intervalSeconds === null) return [];
      return [
        {
          marketId: market.marketId,
          poolAddress: market.poolAddress,
          venueId: market.venueId ?? `operator-${market.operatorId ?? "unknown"}`,
          asset,
          intervalSeconds,
          strikeRaw: market.strike,
          expirySeconds: market.expiry,
          indexerStatus: market.status,
          priceDecimals: market.quoteDecimals,
          quantityDecimals: market.baseDecimals,
          collateralDecimals: market.quoteDecimals,
        },
      ];
    });
  }

  async hydrate(market: DiscoveredBinaryMarket): Promise<HydratedMarket> {
    const [book, params, onchain] = await Promise.all([
      this.exchange.client.getBinaryOrderBook(market.poolAddress as `0x${string}`, {
        depth: 20,
        decimals: market.priceDecimals,
      }),
      this.exchange.client.getBinaryBookParams(market.poolAddress),
      this.exchange.client.getMarketOnchain(market.marketId as `0x${string}`),
    ]);
    return {
      market,
      book,
      params,
      chainStatus: onchain.status,
      capturedAtMs: Date.now(),
      indexerTimestampMs: null,
      sourceBlock: null,
    };
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}

export class DreamDexAdapter {
  #snapshotsByMarketId = new Map<string, MarketSnapshotV1>();

  constructor(private readonly source: DreamDexMarketSource) {}

  async refresh(): Promise<MarketSnapshotV1[]> {
    const discovered = await this.source.discoverActive();
    const snapshots = await Promise.all(
      discovered.map(async (market) => normalizeHydratedMarket(await this.source.hydrate(market))),
    );
    const next = new Map(snapshots.map((snapshot) => [snapshot.marketId, snapshot]));
    this.#snapshotsByMarketId = next;
    return this.list();
  }

  list(): MarketSnapshotV1[] {
    return [...this.#snapshotsByMarketId.values()].sort(
      (left, right) => left.marketExpiryMs - right.marketExpiryMs,
    );
  }

  markDisconnected(nowMs = Date.now()): MarketSnapshotV1[] {
    this.#snapshotsByMarketId = new Map(
      [...this.#snapshotsByMarketId.entries()].map(([id, snapshot]) => [
        id,
        {
          ...snapshot,
          capturedAtMs: Math.min(snapshot.capturedAtMs, nowMs),
          connection: "disconnected" as const,
        },
      ]),
    );
    return this.list();
  }

  async close(): Promise<void> {
    await this.source.close?.();
  }
}

export interface SdkWriterOptions extends SdkSourceOptions {
  privateKey: `0x${string}`;
  httpRpcUrl?: string;
}

export interface ConfirmedIocResult {
  hash: string;
  receipt: {
    status: "success" | "reverted";
    blockNumber: bigint;
    gasUsed: bigint;
  };
  fills: Array<{ quantityRaw: bigint; priceRaw: bigint }>;
}

export interface ClaimableOutcome {
  marketId: string;
  outcome: "YES" | "NO";
  amountRaw: bigint;
  estimatedPayoutRaw: bigint;
}

export interface ConfirmedWriteResult {
  hash: string;
  receipt: {
    status: "success" | "reverted";
    blockNumber: bigint;
    gasUsed: bigint;
  };
}

/**
 * Server-only Shannon writer. The SDK confirms a write in one round trip, so
 * callers must still persist their PREPARED intent before invoking submitIoc.
 */
export class DreamDexSdkWriter {
  readonly exchange: SomniaMarkets;
  readonly publicClient;

  constructor(options: SdkWriterOptions) {
    this.exchange = new SomniaMarkets({
      chain: somniaShannon,
      indexerUrl: options.indexerUrl ?? DEFAULT_INDEXER_URL,
      wsRpcUrl: options.wsRpcUrl ?? DEFAULT_WS_RPC_URL,
      addresses: SOMNIA_TESTNET_ADDRESSES,
      privateKey: options.privateKey,
    });
    this.publicClient = createPublicClient({
      chain: somniaShannon,
      transport: http(options.httpRpcUrl ?? "https://dream-rpc.somnia.network"),
    });
  }

  async getChainId(): Promise<number> {
    return this.publicClient.getChainId();
  }

  get walletAddress(): `0x${string}` {
    const address = this.exchange.walletAddress;
    if (address === undefined) throw new Error("DreamDEX writer has no configured wallet.");
    return address;
  }

  async getNativeBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.walletAddress });
  }

  async getCollateralBalance(asset: "BTC" | "ETH", intervalSeconds: 900 | 3600): Promise<bigint> {
    const [market] = await this.exchange.client.listLiveBinaryMarkets({
      status: "Trading",
      asset,
      intervalSec: intervalSeconds,
    });
    if (market === undefined)
      throw new Error(
        `No live ${asset} ${intervalSeconds}s market is available for collateral preflight.`,
      );
    return this.exchange.client.getErc20Balance(market.collateral, this.walletAddress);
  }

  async getMarketStatus(marketId: string): Promise<MarketSnapshotV1["chainStatus"]> {
    const onchain = await this.exchange.client.getMarketOnchain(marketId as `0x${string}`);
    return toLifecycleFromChain(onchain.status);
  }

  async submitIoc(input: {
    poolAddress: string;
    outcome: "YES" | "NO";
    nativeYesPriceRaw: bigint;
    quantityRaw: bigint;
    expiryNanoseconds: bigint;
  }): Promise<ConfirmedIocResult> {
    const result = await this.exchange.trader.placeOrder({
      pool: input.poolAddress as `0x${string}`,
      side: input.outcome === "YES" ? "BUY_YES" : "BUY_NO",
      price: input.nativeYesPriceRaw,
      quantity: input.quantityRaw,
      expireTimestampNs: input.expiryNanoseconds,
      orderType: ORDER_TYPE.MARKET,
    });
    return {
      hash: result.hash,
      receipt: {
        status: result.receipt.status,
        blockNumber: result.receipt.blockNumber,
        gasUsed: result.receipt.gasUsed,
      },
      fills: result.fills.map((fill) => ({
        quantityRaw: fill.quantityFilled,
        priceRaw: fill.fillPrice,
      })),
    };
  }

  async listFinalizedClaimable(): Promise<ClaimableOutcome[]> {
    // Finalization is discovered from the current registry rather than a
    // remembered pool. A pool can be recycled while the market ID remains the
    // permanent settlement key.
    const finalized = await this.exchange.client.listBinaryMarkets({
      status: "Finalized",
      limit: 200,
    });
    const finalizedIds = new Set<string>(finalized.map((market) => market.marketId));
    const positions = await this.exchange.client.getClaimable(this.walletAddress);
    return positions.flatMap((position) =>
      finalizedIds.has(position.marketId)
        ? [
            {
              marketId: position.marketId,
              outcome: position.outcomeIdx === 0 ? ("YES" as const) : ("NO" as const),
              amountRaw: position.amount,
              estimatedPayoutRaw: position.estPayout,
            },
          ]
        : [],
    );
  }

  async submitClaim(input: {
    marketId: string;
    outcome: "YES" | "NO";
    amountRaw: bigint;
  }): Promise<ConfirmedWriteResult> {
    const result = await this.exchange.trader.redeem({
      marketId: input.marketId as `0x${string}`,
      outcomeIdx: input.outcome === "YES" ? 0 : 1,
      amount: input.amountRaw,
    });
    return {
      hash: result.hash,
      receipt: {
        status: result.receipt.status,
        blockNumber: result.receipt.blockNumber,
        gasUsed: result.receipt.gasUsed,
      },
    };
  }

  async getConfirmedReceipt(hash: string, poolAddress?: string): Promise<ConfirmedIocResult> {
    const receipt = await this.publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
    const fills: ConfirmedIocResult["fills"] = [];
    if (poolAddress !== undefined) {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== poolAddress.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: orderBookEventsAbi,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== "OrderFilled") continue;
          const args = decoded.args as unknown as { quantityFilled: bigint; fillPrice: bigint };
          fills.push({ quantityRaw: args.quantityFilled, priceRaw: args.fillPrice });
        } catch {
          // Token and vault logs in the same receipt are intentionally ignored.
        }
      }
    }
    return {
      hash,
      receipt: {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      },
      fills,
    };
  }

  async close(): Promise<void> {
    await this.exchange.close();
  }
}
