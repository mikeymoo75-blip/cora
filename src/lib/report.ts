import { clockFromFills, fmtHourSlot, sqnLabel, walletViews, walletIdFor, botScores, markToMarket } from "./engine";
import { money, pct, signedMoney } from "./format";
import { copyQualityGate, riskView } from "./risk";
import type { DeskReport, DeskState } from "./types";
import { STRATEGY_COPY } from "./universe";

function mean(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function buildReport(state: DeskState): DeskReport {
  const views = walletViews(state);
  const core = views.find((w) => w.id === "core")!;
  const pump = views.find((w) => w.id === "poly")!;
  const scores = [...state.bots].map((bot) => {
    const fills = state.fills.filter((f) => f.botId === bot.id || f.botName === bot.name);
    const sells = fills.filter((f) => f.side === "sell");
    const pnls = sells.map((f) => f.realizedPnl || 0);
    const wins = sells.filter((f) => f.realizedPnl > 0);
    const losses = pnls.filter((p) => p < 0);
    const realized = fills.reduce((n, f) => n + (f.realizedPnl || 0), 0);
    const fees = fills.reduce((n, f) => n + f.fee, 0);
    const sd = stdev(pnls);
    const sqn = pnls.length > 1 && sd > 0 ? (Math.sqrt(pnls.length) * mean(pnls)) / sd : 0;
    const avgWin = wins.length ? mean(wins.map((f) => f.realizedPnl || 0)) : 0;
    const avgLoss = losses.length ? mean(losses) : 0;
    const winSum = wins.reduce((n, f) => n + (f.realizedPnl || 0), 0);
    const lossSum = Math.abs(losses.reduce((a, b) => a + b, 0));
    return {
      bot,
      trades: fills.length,
      sells: sells.length,
      wins: wins.length,
      winRate: sells.length ? (wins.length / sells.length) * 100 : 0,
      realized,
      fees,
      net: realized,
      sqn,
      avgWin,
      avgLoss,
      profitFactor: lossSum > 0 ? winSum / lossSum : wins.length ? 99 : 0,
    };
  });
  scores.sort((a, b) => a.net - b.net);

  const lines: string[] = [];
  const when = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  });
  lines.push(`CORA DESK REPORT  ${when} ET`);
  lines.push("Paper money. Paste this into the Cora chat if you want Grok to tweak the bots.");
  lines.push("");
  lines.push("WALLETS (Polymarket cannot spend stocks/crypto cash)");
  lines.push(
    `  Stocks + crypto: cash ${money(core.cash)}  value ${money(core.equity)}  P/L ${money(core.netPnl)}  today ${money(core.dayPnl)}  fees ${money(core.feesPaid)}`,
  );
  lines.push(
    `  Polymarket:      cash ${money(pump.cash)}  value ${money(pump.equity)}  P/L ${money(pump.netPnl)}  today ${money(pump.dayPnl)}  fees ${money(pump.feesPaid)}`,
  );
  if (core.halted) lines.push(`  CORE PAUSED — ${core.haltReason}`);
  if (pump.halted) lines.push(`  POLY PAUSED — ${pump.haltReason}`);
  lines.push("");

  const risk = riskView(state, markToMarket(state));
  lines.push("RISK (Polymarket v3.1 layers — paper shrinks tickets, does not halt)");
  for (const layer of risk.layers) {
    const bar = `${layer.usedPct.toFixed(0)}% of ${layer.limitPct.toFixed(0)}% ${layer.label.toLowerCase()} limit`;
    lines.push(
      `  ${layer.label.padEnd(10)} ${signedMoney(layer.usd)}  ${bar}  ${layer.status === "ok" ? "ok" : layer.status.toUpperCase()}`,
    );
  }
  lines.push(`  Peak equity ${money(risk.peakEquity)}  drawdown ${risk.drawdownPct.toFixed(1)}%`);
  lines.push(`  Ticket size now ${Math.round(risk.sizeMult * 100)}% of base. ${risk.sizeWhy}`);
  const epoch = state.clockEpoch || 0;
  const thisClock = clockFromFills(state.fills || [], epoch, state.hourWipes);
  if (thisClock.some((r) => r.sells > 0 || r.buys > 0)) {
    const net = thisClock.reduce((n, r) => n + r.net, 0);
    lines.push(`CLOCK this test (ET, clock net ${signedMoney(net)} — should match bot sells, including $0 losses)`);
    for (let h = 0; h < 24; h += 1) {
      const row = thisClock.find((r) => r.hour === h);
      if (!row || !(row.sells || row.buys)) continue;
      lines.push(
        `  ${fmtHourSlot(h)}  ${row.buys || 0} buys  ${row.wins}/${row.sells} wins  ${signedMoney(row.net)}`,
      );
    }
  }
  const clock = state.hourClock || [];
  if (clock.some((r) => r.sells > 0 || r.buys > 0)) {
    lines.push("CLOCK all tests (survives reset — for on/off hours later)");
    for (let h = 0; h < 24; h += 1) {
      const row = clock.find((r) => r.hour === h);
      if (!row || !(row.sells || row.buys)) continue;
      lines.push(
        `  ${fmtHourSlot(h)}  ${row.buys || 0} buys  ${row.wins}/${row.sells} wins  ${signedMoney(row.net)}`,
      );
    }
  }
  const copyQ = state.bots.filter((b) => b.strategy === "copy" && b.enabled).map((b) => copyQualityGate(b, state.fills));
  if (copyQ.length) {
    lines.push("  SMART MONEY (copy bots — 55%+ wins, PF 1.3+, no one-hit wonders)");
    for (const q of copyQ) {
      lines.push(`    ${q.ok ? "pass" : "SKIP"} ${q.name}  ${q.why}`);
    }
  }
  lines.push("");
  lines.push("BOTS (worst to best by cashed-in P/L)");
  const active = scores.filter((s) => s.bot.enabled || s.trades > 0);
  if (!active.length) lines.push("  No bot has traded yet.");
  for (const s of active) {
    const wr = s.sells ? `  win ${pct(s.winRate, 0)}` : "";
    lines.push(
      `  ${s.bot.enabled ? "ON " : "off"} ${s.bot.name}  ${STRATEGY_COPY[s.bot.strategy]?.label || s.bot.strategy}  ${s.trades} trades  net ${money(s.net)}  fees ${money(s.fees)}${wr}`,
    );
    if (s.bot.lastReason) lines.push(`      ${s.bot.lastReason}`);
    if (s.sells >= 5) {
      lines.push(
        `      SQN ${s.sqn.toFixed(2)} (${sqnLabel(s.sqn, s.sells)}) · avg win ${money(s.avgWin)} · avg loss ${money(s.avgLoss)}`,
      );
    }
  }
  lines.push("");
  lines.push("EXPECTANCY (ranked by net — kill the ones that do not pay)");
  const ranked = botScores(state)
    .filter((s) => s.sells > 0 || s.enabled)
    .sort((a, b) => a.netPnl - b.netPnl);
  if (!ranked.some((s) => s.sells > 0)) {
    lines.push("  Not enough closed trades yet.");
  }
  for (const s of ranked) {
    if (!s.sells && !s.enabled) continue;
    const hold = s.avgHoldMs ? `${Math.max(1, Math.round(s.avgHoldMs / 60000))}m avg hold` : "no holds";
    const pf = s.sells ? `  PF ${s.profitFactor.toFixed(2)}` : "";
    const slip = s.avgSlipBps ? `  slip ${s.avgSlipBps.toFixed(0)}bps` : "";
    lines.push(
      `  ${s.enabled ? "ON " : "off"} ${s.name}  ${s.sells} sells  net ${money(s.realizedPnl)}  fees ${money(s.fees)}${pf}  ${hold}${slip}`,
    );
  }
  lines.push("");
  lines.push("SCANNER (last pass — why it bought, sold, or skipped)");
  const scanners = state.bots.filter(
    (b) => b.enabled && b.strategy !== "copy" && (b.lastScan?.length || b.lastReason),
  );
  if (!scanners.length) {
    lines.push("  No scan yet. Wait ~15 seconds after the bots are on, then save again.");
  }
  for (const bot of scanners) {
    const notes = bot.lastScan || [];
    const whenScan = notes[0]?.ts
      ? new Date(notes[0].ts).toLocaleTimeString("en-US", { timeZone: "America/New_York" })
      : "";
    lines.push(`  ${bot.name}${whenScan ? `  ${whenScan}` : ""}`);
    const acts = notes.filter((n) => n.decision !== "skip");
    const skips = notes.filter((n) => n.decision === "skip");
    if (!notes.length && bot.lastReason) {
      lines.push(`    ${bot.lastReason}`);
      continue;
    }
    for (const n of acts) {
      lines.push(`    ${n.decision.toUpperCase()}  ${n.ticker}  ${n.reason}`);
    }
    if (skips.length) {
      const buckets = new Map<string, number>();
      for (const n of skips) {
        const r = n.reason.toLowerCase();
        let key = "other";
        if (r.includes("parabolic")) key = "parabolic";
        else if (r.includes("dump")) key = "dumping";
        else if (r.includes("ticks") || r.includes("tape")) key = "short tape";
        else if (r.includes("thin") || r.includes("volume")) key = "too thin";
        else if (r.includes("liquid")) key = "not liquid";
        else if (r.includes("ripping") || r.includes("last tick")) key = "not ripping";
        else if (r.includes("high")) key = "off the high";
        else if (r.includes("move is") || (r.includes("only") && r.includes("day"))) key = "move too small";
        else if (r.includes("day")) key = "not up 5–18%";
        else if (r.includes("guard") || r.includes("kill")) key = "paused";
        else if (r.includes("skew") || r.includes("cash")) key = "cash/inventory";
        else if (r.includes("delay") || r.includes("gap") || r.includes("cool")) key = "cooldown";
        buckets.set(key, (buckets.get(key) || 0) + 1);
      }
      const bits = [...buckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
      lines.push(`    SKIP ${skips.length}: ${bits}`);
      for (const n of skips.slice(0, 15)) {
        lines.push(`    skip  ${n.ticker}  ${n.reason}`);
      }
      if (skips.length > 15) lines.push(`    … ${skips.length - 15} more skips`);
    }
    if (!acts.length && !skips.length) lines.push(`    ${bot.lastReason || "No names this pass."}`);
  }
  lines.push("");
  lines.push("OPEN POSITIONS");
  const pos = Object.values(state.positions);
  if (!pos.length) lines.push("  None.");
  for (const p of pos) {
    const q = state.quotes[p.symbol];
    const mtm = q ? (q.price - p.avg) * p.qty : 0;
    lines.push(
      `  ${q?.symbol ?? p.symbol}  ${p.kind}  ${walletIdFor(p.kind)} wallet  qty ${p.qty.toFixed(4)}  avg ${money(p.avg)}  P/L ${money(mtm)}`,
    );
  }
  lines.push("");
  lines.push("LAST 20 FILLS");
  const fills = state.fills.slice(0, 20);
  if (!fills.length) lines.push("  None.");
  for (const f of fills) {
    const who = f.source === "manual" ? "You" : f.leaderName || f.botName || f.source;
    const name = state.quotes[f.symbol]?.symbol ?? f.symbol;
    const when = new Date(f.ts).toLocaleTimeString("en-US");
    const gas = f.gasFee ? `  gas ${money(f.gasFee)}` : "";
    const slip = f.slipBps ? `  slip ${f.slipBps.toFixed(0)}bps` : "";
    if (f.side === "buy") {
      lines.push(
        `  ${when}  BUY ${name}  paid ${money(f.notional)}  fees ${money(f.fee)}${gas}${slip}  total out ${money(f.notional + f.fee)}  ${who}`,
      );
    } else {
      const netIn = f.notional - f.fee;
      const boughtFor = netIn - f.realizedPnl;
      const hold = f.holdMs ? `  held ${Math.max(1, Math.round(f.holdMs / 60000))}m` : "";
      lines.push(
        `  ${when}  SELL ${name}  sold ${money(f.notional)}  fees ${money(f.fee)}${gas}${slip}${hold}  net in ${money(netIn)}  bought for ${money(boughtFor)}  P/L ${signedMoney(f.realizedPnl)}  ${who}`,
      );
    }
    if (f.reason) lines.push(`      ${f.reason}`);
  }
  lines.push("");
  lines.push("TWEAKS TO LOOK AT");
  const hints: string[] = [];
  for (const s of scores) {
    if (s.sells >= 5 && s.net < 0) {
      hints.push(
        `  ${s.bot.name} is down ${money(s.net)} after ${s.sells} sells (win ${pct(s.winRate, 0)}). Consider Off, or a smaller ticket.`,
      );
    }
    if (s.sells >= 5 && s.profitFactor < 1 && s.net < 0) {
      hints.push(`  ${s.bot.name} profit factor under 1. It does not pay. Turn it Off.`);
    }
  }
  if (pump.netPnl < -pump.startingCash * 0.15) {
    hints.push("  Polymarket wallet is the weak book. Leave it small. Do not move core cash into it.");
  }
  if (core.netPnl > 0 && pump.netPnl < 0) {
    hints.push("  Isolation is working: Polymarket losses are not eating stocks/crypto gains.");
  }
  if (core.netPnl < 0 && pump.netPnl > 0) {
    hints.push("  Core is the weak book. Polymarket is not the problem right now.");
  }
  const on = state.bots.filter((b) => b.enabled).length;
  if (on >= 6) {
    hints.push(`  ${on} bots are on. They can stack into too many names. Try 2–3 on at a time.`);
  }
  if (risk.sizeMult < 0.7) {
    hints.push(
      `  Tickets are at ${Math.round(risk.sizeMult * 100)}% of base because a risk layer is hot. Paper is still trading.`,
    );
  }
  if (copyQ.some((q) => !q.ok)) {
    hints.push("  A copy bot failed the smart-money filter. Turn it Off or wait for a better streak.");
  }
  if (!hints.length) {
    hints.push("  Not enough closed trades yet. Let it run, then save another report.");
  }
  lines.push(...hints);
  lines.push("");

  return {
    id: `rep-${Date.now()}`,
    ts: Date.now(),
    text: lines.join("\n"),
  };
}
