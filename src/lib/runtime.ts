import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { COPY_LEADERS } from "./copy-leaders";
import { fetchCopyPack } from "./copy";
import { buildReport } from "./report";
import { applyFill, blankWallets, botScores, deskStats, ensureWallets, markToMarket, mergeQuotes, prunePumpQuotes, pruneStaleQuotes, stockMarketOpen, tickBots, tickHeldExits, todayStamp, walletEquity, walletViews } from "./engine";
import { fetchMarketSnapshot, refreshHeldAll, yahooOne } from "./quotes-core";
import type { Bot, CopyEvent, DeskSnapshot, DeskState, MarketKind, ScanScope, StrategyId } from "./types";
import { CORE_SEEDS, PUMP_FALLBACK, seedQuote } from "./universe";

const STARTING = 1_000;
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
      sizeUsd: 25,
      scope: "stock",
      maxNames: 4,
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
      sizeUsd: 20,
      scope: "stock",
      maxNames: 4,
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
      sizeUsd: 35,
      scope: "crypto",
      maxNames: 2,
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
      sizeUsd: 20,
      scope: "crypto",
      maxNames: 4,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "Holds 20 min, skips BTC/ETH at this ticket size — gas would eat the trade.",
    },
    {
      id: "bot-scan-pump",
      name: "Scan Pump.fun · sniper",
      enabled: true,
      symbol: "pump:CORA",
      kind: "pump",
      strategy: "sniper",
      sizeUsd: 12,
      scope: "pump",
      maxNames: 1,
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
      sizeUsd: 12,
      scope: "pump",
      maxNames: 1,
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
      sizeUsd: 20,
      scope: "all",
      maxNames: 5,
      lastSignal: "idle",
      lastTickAt: 0,
      lastReason: "",
    },
    ...COPY_LEADERS.map((l) => ({
      id: `copy-${l.id}`,
      name: `Copy ${l.name}`,
      enabled: false,
      symbol: l.tickers?.[0] || (l.kind === "crypto-top" ? "BTC" : "NVDA"),
      kind: (l.kind === "crypto-top" ? "crypto" : "stock") as MarketKind,
      strategy: "copy" as StrategyId,
      sizeUsd: l.kind === "public" ? 40 : l.kind === "star" ? 30 : 25,
      scope: "one" as ScanScope,
      maxNames: 4,
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
    manualLocks: {},
    wallets: blankWallets(),
    reports: [],
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
      if (!haveIds.has(b.id)) bots.push(b);
    }
    const mapped: Bot[] = bots.map((b) => ({
      ...b,
      lastReason: b.lastReason || "",
      scope: b.scope || "one",
      maxNames: b.maxNames || (b.scope && b.scope !== "one" ? 4 : 1),
      kind: b.leaderId?.startsWith("hl-") ? "crypto" : b.kind,
    }));
    const mergedQuotes = { ...base.quotes, ...(parsed.quotes || {}) };
    const fills = (parsed.fills || []).map((f) => ({
      ...f,
      reason: f.reason || f.note || "",
    }));
    const positions = Object.fromEntries(
      Object.entries(parsed.positions || {}).map(([k, p]) => [
        k,
        { ...p, openedAt: p.openedAt || Date.now() },
      ]),
    );

    // Old $100k paper book → $1,000 bank, sized like real money.
    if ((parsed.startingCash ?? 0) >= 10_000) {
      const prior: DeskState = {
        ...base,
        ...parsed,
        quotes: mergedQuotes,
        bots: mapped,
        fills,
        copyEvents: parsed.copyEvents || [],
        tests: parsed.tests || [],
        runStartedAt: parsed.runStartedAt || Date.now(),
        manualLocks: parsed.manualLocks || {},
      };
      const tests = [...(prior.tests || [])];
      if (prior.fills.length > 0) {
        const stats = deskStats(prior);
        tests.unshift({
          id: `run-bank-${Date.now()}`,
          name: "Old $100k book",
          startedAt: prior.runStartedAt || Date.now(),
          endedAt: Date.now(),
          startingCash: prior.startingCash,
          endingEquity: markToMarket(prior),
          realizedPnl: stats.realizedPnl,
          feesPaid: stats.feesPaid,
          netPnl: stats.netPnl,
          trades: prior.fills.length,
        });
      }
      const sized = new Map(base.bots.map((b) => [b.id, b]));
      return ensureWallets({
        ...base,
        quotes: mergedQuotes,
        bots: mapped.map((b) => {
          const fresh = sized.get(b.id);
          if (fresh) return { ...b, sizeUsd: fresh.sizeUsd, maxNames: fresh.maxNames };
          return { ...b, sizeUsd: Math.min(b.sizeUsd, 25) };
        }),
        copyEvents: (parsed.copyEvents || []).map((e) => ({ ...e, consumed: false })),
        copyFetchedAt: parsed.copyFetchedAt || 0,
        tests: tests.slice(0, 40),
        selectedId: parsed.selectedId || "NVDA",
        liveQuotes: parsed.liveQuotes || false,
      });
    }

    return ensureWallets({
      ...base,
      ...parsed,
      quotes: mergedQuotes,
      bots: mapped,
      copyEvents: parsed.copyEvents || [],
      tests: parsed.tests || [],
      runStartedAt: parsed.runStartedAt || Date.now(),
      manualLocks: parsed.manualLocks || {},
      fills,
      positions,
      reports: parsed.reports || [],
    });
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

type G = typeof globalThis & {
  __coraDesk?: DeskState;
  __coraLoop?: ReturnType<typeof setInterval>;
  __coraPumpLoop?: ReturnType<typeof setInterval>;
};

function g(): G {
  return globalThis as G;
}

function fitBotsToBank(state: DeskState): DeskState {
  const fresh = new Map(defaultBots().map((b) => [b.id, b]));
  let changed = false;
  const bots = state.bots.map((b) => {
    const f = fresh.get(b.id);
    if (f && (b.scope === "pump" || b.id === "bot-scan-crypto") && b.sizeUsd < f.sizeUsd) {
      changed = true;
      return { ...b, sizeUsd: f.sizeUsd, maxNames: f.maxNames };
    }
    if (f && (b.sizeUsd > f.sizeUsd || b.maxNames > f.maxNames)) {
      changed = true;
      return { ...b, sizeUsd: f.sizeUsd, maxNames: f.maxNames };
    }
    if (b.id === "bot-scan-pump" && !b.enabled && !b.lastTickAt) {
      changed = true;
      return { ...b, enabled: true, lastReason: "Scanning live Pump.fun coins (hottest + newest)." };
    }
    if (!f && b.sizeUsd > 50) {
      changed = true;
      return { ...b, sizeUsd: 25 };
    }
    return b;
  });
  return changed ? { ...state, bots } : state;
}

function ensureCopyLeaders(state: DeskState): DeskState {
  const extras = defaultBots().filter((d) => d.strategy === "copy");
  const next = [...state.bots];
  let added = false;
  for (const d of extras) {
    if (next.some((b) => b.id === d.id || (d.leaderId && b.leaderId === d.leaderId))) continue;
    next.push(d);
    added = true;
  }
  return added ? { ...state, bots: next } : state;
}

export function getState(): DeskState {
  let cur = g().__coraDesk;
  if (cur && cur.startingCash >= 10_000) cur = undefined;
  if (!cur) {
    cur = ensureCopyLeaders(ensureWallets(fitBotsToBank(load())));
    g().__coraDesk = cur;
    save(cur);
    return cur;
  }
  cur = ensureCopyLeaders(ensureWallets(cur));
  const fitted = fitBotsToBank(cur);
  if (fitted !== cur) {
    g().__coraDesk = fitted;
    save(fitted);
    return fitted;
  }
  g().__coraDesk = cur;
  return cur;
}

function setState(next: DeskState) {
  g().__coraDesk = next;
  save(next);
}

export function snapshot(): DeskSnapshot {
  const s = ensureWallets(getState());
  return {
    ...s,
    stats: deskStats(s),
    equityNow: markToMarket(s),
    scores: botScores(s),
    lastFill: s.fills[0] ?? null,
    stockMarketOpen: stockMarketOpen(),
    walletViews: walletViews(s),
  };
}

async function ensureQuote(symbol: string): Promise<void> {
  const s = getState();
  if (s.quotes[symbol]) return;
  let q = await yahooOne(symbol);
  if (!q) q = await yahooOne(`${symbol}-USD`);
  if (!q) return;
  const kind: MarketKind =
    q.id.endsWith("-USD") || symbol.endsWith("-USD") || q.kind === "crypto" ? "crypto" : q.kind;
  const stored = { ...q, id: symbol, symbol, kind };
  setState({ ...getState(), quotes: { ...getState().quotes, [symbol]: stored } });
}

async function refreshCopy(force = false) {
  const s = getState();
  const unnamedWhales = s.bots.some((b) => b.id.startsWith("copy-hl-") && /whale #/.test(b.name));
  if (!force && !unnamedWhales && Date.now() - s.copyFetchedAt < 10 * 60 * 1000) return;
  try {
    const pack = await fetchCopyPack();
    const fresh = pack.events;
    const prev = new Map(s.copyEvents.map((e) => [e.id, e]));
    const merged: CopyEvent[] = fresh.map((e) => {
      const old = prev.get(e.id);
      return old ? { ...e, consumed: old.consumed } : e;
    });
    // If a Hyperliquid whale exits a long we previously copied, emit a sell.
    if (pack.whales.length) {
      const liveLongs = new Map<string, Set<string>>();
      for (const e of fresh) {
        if (!e.leaderId.startsWith("hl-") || e.side !== "buy") continue;
        if (!liveLongs.has(e.leaderId)) liveLongs.set(e.leaderId, new Set());
        liveLongs.get(e.leaderId)!.add(e.ticker);
      }
      const stamp = todayStamp();
      for (const whale of pack.whales) {
        if (!whale.bookOk) continue;
        const live = liveLongs.get(whale.id) ?? new Set<string>();
        const prevTickers = new Set(
          s.copyEvents.filter((e) => e.leaderId === whale.id && e.side === "buy").map((e) => e.ticker),
        );
        for (const ticker of prevTickers) {
          if (live.has(ticker)) continue;
          const id = `${whale.id}-${ticker}-flat-${stamp}`;
          if (merged.some((e) => e.id === id)) continue;
          merged.push({
            id,
            leaderId: whale.id,
            leaderName: whale.name,
            ticker,
            side: "sell",
            tradeDate: stamp,
            disclosureDate: stamp,
            amount: "wallet no longer long",
            delayDays: 0,
            consumed: prev.get(id)?.consumed ?? false,
            note: "Wallet closed this long. Paper copy exits too.",
          });
        }
      }
    }
    for (const e of merged) {
      if (!getState().quotes[e.ticker]) await ensureQuote(e.ticker);
    }
    // Keep last-known longs when a whale book could not be read this pass.
    for (const whale of pack.whales) {
      if (whale.bookOk) continue;
      for (const e of s.copyEvents.filter((ev) => ev.leaderId === whale.id)) {
        if (!merged.some((m) => m.id === e.id)) merged.push(e);
      }
    }
    // Public-figure synthetic holds: keep a buy signal for their flagship ticker.
    for (const leader of COPY_LEADERS) {
      if ((leader.kind !== "public" && leader.kind !== "star") || !leader.tickers?.length) continue;
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
    let bots = getState().bots;
    if (pack.whales.length) {
      bots = bots.map((b) => {
        const w = pack.whales.find((x) => b.id === `copy-${x.id}`);
        if (!w) return b;
        return { ...b, name: `Copy ${w.name}`, lastReason: w.detail };
      });
    }
    setState({
      ...getState(),
      bots,
      copyEvents: merged,
      copyFetchedAt: Date.now(),
    });
  } catch (err) {
    console.error("[cora] copy feed failed", err);
    setState({ ...getState(), copyFetchedAt: Date.now() });
  }
}

export async function tickOnce(): Promise<DeskSnapshot> {
  let s = getState();
  try {
    const snap = await fetchMarketSnapshot();
    const heldList = Object.values(s.positions).map((p) => ({ id: p.symbol, kind: p.kind }));
    const held = new Set(heldList.map((h) => h.id));
    const heldLive = await refreshHeldAll(heldList).catch(() => []);
    const incoming = [...snap.quotes, ...heldLive];
    s = {
      ...s,
      quotes: pruneStaleQuotes(
        prunePumpQuotes(mergeQuotes(s.quotes, incoming), snap.quotes, held),
        snap.quotes,
        held,
        "crypto",
        20 * 60 * 1000,
      ),
      liveQuotes: snap.live,
    };
    const stamp = todayStamp();
    if (stamp !== s.dayStamp) {
      const e = ensureWallets(s);
      s = {
        ...e,
        dayStamp: stamp,
        dayStartEquity: markToMarket(e),
        halted: false,
        haltReason: "",
        wallets: {
          core: {
            ...e.wallets.core,
            dayStartEquity: walletEquity(e, "core"),
            halted: false,
            haltReason: "",
          },
          pump: {
            ...e.wallets.pump,
            dayStartEquity: walletEquity(e, "pump"),
            halted: false,
            haltReason: "",
          },
        },
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

export async function tickHeldExitsLoop(): Promise<void> {
  const s = getState();
  const held = Object.values(s.positions).map((p) => ({ id: p.symbol, kind: p.kind }));
  if (!held.length) return;
  try {
    const fresh = await refreshHeldAll(held);
    let next = { ...s, quotes: mergeQuotes(s.quotes, fresh) };
    next = tickHeldExits(next);
    next = { ...next, loopAt: Date.now(), loopOk: true };
    setState(next);
  } catch (err) {
    console.error("[cora] hold-exit tick failed", err);
  }
}

export function startDeskLoop() {
  if (g().__coraLoop) return;
  console.info("[cora] server desk loop on — bots run with the page closed");
  setTimeout(() => {
    void tickOnce();
  }, 1200);
  g().__coraLoop = setInterval(() => {
    void tickOnce();
  }, TICK_MS);
  g().__coraPumpLoop = setInterval(() => {
    void tickHeldExitsLoop();
  }, 10_000);
}

export function placeOrder(side: "buy" | "sell", symbol: string, notional: number, close = false) {
  const s = getState();
  const q = s.quotes[symbol];
  if (!q) return snapshot();
  const pos = s.positions[q.id];
  let size = Math.max(0, notional);
  let reason =
    side === "buy"
      ? "You bought this yourself — did not wait for a bot."
      : "You sold this yourself — did not wait for a bot.";
  if (side === "sell") {
    if (!pos || pos.qty <= 0) return snapshot();
    if (close) {
      size = pos.qty * q.price * 1.1;
      reason =
        "You closed this yourself. Bots skip this name for 30 minutes so they do not buy it back.";
    }
  }
  if (size < 1 && !close) return snapshot();
  const next = applyFill(
    s,
    side,
    q.id,
    q.kind,
    size,
    "manual",
    undefined,
    reason,
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
    sizeUsd: Math.max(5, Math.min(input.sizeUsd || 25, 100)),
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
    bots: s.bots.map((b) => (b.id === id ? { ...b, sizeUsd: Math.max(10, sizeUsd) } : b)),
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
  const s = ensureWallets(getState());
  setState({
    ...s,
    halted: false,
    haltReason: "",
    wallets: {
      core: { ...s.wallets.core, halted: false, haltReason: "" },
      pump: { ...s.wallets.pump, halted: false, haltReason: "" },
    },
  });
  return snapshot();
}

export function saveReport() {
  const s = ensureWallets(getState());
  const report = buildReport(s);
  setState({ ...s, reports: [report, ...(s.reports || [])].slice(0, 20) });
  return snapshot();
}

export function selectSymbol(id: string) {
  setState({ ...getState(), selectedId: id });
  return snapshot();
}
