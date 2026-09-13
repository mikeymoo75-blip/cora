import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COPY_LEADERS } from "./copy-leaders";
import { fetchCopyEvents } from "./copy";
import { applyFill, botScores, deskStats, markToMarket, mergeQuotes, stockMarketOpen, tickBots, todayStamp } from "./engine";
import { fetchMarketSnapshot, yahooOne } from "./quotes-core";
import type { Bot, CopyEvent, DeskSnapshot, DeskState, MarketKind, ScanScope, StrategyId } from "./types";
import { CORE_SEEDS, PUMP_FALLBACK, seedQuote } from "./universe";

const STARTING = 100_000;
const TICK_MS = 15_000;

function dataFile(): string {
  const dir = process.env.CORA_DATA_DIR || join("/tmp", "cora-data");
  return join(dir, "desk.json");
}

function defaultBots(): Bot[] {
  return [
    {
      id: "bot-scan-stock-trend",
      name: "Scan stocks · trend",
      enabled: false,
      symbol: "SPY",
      kind: "stock",
      strategy: "sma",
      sizeUsd: 4000,
      scope: "stock",
      maxNames: 5,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-stock-dip",
      name: "Scan stocks · dips",
      enabled: false,
      symbol: "SPY",
      kind: "stock",
      strategy: "dca",
      sizeUsd: 3000,
      scope: "stock",
      maxNames: 5,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-crypto",
      name: "Scan crypto · momentum",
      enabled: false,
      symbol: "BTC",
      kind: "crypto",
      strategy: "momentum",
      sizeUsd: 3500,
      scope: "crypto",
      maxNames: 4,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-crypto-dip",
      name: "Scan crypto · dips",
      enabled: false,
      symbol: "ETH",
      kind: "crypto",
      strategy: "meanrev",
      sizeUsd: 2500,
      scope: "crypto",
      maxNames: 4,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-pump",
      name: "Scan Pump.fun · sniper",
      enabled: false,
      symbol: "pump:CORA",
      kind: "pump",
      strategy: "sniper",
      sizeUsd: 500,
      scope: "pump",
      maxNames: 3,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-pump-scalp",
      name: "Scan Pump.fun · scalp",
      enabled: false,
      symbol: "pump:CORA",
      kind: "pump",
      strategy: "scalp",
      sizeUsd: 400,
      scope: "pump",
      maxNames: 3,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    {
      id: "bot-scan-all",
      name: "Scan everything",
      enabled: false,
      symbol: "SPY",
      kind: "stock",
      strategy: "momentum",
      sizeUsd: 2000,
      scope: "all",
      maxNames: 6,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    ...COPY_LEADERS.map((l) => ({
      id: `copy-${l.id}`,
      name: `Copy ${l.name}`,
      enabled: false,
      symbol: l.tickers?.[0] || "NVDA",
      kind: "stock" as MarketKind,
      strategy: "copy" as StrategyId,
      sizeUsd: l.kind === "public" ? 8000 : 4000,
      scope: "one" as ScanScope,
      maxNames: 8,
      leaderId: l.id,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    })),
  ];
}

function seedQuotes(): Record<string, import("./types").Quote> {
  const out: Record<string, import("./types").Quote> = {};
  for (const s of [...CORE_SEEDS, ...PUMP_FALLBACK]) out[s.id] = seedQuote(s);
  return out;
}

function blank(): DeskState {
  return {
    cash: STARTING,
    startingCash: STARTING,
    dayStartEquity: STARTING,
    dayStamp: todayStamp(),
    maxDailyLossPct: 8,
    halted: false,
    haltReason: "",
    quotes: seedQuotes(),
    positions: {},
    fills: [],
    bots: defaultBots(),
    copyEvents: [],
    copyFetchedAt: 0,
    equity: [{ t: Date.now(), v: STARTING }],
    selectedId: "NVDA",
    liveQuotes: false,
    loopAt: 0,
    loopOk: false,
    tests: [],
    runStartedAt: Date.now(),
  };
}

function load(): DeskState {
  try {
    const raw = readFileSync(dataFile(), "utf8");
    const parsed = JSON.parse(raw) as DeskState;
    const base = blank();
    let bots = parsed.bots?.length ? parsed.bots : base.bots;
    const haveCopy = bots.some((b) => b.strategy === "copy");
    if (!haveCopy) bots = [...bots, ...base.bots.filter((b) => b.strategy === "copy")];
    const haveScan = bots.some((b) => b.scope && b.scope !== "one" && b.strategy !== "copy");
    if (!haveScan) {
      const stale = new Set([
        "bot-nvda",
        "bot-spy",
        "bot-btc",
        "bot-sol",
        "bot-pump",
      ]);
      bots = [
        ...base.bots.filter((b) => b.strategy !== "copy"),
        ...bots.filter((b) => b.strategy === "copy" || !stale.has(b.id)),
      ];
    }
    const haveIds = new Set(bots.map((b) => b.id));
    for (const b of base.bots) {
      if (b.strategy === "copy") continue;
      if (!haveIds.has(b.id)) bots.push(b);
    }
    return {
      ...base,
      ...parsed,
      quotes: { ...base.quotes, ...(parsed.quotes || {}) },
      bots: bots.map((b) => ({
        ...b,
        lastReason: b.lastReason || "",
        scope: b.scope || "one",
        maxNames: b.maxNames || (b.scope && b.scope !== "one" ? 4 : 1),
      })),
      copyEvents: parsed.copyEvents || [],
      tests: parsed.tests || [],
      runStartedAt: parsed.runStartedAt || Date.now(),
      fills: (parsed.fills || []).map((f) => ({
        ...f,
        reason: f.reason || f.note || "",
      })),
    };
  } catch {
    return blank();
  }
}

function save(state: DeskState) {
  const file = dataFile();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const slim: DeskState = {
    ...state,
    quotes: Object.fromEntries(
      Object.values(state.quotes).map((q) => [q.id, { ...q, spark: q.spark.slice(-48) }]),
    ),
    fills: state.fills.slice(0, 400),
    equity: state.equity.slice(-480),
    copyEvents: state.copyEvents.slice(0, 80),
  };
  writeFileSync(tmp, JSON.stringify(slim));
  renameSync(tmp, file);
}

type G = typeof globalThis & { __coraDesk?: DeskState; __coraLoop?: ReturnType<typeof setInterval> };

function g(): G {
  return globalThis as G;
}

export function getState(): DeskState {
  g().__coraDesk ??= load();
  return g().__coraDesk!;
}

function setState(next: DeskState) {
  g().__coraDesk = next;
  save(next);
}

export function snapshot(): DeskSnapshot {
  const s = getState();
  return {
    ...s,
    stats: deskStats(s),
    equityNow: markToMarket(s),
    scores: botScores(s),
    lastFill: s.fills[0] ?? null,
    stockMarketOpen: stockMarketOpen(),
  };
}

async function ensureQuote(symbol: string): Promise<void> {
  const s = getState();
  if (s.quotes[symbol]) return;
  const q = await yahooOne(symbol);
  if (!q) return;
  setState({ ...getState(), quotes: { ...getState().quotes, [q.id]: q } });
}

async function refreshCopy(force = false) {
  const s = getState();
  if (!force && Date.now() - s.copyFetchedAt < 10 * 60 * 1000) return;
  try {
    const fresh = await fetchCopyEvents();
    const prev = new Map(s.copyEvents.map((e) => [e.id, e]));
    const merged: CopyEvent[] = fresh.map((e) => {
      const old = prev.get(e.id);
      return old ? { ...e, consumed: old.consumed } : e;
    });
    for (const e of merged) {
      if (!getState().quotes[e.ticker]) await ensureQuote(e.ticker);
    }
    // Public-figure synthetic holds: keep a buy signal for their flagship ticker.
    for (const leader of COPY_LEADERS) {
      if (leader.kind !== "public" || !leader.tickers?.length) continue;
      for (const ticker of leader.tickers) {
        const id = `public-${leader.id}-${ticker}`;
        if (merged.some((e) => e.id === id)) continue;
        merged.unshift({
          id,
          leaderId: leader.id,
          leaderName: leader.name,
          ticker,
          side: "buy",
          tradeDate: todayStamp(),
          disclosureDate: todayStamp(),
          amount: "public holding",
          delayDays: 0,
          consumed: prev.get(id)?.consumed ?? false,
          note: leader.blurb,
        });
      }
    }
    setState({ ...getState(), copyEvents: merged, copyFetchedAt: Date.now() });
  } catch (err) {
    console.error("[cora] copy feed failed", err);
    setState({ ...getState(), copyFetchedAt: Date.now() });
  }
}

export async function tickOnce(): Promise<DeskSnapshot> {
  let s = getState();
  try {
    const snap = await fetchMarketSnapshot();
    s = {
      ...s,
      quotes: mergeQuotes(s.quotes, snap.quotes),
      liveQuotes: snap.live,
    };
    const stamp = todayStamp();
    if (stamp !== s.dayStamp) {
      s = {
        ...s,
        dayStamp: stamp,
        dayStartEquity: markToMarket(s),
        halted: false,
        haltReason: "",
      };
    }
    setState(s);
    await refreshCopy();
    s = tickBots(getState());
    s = { ...s, loopAt: Date.now(), loopOk: true };
    setState(s);
  } catch (err) {
    console.error("[cora] tick failed", err);
    setState({ ...getState(), loopAt: Date.now(), loopOk: false });
  }
  return snapshot();
}

export function startDeskLoop() {
  if (g().__coraLoop) return;
  console.info("[cora] server desk loop on — bots run with the page closed");
  void tickOnce();
  g().__coraLoop = setInterval(() => {
    void tickOnce();
  }, TICK_MS);
}

export function placeOrder(side: "buy" | "sell", symbol: string, notional: number) {
  const s = getState();
  const q = s.quotes[symbol];
  if (!q) return snapshot();
  const next = applyFill(
    s,
    side,
    q.id,
    q.kind,
    notional,
    "manual",
    undefined,
    "You placed this trade.",
  );
  setState({
    ...next,
    equity: [...next.equity, { t: Date.now(), v: markToMarket(next) }].slice(-480),
  });
  return snapshot();
}

export function toggleBot(id: string) {
  const s = getState();
  setState({
    ...s,
    bots: s.bots.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)),
  });
  return snapshot();
}

export function addBot(input: {
  name: string;
  symbol: string;
  strategy: StrategyId;
  sizeUsd: number;
  scope?: ScanScope;
  maxNames?: number;
}) {
  const s = getState();
  const scope: ScanScope = input.scope || "one";
  const q = s.quotes[input.symbol] || Object.values(s.quotes)[0];
  if (!q) return snapshot();
  const bot: Bot = {
    id: `bot-${Date.now()}`,
    name: input.name,
    enabled: false,
    symbol: q.id,
    kind: q.kind,
    strategy: input.strategy,
    sizeUsd: input.sizeUsd,
    scope,
    maxNames: input.maxNames || (scope === "one" ? 1 : 4),
    lastSignal: "idle",
    lastTickAt: 0,
    lastReason: "",
  };
  setState({ ...s, bots: [...s.bots, bot] });
  return snapshot();
}

export function removeBot(id: string) {
  const s = getState();
  setState({ ...s, bots: s.bots.filter((b) => b.id !== id) });
  return snapshot();
}

export function setBotSize(id: string, sizeUsd: number) {
  const s = getState();
  setState({
    ...s,
    bots: s.bots.map((b) => (b.id === id ? { ...b, sizeUsd } : b)),
  });
  return snapshot();
}

export function resetBook(name?: string) {
  const s = getState();
  const ended = markToMarket(s);
  const stats = deskStats(s);
  const tests = [...(s.tests || [])];
  if (s.fills.length > 0) {
    tests.unshift({
      id: `run-${Date.now()}`,
      name: (name || "").trim() || `Test ${tests.length + 1}`,
      startedAt: s.runStartedAt || Date.now(),
      endedAt: Date.now(),
      startingCash: s.startingCash,
      endingEquity: ended,
      realizedPnl: stats.realizedPnl,
      feesPaid: stats.feesPaid,
      netPnl: stats.netPnl,
      trades: s.fills.length,
    });
  }
  const next = blank();
  next.quotes = s.quotes;
  next.liveQuotes = s.liveQuotes;
  next.bots = s.bots.map((b) => ({
    ...b,
    lastSignal: b.enabled ? "idle" : b.lastSignal,
    lastTickAt: 0,
    lastReason: b.enabled ? "New test — waiting for the next signal." : b.lastReason,
  }));
  next.copyEvents = s.copyEvents.map((e) => ({ ...e, consumed: false }));
  next.copyFetchedAt = s.copyFetchedAt;
  next.selectedId = s.selectedId;
  next.tests = tests.slice(0, 40);
  next.runStartedAt = Date.now();
  setState(next);
  return snapshot();
}

export async function addSymbol(raw: string) {
  const cleaned = raw.trim().toUpperCase().replace(/^\$/, "");
  if (!cleaned) return snapshot();
  const existing = getState().quotes[cleaned] || getState().quotes[`pump:${cleaned}`];
  if (existing) {
    setState({ ...getState(), selectedId: existing.id });
    return snapshot();
  }
  let q = await yahooOne(cleaned);
  if (!q) q = await yahooOne(`${cleaned}-USD`);
  if (!q) return snapshot();
  const s = getState();
  setState({
    ...s,
    quotes: { ...s.quotes, [q.id]: q },
    selectedId: q.id,
  });
  return snapshot();
}

export function resumeHalt() {
  setState({ ...getState(), halted: false, haltReason: "" });
  return snapshot();
}

export function selectSymbol(id: string) {
  setState({ ...getState(), selectedId: id });
  return snapshot();
}
