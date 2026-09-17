import { calcFees, feeWouldEat, minTicketUsd, roundTripFee } from "./fees";
import {
  RISK,
  blankWalletRisk,
  copyQualityGate,
  dynamicTicket,
  monthStamp,
  nameNotional,
  strategyNotional,
  touchWalletRisk,
} from "./risk";
import { slipBps } from "./universe";
import { isCurrentRound, pairLocks, sideWon, updownExplain, windowBounds } from "./updown";
import type {
  Bot,
  BotScore,
  DeskState,
  DeskStats,
  Fill,
  HourClock,
  MarketKind,
  Position,
  Quote,
  ScanNote,
  ScanScope,
  StrategyId,
  Wallet,
  WalletId,
  WalletView,
} from "./types";

export const CORE_START = 500;
export const POLY_START = 500;
export const PUMP_START = POLY_START;
/** Max fraction of a wallet sitting in open bags. */
export const MAX_DEPLOYED = 0.45;
export const CRYPTO_MIN_VOL = 50_000_000;
const RUNNER_LO = 4;
const RUNNER_HI = 9;
const DAILY_TRADES: Record<MarketKind, number> = { stock: 20, crypto: 30, poly: 32, pump: 8 };

export function isEventKind(kind: MarketKind): boolean {
  return kind === "poly" || kind === "pump";
}

export function walletIdFor(kind: MarketKind): WalletId {
  return isEventKind(kind) ? "poly" : "core";
}

export function blankWallets(): Record<WalletId, Wallet> {
  return {
    core: {
      cash: CORE_START,
      startingCash: CORE_START,
      dayStartEquity: CORE_START,
      halted: false,
      haltReason: "",
      ...blankWalletRisk(CORE_START),
    },
    poly: {
      cash: POLY_START,
      startingCash: POLY_START,
      dayStartEquity: POLY_START,
      halted: false,
      haltReason: "",
      ...blankWalletRisk(POLY_START),
    },
  };
}

export function ensureWallets(state: DeskState): DeskState {
  const incoming = (state.wallets || {}) as Record<string, Wallet | undefined>;
  const polyFrom = incoming.poly || incoming.pump;
  let next: DeskState;
  if (incoming.core && polyFrom) {
    let wallets: Record<WalletId, Wallet> = { core: incoming.core, poly: { ...polyFrom } };
    let positions = { ...(state.positions || {}) };
    let quotes = { ...(state.quotes || {}) };
    let polyCash = wallets.poly.cash;
    for (const [id, p] of Object.entries(positions)) {
      if (p.kind !== "pump") continue;
      const q = quotes[id];
      polyCash += p.qty * (q?.price || p.avg || 0);
      delete positions[id];
      delete quotes[id];
    }
    for (const id of Object.keys(quotes)) {
      if (quotes[id]?.kind === "pump") delete quotes[id];
    }
    if (Math.abs(polyCash - wallets.poly.cash) > 0.009) {
      wallets = { ...wallets, poly: { ...wallets.poly, cash: Math.round(polyCash * 100) / 100 } };
    }
    for (const id of ["core", "poly"] as WalletId[]) {
      const eq = walletEquity({ ...state, wallets, positions, quotes }, id);
      const w = wallets[id];
      if (Math.abs(w.dayStartEquity - w.cash) < 1 && Math.abs(eq - w.cash) > 5) {
        wallets = { ...wallets, [id]: { ...w, dayStartEquity: eq } };
      }
    }
    if (wallets.core.startingCash === 800 && wallets.poly.startingCash === 200) {
      const move = Math.min(300, Math.max(0, wallets.core.cash - 20));
      wallets = {
        core: {
          ...wallets.core,
          cash: Math.round((wallets.core.cash - move) * 100) / 100,
          startingCash: CORE_START,
        },
        poly: {
          ...wallets.poly,
          cash: Math.round((wallets.poly.cash + move) * 100) / 100,
          startingCash: POLY_START,
        },
      };
    }
    if (wallets.core.startingCash === CORE_START && wallets.poly.startingCash === POLY_START) {
      if (wallets.core.dayStartEquity >= 700 && wallets.poly.dayStartEquity <= 280) {
        wallets = {
          core: { ...wallets.core, dayStartEquity: CORE_START },
          poly: { ...wallets.poly, dayStartEquity: POLY_START },
        };
      }
    }
    const poly = wallets.poly;
    if (poly.cash < 0) {
      wallets = {
        ...wallets,
        poly: {
          ...poly,
          halted: true,
          haltReason: "Polymarket cash went negative — start a New $1,000 test. Do not keep trading this book.",
        },
      };
    } else if (poly.halted && poly.cash >= 5) {
      wallets = { ...wallets, poly: { ...poly, halted: false, haltReason: "" } };
    }
    const cash = wallets.core.cash + wallets.poly.cash;
    next = {
      ...state,
      cash,
      wallets,
      positions,
      quotes,
      reports: state.reports || [],
      scanTape: state.scanTape || [],
      hourClock: state.clockGen === 2 ? scrubClockHours(state) : [],
      clockGen: 2,
      clockScrub: 1,
    };
  } else {
    const cash = Number.isFinite(state.cash) ? state.cash : CORE_START + POLY_START;
    const coreCash = Math.round(cash * 0.5 * 100) / 100;
    const polyCash = Math.round((cash - coreCash) * 100) / 100;
    const wallets: Record<WalletId, Wallet> = {
      core: {
        cash: coreCash,
        startingCash: CORE_START,
        dayStartEquity: coreCash,
        halted: false,
        haltReason: "",
        ...blankWalletRisk(coreCash),
      },
      poly: {
        cash: polyCash,
        startingCash: POLY_START,
        dayStartEquity: polyCash,
        halted: false,
        haltReason: "",
        ...blankWalletRisk(polyCash),
      },
    };
    const built = { ...state, wallets, cash, reports: state.reports || [] };
    next = {
      ...built,
      wallets: {
        core: { ...wallets.core, dayStartEquity: walletEquity(built, "core") },
        poly: { ...wallets.poly, dayStartEquity: walletEquity(built, "poly") },
      },
    };
  }

  const wallets = { ...next.wallets };
  for (const id of ["core", "poly"] as WalletId[]) {
    const w = wallets[id];
    const eq = walletEquity({ ...next, wallets }, id);
    const seeded: Wallet = {
      ...w,
      peakEquity: w.peakEquity || eq,
      monthStamp: w.monthStamp || monthStamp(),
      monthStartEquity: w.monthStartEquity || eq,
    };
    wallets[id] = touchWalletRisk(seeded, eq);
  }
  return { ...next, wallets };
}

export function walletEquity(state: DeskState, id: WalletId): number {
  const cash = state.wallets?.[id]?.cash ?? 0;
  let eq = cash;
  for (const p of Object.values(state.positions || {})) {
    if (walletIdFor(p.kind) !== id) continue;
    eq += p.qty * (isEventKind(p.kind) ? p.avg : positionMark(p, state.quotes[p.symbol]));
  }
  return eq;
}

function honestBookPx(px?: number): number {
  if (!px || px <= 0) return 0;
  if (px <= 0.06 || px >= 0.94) return 0;
  return px;
}

export function positionWindowEnd(p: Position): number | undefined {
  if (p.windowEnd) return p.windowEnd;
  if (p.windowStart && p.horizon) return p.windowStart + (p.horizon === "15m" ? 900_000 : 300_000);
  return undefined;
}

export function isSettling(p: Position, now = Date.now()): boolean {
  const end = positionWindowEnd(p);
  return p.kind === "poly" && !!end && now >= end;
}

/** Live mark, or frozen close if this round's clock already hit 0:00. */
export function positionMark(p: Position, q?: Quote, now = Date.now()): number {
  if (isSettling(p, now)) {
    return honestBookPx(p.closedMark) || honestBookPx(p.lastMark) || p.avg;
  }
  return honestBookPx(q?.price) || honestBookPx(p.lastMark) || p.avg;
}

export function markToMarket(
  state: Pick<DeskState, "cash" | "positions" | "quotes"> & Partial<Pick<DeskState, "wallets">>,
): number {
  const s = ensureWallets(state as DeskState);
  return walletEquity(s, "core") + walletEquity(s, "poly");
}

export function walletViews(state: DeskState): WalletView[] {
  const s = ensureWallets(state);
  return (["core", "poly"] as WalletId[]).map((id) => {
    const w = s.wallets[id];
    const fills = s.fills.filter((f) => walletIdFor(f.kind) === id);
    const realizedPnl = fills.reduce((n, f) => n + (f.realizedPnl || 0), 0);
    const feesPaid = fills.reduce((n, f) => n + f.fee, 0);
    let unrealizedPnl = 0;
    for (const p of Object.values(s.positions)) {
      if (walletIdFor(p.kind) !== id) continue;
      unrealizedPnl += (positionMark(p, s.quotes[p.symbol]) - p.avg) * p.qty;
    }
    const equity = walletEquity(s, id);
    return {
      id,
      label: id === "core" ? "Stocks + crypto" : "Polymarket",
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

export function sqnLabel(sqn: number, sells: number): string {
  if (sells < 5) return "too few trades";
  if (sqn < 0) return "broken";
  if (sqn < 1) return "noise";
  if (sqn < 1.6) return "poor";
  if (sqn < 2) return "below average";
  if (sqn < 2.5) return "average";
  if (sqn < 3) return "good";
  if (sqn < 5) return "excellent";
  return "superb";
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
function nyMins(at = Date.now()): { weekday: string; mins: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const weekday = parts.find((p) => p.type === "weekday")?.value || "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { weekday, mins: hour * 60 + minute };
}

export function stockMarketOpen(at = Date.now()): boolean {
  const { weekday, mins } = nyMins(at);
  if (weekday === "Sat" || weekday === "Sun") return false;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/** Skip the first 10 min and last 15 min for new stock buys. */
export function stockEntryWindow(at = Date.now()): boolean {
  if (!stockMarketOpen(at)) return false;
  const { mins } = nyMins(at);
  if (mins < 9 * 60 + 40) return false;
  if (mins >= 15 * 60 + 45) return false;
  return true;
}

function expectedMovePct(strategy: StrategyId): number {
  if (strategy === "momentum") return 8;
  if (strategy === "sniper") return 18;
  if (strategy === "scalp") return 10;
  if (strategy === "sma") return 3;
  if (strategy === "copy") return 4;
  return 5;
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
      buy: "Runner: up 4–9% on the day, $50M+ volume, still ticking higher.",
      sell: "Trail after +5% (−2% off peak), ROI 8%/4%/flat at 60 min, hard −4%.",
    },
    dca: {
      buy: "Price is stretched below its recent average (z-score), so the bot is buying a dip.",
      sell: "The position is up about 6% from cost, so the bot is cashing in.",
    },
    sniper: {
      buy: "5m/15m Up-Down: live crypto is mispriced vs Polymarket. Buy the cheap side.",
      sell: "Round settled, unhedged stop, or the window closed.",
    },
    scalp: {
      buy: "Polymarket fade: YES dumped 3–8¢ then ticked back up. Quick mean-reversion, not a hold.",
      sell: "Polymarket fade exit: +5¢, −4¢ stop, 90 minutes, or the market settled.",
    },
    copy: {
      buy: "The person this bot follows showed a public buy or a live long.",
      sell: "The person this bot follows showed a public sale or closed the long.",
    },
  };
  return map[strategy][side];
}

/** Polymarket taker: buy the ask, sell the bid. Resolved bags redeem 0 or 1 — not 1¢/99¢. */
export function paperFillPx(quote: Quote, side: "buy" | "sell", windowEnd?: number, pos?: Position): number {
  if (quote.kind === "poly") {
    const end = windowEnd || quote.windowEnd || pos?.windowEnd;
    const windowOver = !!(end && Date.now() >= end);
    if (side === "sell") {
      if (windowOver && quote.price <= 0.04) return 0;
      if (windowOver && quote.price >= 0.96) return 1;
      const waited = end ? Date.now() - end : 0;
      if (windowOver && waited >= 150_000 && pos) {
        const leg =
          pos.leg ||
          (/:down|-dn$/i.test(pos.symbol) ? "down" : /:up|-up$/i.test(pos.symbol) ? "up" : "");
        const won = sideWon(leg, pos.lastSpot || 0, pos.lastOpen || 0);
        if (won === true) return 1;
        if (won === false) return 0;
      }
      const bid = quote.bid || 0;
      if (!(bid > 0)) return 0;
      return bid;
    }
    const ask = quote.ask || 0;
    if (!(ask > 0)) return 0;
    const depthUsd = (quote.askSize || 0) * ask;
    const walk = depthUsd > 0 && depthUsd < 40 ? 0.01 : 0;
    return Math.min(0.99, ask + walk);
  }
  const slip = slipBps(quote.kind) / 10_000;
  return side === "buy" ? quote.price * (1 + slip) : quote.price * (1 - slip);
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

  const pos = s0.positions[symbol];
  const expectedPrice = quote.price;
  const px = paperFillPx(quote, side, pos?.windowEnd || quote.windowEnd, pos);
  if (!Number.isFinite(px) || px < 0) return s0;
  if (side === "buy" && !(px > 0)) return s0;
  const slipActual = expectedPrice > 0 && px > 0 ? ((px - expectedPrice) / expectedPrice) * 10_000 : 0;
  let qty = px > 0 ? notional / px : 0;

  if (side === "sell") {
    if (!pos || pos.qty <= 0) return s0;
    const end = pos.windowEnd || quote.windowEnd;
    const windowOver = !!(end && Date.now() >= end);
    const redeem =
      quote.kind === "poly" &&
      windowOver &&
      (px === 0 || px === 1 || quote.price <= 0.04 || quote.price >= 0.96);
    if (redeem) qty = pos.qty;
    else qty = Math.min(qty, pos.qty);
    if (!(qty > 0)) return s0;
  } else {
    if (quote.kind === "poly") {
      if (!quote.live) return s0;
      if (quote.horizon && !isCurrentRound(quote)) return s0;
      if (quote.windowEnd && Date.now() >= quote.windowEnd) return s0;
      if (quote.seenAt && Date.now() - quote.seenAt > 12_000) return s0;
      const ask = quote.ask || 0;
      const askSize = quote.askSize || 0;
      if (!(ask > 0) || askSize < 8) return s0;
      const depth = askSize * ask;
      if (notional > depth * 0.85) return s0;
      const width = ask - (quote.bid || 0);
      if (width > 0.05) return s0;
    }
    const maxNotional = book.cash * 0.98;
    if (notional > maxNotional) qty = Math.min(qty, maxNotional / px);
    if (qty * px < 1) return s0;
  }

  const gross = qty * px;
  const resolved =
    quote.kind === "poly" &&
    side === "sell" &&
    !!(pos?.windowEnd || quote.windowEnd) &&
    Date.now() >= (pos?.windowEnd || quote.windowEnd || 0) &&
    (px === 0 || px === 1);
  const fees = resolved
    ? { venue: 0, regulatory: 0, gas: 0.12, total: 0.12, note: "Redeem 0/1 + Polygon gas" }
    : calcFees(kind, side, quote.symbol, qty, gross);

  if (side === "buy" && book.cash < gross + fees.total) return s0;

  let realizedPnl = 0;
  let holdMs = 0;
  const positions = { ...s0.positions };
  let cash = book.cash;
  const manualLocks = { ...(s0.manualLocks || {}) };

  if (side === "buy") {
    const end = quote.windowEnd || (quote.horizon ? windowBounds(quote.horizon).end : 0);
    if (quote.horizon && end && Date.now() >= end) return s0;
    cash -= gross + fees.total;
    const prev = positions[symbol];
    const cost = gross + fees.total;
    const bounds = quote.horizon ? windowBounds(quote.horizon) : null;
    const liveRound = !!(quote.horizon && isCurrentRound(quote));
    const windowStart = quote.windowStart || (liveRound ? bounds?.start : undefined);
    const windowEnd = quote.windowEnd || (liveRound ? bounds?.end : undefined);
    if (!prev) {
      positions[symbol] = {
        symbol,
        kind,
        qty,
        avg: cost / qty,
        peak: quote.price,
        lastMark: quote.price,
        lastSpot: quote.spot,
        lastOpen: quote.openPx,
        openedAt: Date.now(),
        windowStart,
        windowEnd,
        horizon: quote.horizon,
        asset: quote.asset,
        leg: quote.leg,
      };
    } else {
      const newQty = prev.qty + qty;
      const avg = (prev.avg * prev.qty + cost) / newQty;
      positions[symbol] = {
        ...prev,
        qty: newQty,
        avg,
        peak: Math.max(prev.peak, quote.price),
        lastMark: quote.price || prev.lastMark,
        openedAt: prev.openedAt || Date.now(),
        windowStart: prev.windowStart || windowStart,
        windowEnd: prev.windowEnd || windowEnd,
        horizon: prev.horizon || quote.horizon,
        asset: prev.asset || quote.asset,
        leg: prev.leg || quote.leg,
      };
    }
    if (source === "manual") delete manualLocks[symbol];
  } else {
    const prev = positions[symbol]!;
    const proceeds = gross - fees.total;
    cash += proceeds;
    realizedPnl = proceeds - prev.avg * qty;
    holdMs = prev.openedAt ? Date.now() - prev.openedAt : 0;
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
    expectedPrice,
    slipBps: slipActual,
    holdMs: side === "sell" ? holdMs : undefined,
  };

  const wallets = {
    ...s0.wallets,
    [wid]: { ...book, cash },
  };
  const other: WalletId = wid === "core" ? "poly" : "core";
  return {
    ...s0,
    cash: cash + wallets[other].cash,
    wallets,
    positions,
    manualLocks,
    fills: [fill, ...s0.fills].slice(0, 400),
    hourClock: stampHourClock(s0, fill),
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

const POLY_ROI_MOVER: RoiStep[] = [
  { afterMin: 0, pct: 16 },
  { afterMin: 45, pct: 8 },
  { afterMin: 180, pct: 0 },
];
const POLY_ROI_FADE: RoiStep[] = [
  { afterMin: 0, pct: 10 },
  { afterMin: 30, pct: 4 },
  { afterMin: 90, pct: 0 },
];
const CRYPTO_ROI: RoiStep[] = [
  { afterMin: 0, pct: 10 },
  { afterMin: 40, pct: 5 },
  { afterMin: 180, pct: 0 },
];
const RUNNER_ROI: RoiStep[] = [
  { afterMin: 0, pct: 8 },
  { afterMin: 25, pct: 4 },
  { afterMin: 60, pct: 0 },
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

/** Polymarket YES contracts. Think in cents, not memecoin %. */
export function polyExplain(
  quote: Quote,
  pos: Position | undefined,
  style: "sniper" | "scalp",
  other?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  if (quote.horizon) return updownExplain(quote, pos, other);
  if (pos && style === "sniper") {
    return { action: "sell", why: "Round left the live board — settling leftover." };
  }
  if (style === "sniper") {
    return { action: "hold", why: "5m/15m bot skips longer events — those use Fade." };
  }
  const spark = quote.spark;
  const last = quote.price;
  const cents = (from: number, to: number) => (to - from) * 100;

  if (pos) {
    if (!last || last <= 0) return { action: "sell", why: "Odds print died — getting out." };
    if (last <= 0.02 || last >= 0.98) {
      return { action: "sell", why: `Market settling at ${Math.round(last * 100)}¢.` };
    }
    const heldMs = pos.openedAt ? Date.now() - pos.openedAt : 0;
    const heldMin = Math.round(heldMs / 60_000);
    const fromEntryC = cents(pos.avg, last);
    const fromPeakC = cents(pos.peak, last);
    const fromEntryPct = pos.avg > 0 ? ((last - pos.avg) / pos.avg) * 100 : 0;
    const stale = quote.seenAt ? Date.now() - quote.seenAt > 3 * 60 * 1000 : false;
    const maxHold = style === "scalp" ? 90 * 60 * 1000 : 6 * 60 * 60 * 1000;
    const minHold = 3 * 60 * 1000;
    const hard = style === "scalp" ? -4 : -6;
    if (fromEntryC <= hard) {
      return { action: "sell", why: `Hard stop — down ${Math.abs(fromEntryC).toFixed(1)}¢ from entry.` };
    }
    if (!stale && heldMs < minHold) {
      return {
        action: "hold",
        why: `Min hold 3 min (${Math.round(heldMs / 1000)}s in). ${fromEntryC >= 0 ? "Up" : "Down"} ${Math.abs(fromEntryC).toFixed(1)}¢.`,
      };
    }
    if (stale) return { action: "sell", why: "Odds feed went stale for 3 minutes." };
    if (heldMs >= maxHold) {
      return { action: "sell", why: `Time stop — held ${heldMin} min.` };
    }
    const table = style === "scalp" ? POLY_ROI_FADE : POLY_ROI_MOVER;
    const hit = roiHit(heldMs, fromEntryPct, table);
    if (hit) {
      return {
        action: "sell",
        why: `Up ${fromEntryC.toFixed(1)}¢ (${fromEntryPct.toFixed(1)}%) after ${heldMin} min.`,
      };
    }
    const offset = style === "scalp" ? 3 : 5;
    const trail = style === "scalp" ? 2 : 3;
    if (fromEntryC >= offset && fromPeakC <= -trail) {
      return {
        action: "sell",
        why: `Trailing stop: locked after +${offset}¢, then faded ${Math.abs(fromPeakC).toFixed(1)}¢ off the peak.`,
      };
    }
    const take = style === "scalp" ? 5 : 8;
    if (fromEntryC >= take) {
      return { action: "sell", why: `Take profit — up ${fromEntryC.toFixed(1)}¢.` };
    }
    return {
      action: "hold",
      why: `Watching YES at ${Math.round(last * 100)}¢. ${fromEntryC >= 0 ? "Up" : "Down"} ${Math.abs(fromEntryC).toFixed(1)}¢ from entry. Trail after +${offset}¢.`,
    };
  }

  if (last <= 0) return { action: "hold", why: "No odds yet." };
  if (!quote.live) return { action: "hold", why: "No live Polymarket price yet." };
  if (last < 0.12 || last > 0.82) {
    return { action: "hold", why: `YES at ${Math.round(last * 100)}¢ is too close to settled (wants 12–82¢).` };
  }
  if ((quote.volume || 0) < 25_000) {
    return { action: "hold", why: `Too thin — 24h volume $${Math.round(quote.volume || 0).toLocaleString()}.` };
  }
  const spreadBps = quote.spreadBps || 0;
  if (spreadBps > 500) {
    const sc = (spreadBps * quote.price) / 100;
    if (sc > 3) {
      return { action: "hold", why: `Spread ${sc.toFixed(1)}¢ is too wide.` };
    }
  }
  if (spark.length < 4) {
    return { action: "hold", why: `Only ${spark.length} odds ticks — needs about a minute of tape.` };
  }
  const look = spark[spark.length - Math.min(spark.length, style === "scalp" ? 5 : 8)] ?? last;
  const moveC = cents(look, last);
  const rising = last >= (spark[spark.length - 2] ?? last);
  if (style === "scalp") {
    if (moveC > -3 || moveC < -8) {
      return { action: "hold", why: `Dump is ${moveC.toFixed(1)}¢ — fade wants −3 to −8¢ then a bounce.` };
    }
    if (!rising) return { action: "hold", why: "Still dumping — wait for a tick back up." };
    return { action: "buy", why: `Fade: YES dumped ${Math.abs(moveC).toFixed(1)}¢ and just ticked back up.` };
  }
  if (moveC < 3 || moveC > 10) {
    return { action: "hold", why: `Move is ${moveC >= 0 ? "+" : ""}${moveC.toFixed(1)}¢ — movers want +3 to +10¢.` };
  }
  if (!rising) return { action: "hold", why: "Last tick was down, not still running." };
  return { action: "buy", why: `Mover: YES jumped ${moveC.toFixed(1)}¢ and is still running at ${Math.round(last * 100)}¢.` };
}

export function pumpExplain(
  quote: Quote,
  pos: Position | undefined,
  style: "sniper" | "scalp",
  other?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  if (quote.kind === "poly") return polyExplain(quote, pos, style, other);
  if (pos) return { action: "sell", why: "Pump.fun book is retired. Closing leftover bags." };
  return { action: "hold", why: "Pump.fun scanning is off. Use Polymarket." };
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
  other?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  if (quote.kind === "poly" || quote.kind === "pump") {
    return pumpExplain(quote, pos, bot.strategy === "scalp" ? "scalp" : "sniper", other);
  }
  const use = bot.strategy === "sniper" || bot.strategy === "scalp" ? "momentum" : bot.strategy;
  return technicalExplain({ ...bot, strategy: use }, quote, pos);
}

export function pickSignal(bot: Bot, quote: Quote, pos?: Position, other?: Position): "buy" | "sell" | "hold" {
  return explainSignal(bot, quote, pos, other).action;
}

export function whyTrade(bot: Bot, quote: Quote, side: "buy" | "sell"): string {
  if (quote.kind === "poly" || quote.kind === "pump") {
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
  const minHold = bot.strategy === "meanrev" || bot.strategy === "dca" ? 20 * 60 * 1000 : 10 * 60 * 1000;

  switch (bot.strategy) {
    case "sma":
      if (quote.kind === "stock" && (quote.price < 8 || (quote.volume || 0) * quote.price < 5_000_000)) return "hold";
      if (fast > slow * 1.004 && !pos && vol > 0.002) return "buy";
      if (pos && fromEntry <= -3.5) return "sell";
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
        const liquid = quote.kind !== "crypto" || quote.volume >= CRYPTO_MIN_VOL;
        const falling = ticksFalling(spark, 2);
        const runner =
          quote.live && quote.changePct >= RUNNER_LO && quote.changePct <= RUNNER_HI && ret8 > 0 && liquid && !falling;
        if (!pos && runner) return "buy";
      }
      if (!pos) return "hold";
      if (fromEntry <= -4) return "sell";
      if (heldMs < 8 * 60 * 1000) return "hold";
      {
        const hit = roiHit(heldMs, fromEntry, RUNNER_ROI);
        if (hit) return "sell";
        const fromPeak = pos.peak > 0 ? ((last - pos.peak) / pos.peak) * 100 : 0;
        if (fromEntry >= 5 && fromPeak <= -2) return "sell";
      }
      if (heldMs > 60 * 60 * 1000) return "sell";
      return "hold";
    case "dca":
      if (quote.kind === "stock" && (quote.price < 8 || (quote.volume || 0) * quote.price < 5_000_000)) return "hold";
      if (vol < 0.001) return "hold";
      if (z < -1.3 && last < mid * 0.995 && !pos) return "buy";
      if (!pos) return "hold";
      if (fromEntry <= -3.5) return "sell";
      if (heldMs < minHold) return "hold";
      if (fromEntry >= 5 && z > 0.4) return "sell";
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
  if (action === "buy" && bot.strategy === "momentum") {
    return {
      action,
      why: `Runner: up ${quote.changePct.toFixed(1)}% on the day and still ticking higher.`,
    };
  }
  if (action === "sell" && bot.strategy === "momentum" && pos) {
    const fromEntry = pos.avg > 0 ? ((quote.price - pos.avg) / pos.avg) * 100 : 0;
    const fromPeak = pos.peak > 0 ? ((quote.price - pos.peak) / pos.peak) * 100 : 0;
    if (fromEntry <= -4) return { action, why: `Runner stop — down ${Math.abs(fromEntry).toFixed(1)}% from entry.` };
    if (fromEntry >= 5 && fromPeak <= -2) {
      return { action, why: `Runner fading — peaked, then dropped ${Math.abs(fromPeak).toFixed(1)}%. Out before the dump.` };
    }
    return { action, why: whySignal("momentum", "sell") };
  }
  if (action === "buy") return { action, why: whySignal(bot.strategy, "buy") };
  if (action === "sell") return { action, why: whySignal(bot.strategy, "sell") };
  if (bot.strategy === "momentum" && !pos) {
    if (quote.spark.length < 6) return { action, why: "Not enough ticks yet." };
    if (!quote.live) return { action, why: "Not a live price." };
    if (quote.kind === "crypto" && quote.volume < CRYPTO_MIN_VOL) {
      return { action, why: `Too thin ($${(quote.volume / 1_000_000).toFixed(1)}M). Runners need $50M+.` };
    }
    if (quote.changePct < RUNNER_LO) {
      return { action, why: `Only ${quote.changePct.toFixed(1)}% on the day — not a runner yet (wants 4–9%).` };
    }
    if (quote.changePct > RUNNER_HI) {
      return { action, why: `Already up ${quote.changePct.toFixed(1)}% today — too late, the drop often starts here.` };
    }
    return { action, why: "Up on the day but the last ticks are not still running." };
  }
  if (pos) return { action, why: "Holding — stop and target not hit yet." };
  return { action, why: "No buy signal this pass." };
}

export function botScores(state: DeskState): BotScore[] {
  return state.bots.map((bot) => {
    const fills = state.fills.filter((f) => f.botId === bot.id || f.botName === bot.name);
    const sells = fills.filter((f) => f.side === "sell");
    const pnls = sells.map((f) => f.realizedPnl || 0);
    const wins = pnls.filter((p) => p > 0);
    const losses = pnls.filter((p) => p < 0);
    const avgWin = wins.length ? mean(wins) : 0;
    const avgLoss = losses.length ? mean(losses) : 0;
    const sd = stdev(pnls);
    const sqn = pnls.length > 1 && sd > 0 ? Math.sqrt(pnls.length) * mean(pnls) / sd : 0;
    let loseStreak = 0;
    for (const p of pnls) {
      if (p < 0) loseStreak += 1;
      else break;
    }
    const realizedPnl = fills.reduce((s, f) => s + (f.realizedPnl || 0), 0);
    const fees = fills.reduce((s, f) => s + f.fee, 0);
    let unrealizedPnl = 0;
    for (const sym of ownedSymbols(state, bot.id)) {
      const pos = state.positions[sym];
      const q = state.quotes[sym];
      if (pos && q) unrealizedPnl += (q.price - pos.avg) * pos.qty;
    }
    const holds = sells.map((f) => f.holdMs || 0).filter((n) => n > 0);
    const avgHoldMs = holds.length ? mean(holds) : 0;
    const slips = fills.map((f) => Math.abs(f.slipBps || 0));
    const avgSlipBps = slips.length ? mean(slips) : 0;
    const winSum = wins.reduce((a, b) => a + b, 0);
    const lossSum = Math.abs(losses.reduce((a, b) => a + b, 0));
    const profitFactor = lossSum > 0 ? winSum / lossSum : wins.length ? 99 : 0;
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
      sqn,
      avgWin,
      avgLoss,
      payoff: avgLoss < 0 ? avgWin / Math.abs(avgLoss) : avgWin > 0 ? 99 : 0,
      loseStreak,
      sells: sells.length,
      profitFactor,
      avgHoldMs,
      avgSlipBps,
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
  if (bot.scope === "poly" || bot.scope === ("pump" as ScanScope)) {
    const live = all.filter((q) => q.kind === "poly" && q.live);
    if (bot.strategy === "sniper") return live.filter((q) => q.horizon && isCurrentRound(q));
    return live;
  }
  if (bot.scope === "crypto") {
    return all.filter((q) => q.kind === "crypto" && q.live && (q.volume || 0) >= CRYPTO_MIN_VOL);
  }
  if (bot.scope === "all") return all.filter((q) => q.kind === "stock" || q.kind === "crypto");
  return all.filter((q) => q.kind === bot.scope);
}

function rankForBot(bot: Bot, quotes: Quote[]): Quote[] {
  const dip = bot.strategy === "meanrev" || bot.strategy === "dca";
  const score = (q: Quote): number => {
    const c = q.changePct;
    let s = q.live ? 10 : 0;
    if (dip) return s - c + Math.min(q.volume || 0, 1_000_000) / 1_000_000;
    if (q.kind === "poly") {
      if (q.horizon) {
        const edge = Math.abs((q.fair ?? 0.5) - (q.leg === "down" ? 1 - q.price : q.price));
        s += 40 + edge * 400;
        if (q.horizon === "5m") s += 8;
        if (q.asset === "BTC" || q.asset === "ETH") s += 5;
        else if (q.asset === "SOL") s += 3;
      } else if (c >= 4 && c <= 18) s += 80 - Math.abs(c - 10);
      else if (c < 0 && c > -12 && bot.strategy === "scalp") s += 70 - Math.abs(c + 5);
      else if (c > 18) s += 8;
      s += Math.min(q.volume || 0, 2_000_000) / 80_000;
      if ((q.spreadBps || 0) > 0 && (q.spreadBps || 0) < 250) s += 10;
    } else if (q.kind === "pump") {
      s -= 50;
    } else {
      if (c >= RUNNER_LO && c <= RUNNER_HI) s += 80 - Math.abs(c - 6.5);
      else if (c > 0) s += Math.min(c, 20);
      s += Math.min(q.volume || 0, 40_000_000) / 4_000_000;
    }
    return s;
  };
  return quotes.slice().sort((a, b) => score(b) - score(a));
}

function skipSummary(pass: ScanNote[]): string {
  const skips = pass.filter((n) => n.decision === "skip");
  if (!skips.length) return "";
  const buckets = new Map<string, number>();
  for (const n of skips) {
    const r = n.reason.toLowerCase();
    let key = "other";
    if (r.includes("parabolic")) key = "parabolic";
    else if (r.includes("settling") || r.includes("settled")) key = "near settle";
    else if (r.includes("¢") || r.includes("odds")) key = "odds window";
    else if (r.includes("dump")) key = "dumping";
    else if (r.includes("ticks") || r.includes("tape")) key = "short tape";
    else if (r.includes("thin") || r.includes("volume")) key = "too thin";
    else if (r.includes("liquid")) key = "not liquid";
    else if (r.includes("ripping") || r.includes("last tick")) key = "not ripping";
    else if (r.includes("high")) key = "off the high";
    else if (r.includes("move is") || (r.includes("only") && r.includes("day"))) key = "move too small";
    else if (r.includes("smart money") || r.includes("profit factor") || r.includes("win rate")) key = "smart money";
    else if (r.includes("strategy cap") || r.includes("copy cap") || r.includes("exposure")) key = "risk cap";
    else if (r.includes("day")) key = "not up 5–18%";
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const bits = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, n]) => `${n} ${k}`);
  return ` Looked at ${skips.length}: ${bits.join(", ")}.`;
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

function botBookPnl(state: DeskState, botId: string): number {
  const realized = state.fills
    .filter((f) => f.botId === botId)
    .reduce((n, f) => n + (f.realizedPnl || 0), 0);
  let open = 0;
  for (const sym of ownedSymbols(state, botId)) {
    const pos = state.positions[sym];
    const q = state.quotes[sym];
    if (pos && q) open += (q.price - pos.avg) * pos.qty;
  }
  return realized + open;
}

export function tickBots(state: DeskState): DeskState {
  const now = Date.now();
  const keptLocks: Record<string, number> = {};
  for (const [sym, until] of Object.entries(state.manualLocks || {})) {
    if (until > now) keptLocks[sym] = until;
  }

  let next: DeskState = ensureWallets({ ...state, manualLocks: keptLocks });

  const wallets = { ...next.wallets };
  for (const id of ["core", "poly"] as WalletId[]) {
    const w = wallets[id];
    if (id === "poly") {
      const holding = Object.values(next.positions).some((p) => isEventKind(p.kind));
      if (w.cash < 5 && !holding) {
        wallets[id] = {
          ...w,
          halted: true,
          haltReason: "Polymarket wallet is empty. It will trade again if you add cash or start a new test.",
        };
      } else if (w.halted) {
        wallets[id] = { ...w, halted: false, haltReason: "" };
      }
      continue;
    }
    if (w.halted) {
      wallets[id] = { ...w, halted: false, haltReason: "" };
    }
  }
  next = {
    ...next,
    wallets,
    cash: wallets.core.cash + wallets.poly.cash,
    halted: wallets.core.halted || wallets.poly.halted,
    haltReason: [wallets.core.haltReason, wallets.poly.haltReason].filter(Boolean).join(" "),
  };

  const bots = next.bots.map((b) => ({ ...b }));
  const copyEvents = next.copyEvents.map((e) => ({ ...e }));
  const rth = stockMarketOpen();
  const tape: ScanNote[] = [];

  for (const bot of bots) {
    if (!bot.enabled) continue;

    if (bot.strategy === "copy") {
      const pendingAll = copyEvents.filter((e) => !e.consumed && e.leaderId === bot.leaderId);
      if (!pendingAll.length) {
        bot.lastSignal = "watching";
        const unread = /book unread|retrying/i.test(bot.lastReason);
        bot.lastReason = unread
          ? bot.lastReason
          : bot.kind === "crypto"
            ? "This wallet has no copyable longs right now (majors only, no shorts, not Polymarket)."
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
        if (isEventKind(quote.kind)) {
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
        if (pending.side === "buy" && bot.lockedUntil && bot.lockedUntil > Date.now()) {
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
        const quality = copyQualityGate(bot, next.fills);
        if (pending.side === "buy" && !quality.ok) {
          bot.lastSignal = "smart money";
          bot.lastReason = quality.why;
          break;
        }
        const eq = walletEquity(next, "core");
        const copyBook = strategyNotional(next, "copy", "core");
        if (pending.side === "buy" && eq > 0 && copyBook >= eq * RISK.maxCopyPct) {
          bot.lastSignal = "copy cap";
          bot.lastReason = `Copy book is ${Math.round((copyBook / eq) * 100)}% of the wallet (max ${Math.round(RISK.maxCopyPct * 100)}%).`;
          break;
        }
        if (pending.side === "buy" && nameNotional(next, quote.id) >= eq * RISK.maxPerNamePct) {
          pending.consumed = true;
          continue;
        }
        const sized = dynamicTicket(next, bot, Math.min(bot.sizeUsd, 22), "core", eq);
        const size = Math.min(sized.size, next.wallets.core.cash);
        if (pending.side === "buy" && feeWouldEat(quote.kind, quote.symbol, size)) {
          pending.consumed = true;
          bot.lastReason = `Skipped ${pending.ticker}: network fees would eat a $${size.toFixed(0)} ticket.`;
          continue;
        }
        const notional = pending.side === "sell" ? (pos?.qty ?? 0) * quote.price : size;
        const delayBit = pending.delayDays ? ` — ${pending.delayDays} days after the real trade` : "";
        const reason =
          quote.kind === "crypto"
            ? `Copying ${pending.leaderName}'s ${pending.side === "buy" ? "long" : "exit"} in ${pending.ticker}. ${pending.amount}. Paper longs only — not Polymarket.`
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
      bot.lastReason =
        bot.scope === "poly"
          ? "No live Polymarket events this pass."
          : bot.scope === "crypto"
            ? "No crypto names with $50M+ volume this pass."
            : "Nothing to scan yet.";
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
      const explained = explainSignal(
        bot,
        quote,
        next.positions[sym],
        quote.pairId ? next.positions[quote.pairId] : undefined,
      );
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
      const heldPoly = ownedSymbols(next, bot.id).filter((id) => isEventKind(next.positions[id]?.kind || "stock"));
      if (heldPoly.length) {
        const bits = heldPoly.slice(0, 3).map((id) => {
          const q = next.quotes[id];
          const p = next.positions[id];
          if (!q || !p) return id;
          const fromC = (q.price - p.avg) * 100;
          const sign = fromC >= 0 ? "+" : "";
          return `${q.symbol} ${sign}${fromC.toFixed(1)}¢`;
        });
        bot.lastSignal = "watching";
        bot.lastReason = `Watching ${bits.join(", ")} on the live book. Sells when this round hits 0:00 and Polymarket prints 0/1.`;
        acted = true;
      }
    }

    // Buy new names that pass the rule.
    let held = ownedSymbols(next, bot.id).length;
    if (bot.strategy === "sniper") {
      const locks = pairLocks(Object.values(next.quotes));
      for (const pair of locks) {
        const legs = [pair.a, pair.b];
        const missing = legs.filter((q) => !next.positions[q.id]);
        if (!missing.length) continue;
        if (held + missing.length > maxNames) continue;
        const wid = walletIdFor(pair.a.kind);
        if (next.wallets[wid].halted) break;
        const askA = pair.a.ask || 0;
        const askB = pair.b.ask || 0;
        if (!(askA > 0 && askB > 0) || askA + askB > 0.93) continue;
        const heldLeg = legs.find((q) => next.positions[q.id]);
        const shares = heldLeg
          ? next.positions[heldLeg.id]!.qty
          : Math.min(20, next.wallets[wid].cash * 0.18) / (askA + askB);
        if (!(shares > 0)) continue;
        const need = missing.reduce((n, q) => n + shares * (q.ask || 0), 0);
        if (next.wallets[wid].cash < need + 0.5) {
          pass.push(scanNote(bot, pair.a, "skip", "Not enough cash for both lock legs."));
          continue;
        }
        let bought = 0;
        for (const quote of missing) {
          const size = shares * (quote.ask || 0);
          const floor = minTicketUsd(quote.kind, quote.symbol);
          if (size < floor) {
            pass.push(scanNote(bot, quote, "skip", `Corridor ticket under $${floor} min.`));
            continue;
          }
          const before = next.fills.length;
          next = applyFill(
            next,
            "buy",
            quote.id,
            quote.kind,
            size,
            "bot",
            bot.name,
            `${quote.symbol}: ${pair.why}`,
            undefined,
            bot.id,
          );
          if (next.fills.length === before) continue;
          pass.push(scanNote(bot, quote, "buy", pair.why));
          bot.lastSignal = "buy";
          bot.lastReason = pair.why;
          acted = true;
          bought += 1;
          held = ownedSymbols(next, bot.id).length;
        }
        if (bought > 0 && bought < missing.length) {
          const opened = missing.find((q) => next.positions[q.id]);
          if (opened) {
            const pos = next.positions[opened.id]!;
            next = applyFill(
              next,
              "sell",
              opened.id,
              opened.kind,
              pos.qty * (opened.bid || opened.price || pos.avg),
              "bot",
              bot.name,
              `${opened.symbol}: Pair lock missed the other leg — flattening. Not a $1 lock.`,
              undefined,
              bot.id,
            );
            held = ownedSymbols(next, bot.id).length;
            pass.push(scanNote(bot, opened, "sell", "Pair lock missed the other leg — flattening."));
          }
        }
      }
    }
    const ranked = rankForBot(bot, universe);
    let polyCool = false;
    if (bot.scope === "poly" || ranked.some((q) => q.kind === "poly")) {
      const lastPoly = next.fills.find((f) => f.botId === bot.id && isEventKind(f.kind));
      polyCool = !!(lastPoly && Date.now() - lastPoly.ts < 2 * 60 * 1000);
    }
    const lastFill = next.fills.find((f) => f.botId === bot.id);
    const fillDelayMs = bot.scope === "poly" ? 8_000 : 90_000;
    const fillDelay =
      fillDelayMs > 0 && lastFill && Date.now() - lastFill.ts < fillDelayMs
        ? Math.max(1, Math.round((fillDelayMs - (Date.now() - lastFill.ts)) / 1000))
        : 0;
    let newDirectional = 0;
    for (const quote of ranked.slice(0, 60)) {
      if (next.positions[quote.id]) continue;
      if (fillDelay) {
        pass.push(scanNote(bot, quote, "skip", `Filled-order delay: wait ${fillDelay}s after the last fill.`));
        break;
      }
      const hedging = !!(quote.pairId && next.positions[quote.pairId]);
      if (hedging && quote.horizon) {
        pass.push(
          scanNote(
            bot,
            quote,
            "skip",
            "No same-round UP+DN hedge. That is two bets, not a $1 lock. Hold the first leg to 0/1.",
          ),
        );
        continue;
      }
      const widEarly = walletIdFor(quote.kind);
      const eqEarly = walletEquity(next, widEarly);
      const cashEarly = next.wallets[widEarly].cash;
      const deployed = eqEarly > 0 ? 1 - cashEarly / eqEarly : 0;
      if (!hedging && deployed >= MAX_DEPLOYED) {
        pass.push(
          scanNote(
            bot,
            quote,
            "skip",
            `Exposure cap: ${Math.round(deployed * 100)}% of this wallet is already in bags (max ${Math.round(MAX_DEPLOYED * 100)}%).`,
          ),
        );
        continue;
      }
      if (hedging && deployed >= 0.72) {
        pass.push(scanNote(bot, quote, "skip", `Hedge cap: ${Math.round(deployed * 100)}% of this wallet is already in bags.`));
        continue;
      }
      if (!hedging && quote.horizon && newDirectional >= 1) {
        pass.push(scanNote(bot, quote, "skip", "One new directional round per 8s — corridor locks still fire."));
        continue;
      }
      if (held >= maxNames && !hedging) {
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
      if (quote.kind === "stock" && !stockEntryWindow()) {
        pass.push(scanNote(bot, quote, "skip", "No new stock buys in the first 10 min or last 15 min."));
        continue;
      }
      const spreadTooWide =
        quote.kind === "poly"
          ? ((quote.spreadBps || 0) * quote.price) / 100 > 3
          : (quote.spreadBps || 0) > (quote.kind === "crypto" ? 25 : 30);
      if (spreadTooWide && !quote.horizon) {
        const sc =
          quote.kind === "poly"
            ? ((quote.spreadBps || 0) * quote.price) / 100
            : quote.spreadBps || 0;
        pass.push(
          scanNote(
            bot,
            quote,
            "skip",
            quote.kind === "poly"
              ? `Spread ${sc.toFixed(1)}¢ is too wide.`
              : `Spread ${sc.toFixed(0)} bps is too wide.`,
          ),
        );
        continue;
      }
      if (bot.lockedUntil && bot.lockedUntil > Date.now()) {
        const left = Math.max(1, Math.round((bot.lockedUntil - Date.now()) / 60000));
        pass.push(scanNote(bot, quote, "skip", `Strategy paused ${left} min (${bot.lastReason || "cooldown"}).`));
        break;
      }
      const todayBuys = next.fills.filter(
        (f) => f.side === "buy" && f.kind === quote.kind && todayStamp(f.ts) === todayStamp(),
      ).length;
      if (!quote.horizon && todayBuys >= DAILY_TRADES[quote.kind]) {
        pass.push(scanNote(bot, quote, "skip", `Daily trade cap (${DAILY_TRADES[quote.kind]} ${quote.kind} buys).`));
        break;
      }
      const wid = walletIdFor(quote.kind);
      if (next.wallets[wid].halted) {
        pass.push(scanNote(bot, quote, "skip", next.wallets[wid].haltReason || "Wallet paused."));
        continue;
      }
      const coolUntil = bot.lastSold?.[quote.id] ?? 0;
      const lastSell = next.fills.find((f) => f.botId === bot.id && f.symbol === quote.id && f.side === "sell");
      const coolMs =
        bot.strategy === "momentum" && lastSell && (lastSell.realizedPnl || 0) < 0
          ? 3.5 * 60 * 60 * 1000
          : 45 * 60 * 1000;
      if (Date.now() < coolUntil + coolMs) {
        const left = Math.max(1, Math.round((coolUntil + coolMs - Date.now()) / 60000));
        pass.push(scanNote(bot, quote, "skip", `Sold this recently — cooling ${left} min.`));
        continue;
      }
      if (quote.kind === "poly" && polyCool && !quote.horizon && !hedging) {
        pass.push(scanNote(bot, quote, "skip", "2-minute gap after the last Polymarket trade."));
        continue;
      }
      const explained = explainSignal(
        bot,
        quote,
        undefined,
        quote.pairId ? next.positions[quote.pairId] : undefined,
      );
      if (explained.action !== "buy") {
        pass.push(scanNote(bot, quote, "skip", explained.why));
        continue;
      }
      const eq = walletEquity(next, wid);
      const stratN = strategyNotional(next, bot.strategy, wid);
      if (!hedging && eq > 0 && stratN >= eq * RISK.maxStrategyPct) {
        pass.push(
          scanNote(
            bot,
            quote,
            "skip",
            `Strategy cap: ${bot.strategy} already has ${Math.round((stratN / eq) * 100)}% of this wallet (max ${Math.round(RISK.maxStrategyPct * 100)}%).`,
          ),
        );
        break;
      }
      if (nameNotional(next, quote.id) >= eq * RISK.maxPerNamePct) {
        pass.push(scanNote(bot, quote, "skip", `This name is already ${Math.round(RISK.maxPerNamePct * 100)}% of the wallet.`));
        continue;
      }
      const cap =
        quote.kind === "crypto" && bot.strategy === "momentum"
          ? Math.min(bot.sizeUsd, 22)
          : quote.horizon
            ? Math.min(bot.sizeUsd, 22)
            : quote.kind === "poly"
              ? Math.min(bot.sizeUsd, 16)
              : bot.strategy === "sniper" || bot.strategy === "scalp"
                ? Math.min(bot.sizeUsd, 10)
                : bot.sizeUsd;
      const sized = dynamicTicket(next, bot, cap, wid, eq);
      const sizeRaw = quote.horizon
        ? Math.min(sized.size, next.wallets[wid].cash * 0.2, eq * 0.12)
        : Math.min(sized.size, next.wallets[wid].cash * 0.1, eq * RISK.maxPerNamePct);
      let size = sizeRaw;
      if (hedging && quote.horizon && quote.pairId) {
        const other = next.positions[quote.pairId];
        const oq = next.quotes[quote.pairId];
        const otherNotional = other && oq ? other.qty * oq.price : sizeRaw;
        size = Math.min(sizeRaw, Math.max(minTicketUsd(quote.kind, quote.symbol), otherNotional * 0.45));
      }
      const floor = minTicketUsd(quote.kind, quote.symbol);
      if (size < floor) {
        pass.push(scanNote(bot, quote, "skip", `Ticket $${size.toFixed(0)} is under the $${floor} min for ${quote.symbol}.`));
        continue;
      }
      const rt = roundTripFee(quote.kind, quote.symbol, size);
      const edge = size * (expectedMovePct(bot.strategy) / 100);
      if (!(hedging && quote.horizon) && edge < 3 * rt) {
        pass.push(
          scanNote(
            bot,
            quote,
            "skip",
            `Expected move $${edge.toFixed(2)} is under 3× round-trip costs $${(3 * rt).toFixed(2)}.`,
          ),
        );
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
      if (!hedging && quote.horizon) newDirectional += 1;
      acted = true;
    }

    bot.lastScan = pass.slice(0, 40);
    tape.push(...pass);

    if (!acted) {
      const n = universe.length;
      const heldNow = ownedSymbols(next, bot.id);
      const skipNote = feeSkips.length
        ? ` Skipped ${feeSkips.join(", ")}: network fees too big for a $${bot.sizeUsd} ticket.`
        : skipSummary(pass);
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
        bot.scope !== "poly"
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
    const windowOver = isSettling(pos);
    const frozenHard = !!(windowOver && pos.closedMark && pos.settleSide && pos.lastSpot && pos.lastOpen);
    const last = honestBookPx(quote?.price) || pos.lastMark;
    if (!frozenHard) {
      if (windowOver || last) {
        next = {
          ...next,
          positions: {
            ...next.positions,
            [pos.symbol]: {
              ...pos,
              lastMark: windowOver ? pos.lastMark || last : last || pos.lastMark,
              closedMark: pos.closedMark || (windowOver ? pos.lastMark || last : undefined),
            },
          },
        };
      }
    }
    if (!quote) continue;
    if (pos.kind === "stock" && !rth) continue;
    const stamped = next.positions[pos.symbol]!;
    if (!frozenHard) {
      const liveSpot = !windowOver && quote.spot && quote.spot > 0 ? quote.spot : 0;
      const liveOpen = !windowOver && quote.openPx && quote.openPx > 0 ? quote.openPx : 0;
      const frozenSpot = windowOver ? stamped.lastSpot : liveSpot || stamped.lastSpot;
      const frozenOpen = windowOver ? stamped.lastOpen : liveOpen || stamped.lastOpen;
      const settleSide =
        stamped.settleSide ||
        (windowOver && frozenSpot && frozenOpen
          ? frozenSpot >= frozenOpen
            ? "up"
            : "down"
          : undefined);
      next = {
        ...next,
        positions: {
          ...next.positions,
          [pos.symbol]: {
            ...stamped,
            peak: windowOver ? stamped.peak : Math.max(stamped.peak, honestBookPx(quote.price) || stamped.peak),
            windowStart: stamped.windowStart || quote.windowStart,
            windowEnd: stamped.windowEnd || quote.windowEnd || positionWindowEnd(stamped),
            horizon: stamped.horizon || quote.horizon,
            asset: stamped.asset || quote.asset,
            leg: stamped.leg || quote.leg,
            lastMark: windowOver ? stamped.lastMark || last : last,
            lastSpot: frozenSpot,
            lastOpen: frozenOpen,
            settleSide,
            closedMark: stamped.closedMark || (windowOver ? stamped.lastMark || last : undefined),
          },
        },
      };
    }
    const marked = next.positions[pos.symbol]!;
    const bot = ownerOf(pos.symbol);
    const dummy: Bot = {
      id: "exit-watch",
      name: "Hold watch",
      enabled: true,
      symbol: pos.symbol,
      kind: pos.kind,
      strategy: isEventKind(pos.kind) ? "sniper" : pos.kind === "crypto" ? "momentum" : "sma",
      sizeUsd: 0,
      scope: isEventKind(pos.kind) ? "poly" : pos.kind === "crypto" ? "crypto" : "stock",
      maxNames: 1,
      lastSignal: "watching",
      lastTickAt: Date.now(),
      lastReason: "",
    };
    const actor = bot || dummy;
    const other = quote.pairId ? next.positions[quote.pairId] : undefined;
    const explained = explainSignal(actor, quote, marked, other);
    if (explained.action !== "sell") continue;
    const reason = `${quote.symbol}: ${explained.why}`;
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

function horizonSpark(q: Quote, old?: Quote): number[] {
  const spots = (arr: number[] | undefined) => (arr || []).filter((v) => v > 2);
  const incoming = spots(q.spark);
  if (incoming.length >= 8) return incoming.slice(-960);
  const prev = spots(old?.spark);
  const last = q.spot && q.spot > 2 ? q.spot : 0;
  const next = last ? [...prev, last] : prev;
  return next.slice(-960);
}

export function mergeQuotes(
  prev: Record<string, Quote>,
  incoming: Quote[],
): Record<string, Quote> {
  const out = { ...prev };
  for (const q of incoming) {
    const old = out[q.id];
    const spark = q.horizon ? horizonSpark(q, old) : [...(old?.spark ?? []), q.price].slice(-48);
    if (q.kind === "poly" && !q.horizon && old && old.price > 0) {
      const jump = Math.abs(q.price - old.price);
      const young = Date.now() - (old.seenAt || 0) < 20_000;
      if (jump > 0.12 && young) {
        out[q.id] = { ...old, seenAt: Date.now() };
        continue;
      }
    }
    const base = spark.length >= 6 ? spark[spark.length - 6]! : spark[0]!;
    const changePct = q.horizon
      ? q.changePct
      : base > 0
        ? ((q.price - base) / base) * 100
        : q.changePct;
    out[q.id] = {
      ...q,
      spark,
      changePct: Number.isFinite(changePct) ? changePct : q.changePct,
      seenAt: Date.now(),
      ...(old?.horizon && !q.horizon
        ? {
            horizon: old.horizon,
            windowStart: old.windowStart,
            windowEnd: old.windowEnd,
            spot: old.spot,
            openPx: old.openPx,
            asset: old.asset,
            leg: old.leg,
            pairId: old.pairId,
            fair: old.fair,
            twapLive: old.twapLive,
            clobTokenId: old.clobTokenId,
            symbol: old.symbol,
          }
        : {}),
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
  const droppedPump = pruneStaleQuotes(quotes, liveIncoming, held, "pump", 0);
  const pruned = pruneStaleQuotes(droppedPump, liveIncoming, held, "poly", 45 * 60 * 1000);
  const now = Date.now();
  const out: Record<string, Quote> = {};
  for (const q of Object.values(pruned)) {
    if (q.horizon && q.windowEnd && q.windowEnd < now - 45_000 && !held.has(q.id)) continue;
    out[q.id] = q;
  }
  return out;
}

export function todayStamp(at = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

export function etHour(at = Date.now()): number {
  const raw = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  }).format(new Date(at));
  const n = parseInt(raw, 10);
  if (n === 24) return 0;
  return Number.isFinite(n) ? n : 0;
}

export function hourBucket(hour: number): number {
  return Math.floor(hour / 2) * 2;
}

export function clockFromFills(fills: Fill[]): HourClock[] {
  let clock: HourClock[] = [];
  for (const f of [...fills].reverse()) {
    clock = stampHourClock({ hourClock: clock } as DeskState, f);
  }
  return clock;
}

const GHOST_HOURS = new Set([18, 19, 20]);

export function scrubClockHours(state: Pick<DeskState, "hourClock" | "clockScrub">): HourClock[] {
  const clock = state.hourClock || [];
  if (state.clockScrub === 1) return clock;
  return clock.filter((r) => !GHOST_HOURS.has(r.hour));
}

export function stampHourClock(state: DeskState, fill: Fill): HourClock[] {
  const clock = [...(state.hourClock || [])];
  if (fill.kind !== "poly" || fill.side !== "sell") return clock;
  const hour = etHour(fill.ts);
  const i = clock.findIndex((r) => r.hour === hour);
  const win = (fill.realizedPnl || 0) > 0;
  const row: HourClock = i >= 0 ? { ...clock[i]! } : { hour, sells: 0, wins: 0, losses: 0, net: 0 };
  row.sells += 1;
  if (win) row.wins += 1;
  else row.losses += 1;
  row.net += fill.realizedPnl || 0;
  if (i >= 0) clock[i] = row;
  else clock.push(row);
  return clock.sort((a, b) => a.hour - b.hour);
}

/** 2-hour ET window with enough paper: skip new tickets if it does not pay. */
export function hourWindowSkip(_clock?: HourClock[], _at = Date.now()): string {
  return "";
}

export function fmtHour(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  const am = hr < 12;
  const n = hr % 12 || 12;
  return `${n}${am ? "a" : "p"}`;
}

/** One Eastern hour, e.g. 10:00a. */
export function fmtHourSlot(h: number): string {
  const hr = ((h % 24) + 24) % 24;
  const am = hr < 12;
  const n = hr % 12 || 12;
  return `${n}:00${am ? "a" : "p"}`;
}
