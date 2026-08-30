"use client";

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Braces,
  CheckCircle2,
  CirclePause,
  CirclePlay,
  Clock3,
  DatabaseZap,
  Download,
  Gauge,
  History,
  Link2,
  LoaderCircle,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Square,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DecisionV1,
  MarketSnapshotV1,
  RiskSnapshotV1,
  RunnerEventV1,
  StrategyV1,
} from "@eventpilot/contracts";
import { decisionV1Schema, riskSnapshotV1Schema, strategyV1Schema } from "@eventpilot/contracts";
import {
  defaultStrategy,
  evaluateStrategy,
  exportStrategy,
  hashStrategy,
  importStrategy,
} from "@eventpilot/strategy";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useMarkets } from "@/hooks/use-markets";
import { api } from "@/lib/api";
import type { PublicEvidence } from "@/lib/api";

type View = "markets" | "strategy" | "paper" | "runner" | "evidence";
type PaperState = "stopped" | "running" | "paused";
interface PaperEntry {
  id: string;
  recordedAtMs: number;
  marketId: string;
  risk: RiskSnapshotV1;
  decision: DecisionV1;
  message: string;
}

const PAPER_STORAGE_KEY = "eventpilot.paper.v1";
const STRATEGY_STORAGE_KEY = "eventpilot.strategy.v1";

function pow10(decimals: number): bigint {
  return 10n ** BigInt(decimals);
}
function probabilityBps(raw: string | null, decimals: number): bigint | null {
  return raw === null ? null : (BigInt(raw) * 10_000n) / pow10(decimals);
}
function formatBps(value: bigint | null): string {
  return value === null ? "—" : `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}%`;
}
function formatRaw(value: string, decimals: number, fractionDigits = 2): string {
  const raw = BigInt(value);
  const scale = pow10(decimals);
  const whole = raw / scale;
  const fraction = ((raw % scale) * pow10(fractionDigits)) / scale;
  return `${whole}.${fraction.toString().padStart(fractionDigits, "0")}`;
}
function short(value: string | null, lead = 8): string {
  return value === null
    ? "not available"
    : value.length > lead + 6
      ? `${value.slice(0, lead)}…${value.slice(-4)}`
      : value;
}
function publicString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function countdown(expiryMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((expiryMs - nowMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function paperRiskFor(
  market: MarketSnapshotV1,
  entries: PaperEntry[],
  nowMs = Date.now(),
): RiskSnapshotV1 {
  const dayStartMs = Date.parse(`${new Date(nowMs).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const eligible = entries.filter((entry) => entry.decision.eligible);
  const marketEntries = eligible.filter((entry) => entry.marketId === market.marketId);
  const dailyCollateralRaw = eligible
    .filter(
      (entry) => entry.recordedAtMs >= dayStartMs && entry.recordedAtMs < dayStartMs + 86_400_000,
    )
    .reduce((total, entry) => total + BigInt(entry.decision.maximumCostRaw), 0n);
  return {
    version: "1",
    marketId: market.marketId,
    ordersForMarket: marketEntries.length,
    dailyCollateralRaw: dailyCollateralRaw.toString(),
    consecutiveFailures: 0,
    lastOrderAtMs:
      marketEntries.length === 0
        ? null
        : Math.max(...marketEntries.map((entry) => entry.recordedAtMs)),
    collateralDecimals: market.collateralDecimals,
    asOfMs: nowMs,
  };
}
function parsePaperEntries(value: string): PaperEntry[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Saved paper history is not an array.");
  return parsed.slice(0, 100).map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Saved paper entry ${index + 1} is invalid.`);
    }
    const candidate = entry as Record<string, unknown>;
    const decision = decisionV1Schema.safeParse(candidate.decision);
    const risk = riskSnapshotV1Schema.safeParse(candidate.risk);
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.recordedAtMs !== "number" ||
      !Number.isSafeInteger(candidate.recordedAtMs) ||
      candidate.recordedAtMs < 0 ||
      typeof candidate.marketId !== "string" ||
      typeof candidate.message !== "string" ||
      !decision.success ||
      !risk.success
    ) {
      throw new Error(`Saved paper entry ${index + 1} is invalid.`);
    }
    return {
      id: candidate.id,
      recordedAtMs: candidate.recordedAtMs,
      marketId: candidate.marketId,
      message: candidate.message,
      risk: risk.data,
      decision: decision.data,
    };
  });
}
function cloneDefaultStrategy(): StrategyV1 {
  return structuredClone(defaultStrategy);
}

export default function Home() {
  const marketQuery = useMarkets();
  const [view, setView] = useState<View>("markets");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [strategy, setStrategy] = useState<StrategyV1>(cloneDefaultStrategy);
  const [strategyHash, setStrategyHash] = useState("calculating…");
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionV1 | null>(null);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [paperState, setPaperState] = useState<PaperState>("stopped");
  const [paperEntries, setPaperEntries] = useState<PaperEntry[]>([]);
  const paperEntriesRef = useRef<PaperEntry[]>([]);
  const [runner, setRunner] = useState<Record<string, unknown> | null>(null);
  const [runnerEvents, setRunnerEvents] = useState<RunnerEventV1[]>([]);
  const [latestEvidence, setLatestEvidence] = useState<PublicEvidence | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    const savedStrategy = localStorage.getItem(STRATEGY_STORAGE_KEY);
    const savedPaper = localStorage.getItem(PAPER_STORAGE_KEY);
    try {
      if (savedStrategy) setStrategy(importStrategy(savedStrategy));
    } catch {
      localStorage.removeItem(STRATEGY_STORAGE_KEY);
      setRecoveryMessage(
        "An invalid saved strategy was removed. EventPilot restored the safe default policy.",
      );
    }
    try {
      if (savedPaper) {
        const restored = parsePaperEntries(savedPaper);
        paperEntriesRef.current = restored;
        setPaperEntries(restored);
      }
    } catch {
      localStorage.removeItem(PAPER_STORAGE_KEY);
      paperEntriesRef.current = [];
      setPaperEntries([]);
      setRecoveryMessage(
        "Invalid browser-local paper history was removed. No simulated result was trusted.",
      );
    }
    return () => clearInterval(timer);
  }, []);

  const strategyValidation = useMemo(() => strategyV1Schema.safeParse(strategy), [strategy]);
  const policyError = strategyValidation.success
    ? null
    : (strategyValidation.error.issues[0]?.message ?? "Strategy policy is invalid.");

  useEffect(() => {
    if (!strategyValidation.success) {
      setStrategyHash("invalid policy");
      return;
    }
    void hashStrategy(strategyValidation.data).then(setStrategyHash);
    localStorage.setItem(STRATEGY_STORAGE_KEY, exportStrategy(strategyValidation.data));
  }, [strategyValidation]);

  useEffect(() => {
    if (marketQuery.markets.length === 0) return;
    const selectedMatches = marketQuery.markets.some(
      (market) =>
        market.marketId === selectedMarketId &&
        market.asset === strategy.selector.asset &&
        market.intervalSeconds === strategy.selector.intervalSeconds,
    );
    if (!selectedMatches) {
      const preferred = marketQuery.markets.find(
        (market) =>
          market.asset === strategy.selector.asset &&
          market.intervalSeconds === strategy.selector.intervalSeconds,
      );
      setSelectedMarketId((preferred ?? marketQuery.markets[0])?.marketId ?? null);
      setDecision(null);
    }
  }, [
    marketQuery.markets,
    selectedMarketId,
    strategy.selector.asset,
    strategy.selector.intervalSeconds,
  ]);

  const selectedMarket = useMemo(
    () => marketQuery.markets.find((market) => market.marketId === selectedMarketId) ?? null,
    [marketQuery.markets, selectedMarketId],
  );

  const evaluateNow = useCallback(async () => {
    if (selectedMarket === null || !strategyValidation.success) return;
    setEvaluating(true);
    setEvaluationError(null);
    try {
      setDecision(
        await api.evaluate({
          strategy: strategyValidation.data,
          market: selectedMarket,
          risk: paperRiskFor(selectedMarket, paperEntriesRef.current),
          evaluatedAtMs: Date.now(),
        }),
      );
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : "Evaluation failed.");
    } finally {
      setEvaluating(false);
    }
  }, [selectedMarket, strategyValidation]);

  useEffect(() => {
    if (paperState !== "running" || selectedMarket === null || !strategyValidation.success) return;
    let active = true;
    const evaluatedAtMs = Date.now();
    const risk = paperRiskFor(selectedMarket, paperEntriesRef.current, evaluatedAtMs);
    void evaluateStrategy({
      strategy: strategyValidation.data,
      market: selectedMarket,
      risk,
      evaluatedAtMs,
    }).then((result) => {
      if (!active) return;
      const entry: PaperEntry = {
        id: crypto.randomUUID(),
        recordedAtMs: Date.now(),
        marketId: selectedMarket.marketId,
        risk,
        decision: result,
        message: result.eligible
          ? "Would submit at this snapshot."
          : (result.reasons[0] ?? "Skipped by policy."),
      };
      setPaperEntries((previous) => {
        const next = [entry, ...previous].slice(0, 100);
        paperEntriesRef.current = next;
        localStorage.setItem(PAPER_STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    });
    return () => {
      active = false;
    };
  }, [marketQuery.lastUpdateMs, paperState, selectedMarket, strategyValidation]);

  useEffect(() => {
    if (view !== "runner" && view !== "evidence") return;
    let active = true;
    const load = async () => {
      try {
        const [nextRunner, nextEvents, nextEvidence] = await Promise.all([
          api.runner(),
          api.events(0),
          api.latestEvidence().catch(() => null),
        ]);
        if (active) {
          setRunner(nextRunner);
          setRunnerEvents(nextEvents.events);
          setLatestEvidence(nextEvidence);
        }
      } catch {
        if (active) setRunner(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [view]);

  const chooseMarket = (market: MarketSnapshotV1) => {
    setSelectedMarketId(market.marketId);
    setStrategy((current) => ({
      ...current,
      selector: {
        ...current.selector,
        asset: market.asset,
        intervalSeconds: market.intervalSeconds,
      },
    }));
    setDecision(null);
    setView("strategy");
  };
  const downloadStrategy = () => {
    const url = URL.createObjectURL(
      new Blob([exportStrategy(strategy)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "eventpilot-strategy-v1.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Header view={view} setView={setView} />
      <section className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
        <Hero marketQuery={marketQuery} nowMs={nowMs} />
        {recoveryMessage && (
          <Alert className="mb-5 border-amber-300/20 bg-amber-300/[0.03]">
            <RotateCcw className="text-amber-200" />
            <AlertTitle>Local state recovered safely</AlertTitle>
            <AlertDescription>{recoveryMessage}</AlertDescription>
          </Alert>
        )}
        {(view === "markets" || view === "strategy") && (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(390px,.82fr)]">
            <MarketPanel
              markets={marketQuery.markets}
              nowMs={nowMs}
              isLoading={marketQuery.isLoading}
              error={marketQuery.error}
              selectedMarketId={selectedMarketId}
              chooseMarket={chooseMarket}
            />
            <StrategyStudio
              strategy={strategy}
              setStrategy={setStrategy}
              strategyHash={strategyHash}
              decision={decision}
              selectedMarket={selectedMarket}
              evaluating={evaluating}
              evaluationError={evaluationError}
              policyError={policyError}
              setEvaluationError={setEvaluationError}
              evaluateNow={evaluateNow}
              downloadStrategy={downloadStrategy}
              importRef={importRef}
            />
          </div>
        )}
        {view === "paper" && (
          <PaperRun
            state={paperState}
            setState={setPaperState}
            entries={paperEntries}
            clear={() => {
              paperEntriesRef.current = [];
              setPaperEntries([]);
              localStorage.removeItem(PAPER_STORAGE_KEY);
            }}
            selectedMarket={selectedMarket}
          />
        )}
        {view === "runner" && <DemoRunnerPanel runner={runner} events={runnerEvents} />}
        {view === "evidence" && (
          <EvidenceConsole
            events={runnerEvents}
            decision={decision}
            strategyHash={strategyHash}
            latestEvidence={latestEvidence}
          />
        )}
      </section>
      <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 border-t border-white/6 px-4 py-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>
          Educational Shannon testnet software. No guaranteed fills, profits, audit status, or
          investment advice.
        </p>
        <p className="font-mono">chain 50312 · markets-sdk 0.28.1 · dry-run default</p>
      </footer>
    </main>
  );
}

function Header({ view, setView }: { view: View; setView: (view: View) => void }) {
  const items: [View, string][] = [
    ["markets", "Markets"],
    ["strategy", "Strategy"],
    ["paper", "Paper run"],
    ["runner", "Demo runner"],
    ["evidence", "Evidence"],
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-white/7 bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
        <button
          onClick={() => setView("markets")}
          className="flex items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <span className="grid size-9 place-items-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Gauge className="size-5" />
          </span>
          <span>
            <span className="block font-heading text-[15px] font-semibold">EventPilot</span>
            <span className="block text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Policy Studio
            </span>
          </span>
        </button>
        <nav
          className="order-3 flex w-full gap-1 overflow-x-auto rounded-xl border border-white/6 bg-white/[0.025] p-1 md:order-none md:w-auto"
          aria-label="Primary"
        >
          {items.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${view === id ? "bg-white/8 text-white" : "text-muted-foreground hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <Badge variant="outline" className="border-primary/25 bg-primary/8 text-primary">
          <span className="size-1.5 rounded-full bg-primary" /> Shannon testnet
        </Badge>
      </div>
    </header>
  );
}

function Hero({
  marketQuery,
  nowMs,
}: {
  marketQuery: ReturnType<typeof useMarkets>;
  nowMs: number;
}) {
  const age =
    marketQuery.lastUpdateMs === null ? null : Math.max(0, nowMs - marketQuery.lastUpdateMs);
  return (
    <div className="mb-5 flex flex-col justify-between gap-3 border-b border-white/6 pb-5 sm:flex-row sm:items-end">
      <div>
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
          <Radio className="size-3.5" /> DreamDEX Event Contracts
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
          Build it. Simulate it. <span className="text-primary">Prove it on-chain.</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          A deterministic automation studio where every guard, rounded unit, intent, receipt, and
          claim can remain linked to one strategy hash.
        </p>
      </div>
      <div
        className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
        aria-live="polite"
      >
        <Badge
          variant="outline"
          className={
            marketQuery.source === "dreamdex-live"
              ? "border-primary/30 text-primary"
              : "border-amber-300/25 text-amber-200"
          }
        >
          {marketQuery.source === "dreamdex-live"
            ? "Live DreamDEX"
            : marketQuery.source === "fixture"
              ? "Deterministic fixture"
              : "Connecting"}
        </Badge>
        <span className="flex items-center gap-1.5">
          <Activity
            className={`size-3.5 ${marketQuery.streamState === "live" ? "text-primary" : "text-amber-300"}`}
          />
          {marketQuery.streamState}
        </span>
        <span className="font-mono">{age === null ? "no update yet" : `${age}ms old`}</span>
      </div>
    </div>
  );
}

function MarketPanel(props: {
  markets: MarketSnapshotV1[];
  nowMs: number;
  isLoading: boolean;
  error: Error | null;
  selectedMarketId: string | null;
  chooseMarket: (market: MarketSnapshotV1) => void;
}) {
  return (
    <section aria-labelledby="markets-title" className="space-y-3">
      <div>
        <h2 id="markets-title" className="font-heading text-sm font-semibold">
          Live markets
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Current BTC/ETH 15-minute and 1-hour windows, keyed by market ID.
        </p>
      </div>
      {props.isLoading && (
        <Card>
          <CardContent className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Discovering current venue and markets…
          </CardContent>
        </Card>
      )}
      {props.error && (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Control plane disconnected</AlertTitle>
          <AlertDescription>
            No probabilities are invented while the market feed is unavailable. Start the API or
            verify its configured origin.
          </AlertDescription>
        </Alert>
      )}
      {!props.isLoading && !props.error && props.markets.length === 0 && (
        <Card>
          <CardContent className="min-h-40 py-10 text-center">
            <BookOpenCheck className="mx-auto mb-3 size-7 text-muted-foreground" />
            <p>No supported Trading markets were discovered.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              EventPilot will reconnect and follow the next rolled market ID.
            </p>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {props.markets.map((market) => (
          <MarketCard
            key={market.marketId}
            market={market}
            nowMs={props.nowMs}
            selected={props.selectedMarketId === market.marketId}
            choose={() => props.chooseMarket(market)}
          />
        ))}
      </div>
      <Alert className="border-white/7 bg-card/55">
        <ShieldCheck className="text-primary" />
        <AlertTitle>Rollover-safe discovery</AlertTitle>
        <AlertDescription>
          Pool addresses are temporary bindings. Strategy and paper state follow the current{" "}
          <span className="font-mono">marketId</span>, so old book state cannot bleed into a rolled
          market.
        </AlertDescription>
      </Alert>
    </section>
  );
}

function MarketCard({
  market,
  nowMs,
  selected,
  choose,
}: {
  market: MarketSnapshotV1;
  nowMs: number;
  selected: boolean;
  choose: () => void;
}) {
  const yesAsk = probabilityBps(market.yes.bestAskRaw, market.priceDecimals);
  const noAsk = probabilityBps(market.no.bestAskRaw, market.priceDecimals);
  const yesBid = probabilityBps(market.yes.bestBidRaw, market.priceDecimals);
  const spread = yesAsk === null || yesBid === null ? null : yesAsk - yesBid;
  const stale = nowMs - market.capturedAtMs > 15_000;
  return (
    <Card
      className={`market-card relative border bg-card/75 ${selected ? "border-primary/40 ring-1 ring-primary/20" : "border-white/7"}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl border border-white/8 bg-white/[0.04] font-mono text-sm font-bold text-primary">
            {market.asset}
          </div>
          <div>
            <CardTitle>{market.asset} direction</CardTitle>
            <CardDescription>
              {market.intervalSeconds === 900 ? "15 minute" : "1 hour"} ·{" "}
              {short(market.marketId, 10)}
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge
            variant="outline"
            className={
              market.chainStatus === "Trading"
                ? "border-emerald-400/20 text-emerald-300"
                : "border-amber-300/20 text-amber-200"
            }
          >
            {market.chainStatus}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {market.yes.bestAskRaw === null || market.no.bestAskRaw === null ? (
          <Alert>
            <AlertTriangle />
            <AlertTitle>No executable liquidity</AlertTitle>
            <AlertDescription>Top-of-book probability is unavailable.</AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-primary/15 bg-primary/[0.055] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-primary">
                YES ask
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold">{formatBps(yesAsk)}</p>
            </div>
            <div className="rounded-xl border border-white/7 bg-white/[0.025] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                NO ask
              </p>
              <p className="mt-2 font-mono text-2xl font-semibold text-white/78">
                {formatBps(noAsk)}
              </p>
            </div>
          </div>
        )}
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Spread</dt>
            <dd className="mt-1 font-mono">{formatBps(spread)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">YES depth</dt>
            <dd className="mt-1 font-mono">
              {formatRaw(market.yes.askDepthRaw, market.quantityDecimals)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Expires</dt>
            <dd className="mt-1 flex items-center gap-1 font-mono">
              <Clock3 className="size-3" />
              {countdown(market.marketExpiryMs, nowMs)}
            </dd>
          </div>
        </dl>
        {(stale || market.connection !== "live") && (
          <p className="flex items-center gap-1.5 text-xs text-amber-200">
            <AlertTriangle className="size-3.5" />
            {market.connection !== "live" ? market.connection : "Snapshot is stale"}
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-between border-white/6 bg-white/[0.018]">
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <DatabaseZap className="size-3.5" />
          block {market.sourceBlock ?? "unavailable"}
        </span>
        <Button size="sm" variant={selected ? "default" : "outline"} onClick={choose}>
          {selected ? "Selected" : "Use market"}
        </Button>
      </CardFooter>
    </Card>
  );
}

function StrategyStudio(props: {
  strategy: StrategyV1;
  setStrategy: React.Dispatch<React.SetStateAction<StrategyV1>>;
  strategyHash: string;
  decision: DecisionV1 | null;
  selectedMarket: MarketSnapshotV1 | null;
  evaluating: boolean;
  evaluationError: string | null;
  policyError: string | null;
  setEvaluationError: (message: string | null) => void;
  evaluateNow: () => Promise<void>;
  downloadStrategy: () => void;
  importRef: React.RefObject<HTMLInputElement | null>;
}) {
  const setBps = (field: "trigger" | "entry", value: string) => {
    const bps = Math.max(0, Math.min(10_000, Math.round(Number(value) * 100)));
    if (!Number.isFinite(bps)) return;
    props.setStrategy((current) =>
      field === "trigger"
        ? { ...current, trigger: { bestAskBps: { ...current.trigger.bestAskBps, valueBps: bps } } }
        : { ...current, guards: { ...current.guards, maximumEntryBps: bps } },
    );
  };
  const setOrder = (field: "quantity" | "maximumCollateral", value: string) =>
    props.setStrategy((current) => ({ ...current, order: { ...current.order, [field]: value } }));
  const setGuardInteger = (
    field:
      | "maximumAbsoluteSpreadBps"
      | "maximumRelativeSpreadPpm"
      | "minimumSecondsRemaining"
      | "maximumSnapshotAgeMs",
    value: string,
  ) =>
    props.setStrategy((current) => ({
      ...current,
      guards: { ...current.guards, [field]: Number.parseInt(value || "0", 10) },
    }));
  const setRiskInteger = (
    field: "maximumOrdersPerMarket" | "cooldownSeconds" | "maximumConsecutiveFailures",
    value: string,
  ) =>
    props.setStrategy((current) => ({
      ...current,
      risk: { ...current.risk, [field]: Number.parseInt(value || "0", 10) },
    }));
  const inputClass = "h-10 bg-black/15 font-mono";
  return (
    <aside aria-labelledby="strategy-title">
      <Card className="sticky top-24 border border-primary/16 bg-[linear-gradient(145deg,color-mix(in_oklch,var(--card)_94%,var(--primary)_6%),var(--card))]">
        <CardHeader className="border-b border-white/6 pb-4">
          <div className="flex items-center gap-2 text-primary">
            <Braces className="size-4" />
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              Strategy Studio
            </span>
          </div>
          <CardTitle id="strategy-title" className="text-lg">
            {props.strategy.selector.asset} ·{" "}
            {props.strategy.selector.intervalSeconds === 900 ? "15 minute" : "1 hour"} ·{" "}
            {props.strategy.selector.outcome}
          </CardTitle>
          <CardDescription>
            Versioned, portable policy. All protocol values are evaluated as bigint.
          </CardDescription>
          <CardAction>
            <span className="font-mono text-[11px] text-muted-foreground">v1</span>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-5 pt-1">
          <label htmlFor="strategy-name" className="space-y-2 text-xs">
            <span className="text-muted-foreground">Policy name</span>
            <Input
              id="strategy-name"
              value={props.strategy.name}
              onChange={(event) =>
                props.setStrategy((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">Market selector</legend>
            <div className="grid grid-cols-4 gap-2">
              {(["BTC", "ETH"] as const).map((asset) => (
                <Button
                  key={asset}
                  type="button"
                  size="sm"
                  variant={props.strategy.selector.asset === asset ? "default" : "outline"}
                  onClick={() =>
                    props.setStrategy((current) => ({
                      ...current,
                      selector: { ...current.selector, asset },
                    }))
                  }
                >
                  {asset}
                </Button>
              ))}
              {([900, 3600] as const).map((intervalSeconds) => (
                <Button
                  key={intervalSeconds}
                  type="button"
                  size="sm"
                  variant={
                    props.strategy.selector.intervalSeconds === intervalSeconds
                      ? "default"
                      : "outline"
                  }
                  onClick={() =>
                    props.setStrategy((current) => ({
                      ...current,
                      selector: { ...current.selector, intervalSeconds },
                    }))
                  }
                >
                  {intervalSeconds === 900 ? "15m" : "1h"}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs text-muted-foreground">Outcome and trigger</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["YES", "NO"] as const).map((outcome) => (
                <Button
                  key={outcome}
                  type="button"
                  size="sm"
                  variant={props.strategy.selector.outcome === outcome ? "default" : "outline"}
                  onClick={() =>
                    props.setStrategy((current) => ({
                      ...current,
                      selector: { ...current.selector, outcome },
                    }))
                  }
                >
                  Buy {outcome}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-[1fr_92px] gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-10 justify-start bg-black/15"
                onClick={() =>
                  props.setStrategy((current) => ({
                    ...current,
                    trigger: {
                      bestAskBps: {
                        ...current.trigger.bestAskBps,
                        operator: current.trigger.bestAskBps.operator === "lte" ? "gte" : "lte",
                      },
                    },
                  }))
                }
              >
                Best ask{" "}
                {props.strategy.trigger.bestAskBps.operator === "lte"
                  ? "at or below"
                  : "at or above"}
              </Button>
              <Input
                aria-label="Trigger threshold percent"
                className={inputClass}
                value={(props.strategy.trigger.bestAskBps.valueBps / 100).toFixed(2)}
                onChange={(event) => setBps("trigger", event.target.value)}
              />
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="maximum-entry" className="space-y-2 text-xs">
              <span className="text-muted-foreground">Maximum entry %</span>
              <Input
                id="maximum-entry"
                className={inputClass}
                value={(props.strategy.guards.maximumEntryBps / 100).toFixed(2)}
                onChange={(event) => setBps("entry", event.target.value)}
              />
            </label>
            <label htmlFor="maximum-collateral" className="space-y-2 text-xs">
              <span className="text-muted-foreground">Max collateral</span>
              <Input
                id="maximum-collateral"
                className={inputClass}
                value={props.strategy.order.maximumCollateral}
                onChange={(event) => setOrder("maximumCollateral", event.target.value)}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label htmlFor="order-quantity" className="space-y-2 text-xs">
              <span className="text-muted-foreground">Quantity</span>
              <Input
                id="order-quantity"
                className={inputClass}
                value={props.strategy.order.quantity}
                onChange={(event) => setOrder("quantity", event.target.value)}
              />
            </label>
            <label htmlFor="minimum-seconds" className="space-y-2 text-xs">
              <span className="text-muted-foreground">Minimum seconds</span>
              <Input
                id="minimum-seconds"
                className={inputClass}
                value={props.strategy.guards.minimumSecondsRemaining}
                onChange={(event) => setGuardInteger("minimumSecondsRemaining", event.target.value)}
              />
            </label>
          </div>
          <details className="rounded-xl border border-white/7 bg-black/10 p-4">
            <summary className="cursor-pointer text-xs font-medium text-white/85">
              Market guards and risk limits
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label htmlFor="maximum-spread" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Max spread bps</span>
                <Input
                  id="maximum-spread"
                  className={inputClass}
                  value={props.strategy.guards.maximumAbsoluteSpreadBps}
                  onChange={(event) =>
                    setGuardInteger("maximumAbsoluteSpreadBps", event.target.value)
                  }
                />
              </label>
              <label htmlFor="maximum-relative-spread" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Max relative spread ppm</span>
                <Input
                  id="maximum-relative-spread"
                  className={inputClass}
                  value={props.strategy.guards.maximumRelativeSpreadPpm}
                  onChange={(event) =>
                    setGuardInteger("maximumRelativeSpreadPpm", event.target.value)
                  }
                />
              </label>
              <label htmlFor="maximum-snapshot-age" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Max snapshot age ms</span>
                <Input
                  id="maximum-snapshot-age"
                  className={inputClass}
                  value={props.strategy.guards.maximumSnapshotAgeMs}
                  onChange={(event) => setGuardInteger("maximumSnapshotAgeMs", event.target.value)}
                />
              </label>
              <label htmlFor="minimum-executable" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Minimum executable quantity</span>
                <Input
                  id="minimum-executable"
                  className={inputClass}
                  value={props.strategy.guards.minimumExecutableQuantity}
                  onChange={(event) =>
                    props.setStrategy((current) => ({
                      ...current,
                      guards: {
                        ...current.guards,
                        minimumExecutableQuantity: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label htmlFor="orders-per-market" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Orders per market</span>
                <Input
                  id="orders-per-market"
                  className={inputClass}
                  value={props.strategy.risk.maximumOrdersPerMarket}
                  onChange={(event) => setRiskInteger("maximumOrdersPerMarket", event.target.value)}
                />
              </label>
              <label htmlFor="daily-collateral" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Daily collateral</span>
                <Input
                  id="daily-collateral"
                  className={inputClass}
                  value={props.strategy.risk.maximumDailyCollateral}
                  onChange={(event) =>
                    props.setStrategy((current) => ({
                      ...current,
                      risk: { ...current.risk, maximumDailyCollateral: event.target.value },
                    }))
                  }
                />
              </label>
              <label htmlFor="cooldown-seconds" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Cooldown seconds</span>
                <Input
                  id="cooldown-seconds"
                  className={inputClass}
                  value={props.strategy.risk.cooldownSeconds}
                  onChange={(event) => setRiskInteger("cooldownSeconds", event.target.value)}
                />
              </label>
              <label htmlFor="failure-stop" className="space-y-2 text-xs">
                <span className="text-muted-foreground">Failure stop</span>
                <Input
                  id="failure-stop"
                  className={inputClass}
                  value={props.strategy.risk.maximumConsecutiveFailures}
                  onChange={(event) =>
                    setRiskInteger("maximumConsecutiveFailures", event.target.value)
                  }
                />
              </label>
            </div>
          </details>
          <div className="rounded-xl border border-primary/14 bg-primary/[0.045] p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                Plain-English policy
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                {short(props.strategyHash, 10)}
              </span>
            </div>
            <p className="text-sm leading-6 text-white/84">
              Would submit an IOC to buy{" "}
              <strong>
                {props.strategy.selector.asset} {props.strategy.selector.outcome}
              </strong>{" "}
              when its best ask is{" "}
              {props.strategy.trigger.bestAskBps.operator === "lte" ? "at or below" : "at or above"}{" "}
              <strong>{(props.strategy.trigger.bestAskBps.valueBps / 100).toFixed(2)}%</strong>,
              never entering above{" "}
              <strong>{(props.strategy.guards.maximumEntryBps / 100).toFixed(2)}%</strong> or
              spending more than <strong>{props.strategy.order.maximumCollateral}</strong> test
              collateral.
            </p>
          </div>
          {props.evaluationError && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>Evaluation unavailable</AlertTitle>
              <AlertDescription>{props.evaluationError}</AlertDescription>
            </Alert>
          )}
          {props.policyError && (
            <Alert variant="destructive">
              <XCircle />
              <AlertTitle>Strategy needs attention</AlertTitle>
              <AlertDescription>{props.policyError}</AlertDescription>
            </Alert>
          )}
          {props.decision && <DecisionInspector decision={props.decision} />}
        </CardContent>
        <CardFooter className="flex-wrap gap-2 border-white/6 bg-black/10">
          <input
            ref={props.importRef}
            type="file"
            accept="application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file
                .text()
                .then((text) => {
                  props.setStrategy(importStrategy(text));
                  props.setEvaluationError(null);
                })
                .catch((error: unknown) =>
                  props.setEvaluationError(
                    error instanceof Error ? error.message : "Strategy import failed.",
                  ),
                )
                .finally(() => {
                  event.target.value = "";
                });
            }}
          />
          <Button variant="outline" size="sm" onClick={() => props.importRef.current?.click()}>
            <Upload /> Import
          </Button>
          <Button variant="outline" size="sm" onClick={props.downloadStrategy}>
            <Download /> Export
          </Button>
          <Button
            className="ml-auto"
            disabled={
              props.selectedMarket === null || props.evaluating || props.policyError !== null
            }
            onClick={() => void props.evaluateNow()}
          >
            {props.evaluating ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}Evaluate
            now
          </Button>
        </CardFooter>
      </Card>
    </aside>
  );
}

function DecisionInspector({ decision }: { decision: DecisionV1 }) {
  const passed = decision.guards.filter((guard) => guard.passed).length;
  return (
    <div
      className={`rounded-xl border p-4 ${decision.eligible ? "border-emerald-300/20 bg-emerald-300/[0.04]" : "border-amber-300/20 bg-amber-300/[0.04]"}`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {decision.eligible ? (
            <CheckCircle2 className="size-4 text-emerald-300" />
          ) : (
            <XCircle className="size-4 text-amber-200" />
          )}
          {decision.eligible ? "Eligible" : "Skipped"}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {passed}/{decision.guards.length} guards
        </span>
      </div>
      <Progress className="my-3" value={(passed * 100) / decision.guards.length} />
      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="text-muted-foreground">Native YES price</dt>
          <dd className="truncate font-mono">{decision.limitPriceRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Outcome price</dt>
          <dd className="truncate font-mono">{decision.outcomePriceRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quantity raw</dt>
          <dd className="truncate font-mono">{decision.quantityRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Max cost raw</dt>
          <dd className="truncate font-mono">{decision.maximumCostRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Price tick raw</dt>
          <dd className="truncate font-mono">{decision.priceTickRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Quantity lot raw</dt>
          <dd className="truncate font-mono">{decision.quantityLotRaw}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Source block</dt>
          <dd className="truncate font-mono">{decision.sourceBlock ?? "unavailable"}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Valid until</dt>
          <dd className="truncate font-mono">
            {new Date(decision.validUntilMs).toLocaleTimeString()}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Intent</dt>
          <dd className="truncate font-mono">{short(decision.intentKey, 7)}</dd>
        </div>
      </dl>
      {!decision.eligible && <p className="mt-3 text-xs text-amber-100">{decision.reasons[0]}</p>}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Inspect every guard
        </summary>
        <div className="mt-2 space-y-1.5">
          {decision.guards.map((guard) => (
            <div key={guard.code} className="flex gap-2 text-[11px]">
              {guard.passed ? (
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-300" />
              ) : (
                <XCircle className="mt-0.5 size-3 shrink-0 text-amber-200" />
              )}
              <span>
                <span className="font-mono text-white/80">{guard.code}</span> · {guard.explanation}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function PaperRun({
  state,
  setState,
  entries,
  clear,
  selectedMarket,
}: {
  state: PaperState;
  setState: (state: PaperState) => void;
  entries: PaperEntry[];
  clear: () => void;
  selectedMarket: MarketSnapshotV1 | null;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <History className="size-4" />
            <CardTitle>Browser-local paper run</CardTitle>
          </div>
          <CardDescription>
            Uses the shared evaluator. It never calls an admin or transaction endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-white/7 bg-black/15 p-4">
            <p className="text-xs text-muted-foreground">Session state</p>
            <p className="mt-1 flex items-center gap-2 font-mono text-lg">
              {state === "running" ? (
                <CirclePlay className="text-primary" />
              ) : state === "paused" ? (
                <CirclePause className="text-amber-200" />
              ) : (
                <Square className="text-muted-foreground" />
              )}
              {state}
            </p>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {selectedMarket
              ? `Following ${short(selectedMarket.marketId, 12)}`
              : "Select a supported market first."}
          </p>
        </CardContent>
        <CardFooter className="flex-wrap gap-2">
          <Button disabled={!selectedMarket} onClick={() => setState("running")}>
            <Play />
            Start
          </Button>
          <Button
            variant="outline"
            disabled={state !== "running"}
            onClick={() => setState("paused")}
          >
            <Pause />
            Pause
          </Button>
          <Button variant="outline" onClick={() => setState("stopped")}>
            <Square />
            Stop
          </Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Decision timeline</CardTitle>
          <CardDescription>Snapshot-time simulations, not fill claims.</CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={clear}>
              <RotateCcw />
              Clear
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-white/10 text-center text-sm text-muted-foreground">
              <div>
                <History className="mx-auto mb-3 size-7" />
                <p>No paper decisions yet.</p>
                <p className="mt-1 text-xs">
                  Start the session and wait for the next market snapshot.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => (
                <div key={entry.id} className="rounded-xl border border-white/7 bg-black/15 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className={`flex items-center gap-2 text-sm font-medium ${entry.decision.eligible ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {entry.decision.eligible ? (
                        <CheckCircle2 className="size-4" />
                      ) : (
                        <XCircle className="size-4" />
                      )}
                      {entry.message}
                    </span>
                    <time className="font-mono text-[10px] text-muted-foreground">
                      {new Date(entry.recordedAtMs).toLocaleTimeString()}
                    </time>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    {short(entry.marketId, 16)} · {short(entry.decision.intentKey, 10)} · prior
                    orders {entry.risk.ordersForMarket} · daily raw {entry.risk.dailyCollateralRaw}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DemoRunnerPanel({
  runner,
  events,
}: {
  runner: Record<string, unknown> | null;
  events: RunnerEventV1[];
}) {
  if (runner === null)
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Demo runner unavailable</AlertTitle>
        <AlertDescription>
          The public monitoring API is disconnected. No runner state is inferred.
        </AlertDescription>
      </Alert>
    );
  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="size-4" />
            <CardTitle>Guarded demo runner</CardTitle>
          </div>
          <CardDescription>
            Read-only public monitor. Only the server-side operator can arm it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-primary/15 bg-primary/[0.04] p-4">
            <p className="text-xs text-muted-foreground">Current state</p>
            <p className="mt-1 font-mono text-lg">{String(runner.state)}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Network</dt>
              <dd className="mt-1">{String(runner.network)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Chain</dt>
              <dd className="mt-1 font-mono">{String(runner.chainId)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Dry run</dt>
              <dd className="mt-1">{runner.dryRun ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Wallet</dt>
              <dd className="mt-1">
                {runner.walletConfigured ? "configured server-side" : "not configured"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Native gas balance</dt>
              <dd className="mt-1 break-all font-mono">
                {publicString(runner.nativeBalanceRaw) === null
                  ? "not checked"
                  : `${publicString(runner.nativeBalanceRaw)} raw`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Collateral balance</dt>
              <dd className="mt-1 break-all font-mono">
                {publicString(runner.collateralBalanceRaw) === null
                  ? "not checked"
                  : `${publicString(runner.collateralBalanceRaw)} raw`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reconciliation</dt>
              <dd className="mt-1">{runner.reconciliationPending ? "blocking writes" : "clear"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Strategy hash</dt>
              <dd className="mt-1 font-mono">{short(publicString(runner.strategyHash), 7)}</dd>
            </div>
          </dl>
          <Alert>
            <ShieldCheck />
            <AlertTitle>Public controls disabled</AlertTitle>
            <AlertDescription>
              The browser cannot submit a key or control the funded runner.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
      <EventList events={events} />
    </div>
  );
}

function EventList({ events }: { events: RunnerEventV1[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Runner events</CardTitle>
        <CardDescription>Cursor-backed, persisted event history.</CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="grid min-h-56 place-items-center text-center text-sm text-muted-foreground">
            <div>
              <Activity className="mx-auto mb-3 size-7" />
              <p>No persisted runner activity yet.</p>
              <p className="mt-1 text-xs">This is an honest stopped/empty state.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div key={event.id} className="rounded-xl border border-white/7 bg-black/15 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge variant="outline">{event.kind}</Badge>
                  <time className="font-mono text-[10px] text-muted-foreground">
                    #{event.sequence} · {new Date(event.occurredAtMs).toLocaleString()}
                  </time>
                </div>
                <p className="mt-3 text-sm">{event.summary}</p>
                {event.transactionHash && (
                  <a
                    className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                    href={`https://shannon-explorer.somnia.network/tx/${event.transactionHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Link2 className="size-3" />
                    View Shannon transaction
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceConsole({
  events,
  decision,
  strategyHash,
  latestEvidence,
}: {
  events: RunnerEventV1[];
  decision: DecisionV1 | null;
  strategyHash: string;
  latestEvidence: PublicEvidence | null;
}) {
  const newest = (kinds: RunnerEventV1["kind"][]) =>
    [...events].reverse().find((event) => kinds.includes(event.kind));
  const transactionEvent = newest([
    "transaction.succeeded",
    "transaction.reverted",
    "transaction.sent",
  ]);
  const receiptEvent = newest([
    "transaction.succeeded",
    "transaction.reverted",
    "claim.succeeded",
    "claim.reverted",
    "reconciliation.completed",
  ]);
  const settlementEvent = newest(["settlement.detected"]);
  const claimEvent = newest([
    "claim.succeeded",
    "claim.reverted",
    "claim.unknown",
    "claim.sent",
    "claim.scan_failed",
  ]);
  const hasVerifiedReceipt = receiptEvent !== undefined;
  const steps = [
    ["Strategy", short(strategyHash, 10), "canonical hash"],
    [
      "Snapshot",
      decision ? short(decision.marketId, 10) : "not evaluated",
      decision ? `block ${decision.sourceBlock ?? "n/a"}` : "awaiting",
    ],
    [
      "Decision",
      decision ? (decision.eligible ? "Eligible" : "Skipped") : "not evaluated",
      decision ? `${decision.guards.length} guards` : "awaiting",
    ],
    [
      "Intent",
      decision ? short(decision.intentKey, 10) : "not prepared",
      decision ? "deterministic key" : "awaiting",
    ],
    [
      "Transaction",
      transactionEvent?.transactionHash
        ? short(transactionEvent.transactionHash, 10)
        : "no verified tx",
      "never fabricated",
    ],
    [
      "Receipt",
      receiptEvent?.kind.replaceAll(".", " ") ?? "awaiting evidence",
      "explicit status required",
    ],
    ["Settlement", settlementEvent ? "Finalized detected" : "none detected", "Finalized only"],
    ["Claim", claimEvent?.kind.replaceAll(".", " ") ?? "none verified", "idempotent queue"],
  ];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="size-4" />
            <CardTitle>Evidence Console</CardTitle>
          </div>
          <CardDescription>
            Judge Mode separates current state, simulations, and explorer-verifiable history.
          </CardDescription>
          <CardAction>
            <Badge variant="outline">Public read-only</Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map(([label, value, meta], index) => (
              <div
                key={label}
                className="relative rounded-xl border border-white/7 bg-black/15 p-4"
              >
                {index < steps.length - 1 && (
                  <span className="absolute -right-2 top-1/2 hidden h-px w-2 bg-primary/30 lg:block" />
                )}
                <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </p>
                <p className="mt-2 truncate font-mono text-xs text-white/90">{value}</p>
                <p className="mt-1 text-[10px] text-primary">{meta}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {latestEvidence && (
        <Card>
          <CardHeader>
            <CardTitle>Latest persisted Shannon proof</CardTitle>
            <CardDescription>
              Original strategy, snapshot, decision, intent, and receipt—not current market data.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">event #{latestEvidence.event.sequence}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-muted-foreground">Strategy</p>
              <p className="mt-1 font-mono">{short(latestEvidence.event.strategyHash, 10)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Market snapshot</p>
              <p className="mt-1 font-mono">
                {short(latestEvidence.snapshot?.marketId ?? null, 10)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Receipt</p>
              <p className="mt-1 font-mono">
                {latestEvidence.transaction?.receiptStatus ?? latestEvidence.event.kind}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fills</p>
              <p className="mt-1 font-mono">{latestEvidence.fills.length}</p>
            </div>
            {latestEvidence.explorer && (
              <a
                className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline sm:col-span-2"
                href={latestEvidence.explorer}
                target="_blank"
                rel="noreferrer"
              >
                <Link2 className="size-3" /> Open verified Shannon receipt
              </a>
            )}
          </CardContent>
        </Card>
      )}
      {hasVerifiedReceipt ? (
        <Alert className="border-emerald-300/20 bg-emerald-300/[0.03]">
          <CheckCircle2 className="text-emerald-300" />
          <AlertTitle>Verified receipt evidence is available</AlertTitle>
          <AlertDescription>
            Open the linked persisted event to inspect its Shannon explorer record. Simulation and
            chain evidence remain labeled separately.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-300/20 bg-amber-300/[0.03]">
          <AlertTriangle className="text-amber-200" />
          <AlertTitle>
            Verified transaction evidence is still an external acceptance gate
          </AlertTitle>
          <AlertDescription>
            The repository will not display a transaction, fill, settlement, or claim until a funded
            Shannon runner produces and verifies it.
          </AlertDescription>
        </Alert>
      )}
      <EventList events={events} />
    </div>
  );
}
