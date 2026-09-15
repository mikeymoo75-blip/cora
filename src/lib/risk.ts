import type { Bot, CopyQuality, DeskState, Fill, MarketKind, RiskLayer, RiskView, StrategyId, Wallet, WalletId } from "./types";

/**
 * Risk knobs from Polymarket Trading Bot v3.1 (MrFadiAi), sized for a $1,000
 * paper desk. Layers shrink tickets — they do not halt, so overnight paper
 * tests keep running.
 */
export const RISK = {
  dailyMaxLossPct: 0.05,
  monthlyMaxLossPct: 0.15,
  maxDrawdownPct: 0.25,
  totalMaxLossPct: 0.4,
  maxPerNamePct: 0.1,
  maxStrategyPct: 0.3,
  maxCopyPct: 0.25,
  minPositionPct: 0.01,
  maxPositionPct: 0.05,
  lossSizingReduction: 0.2,
  winSizingIncrease: 0.1,
  streakReduceAfter: 2,
  copyMinWinRate: 0.55,
  copyMinProfitFactor: 1.3,
  copyMinSells: 8,
  copyMaxSingleShare: 0.35,
} as const;

function wid(kind: MarketKind): WalletId {
  return kind === "poly" || kind === "pump" ? "poly" : "core";
}

export function monthStamp(at = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(at));
  const y = parts.find((p) => p.type === "year")?.value || "2026";
  const m = parts.find((p) => p.type === "month")?.value || "01";
  return `${y}-${m}`;
}

export function consecutiveStreak(sellsNewestFirst: Fill[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  for (const f of sellsNewestFirst) {
    const p = f.realizedPnl || 0;
    if (wins === 0 && losses === 0) {
      if (p < 0) losses = 1;
      else if (p > 0) wins = 1;
      continue;
    }
    if (losses > 0) {
      if (p < 0) losses += 1;
      else break;
    } else if (p > 0) wins += 1;
    else break;
  }
  return { wins, losses };
}

function layerStatus(usedPct: number): RiskLayer["status"] {
  if (usedPct >= 100) return "hot";
  if (usedPct >= 60) return "warn";
  return "ok";
}

export function sizeMultiplier(input: {
  equity: number;
  starting: number;
  dayPnl: number;
  monthPnl: number;
  peak: number;
  consecutiveLosses: number;
  consecutiveWins: number;
}): { mult: number; why: string } {
  const bits: string[] = [];
  let layer = 1;
  const dailyLimit = input.starting * RISK.dailyMaxLossPct;
  if (input.dayPnl <= -dailyLimit && dailyLimit > 0) {
    layer = Math.min(layer, 0.55);
    bits.push(`daily loss ${Math.abs(input.dayPnl).toFixed(0)} ≥ 5%`);
  }
  const monthLimit = input.starting * RISK.monthlyMaxLossPct;
  if (input.monthPnl <= -monthLimit && monthLimit > 0) {
    layer = Math.min(layer, 0.45);
    bits.push(`month loss ≥ 15%`);
  }
  const peak = Math.max(input.peak, input.equity, 1);
  const dd = (peak - input.equity) / peak;
  if (dd >= RISK.maxDrawdownPct) {
    layer = Math.min(layer, 0.4);
    bits.push(`drawdown ${(dd * 100).toFixed(0)}% from peak`);
  }
  const totalLoss = input.starting - input.equity;
  if (totalLoss >= input.starting * RISK.totalMaxLossPct) {
    layer = Math.min(layer, 0.3);
    bits.push(`total loss ≥ 40%`);
  }

  let streak = 1;
  if (input.consecutiveLosses > RISK.streakReduceAfter) {
    streak = Math.pow(1 - RISK.lossSizingReduction, input.consecutiveLosses - RISK.streakReduceAfter);
    bits.push(`${input.consecutiveLosses} losses in a row → tickets ×${streak.toFixed(2)}`);
  } else if (input.consecutiveWins >= 3) {
    streak = Math.min(1.2, Math.pow(1 + RISK.winSizingIncrease, input.consecutiveWins - 2));
    if (streak > 1.02) bits.push(`${input.consecutiveWins} wins in a row → tickets ×${streak.toFixed(2)}`);
  }

  const mult = Math.max(0.25, Math.min(1.5, layer * streak));
  const why =
    bits.length === 0
      ? "Full ticket. Risk layers are quiet."
      : `Paper keeps trading. ${bits.join(". ")}.`;
  return { mult, why };
}

export function copyQualityGate(bot: Bot, fills: Fill[]): CopyQuality {
  const sells = fills.filter((f) => (f.botId === bot.id || f.botName === bot.name) && f.side === "sell");
  const wins = sells.filter((f) => (f.realizedPnl || 0) > 0);
  const winSum = wins.reduce((n, f) => n + (f.realizedPnl || 0), 0);
  const lossSum = Math.abs(
    sells.filter((f) => (f.realizedPnl || 0) < 0).reduce((n, f) => n + (f.realizedPnl || 0), 0),
  );
  const pf = lossSum > 0 ? winSum / lossSum : wins.length ? 99 : 0;
  const winRate = sells.length ? wins.length / sells.length : 0;
  const realized = sells.reduce((n, f) => n + (f.realizedPnl || 0), 0);
  const biggest = sells.reduce((m, f) => Math.max(m, Math.abs(f.realizedPnl || 0)), 0);
  const share = Math.abs(realized) > 1 ? biggest / Math.abs(realized) : 0;

  if (sells.length < RISK.copyMinSells) {
    return {
      botId: bot.id,
      name: bot.name,
      ok: true,
      why: `Only ${sells.length} closed copies — filter waits for ${RISK.copyMinSells}.`,
      winRate,
      profitFactor: pf,
      sells: sells.length,
    };
  }
  if (winRate < RISK.copyMinWinRate && sells.length >= 10) {
    return {
      botId: bot.id,
      name: bot.name,
      ok: false,
      why: `Smart money skip: win rate ${(winRate * 100).toFixed(0)}% (wants ${Math.round(RISK.copyMinWinRate * 100)}%+).`,
      winRate,
      profitFactor: pf,
      sells: sells.length,
    };
  }
  if (pf < RISK.copyMinProfitFactor) {
    return {
      botId: bot.id,
      name: bot.name,
      ok: false,
      why: `Smart money skip: profit factor ${pf.toFixed(2)} (wants ${RISK.copyMinProfitFactor}+).`,
      winRate,
      profitFactor: pf,
      sells: sells.length,
    };
  }
  if (share > RISK.copyMaxSingleShare && realized > 0) {
    return {
      botId: bot.id,
      name: bot.name,
      ok: false,
      why: `Whale filter: one copy is ${(share * 100).toFixed(0)}% of this book's P/L.`,
      winRate,
      profitFactor: pf,
      sells: sells.length,
    };
  }
  return {
    botId: bot.id,
    name: bot.name,
    ok: true,
    why: `Passes smart money (${(winRate * 100).toFixed(0)}% wins, PF ${pf.toFixed(2)}).`,
    winRate,
    profitFactor: pf,
    sells: sells.length,
  };
}

export function strategyNotional(state: DeskState, strategy: StrategyId, walletId: WalletId): number {
  const botIds = new Set(state.bots.filter((b) => b.strategy === strategy).map((b) => b.id));
  let n = 0;
  for (const p of Object.values(state.positions || {})) {
    if (wid(p.kind) !== walletId) continue;
    const last = state.fills.find((f) => f.symbol === p.symbol && f.botId);
    if (!last || !botIds.has(last.botId || "")) continue;
    const q = state.quotes[p.symbol];
    n += p.qty * (q?.price || p.avg);
  }
  return n;
}

export function nameNotional(state: DeskState, symbol: string): number {
  const p = state.positions[symbol];
  if (!p) return 0;
  const q = state.quotes[symbol];
  return p.qty * (q?.price || p.avg);
}

export function dynamicTicket(
  state: DeskState,
  bot: Bot,
  base: number,
  walletId: WalletId,
  equity: number,
): { size: number; why: string; mult: number } {
  const w = state.wallets[walletId];
  const sells = state.fills.filter((f) => f.botId === bot.id && f.side === "sell");
  const streak = consecutiveStreak(sells);
  const dayPnl = equity - (w?.dayStartEquity || equity);
  const monthPnl = equity - (w?.monthStartEquity || w?.startingCash || equity);
  const peak = Math.max(w?.peakEquity || equity, equity);
  const { mult, why } = sizeMultiplier({
    equity,
    starting: w?.startingCash || equity,
    dayPnl,
    monthPnl,
    peak,
    consecutiveLosses: streak.losses,
    consecutiveWins: streak.wins,
  });
  const poly = walletId === "poly";
  const floor = Math.max(poly ? 12 : 5, equity * RISK.minPositionPct);
  const capPct = poly ? 0.12 : RISK.maxPositionPct;
  const cap = equity * capPct;
  const perName = equity * (poly ? Math.max(RISK.maxPerNamePct, 0.12) : RISK.maxPerNamePct);
  const size = Math.max(floor, Math.min(cap, base * mult, perName));
  return { size, why, mult };
}

function layerOf(
  id: RiskLayer["id"],
  label: string,
  usd: number,
  starting: number,
  limitPct: number,
): RiskLayer {
  const limitUsd = starting * limitPct;
  const usedPct = limitUsd > 0 && usd < 0 ? Math.min(160, (Math.abs(usd) / limitUsd) * 100) : 0;
  return { id, label, usedPct, limitPct: limitPct * 100, usd, status: layerStatus(usedPct) };
}

export function blankWalletRisk(cash: number): Pick<Wallet, "peakEquity" | "monthStamp" | "monthStartEquity"> {
  return {
    peakEquity: cash,
    monthStamp: monthStamp(),
    monthStartEquity: cash,
  };
}

export function riskView(state: DeskState, equityNow: number): RiskView {
  const starting = state.startingCash || 1000;
  const peak = Math.max(
    state.wallets?.core?.peakEquity || 0,
    state.wallets?.poly?.peakEquity || 0,
    equityNow,
    starting,
  );
  const dayPnl = equityNow - (state.dayStartEquity || starting);
  const monthStart =
    (state.wallets?.core?.monthStartEquity || 0) + (state.wallets?.poly?.monthStartEquity || 0) || starting;
  const monthPnl = equityNow - monthStart;
  const totalPnl = equityNow - starting;
  const dd = peak > 0 ? (peak - equityNow) / peak : 0;
  const sells = state.fills.filter((f) => f.side === "sell");
  const streak = consecutiveStreak(sells);
  const sized = sizeMultiplier({
    equity: equityNow,
    starting,
    dayPnl,
    monthPnl,
    peak,
    consecutiveLosses: streak.losses,
    consecutiveWins: streak.wins,
  });

  return {
    layers: [
      layerOf("daily", "Daily", dayPnl, starting, RISK.dailyMaxLossPct),
      layerOf("month", "Month", monthPnl, starting, RISK.monthlyMaxLossPct),
      layerOf("drawdown", "Drawdown", -dd * peak, peak, RISK.maxDrawdownPct),
      layerOf("total", "Total", totalPnl, starting, RISK.totalMaxLossPct),
    ],
    sizeMult: sized.mult,
    sizeWhy: sized.why,
    copyQuality: state.bots.filter((b) => b.strategy === "copy" && b.enabled).map((b) => copyQualityGate(b, state.fills)),
    peakEquity: peak,
    drawdownPct: dd * 100,
  };
}

export function touchWalletRisk(
  wallet: Wallet,
  equity: number,
  at = Date.now(),
): Wallet {
  const month = monthStamp(at);
  const peak = Math.max(wallet.peakEquity || equity, equity, wallet.startingCash || 0);
  if (wallet.monthStamp !== month) {
    return {
      ...wallet,
      peakEquity: peak,
      monthStamp: month,
      monthStartEquity: equity,
    };
  }
  return {
    ...wallet,
    peakEquity: peak,
    monthStamp: wallet.monthStamp || month,
    monthStartEquity: wallet.monthStartEquity || equity,
  };
}
