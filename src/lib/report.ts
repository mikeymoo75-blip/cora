import { walletViews, walletIdFor } from "./engine";
import { money, pct, signedMoney } from "./format";
import type { DeskReport, DeskState } from "./types";
import { STRATEGY_COPY } from "./universe";

export function buildReport(state: DeskState): DeskReport {
  const views = walletViews(state);
  const core = views.find((w) => w.id === "core")!;
  const pump = views.find((w) => w.id === "pump")!;
  const scores = [...(state as DeskState & { scores?: { name: string }[] }).bots].map((bot) => {
    const fills = state.fills.filter((f) => f.botId === bot.id || f.botName === bot.name);
    const sells = fills.filter((f) => f.side === "sell");
    const wins = sells.filter((f) => f.realizedPnl > 0).length;
    const realized = fills.reduce((n, f) => n + (f.realizedPnl || 0), 0);
    const fees = fills.reduce((n, f) => n + f.fee, 0);
    return {
      bot,
      trades: fills.length,
      sells: sells.length,
      wins,
      winRate: sells.length ? (wins / sells.length) * 100 : 0,
      realized,
      fees,
      net: realized,
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
  lines.push("WALLETS (Pump.fun cannot spend stocks/crypto cash)");
  lines.push(
    `  Stocks + crypto: cash ${money(core.cash)}  value ${money(core.equity)}  P/L ${money(core.netPnl)}  today ${money(core.dayPnl)}  fees ${money(core.feesPaid)}`,
  );
  lines.push(
    `  Pump.fun:        cash ${money(pump.cash)}  value ${money(pump.equity)}  P/L ${money(pump.netPnl)}  today ${money(pump.dayPnl)}  fees ${money(pump.feesPaid)}`,
  );
  if (core.halted) lines.push(`  CORE PAUSED — ${core.haltReason}`);
  if (pump.halted) lines.push(`  PUMP PAUSED — ${pump.haltReason}`);
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
    if (f.side === "buy") {
      lines.push(
        `  ${when}  BUY ${name}  paid ${money(f.notional)}  fees ${money(f.fee)}${gas}  total out ${money(f.notional + f.fee)}  ${who}`,
      );
    } else {
      const netIn = f.notional - f.fee;
      const boughtFor = netIn - f.realizedPnl;
      lines.push(
        `  ${when}  SELL ${name}  sold ${money(f.notional)}  fees ${money(f.fee)}${gas}  net in ${money(netIn)}  bought for ${money(boughtFor)}  P/L ${signedMoney(f.realizedPnl)}  ${who}`,
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
    if (s.fees > 0 && s.net < 0 && Math.abs(s.net) < s.fees * 1.2 && s.trades >= 6) {
      hints.push(`  ${s.bot.name} is mostly losing to fees (${money(s.fees)}). Trade less often or bigger only on clean signals.`);
    }
  }
  if (pump.netPnl < -pump.startingCash * 0.15) {
    hints.push("  Pump.fun wallet is the weak book. Leave it small. Do not move core cash into it.");
  }
  if (core.netPnl > 0 && pump.netPnl < 0) {
    hints.push("  Isolation is working: Pump.fun losses are not eating stocks/crypto gains.");
  }
  if (core.netPnl < 0 && pump.netPnl > 0) {
    hints.push("  Core is the weak book. Pump.fun is not the problem right now.");
  }
  const on = state.bots.filter((b) => b.enabled).length;
  if (on >= 6) {
    hints.push(`  ${on} bots are on. They can stack into too many names. Try 2–3 on at a time.`);
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
