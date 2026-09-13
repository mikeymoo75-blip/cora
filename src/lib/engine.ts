import { calcFees } from "./fees";
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
  StrategyId,
} from "./types";

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
      buy: "Price is stretched well below its recent range, so the bot is buying a dip.",
      sell: "Price bounced back toward the middle of its recent range, so the bot is taking the bounce.",
    },
    momentum: {
      buy: "Price jumped about 1.4% in the last few ticks, so the bot is riding strength.",
      sell: "The bounce faded, or the position is up about 4%, so the bot is taking profit / cutting.",
    },
    dca: {
      buy: "Price is sitting below its recent average, so the bot is buying a fixed dollar dip.",
      sell: "The position is up about 6% from cost, so the bot is cashing in.",
    },
    sniper: {
      buy: "Pump.fun sniper: the coin is ripping and still near its highs. Tight stop — these can go to zero.",
      sell: "Pump.fun sniper exit: it dumped off the peak, hit the hard stop, or the tape flipped. No averaging down.",
    },
    scalp: {
      buy: "Pump.fun scalp: a short pop. This bot wants a quick hit, not a hold.",
      sell: "Pump.fun scalp exit: took about +12%, or a small drop hit. Out before a rug.",
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
  const fees = calcFees(kind, side, quote.symbol, qty, gross);

  if (side === "buy" && state.cash < gross + fees.total) return state;

  let realizedPnl = 0;
  const positions = { ...state.positions };
  let cash = state.cash;

  if (side === "buy") {
    cash -= gross + fees.total;
    const prev = positions[symbol];
    const cost = gross + fees.total;
    if (!prev) {
      positions[symbol] = { symbol, kind, qty, avg: cost / qty, peak: quote.price };
    } else {
      const newQty = prev.qty + qty;
      const avg = (prev.avg * prev.qty + cost) / newQty;
      positions[symbol] = {
        ...prev,
        qty: newQty,
        avg,
        peak: Math.max(prev.peak, quote.price),
      };
    }
  } else {
    const prev = positions[symbol]!;
    const proceeds = gross - fees.total;
    cash += proceeds;
    realizedPnl = proceeds - prev.avg * qty;
    const left = prev.qty - qty;
    if (left <= 1e-12) delete positions[symbol];
    else positions[symbol] = { ...prev, qty: left };
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

  return {
    ...state,
    cash,
    positions,
    fills: [fill, ...state.fills].slice(0, 400),
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

/** Pump.fun is not a stock. No dip-buying, tight trail, fast take-profit. */
export function pumpSignal(
  quote: Quote,
  pos: Position | undefined,
  style: "sniper" | "scalp",
): "buy" | "sell" | "hold" {
  const spark = quote.spark;
  const last = quote.price;
  if (spark.length < 4 || last <= 0) return "hold";

  const recent = spark.slice(style === "scalp" ? -4 : -6);
  const recentHigh = Math.max(...recent);
  const rising = last > (spark[spark.length - 3] ?? last);
  const nearHigh = last >= recentHigh * (style === "scalp" ? 0.98 : 0.97);
  const alreadyDumping = last < recentHigh * 0.92 || quote.changePct < 0;

  if (pos) {
    const fromPeak = ((last - pos.peak) / pos.peak) * 100;
    const fromEntry = ((last - pos.avg) / pos.avg) * 100;
    if (style === "scalp") {
      if (fromPeak <= -4 || fromEntry <= -8 || fromEntry >= 12) return "sell";
      if (quote.changePct < -8 || ticksFalling(spark, 3)) return "sell";
    } else {
      if (fromPeak <= -7 || fromEntry <= -12 || fromEntry >= 28) return "sell";
      if (quote.changePct < -10 || ticksFalling(spark, 4)) return "sell";
    }
    return "hold";
  }

  if (alreadyDumping || !rising || !nearHigh) return "hold";
  if (style === "scalp" && quote.changePct > 5) return "buy";
  if (style === "sniper" && quote.changePct > 8) return "buy";
  return "hold";
}

export function pickSignal(bot: Bot, quote: Quote, pos?: Position): "buy" | "sell" | "hold" {
  if (quote.kind === "pump") {
    return pumpSignal(quote, pos, bot.strategy === "scalp" ? "scalp" : "sniper");
  }
  if (bot.strategy === "sniper" || bot.strategy === "scalp") {
    return technicalSignal({ ...bot, strategy: "momentum" }, quote, pos);
  }
  return technicalSignal(bot, quote, pos);
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
    default:
      return "hold";
  }
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
  if (bot.scope === "all") return all;
  return all.filter((q) => q.kind === bot.scope);
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
      haltReason: `Paused: the paper book is down ${lossPct.toFixed(1)}% today (8% daily brake).`,
      bots: state.bots.map((b) => ({
        ...b,
        enabled: false,
        lastSignal: "halted",
        lastReason: "Daily loss brake hit. Turn bots back on after you resume.",
      })),
    };
  }

  const bots = next.bots.map((b) => ({ ...b }));
  const copyEvents = next.copyEvents.map((e) => ({ ...e }));
  const rth = stockMarketOpen();

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
        if (pending.side === "buy" && held >= maxNames) {
          pending.consumed = true;
          continue;
        }
        bot.symbol = quote.id;
        bot.kind = quote.kind;
        const eq = markToMarket(next);
        const size = Math.min(bot.sizeUsd, eq * 0.25, next.cash);
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
    const maxNames = Math.max(1, bot.maxNames || 4);

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
      const sig = pickSignal(bot, quote, next.positions[sym]);
      if (sig !== "sell") continue;
      const notional = pos.qty * quote.price;
      const reason = `${quote.symbol}: ${whyTrade(bot, quote, "sell")}`;
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
      acted = true;
    }

    // Buy new names that pass the rule.
    let held = ownedSymbols(next, bot.id).length;
    for (const quote of universe) {
      if (held >= maxNames) break;
      if (next.positions[quote.id]) continue;
      if (quote.kind === "stock" && !rth) continue;
      const sig = pickSignal(bot, quote, undefined);
      if (sig !== "buy") continue;
      const eq = markToMarket(next);
      const size = Math.min(bot.sizeUsd, eq * 0.2, next.cash);
      if (size < 10) break;
      const reason = `${quote.symbol}: ${whyTrade(bot, quote, "buy")}`;
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
      held += 1;
      acted = true;
    }

    if (!acted) {
      const n = universe.length;
      const heldNow = ownedSymbols(next, bot.id);
      bot.lastSignal = "scanning";
      bot.lastReason =
        bot.scope === "one"
          ? `Watching ${next.quotes[bot.symbol]?.symbol ?? bot.symbol} — no buy or sell yet.`
          : `Scanned ${n} name${n === 1 ? "" : "s"}. Holding ${heldNow.length}/${maxNames}. No new signal this pass.`;
      if (universe.some((q) => q.kind === "stock") && !rth && bot.scope !== "crypto" && bot.scope !== "pump") {
        bot.lastReason += " Stock names wait until 9:30–4:00 ET.";
      }
    }
  }

  const v = markToMarket(next);
  const equitySeries = [...next.equity, { t: Date.now(), v }].slice(-480);

  return { ...next, bots, copyEvents, equity: equitySeries };
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
