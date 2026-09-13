import { feeBps, slipBps } from "./universe";
import type { Bot, DeskState, Fill, MarketKind, Position, Quote } from "./types";

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function markToMarket(state: Pick<DeskState, "cash" | "positions" | "quotes">): number {
  let eq = state.cash;
  for (const p of Object.values(state.positions)) {
    const q = state.quotes[p.symbol];
    if (!q) continue;
    eq += p.qty * q.price;
  }
  return eq;
}

export function applyFill(
  state: DeskState,
  side: "buy" | "sell",
  symbol: string,
  kind: MarketKind,
  notional: number,
  source: Fill["source"],
  botName?: string,
  note?: string,
): DeskState {
  const quote = state.quotes[symbol];
  if (!quote || quote.price <= 0) return state;

  const slip = slipBps(kind) / 10_000;
  const px = side === "buy" ? quote.price * (1 + slip) : quote.price * (1 - slip);
  let qty = notional / px;
  const pos = state.positions[symbol];

  if (side === "sell") {
    if (!pos || pos.qty <= 0) return state;
    qty = Math.min(qty, pos.qty);
  } else {
    const maxNotional = state.cash * 0.98;
    if (notional > maxNotional) qty = maxNotional / px;
    if (qty * px < 1) return state;
  }

  const gross = qty * px;
  const fee = gross * (feeBps(kind) / 10_000);

  if (side === "buy" && state.cash < gross + fee) return state;

  const fill: Fill = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    ts: Date.now(),
    side,
    symbol,
    kind,
    qty,
    price: px,
    fee,
    source,
    botName,
    note,
  };

  const positions = { ...state.positions };
  let cash = state.cash;

  if (side === "buy") {
    cash -= gross + fee;
    const prev = positions[symbol];
    if (!prev) {
      positions[symbol] = { symbol, kind, qty, avg: px, peak: px };
    } else {
      const newQty = prev.qty + qty;
      const avg = (prev.avg * prev.qty + px * qty) / newQty;
      positions[symbol] = {
        ...prev,
        qty: newQty,
        avg,
        peak: Math.max(prev.peak, quote.price),
      };
    }
  } else {
    cash += gross - fee;
    const prev = positions[symbol]!;
    const left = prev.qty - qty;
    if (left <= 1e-12) delete positions[symbol];
    else positions[symbol] = { ...prev, qty: left };
  }

  return {
    ...state,
    cash,
    positions,
    fills: [fill, ...state.fills].slice(0, 200),
  };
}

function signal(bot: Bot, quote: Quote, pos?: Position): "buy" | "sell" | "hold" {
  const spark = quote.spark;
  const last = quote.price;
  if (spark.length < 5) return "hold";

  const fast = mean(spark.slice(-5));
  const slow = mean(spark.slice(-20));
  const window = spark.slice(-20);
  const sd = stdev(window);
  const z = sd ? (last - mean(window)) / sd : 0;
  const ret8 =
    spark.length >= 9 ? ((last - spark[spark.length - 9]!) / spark[spark.length - 9]!) * 100 : 0;

  switch (bot.strategy) {
    case "sma":
      if (fast > slow * 1.001 && !pos) return "buy";
      if (fast < slow * 0.999 && pos) return "sell";
      return "hold";
    case "meanrev":
      if (z < -1.15 && !pos) return "buy";
      if ((z > 0.4 || z > 1.15) && pos) return "sell";
      return "hold";
    case "momentum":
      if (ret8 > 1.4 && !pos) return "buy";
      if ((ret8 < -0.8 || (pos && last > pos.avg * 1.04)) && pos) return "sell";
      return "hold";
    case "dca":
      if (last < slow && !pos) return "buy";
      if (pos && last > pos.avg * 1.06) return "sell";
      return "hold";
    case "sniper": {
      if (quote.changePct > 6 && !pos) return "buy";
      if (pos) {
        const fromPeak = ((last - pos.peak) / pos.peak) * 100;
        const fromEntry = ((last - pos.avg) / pos.avg) * 100;
        if (fromPeak < -12 || fromEntry < -18 || quote.changePct < -10) return "sell";
      }
      return "hold";
    }
    default:
      return "hold";
  }
}

export function tickBots(state: DeskState): DeskState {
  if (state.halted) return state;

  let next = state;
  const equity = markToMarket(state);
  const lossPct = ((equity - state.dayStartEquity) / state.dayStartEquity) * 100;
  if (lossPct <= -state.maxDailyLossPct) {
    return {
      ...state,
      halted: true,
      haltReason: `Daily loss halt at ${lossPct.toFixed(2)}%`,
      bots: state.bots.map((b) => ({ ...b, enabled: false, lastSignal: "halted" })),
    };
  }

  const bots = next.bots.map((b) => ({ ...b }));

  for (const bot of bots) {
    if (!bot.enabled) continue;
    const quote = next.quotes[bot.symbol];
    if (!quote) {
      bot.lastSignal = "no quote";
      continue;
    }
    const pos = next.positions[bot.symbol];
    if (pos) {
      next = {
        ...next,
        positions: {
          ...next.positions,
          [bot.symbol]: { ...pos, peak: Math.max(pos.peak, quote.price) },
        },
      };
    }
    const sig = signal(bot, quote, next.positions[bot.symbol]);
    bot.lastSignal = sig;
    bot.lastTickAt = Date.now();
    if (sig === "hold") continue;

    const eq = markToMarket(next);
    const cap = eq * 0.25;
    const size = Math.min(bot.sizeUsd, cap, next.cash);
    if (sig === "buy" && size < 10) continue;
    const notional = sig === "sell" ? (next.positions[bot.symbol]?.qty ?? 0) * quote.price : size;
    next = applyFill(next, sig, bot.symbol, bot.kind, notional, "bot", bot.name, bot.strategy);
  }

  const v = markToMarket(next);
  const equitySeries = [...next.equity, { t: Date.now(), v }].slice(-240);

  return { ...next, bots, equity: equitySeries };
}

export function mergeQuotes(
  prev: Record<string, Quote>,
  incoming: Quote[],
): Record<string, Quote> {
  const out = { ...prev };
  for (const q of incoming) {
    const old = out[q.id];
    const spark = [...(old?.spark ?? []), q.price].slice(-48);
    out[q.id] = { ...q, spark };
  }
  return out;
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
