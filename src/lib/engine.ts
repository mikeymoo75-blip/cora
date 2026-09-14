import { calcFees, feeWouldEat } from "./fees";
import { slipBps } from "./universe";
import type {
  Bot,
  BotScore,
  DeskState,
  DeskStats,
  Fill,
  MarketKind,
  Position,
  Quote,
  ScanNote,
  StrategyId,
  Wallet,
  WalletId,
  WalletView,
} from "./types";

export const CORE_START = 800;
export const PUMP_START = 200;

export function walletIdFor(kind: MarketKind): WalletId {
  return kind === "pump" ? "pump" : "core";
}

export function blankWallets(): Record<WalletId, Wallet> {
  return {
    core: {
      cash: CORE_START,
      startingCash: CORE_START,
      dayStartEquity: CORE_START,
      halted: false,
      haltReason: "",
    },
    pump: {
      cash: PUMP_START,
      startingCash: PUMP_START,
      dayStartEquity: PUMP_START,
      halted: false,
      haltReason: "",
    },
  };
}

export function ensureWallets(state: DeskState): DeskState {
  if (state.wallets?.core && state.wallets?.pump) {
    const cash = state.wallets.core.cash + state.wallets.pump.cash;
    let wallets = state.wallets;
    for (const id of ["core", "pump"] as WalletId[]) {
      const eq = walletEquity({ ...state, wallets }, id);
      const w = wallets[id];
      if (Math.abs(w.dayStartEquity - w.cash) < 1 && Math.abs(eq - w.cash) > 5) {
        wallets = { ...wallets, [id]: { ...w, dayStartEquity: eq } };
      }
    }
    const pump = wallets.pump;
    const holdingPump = Object.values(state.positions || {}).some((p) => p.kind === "pump");
    if (pump.halted && (pump.cash >= 5 || holdingPump)) {
      wallets = { ...wallets, pump: { ...pump, halted: false, haltReason: "" } };
    }
    return { ...state, cash, wallets, reports: state.reports || [], scanTape: state.scanTape || [] };
  }
  const cash = Number.isFinite(state.cash) ? state.cash : CORE_START + PUMP_START;
  const coreCash = Math.round(cash * 0.8 * 100) / 100;
  const pumpCash = Math.round((cash - coreCash) * 100) / 100;
  const wallets: Record<WalletId, Wallet> = {
    core: {
      cash: coreCash,
      startingCash: CORE_START,
      dayStartEquity: coreCash,
      halted: false,
      haltReason: "",
    },
    pump: {
      cash: pumpCash,
      startingCash: PUMP_START,
      dayStartEquity: pumpCash,
      halted: false,
      haltReason: "",
    },
  };
  const built = { ...state, wallets, cash, reports: state.reports || [] };
  return {
    ...built,
    wallets: {
      core: { ...wallets.core, dayStartEquity: walletEquity(built, "core") },
      pump: { ...wallets.pump, dayStartEquity: walletEquity(built, "pump") },
    },
  };
}

export function walletEquity(state: DeskState, id: WalletId): number {
  const cash = state.wallets?.[id]?.cash ?? 0;
  let eq = cash;
  for (const p of Object.values(state.positions || {})) {
    if (walletIdFor(p.kind) !== id) continue;
    const q = state.quotes[p.symbol];
    if (!q) continue;
    eq += p.qty * q.price;
  }
  return eq;
}

export function markToMarket(
  state: Pick<DeskState, "cash" | "positions" | "quotes"> & Partial<Pick<DeskState, "wallets">>,
): number {
  const s = ensureWallets(state as DeskState);
  return walletEquity(s, "core") + walletEquity(s, "pump");
}

export function walletViews(state: DeskState): WalletView[] {
  const s = ensureWallets(state);
  return (["core", "pump"] as WalletId[]).map((id) => {
    const w = s.wallets[id];
    const fills = s.fills.filter((f) => walletIdFor(f.kind) === id);
    const realizedPnl = fills.reduce((n, f) => n + (f.realizedPnl || 0), 0);
    const feesPaid = fills.reduce((n, f) => n + f.fee, 0);
    let unrealizedPnl = 0;
    for (const p of Object.values(s.positions)) {
      if (walletIdFor(p.kind) !== id) continue;
      const q = s.quotes[p.symbol];
      if (!q) continue;
      unrealizedPnl += (q.price - p.avg) * p.qty;
    }
    const equity = walletEquity(s, id);
    return {
      id,
      label: id === "core" ? "Stocks + crypto" : "Pump.fun",
      cash: w.cash,
      equity,
      startingCash: w.startingCash,
      dayPnl: equity - w.dayStartEquity,
      realizedPnl,
      unrealizedPnl,
      netPnl: realizedPnl + unrealizedPnl,
      feesPaid,
      halted: w.halted,
      haltReason: w.haltReason,
    };
  });
}

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function deskStats(state: DeskState): DeskStats {
  const realizedPnl = state.fills.reduce((s, f) => s + (f.realizedPnl || 0), 0);
  const feesPaid = state.fills.reduce((s, f) => s + f.fee, 0);
  let unrealizedPnl = 0;
  for (const p of Object.values(state.positions)) {
    const q = state.quotes[p.symbol];
    if (!q) continue;
    unrealizedPnl += (q.price - p.avg) * p.qty;
  }
  const sells = state.fills.filter((f) => f.side === "sell");
  const winCount = sells.filter((f) => f.realizedPnl > 0).length;
  const lossCount = sells.filter((f) => f.realizedPnl <= 0).length;
  return {
    realizedPnl,
    unrealizedPnl,
    feesPaid,
    netPnl: realizedPnl + unrealizedPnl,
    winCount,
    lossCount,
  };
}

/** Regular NYSE hours, weekdays 9:30–16:00 America/New_York. */
export function stockMarketOpen(at = Date.now()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  const mins = hour * 60 + minute;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

export function whySignal(strategy: StrategyId, side: "buy" | "sell"): string {
  const map: Record<StrategyId, { buy: string; sell: string }> = {
    sma: {
      buy: "The short-term average moved above the longer-term average, so the trend looks like it is turning up.",
      sell: "The short-term average dropped back under the longer-term average, so the uptrend looks done.",
    },
    meanrev: {
      buy: "Price is stretched well below its recent range, so the bot is buying a dip — and will hold at least 20 minutes.",
      sell: "The dip either bounced enough to cover fees, hit a 5% stop, or sat long enough to give up.",
    },
    momentum: {
      buy: "Price is up 5–18% on the day, still ticking higher, and liquid enough that fees will not eat the ticket.",
      sell: "Hard −10% stop, trailing stop after +4%, or the ROI table (10% now, 5% after 40 min, flat after 3 hours).",
    },
    dca: {
      buy: "Price is sitting below its recent average, so the bot is buying a fixed dollar dip.",
      sell: "The position is up about 6% from cost, so the bot is cashing in.",
    },
    sniper: {
      buy: "Pump.fun sniper: Dex-priced, liquid, 2 minutes of tape, not parabolic. Holds 2 minutes so a fake print cannot dump you.",
      sell: "Pump.fun sniper exit: ROI table, trailing stop after +6%, hard −8%, 12 minutes, or a dead feed.",
    },
    scalp: {
      buy: "Pump.fun scalp: a short pop. This bot wants a quick hit, not a hold.",
      sell: "Pump.fun scalp exit: took the pop, a small drop hit, 12 minutes passed, or the tape went dark. Out before a rug.",
    },
    copy: {
      buy: "The person this bot follows showed a public buy or a live long.",
      sell: "The person this bot follows showed a public sale or closed the long.",
    },
  };
  return map[strategy][side];
}

export function applyFill(
  state: DeskState,
  side: "buy" | "sell",
  symbol: string,
  kind: MarketKind,
  notional: number,
  source: Fill["source"],
  botName?: string,
  reason?: string,
  leaderName?: string,
  botId?: string,
): DeskState {
  const quote = state.quotes[symbol];
  if (!quote || quote.price <= 0) return state;
  const s0 = ensureWallets(state);
  const wid = walletIdFor(kind);
  const book = s0.wallets[wid];

  const slip = slipBps(kind) / 10_000;
  const px = side === "buy" ? quote.price * (1 + slip) : quote.price * (1 - slip);
  let qty = notional / px;
  const pos = s0.positions[symbol];

  if (side === "sell") {
    if (!pos || pos.qty <= 0) return s0;
    qty = Math.min(qty, pos.qty);
  } else {
    const maxNotional = book.cash * 0.98;
    if (notional > maxNotional) qty = maxNotional / px;
    if (qty * px < 1) return s0;
  }

  const gross = qty * px;
  const fees = calcFees(kind, side, quote.symbol, qty, gross);

  if (side === "buy" && book.cash < gross + fees.total) return s0;

  let realizedPnl = 0;
  const positions = { ...s0.positions };
  let cash = book.cash;
  const manualLocks = { ...(s0.manualLocks || {}) };

  if (side === "buy") {
    cash -= gross + fees.total;
    const prev = positions[symbol];
    const cost = gross + fees.total;
    if (!prev) {
      positions[symbol] = { symbol, kind, qty, avg: cost / qty, peak: quote.price, openedAt: Date.now() };
    } else {
      const newQty = prev.qty + qty;
      const avg = (prev.avg * prev.qty + cost) / newQty;
      positions[symbol] = {
        ...prev,
        qty: newQty,
        avg,
        peak: Math.max(prev.peak, quote.price),
        openedAt: prev.openedAt || Date.now(),
      };
    }
    if (source === "manual") delete manualLocks[symbol];
  } else {
    const prev = positions[symbol]!;
    const proceeds = gross - fees.total;
    cash += proceeds;
    realizedPnl = proceeds - prev.avg * qty;
    const left = prev.qty - qty;
    if (left <= 1e-12) {
      delete positions[symbol];
      if (source === "manual") manualLocks[symbol] = Date.now() + 30 * 60 * 1000;
    } else positions[symbol] = { ...prev, qty: left };
  }

  const fill: Fill = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    side,
    symbol,
    kind,
    qty,
    price: px,
    notional: gross,
    venueFee: fees.venue,
    regulatoryFee: fees.regulatory,
    gasFee: fees.gas,
    fee: fees.total,
    realizedPnl,
    source,
    botId,
    botName,
    leaderName,
    reason:
      reason ||
      (source === "manual" ? "You placed this trade." : fees.note),
    note: fees.note,
  };

  const wallets = {
    ...s0.wallets,
    [wid]: { ...book, cash },
  };
  const other: WalletId = wid === "core" ? "pump" : "core";
  return {
    ...s0,
    cash: cash + wallets[other].cash,
    wallets,
    positions,
    manualLocks,
    fills: [fill, ...s0.fills].slice(0, 400),
  };
}

function ticksFalling(spark: number[], n: number): boolean {
  if (spark.length < n + 1) return false;
  const slice = spark.slice(-(n + 1));
  for (let i = 1; i < slice.length; i++) {
    if ((slice[i] ?? 0) >= (slice[i - 1] ?? 0)) return false;
  }
  return true;
}

type RoiStep = { afterMin: number; pct: number };

const PUMP_ROI_SNIPER: RoiStep[] = [
  { afterMin: 0, pct: 18 },
  { afterMin: 4, pct: 8 },
  { afterMin: 8, pct: 3 },
  { afterMin: 12, pct: 0 },
];
const PUMP_ROI_SCALP: RoiStep[] = [
  { afterMin: 0, pct: 10 },
  { afterMin: 3, pct: 4 },
  { afterMin: 8, pct: 0 },
];
const CRYPTO_ROI: RoiStep[] = [
  { afterMin: 0, pct: 10 },
  { afterMin: 40, pct: 5 },
  { afterMin: 180, pct: 0 },
];

function roiStep(heldMs: number, table: RoiStep[]): RoiStep {
  const min = heldMs / 60_000;
  let step = table[0]!;
  for (const row of table) {
    if (min >= row.afterMin) step = row;
  }
  return step;
}

function roiHit(heldMs: number, fromEntry: number, table: RoiStep[]): RoiStep | null {
  const step = roiStep(heldMs, table);
  return fromEntry >= step.pct ? step : null;
}

/** Pump.fun is not a stock. No dip-buying, tight trail, fast take-profit. */
export function pumpExplain(
  quote: Quote,
  pos: Position | undefined,
  style: "sniper" | "scalp",
): { action: "buy" | "sell" | "hold"; why: string } {
  const spark = quote.spark;
  const last = quote.price;

  if (pos) {
    if (!last || last <= 0) return { action: "sell", why: "Price print died — getting out." };
    const heldMs = pos.openedAt ? Date.now() - pos.openedAt : 0;
    const heldSec = Math.round(heldMs / 1000);
    const fromPeak = pos.peak > 0 ? ((last - pos.peak) / pos.peak) * 100 : 0;
    const fromEntry = pos.avg > 0 ? ((last - pos.avg) / pos.avg) * 100 : 0;
    const stale = quote.seenAt ? Date.now() - quote.seenAt > 90_000 : false;
    const maxHold = style === "scalp" ? 8 * 60 * 1000 : 12 * 60 * 1000;
    const minHold = 2 * 60 * 1000;
    const catastrophic = fromEntry <= -30;
    if (!catastrophic && heldMs < minHold) {
      return {
        action: "hold",
        why: `Min hold 2 min (${heldSec}s in). ${fromEntry >= 0 ? "Up" : "Down"} ${Math.abs(fromEntry).toFixed(1)}% from entry.`,
      };
    }
    if (stale) return { action: "sell", why: "Price feed went stale for 90s." };
    if (heldMs >= maxHold) {
      return { action: "sell", why: `Time stop — held ${Math.round(heldMs / 60000)} min.` };
    }
    const prev = spark.length >= 2 ? spark[spark.length - 2]! : last;
    if (heldMs >= 60_000 && prev > 0 && last <= prev * 0.85) {
      return { action: "sell", why: "Gapped down more than 15% on one tick." };
    }
    const table = style === "scalp" ? PUMP_ROI_SCALP : PUMP_ROI_SNIPER;
    const hit = roiHit(heldMs, fromEntry, table);
    if (hit) {
      return {
        action: "sell",
        why: `ROI table: up ${fromEntry.toFixed(1)}% after ${Math.round(heldMs / 60000)} min (needed ${hit.pct}%).`,
      };
    }
    const offset = style === "scalp" ? 4 : 6;
    const trail = style === "scalp" ? 3 : 4;
    const hard = style === "scalp" ? -6 : -8;
    if (fromEntry <= hard) {
      return { action: "sell", why: `Hard stop — down ${Math.abs(fromEntry).toFixed(1)}% from entry.` };
    }
    if (fromEntry >= offset && fromPeak <= -trail) {
      return {
        action: "sell",
        why: `Trailing stop: locked after +${offset}%, then faded ${Math.abs(fromPeak).toFixed(1)}% off the peak.`,
      };
    }
    const need = roiStep(heldMs, table);
    return {
      action: "hold",
      why: `Watching. ${fromEntry >= 0 ? "Up" : "Down"} ${Math.abs(fromEntry).toFixed(1)}% from entry. Trail starts at +${offset}%. ROI now ${need.pct}% after ${need.afterMin} min.`,
    };
  }

  if (spark.length < 8 || last <= 0) {
    return { action: "hold", why: `Only ${spark.length} price ticks — needs 2 minutes of tape.` };
  }
  if (!quote.live) return { action: "hold", why: "No live Dex price yet." };
  if (!quote.volume || quote.volume < 2500) {
    return { action: "hold", why: `Too thin — volume ${quote.volume ? `$${Math.round(quote.volume)}` : "unknown"}.` };
  }

  const recent = spark.slice(style === "scalp" ? -4 : -8);
  const recentHigh = Math.max(...recent);
  const rising = last >= (spark[spark.length - 2] ?? last);
  const nearHigh = last >= recentHigh * (style === "scalp" ? 0.96 : 0.94);
  const lookback = spark[spark.length - Math.min(spark.length, 6)] ?? last;
  const ret = lookback > 0 ? ((last - lookback) / lookback) * 100 : quote.changePct;
  const alreadyDumping = last < recentHigh * 0.9 || ret < -4;
  const parabolic = ret > 18 || quote.changePct > 40;

  if (alreadyDumping) return { action: "hold", why: `Already dumping (recent move ${ret.toFixed(1)}%).` };
  if (!rising) return { action: "hold", why: "Last tick was down, not ripping." };
  if (!nearHigh) return { action: "hold", why: "Too far off the recent high." };
  if (parabolic) return { action: "hold", why: `Already parabolic (${ret.toFixed(1)}%) — too late.` };
  if (style === "scalp" && ret > 3.5 && ret < 14) {
    return { action: "buy", why: `Short pop, up ${ret.toFixed(1)}% and still near the high.` };
  }
  if (style === "sniper" && ret > 5 && ret < 16) {
    return { action: "buy", why: `Up ${ret.toFixed(1)}% on recent tape, still near the high, Dex-priced.` };
  }
  return {
    action: "hold",
    why: `Move is ${ret.toFixed(1)}% — ${style} wants ${style === "scalp" ? "3.5–14" : "5–16"}%.`,
  };
}

export function pumpSignal(
  quote: Quote,
  pos: Position | undefined,
  style: "sniper" | "scalp",
): "buy" | "sell" | "hold" {
  return pumpExplain(quote, pos, style).action;
}

export function explainSignal(
  bot: Bot,
  quote: Quote,
  pos?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  if (quote.kind === "pump") {
    return pumpExplain(quote, pos, bot.strategy === "scalp" ? "scalp" : "sniper");
  }
  const use = bot.strategy === "sniper" || bot.strategy === "scalp" ? "momentum" : bot.strategy;
  return technicalExplain({ ...bot, strategy: use }, quote, pos);
}

export function pickSignal(bot: Bot, quote: Quote, pos?: Position): "buy" | "sell" | "hold" {
  return explainSignal(bot, quote, pos).action;
}

export function whyTrade(bot: Bot, quote: Quote, side: "buy" | "sell"): string {
  if (quote.kind === "pump") {
    return whySignal(bot.strategy === "scalp" ? "scalp" : "sniper", side);
  }
  const strat =
    bot.strategy === "sniper" || bot.strategy === "scalp" ? "momentum" : bot.strategy;
  return whySignal(strat, side);
}

export function technicalSignal(bot: Bot, quote: Quote, pos?: Position): "buy" | "sell" | "hold" {
  const spark = quote.spark;
  const last = quote.price;
  if (spark.length < 5 || last <= 0) return "hold";

  const fast = mean(spark.slice(-5));
  const slow = mean(spark.slice(-20));
  const window = spark.slice(-20);
  const sd = stdev(window);
  const mid = mean(window);
  if (mid <= 0) return "hold";
  const z = sd ? (last - mid) / sd : 0;
  const vol = sd / mid;
  const ret8 =
    spark.length >= 9 ? ((last - spark[spark.length - 9]!) / spark[spark.length - 9]!) * 100 : 0;
  const heldMs = pos?.openedAt ? Date.now() - pos.openedAt : 0;
  const fromEntry = pos ? ((last - pos.avg) / pos.avg) * 100 : 0;
  const minHold = bot.strategy === "meanrev" || bot.strategy === "dca" || bot.strategy === "momentum" ? 20 * 60 * 1000 : 10 * 60 * 1000;

  switch (bot.strategy) {
    case "sma":
      if (fast > slow * 1.004 && !pos && vol > 0.001) return "buy";
      if (pos && fromEntry <= -5) return "sell";
      if (pos && heldMs >= minHold && fast < slow * 0.996) return "sell";
      return "hold";
    case "meanrev":
      if (vol < 0.003) return "hold";
      if (z < -1.6 && last < mid * 0.99 && !pos) return "buy";
      if (!pos) return "hold";
      if (fromEntry <= -5) return "sell";
      if (heldMs < minHold) return "hold";
      if (fromEntry >= 3 && z > 0.6) return "sell";
      if (heldMs > 3 * 60 * 60 * 1000 && z > 0) return "sell";
      return "hold";
    case "momentum":
      if (spark.length < 6) return "hold";
      {
        const liquid = quote.kind !== "crypto" || quote.volume >= 8_000_000;
        const popping = quote.live && quote.changePct >= 5 && quote.changePct <= 18 && ret8 > 0.15 && liquid;
        if (!pos && popping) return "buy";
      }
      if (!pos) return "hold";
      if (fromEntry <= -10) return "sell";
      if (heldMs < minHold) return "hold";
      {
        const hit = roiHit(heldMs, fromEntry, CRYPTO_ROI);
        if (hit) return "sell";
        const fromPeak = pos.peak > 0 ? ((last - pos.peak) / pos.peak) * 100 : 0;
        if (fromEntry >= 4 && fromPeak <= -3) return "sell";
      }
      if (heldMs > 3 * 60 * 60 * 1000 && fromEntry > 1) return "sell";
      return "hold";
    case "dca":
      if (last < slow * 0.985 && !pos) return "buy";
      if (!pos) return "hold";
      if (fromEntry <= -5) return "sell";
      if (heldMs < minHold) return "hold";
      if (last > pos.avg * 1.06) return "sell";
      return "hold";
    default:
      return "hold";
  }
}

export function technicalExplain(
  bot: Bot,
  quote: Quote,
  pos?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  const action = technicalSignal(bot, quote, pos);
  if (action === "buy") return { action, why: whySignal(bot.strategy, "buy") };
  if (action === "sell") return { action, why: whySignal(bot.strategy, "sell") };
  if (bot.strategy === "momentum" && !pos) {
    if (quote.spark.length < 6) return { action, why: "Not enough ticks yet." };
    if (!quote.live) return { action, why: "Not a live price." };
    if (quote.kind === "crypto" && quote.volume < 8_000_000) {
      return { action, why: `Not liquid enough ($${(quote.volume / 1_000_000).toFixed(1)}M). Wants $8M+.` };
    }
    if (quote.changePct < 5) {
      return { action, why: `Only ${quote.changePct.toFixed(1)}% on the day — wants 5–18%.` };
    }
    if (quote.changePct > 18) {
      return { action, why: `Already up ${quote.changePct.toFixed(1)}% — too extended.` };
    }
    return { action, why: "Up on the day but not ticking higher on the short tape." };
  }
  if (pos) return { action, why: "Holding — stop and target not hit yet." };
  return { action, why: "No buy signal this pass." };
}

export function botScores(state: DeskState): BotScore[] {
  return state.bots.map((bot) => {
    const fills = state.fills.filter((f) => f.botId === bot.id || f.botName === bot.name);
    const realizedPnl = fills.reduce((s, f) => s + (f.realizedPnl || 0), 0);
    const fees = fills.reduce((s, f) => s + f.fee, 0);
    let unrealizedPnl = 0;
    for (const sym of ownedSymbols(state, bot.id)) {
      const pos = state.positions[sym];
      const q = state.quotes[sym];
      if (pos && q) unrealizedPnl += (q.price - pos.avg) * pos.qty;
    }
    return {
      botId: bot.id,
      name: bot.name,
      trades: fills.length,
      fees,
      realizedPnl,
      unrealizedPnl,
      netPnl: realizedPnl + unrealizedPnl,
      lastReason: bot.lastReason || "",
      enabled: bot.enabled,
    };
  });
}

function ownedSymbols(state: DeskState, botId: string): string[] {
  const latest = new Map<string, Fill>();
  for (const f of state.fills) {
    if (f.botId !== botId) continue;
    if (!latest.has(f.symbol)) latest.set(f.symbol, f);
  }
  const out: string[] = [];
  for (const [sym, f] of latest) {
    if (f.side === "buy" && state.positions[sym]) out.push(sym);
  }
  return out;
}

function scanQuotes(state: DeskState, bot: Bot): Quote[] {
  const all = Object.values(state.quotes);
  if (bot.scope === "one" || !bot.scope) {
    const q = state.quotes[bot.symbol];
    return q ? [q] : [];
  }
  if (bot.scope === "all") return all.filter((q) => q.kind === "stock" || q.live);
  if (bot.scope === "crypto") return all.filter((q) => q.kind === "crypto" && q.live);
  if (bot.scope === "pump") return all.filter((q) => q.kind === "pump");
  return all.filter((q) => q.kind === bot.scope);
}

function botsMayBuy(state: DeskState, symbol: string, at = Date.now()): boolean {
  return (state.manualLocks?.[symbol] ?? 0) <= at;
}

function scanNote(
  bot: Bot,
  quote: Quote,
  decision: ScanNote["decision"],
  reason: string,
): ScanNote {
  return {
    ts: Date.now(),
    botId: bot.id,
    botName: bot.name,
    symbol: quote.id,
    ticker: quote.symbol,
    decision,
    reason,
  };
}

export function tickBots(state: DeskState): DeskState {
  const now = Date.now();
  const keptLocks: Record<string, number> = {};
  for (const [sym, until] of Object.entries(state.manualLocks || {})) {
    if (until > now) keptLocks[sym] = until;
  }

  let next: DeskState = ensureWallets({ ...state, manualLocks: keptLocks });

  const wallets = { ...next.wallets };
  for (const id of ["core", "pump"] as WalletId[]) {
    const w = wallets[id];
    if (id === "pump") {
      const holding = Object.values(next.positions).some((p) => p.kind === "pump");
      if (w.cash < 5 && !holding) {
        wallets[id] = {
          ...w,
          halted: true,
          haltReason: "Pump.fun wallet is empty. It will trade again if you add cash or start a new test.",
        };
      } else if (w.halted) {
        wallets[id] = { ...w, halted: false, haltReason: "" };
      }
      continue;
    }
    if (w.halted) continue;
    const eq = walletEquity(next, id);
    const lossPct = ((eq - w.dayStartEquity) / Math.max(w.dayStartEquity, 1)) * 100;
    if (lossPct <= -next.maxDailyLossPct) {
      wallets[id] = {
        ...w,
        halted: true,
        haltReason: `Stocks + crypto wallet paused: down ${lossPct.toFixed(1)}% today. Pump.fun keeps running.`,
      };
    }
  }
  next = {
    ...next,
    wallets,
    cash: wallets.core.cash + wallets.pump.cash,
    halted: wallets.core.halted || wallets.pump.halted,
    haltReason: [wallets.core.haltReason, wallets.pump.haltReason].filter(Boolean).join(" "),
  };

  const bots = next.bots.map((b) => ({ ...b }));
  const copyEvents = next.copyEvents.map((e) => ({ ...e }));
  const rth = stockMarketOpen();
  const tape: ScanNote[] = [];

  for (const bot of bots) {
    if (!bot.enabled) continue;

    if (bot.strategy !== "copy") {
      const since = Date.now() - 20 * 60 * 1000;
      const losses = next.fills.filter(
        (f) => f.botId === bot.id && f.side === "sell" && f.ts >= since && (f.realizedPnl || 0) < -0.15,
      );
      if (!bot.lockedUntil || bot.lockedUntil < Date.now()) {
        if (losses.length >= 3) {
          bot.lockedUntil = Date.now() + 30 * 60 * 1000;
        }
      }
    }

    if (bot.strategy === "copy") {
      const pendingAll = copyEvents.filter((e) => !e.consumed && e.leaderId === bot.leaderId);
      if (!pendingAll.length) {
        bot.lastSignal = "watching";
        const unread = /book unread|retrying/i.test(bot.lastReason);
        bot.lastReason = unread
          ? bot.lastReason
          : bot.kind === "crypto"
            ? "This wallet has no copyable longs right now (majors only, no shorts, not Pump.fun)."
            : "Waiting for a new public filing or holding from this person.";
        bot.lastTickAt = Date.now();
        continue;
      }
      let acted = false;
      let held = ownedSymbols(next, bot.id).length;
      const maxNames = Math.max(1, bot.maxNames || 8);
      for (const pending of pendingAll) {
        const quote = next.quotes[pending.ticker];
        if (!quote) {
          bot.lastSignal = "no quote";
          bot.lastReason = `No price yet for ${pending.ticker}.`;
          continue;
        }
        if (quote.kind === "pump") {
          pending.consumed = true;
          continue;
        }
        if (quote.kind === "stock" && !rth) {
          bot.lastSignal = "market closed";
          bot.lastReason =
            "US stock market is closed. This copy bot waits until Monday–Friday 9:30–4:00 ET.";
          break;
        }
        const pos = next.positions[quote.id];
        if (pending.side === "sell" && !pos) {
          pending.consumed = true;
          continue;
        }
        if (pending.side === "buy" && pos) {
          pending.consumed = true;
          continue;
        }
        if (pending.side === "buy" && !botsMayBuy(next, quote.id)) {
          continue;
        }
        if (pending.side === "buy" && held >= maxNames) {
          pending.consumed = true;
          continue;
        }
        if (pending.side === "buy" && next.wallets.core.halted) {
          bot.lastSignal = "wallet paused";
          bot.lastReason = next.wallets.core.haltReason;
          break;
        }
        const eq = walletEquity(next, "core");
        const size = Math.min(bot.sizeUsd, eq * 0.08, next.wallets.core.cash);
        if (pending.side === "buy" && feeWouldEat(quote.kind, quote.symbol, size)) {
          pending.consumed = true;
          bot.lastReason = `Skipped ${pending.ticker}: network fees would eat a $${size.toFixed(0)} ticket.`;
          continue;
        }
        const notional = pending.side === "sell" ? (pos?.qty ?? 0) * quote.price : size;
        const delayBit = pending.delayDays ? ` — ${pending.delayDays} days after the real trade` : "";
        const reason =
          quote.kind === "crypto"
            ? `Copying ${pending.leaderName}'s ${pending.side === "buy" ? "long" : "exit"} in ${pending.ticker}. ${pending.amount}. Paper longs only — not Pump.fun.`
            : `${whySignal("copy", pending.side)} ${pending.leaderName}: ${pending.side} ${pending.ticker} (${pending.amount || "amount n/a"}), filed ${pending.disclosureDate || "n/a"}${delayBit}.`;
        next = applyFill(
          next,
          pending.side,
          quote.id,
          quote.kind,
          notional,
          "copy",
          bot.name,
          reason,
          pending.leaderName,
          bot.id,
        );
        pending.consumed = true;
        bot.lastSignal = pending.side;
        bot.lastReason = reason;
        bot.lastTickAt = Date.now();
        if (pending.side === "buy") held += 1;
        if (pending.side === "sell") bot.lastSold = { ...(bot.lastSold || {}), [quote.id]: Date.now() };
        acted = true;
      }
      if (!acted && !bot.lastReason) {
        bot.lastSignal = "watching";
        bot.lastReason = "Nothing new to copy this pass.";
        bot.lastTickAt = Date.now();
      }
      continue;
    }

    const universe = scanQuotes(next, bot);
    if (!universe.length) {
      bot.lastSignal = "no quote";
      bot.lastReason = "Nothing to scan yet.";
      continue;
    }

    bot.lastTickAt = Date.now();
    let acted = false;
    const feeSkips: string[] = [];
    const maxNames = Math.max(1, bot.maxNames || 4);
    const pass: ScanNote[] = [];

    // Mark peaks + sell names this bot still holds.
    for (const sym of ownedSymbols(next, bot.id)) {
      const quote = next.quotes[sym];
      const pos = next.positions[sym];
      if (!quote || !pos) continue;
      if (quote.kind === "stock" && !rth) continue;
      next = {
        ...next,
        positions: {
          ...next.positions,
          [sym]: { ...pos, peak: Math.max(pos.peak, quote.price) },
        },
      };
      const explained = explainSignal(bot, quote, next.positions[sym]);
      if (explained.action === "hold") {
        pass.push(scanNote(bot, quote, "skip", explained.why));
        continue;
      }
      if (explained.action !== "sell") continue;
      const notional = pos.qty * quote.price;
      const reason = `${quote.symbol}: ${explained.why}`;
      next = applyFill(
        next,
        "sell",
        quote.id,
        quote.kind,
        notional,
        "bot",
        bot.name,
        reason,
        undefined,
        bot.id,
      );
      bot.lastSignal = "sell";
      bot.lastReason = reason;
      bot.lastSold = { ...(bot.lastSold || {}), [sym]: Date.now() };
      pass.push(scanNote(bot, quote, "sell", explained.why));
      acted = true;
    }

    if (!acted) {
      const heldPump = ownedSymbols(next, bot.id).filter((id) => next.positions[id]?.kind === "pump");
      if (heldPump.length) {
        const bits = heldPump.slice(0, 3).map((id) => {
          const q = next.quotes[id];
          const p = next.positions[id];
          if (!q || !p) return id;
          const fromEntry = p.avg > 0 ? ((q.price - p.avg) / p.avg) * 100 : 0;
          const sign = fromEntry >= 0 ? "+" : "";
          return `${q.symbol} ${sign}${fromEntry.toFixed(1)}%`;
        });
        bot.lastSignal = "watching";
        bot.lastReason = `Watching ${bits.join(", ")} every 10s. Sells on dump, fade off the high, ${bot.strategy === "scalp" ? "8" : "12"} min, or a dead price feed.`;
        acted = true;
      }
    }

    // Buy new names that pass the rule.
    let held = ownedSymbols(next, bot.id).length;
    const ranked = universe.slice().sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    let pumpCool = false;
    if (bot.scope === "pump" || ranked.some((q) => q.kind === "pump")) {
      const lastPump = next.fills.find((f) => f.botId === bot.id && f.kind === "pump");
      pumpCool = !!(lastPump && Date.now() - lastPump.ts < 4 * 60 * 1000);
    }
    for (const quote of ranked.slice(0, 40)) {
      if (next.positions[quote.id]) continue;
      if (bot.lockedUntil && bot.lockedUntil > Date.now()) {
        const left = Math.max(1, Math.round((bot.lockedUntil - Date.now()) / 60000));
        pass.push(scanNote(bot, quote, "skip", `Stoploss guard — no new buys for ${left} min after a losing streak.`));
        bot.lastReason = `Stoploss guard: paused ${left} min after 3 losing sells. Still watching open bags.`;
        break;
      }
      if (held >= maxNames) {
        pass.push(scanNote(bot, quote, "skip", `Already holding ${held}/${maxNames} names.`));
        continue;
      }
      if (!botsMayBuy(next, quote.id)) {
        pass.push(scanNote(bot, quote, "skip", "You sold this. Bots skip it for 30 minutes."));
        continue;
      }
      if (quote.kind === "stock" && !rth) {
        pass.push(scanNote(bot, quote, "skip", "US stock market is closed."));
        continue;
      }
      const wid = walletIdFor(quote.kind);
      if (next.wallets[wid].halted) {
        pass.push(scanNote(bot, quote, "skip", next.wallets[wid].haltReason || "Wallet paused."));
        continue;
      }
      const coolUntil = bot.lastSold?.[quote.id] ?? 0;
      if (Date.now() < coolUntil + 30 * 60 * 1000) {
        const left = Math.max(1, Math.round((coolUntil + 30 * 60 * 1000 - Date.now()) / 60000));
        pass.push(scanNote(bot, quote, "skip", `Sold this recently — cooling ${left} min.`));
        continue;
      }
      if (quote.kind === "pump" && pumpCool) {
        pass.push(scanNote(bot, quote, "skip", "4-minute gap after the last Pump.fun trade."));
        continue;
      }
      const explained = explainSignal(bot, quote, undefined);
      if (explained.action !== "buy") {
        pass.push(scanNote(bot, quote, "skip", explained.why));
        continue;
      }
      const eq = walletEquity(next, wid);
      const size = Math.min(bot.sizeUsd, eq * 0.05, next.wallets[wid].cash);
      if (size < 5) {
        pass.push(scanNote(bot, quote, "skip", "Not enough cash in this wallet for a ticket."));
        continue;
      }
      if (feeWouldEat(quote.kind, quote.symbol, size)) {
        feeSkips.push(quote.symbol);
        pass.push(scanNote(bot, quote, "skip", `Fees would eat a $${size.toFixed(0)} ticket.`));
        continue;
      }
      const reason = `${quote.symbol}: ${explained.why}`;
      next = applyFill(
        next,
        "buy",
        quote.id,
        quote.kind,
        size,
        "bot",
        bot.name,
        reason,
        undefined,
        bot.id,
      );
      bot.lastSignal = "buy";
      bot.lastReason = reason;
      bot.symbol = quote.id;
      bot.kind = quote.kind;
      pass.push(scanNote(bot, quote, "buy", explained.why));
      held += 1;
      acted = true;
    }

    bot.lastScan = pass.slice(0, 40);
    tape.push(...pass);

    if (!acted) {
      const n = universe.length;
      const heldNow = ownedSymbols(next, bot.id);
      const skipNote = feeSkips.length
        ? ` Skipped ${feeSkips.join(", ")}: network fees too big for a $${bot.sizeUsd} ticket.`
        : "";
      bot.lastSignal = "scanning";
      bot.lastReason =
        bot.scope === "one"
          ? `Watching ${next.quotes[bot.symbol]?.symbol ?? bot.symbol} — no buy or sell yet.${skipNote}`
          : `Scanned ${n} name${n === 1 ? "" : "s"}. Holding ${heldNow.length}/${maxNames}. No new signal this pass.${skipNote}`;
      if (
        !feeSkips.length &&
        universe.some((q) => q.kind === "stock") &&
        !rth &&
        bot.scope !== "crypto" &&
        bot.scope !== "pump"
      ) {
        bot.lastReason += " Stock names wait until 9:30–4:00 ET.";
      }
    }
  }

  const v = markToMarket(next);
  const equitySeries = [...next.equity, { t: Date.now(), v }].slice(-480);

  return {
    ...next,
    bots,
    copyEvents,
    equity: equitySeries,
    scanTape: [...tape, ...(next.scanTape || [])].slice(0, 150),
  };
}

/** Fast path: re-mark every open bag and sell if the rule says so. Used every 10s. */
export function tickHeldExits(state: DeskState): DeskState {
  let next = ensureWallets(state);
  const bots = next.bots.map((b) => ({ ...b }));
  const rth = stockMarketOpen();
  let sold = false;

  const ownerOf = (sym: string): Bot | undefined => {
    for (const bot of bots) {
      if (bot.enabled && ownedSymbols(next, bot.id).includes(sym)) return bot;
    }
    const fill = next.fills.find((f) => f.symbol === sym && f.botId);
    return fill ? bots.find((b) => b.id === fill.botId) : undefined;
  };

  for (const pos of Object.values(next.positions)) {
    const quote = next.quotes[pos.symbol];
    if (!quote) continue;
    if (pos.kind === "stock" && !rth) continue;
    next = {
      ...next,
      positions: {
        ...next.positions,
        [pos.symbol]: { ...pos, peak: Math.max(pos.peak, quote.price) },
      },
    };
    const marked = next.positions[pos.symbol]!;
    const bot = ownerOf(pos.symbol);
    const dummy: Bot = {
      id: "exit-watch",
      name: "Hold watch",
      enabled: true,
      symbol: pos.symbol,
      kind: pos.kind,
      strategy: pos.kind === "pump" ? "sniper" : pos.kind === "crypto" ? "momentum" : "sma",
      sizeUsd: 0,
      scope: pos.kind === "pump" ? "pump" : pos.kind === "crypto" ? "crypto" : "stock",
      maxNames: 1,
      lastSignal: "watching",
      lastTickAt: Date.now(),
      lastReason: "",
    };
    const actor = bot || dummy;
    if (pickSignal(actor, quote, marked) !== "sell") continue;
    const reason = `${quote.symbol}: ${whyTrade(actor, quote, "sell")}`;
    next = applyFill(
      next,
      "sell",
      quote.id,
      pos.kind,
      marked.qty * quote.price,
      bot ? (bot.strategy === "copy" ? "copy" : "bot") : "bot",
      actor.name,
      reason,
      bot?.name,
      bot?.id,
    );
    if (bot) {
      bot.lastSignal = "sell";
      bot.lastReason = reason;
      bot.lastSold = { ...(bot.lastSold || {}), [pos.symbol]: Date.now() };
    }
    sold = true;
  }
  if (!sold) return { ...next, bots };
  const v = markToMarket(next);
  return { ...next, bots, equity: [...next.equity, { t: Date.now(), v }].slice(-480) };
}

export function mergeQuotes(
  prev: Record<string, Quote>,
  incoming: Quote[],
): Record<string, Quote> {
  const out = { ...prev };
  for (const q of incoming) {
    const old = out[q.id];
    const spark = [...(old?.spark ?? []), q.price].slice(-48);
    if (q.kind === "pump" && old && old.price > 0) {
      const jump = Math.abs(q.price - old.price) / old.price;
      const young = Date.now() - (old.seenAt || 0) < 45_000;
      if (jump > 0.25 && young) {
        out[q.id] = { ...old, seenAt: Date.now() };
        continue;
      }
    }
    const base = spark.length >= 6 ? spark[spark.length - 6]! : spark[0]!;
    const changePct = base > 0 ? ((q.price - base) / base) * 100 : q.changePct;
    out[q.id] = {
      ...q,
      spark,
      changePct: Number.isFinite(changePct) ? changePct : q.changePct,
      seenAt: Date.now(),
    };
  }
  return out;
}

export function pruneStaleQuotes(
  quotes: Record<string, Quote>,
  liveIncoming: Quote[],
  held: Set<string>,
  kind: Quote["kind"],
  keepMs: number,
): Record<string, Quote> {
  const liveIds = new Set(liveIncoming.filter((q) => q.kind === kind && q.live).map((q) => q.id));
  if (!liveIds.size) return quotes;
  const now = Date.now();
  const out: Record<string, Quote> = {};
  for (const q of Object.values(quotes)) {
    if (q.kind !== kind || liveIds.has(q.id) || held.has(q.id) || now - (q.seenAt || 0) < keepMs) {
      out[q.id] = q;
    }
  }
  return out;
}

export function prunePumpQuotes(
  quotes: Record<string, Quote>,
  liveIncoming: Quote[],
  held: Set<string>,
): Record<string, Quote> {
  return pruneStaleQuotes(quotes, liveIncoming, held, "pump", 20 * 60 * 1000);
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
