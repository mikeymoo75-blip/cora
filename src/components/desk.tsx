import { useEffect, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  CircleAlert,
  ClipboardCopy,
  FileText,
  Plus,
  RotateCcw,
  Search,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { PriceRace, TickPrice } from "@/components/spark";
import { cn } from "@/lib/cn";
import { COPY_LEADERS } from "@/lib/copy-leaders";
import { ago, clock, compactMoney, durationFmt, eventOdds, money, pct, qtyFmt, runWindow, signedClass, signedMoney } from "@/lib/format";
import { useServerDesk } from "@/lib/store";
import type {
  BotScore,
  DeskReport,
  DeskSnapshot,
  Fill,
  MarketKind,
  Position,
  Quote,
  RiskLayer,
  ScanNote,
  ScanScope,
  StrategyId,
  WalletView,
} from "@/lib/types";
import { UPDOWN_ORDER } from "@/lib/updown";
import { SCOPE_COPY, STRATEGY_COPY } from "@/lib/universe";

function copyPeopleFirst(bots: DeskSnapshot["bots"]) {
  const order = [
    "buffett",
    "cathie",
    "ackman",
    "hl-1",
    "hl-2",
    "hl-3",
    "hl-4",
    "hl-5",
    "elon",
    "trump",
    "pelosi",
  ];
  return bots.slice().sort((a, b) => {
    const ra = order.indexOf(a.leaderId || "");
    const rb = order.indexOf(b.leaderId || "");
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
  });
}

const TABS = ["Home", "Bots", "Copy", "Log"] as const;
type Tab = (typeof TABS)[number];
const SIZES = [10, 25, 50];

function kindLabel(k: MarketKind) {
  if (k === "stock") return "Stock";
  if (k === "crypto") return "Crypto";
  if (k === "poly") return "Polymarket";
  return "Pump.fun (retired)";
}

export function Desk() {
  const remote = useServerDesk();
  const desk = remote.desk;
  const [tab, setTab] = useState<Tab>("Home");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState("");

  if (!desk) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        <p className="font-display text-xl">Starting Cora…</p>
      </div>
    );
  }

  const equity = desk.equityNow;
  const dayPnl = equity - desk.dayStartEquity;
  const botsOn = desk.bots.filter((b) => b.enabled);
  const last = desk.lastFill;
  const holdings = Object.values(desk.positions);

  const sellAll = (id: string) => {
    const q = desk.quotes[id];
    if (!desk.positions[id]) {
      toast("Nothing to sell — you don't hold that");
      return;
    }
    void remote.trade("sell", id, 0, true).then((next) => {
      if (!next?.positions[id]) toast(`Sold all ${q?.symbol ?? id}`);
      else toast("Could not sell");
    });
  };

  const sellHalf = (id: string) => {
    const p = desk.positions[id];
    const q = desk.quotes[id];
    if (!p || !q) {
      toast("Nothing to sell");
      return;
    }
    const notional = (p.qty * q.price) / 2;
    void remote.trade("sell", id, notional).then(() => {
      toast(`Sold half of ${q.symbol}`);
    });
  };

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Toaster
        theme="light"
        toastOptions={{ className: "bg-surface text-fg border-border font-sans" }}
      />
      <header className="px-4 pt-5 pb-3 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-widest text-core uppercase">Paper desk</p>
            <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Cora</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">
              {botsOn.length} bot{botsOn.length === 1 ? "" : "s"} on ·{" "}
              {desk.stockMarketOpen ? "US stocks open" : "US stocks closed"} · checked {ago(desk.loopAt)}
              {last
                ? ` · last ${last.side} ${desk.quotes[last.symbol]?.symbol ?? last.symbol}`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-fg px-4 text-sm font-semibold text-bg transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]"
              onClick={() => {
                void remote.saveReport().then(async (next) => {
                  const text = next?.reports?.[0]?.text;
                  if (text) {
                    try {
                      await navigator.clipboard.writeText(text);
                      toast("Report copied — paste it in chat");
                    } catch {
                      toast("Report saved in Log");
                    }
                    setTab("Log");
                  } else toast("Could not build a report");
                });
              }}
            >
              <FileText className="size-4" />
              Save report
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-card)]"
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw className="size-4" />
              New $1,000 test
            </button>
          </div>
        </div>

        {resetOpen && (
          <div className="mt-4 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
            <p className="font-display text-lg font-semibold">Start a fresh $1,000 test</p>
            <p className="mt-1 text-sm text-muted">
              $800 stocks + crypto, $200 Polymarket. Saves this run. Bots stay as they are.
            </p>
            <input
              value={resetName}
              onChange={(e) => setResetName(e.target.value)}
              placeholder={`Test ${(desk.tests?.length ?? 0) + 1}`}
              className="mt-3 min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="min-h-11 flex-1 rounded-lg bg-core font-semibold text-surface"
                onClick={() => {
                  void remote.reset(resetName).then(() => {
                    toast("New $1,000 test started");
                    setResetOpen(false);
                    setResetName("");
                  });
                }}
              >
                Save & reset
              </button>
              <button
                type="button"
                className="min-h-11 flex-1 rounded-lg bg-elevated text-sm font-medium"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {(desk.halted || desk.walletViews?.some((w) => w.halted) || remote.err) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">
            <CircleAlert className="size-4" />
            {desk.haltReason || desk.walletViews?.find((w) => w.halted)?.haltReason || remote.err}
            {(desk.halted || desk.walletViews?.some((w) => w.halted)) && (
              <button
                type="button"
                className="rounded-md bg-surface px-3 py-1.5 text-fg"
                onClick={() => void remote.resume()}
              >
                Resume
              </button>
            )}
          </div>
        )}
      </header>

      <section className="grid gap-3 px-4 md:grid-cols-3 md:px-8">
        {(desk.walletViews || []).map((w) => (
          <WalletCard key={w.id} wallet={w} />
        ))}
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Today</p>
          <p className={cn("mt-1 font-display text-3xl font-semibold tabular-nums", signedClass(dayPnl))}>
            {signedMoney(dayPnl)}
          </p>
          <p className="mt-1 text-sm text-muted">
            Total {compactMoney(equity)} · cashed {signedMoney(desk.stats.realizedPnl)}
          </p>
          <div className="mt-3 h-12">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={desk.equity.map((p) => ({ i: p.t, v: p.v }))}>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke="var(--color-core)"
                  fill="var(--color-core)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <div className="mt-3 px-4 md:px-8">
        <RiskBoard desk={desk} />
      </div>

      <nav className="mt-5 flex gap-1 overflow-x-auto px-4 md:px-8">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 rounded-full px-5 text-sm font-semibold transition-colors duration-150",
              tab === t ? "bg-fg text-bg" : "bg-surface text-muted shadow-[var(--shadow-card)]",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Home" && (
        <HomePane
          desk={desk}
          holdings={holdings}
          botsOn={botsOn}
          onSellAll={sellAll}
          onSellHalf={sellHalf}
          onBuy={(id, n) => {
            void remote.trade("buy", id, n).then((next) => {
              if (next) toast(`Bought ${desk.quotes[id]?.symbol ?? id}`);
              else toast("Buy failed");
            });
          }}
          onAddSymbol={(symbol) =>
            remote.addSymbol(symbol).then((next) => {
              if (!next) return null;
              const found =
                next.quotes[symbol.toUpperCase()] ||
                Object.values(next.quotes).find((q) => q.symbol.toUpperCase() === symbol.toUpperCase());
              return found?.id ?? null;
            })
          }
        />
      )}

      {tab === "Bots" && (
        <BotsPane
          desk={desk}
          quotes={Object.values(desk.quotes)}
          onToggle={(id) => void remote.toggleBot(id)}
          onRemove={(id) => void remote.removeBot(id)}
          onAdd={(input) => void remote.addBot(input).then(() => toast(`Added ${input.name}`))}
        />
      )}

      {tab === "Copy" && <CopyPane desk={desk} onToggle={(id) => void remote.toggleBot(id)} />}

      {tab === "Log" && (
        <LogPane
          desk={desk}
          onCopyReport={(text) => {
            void navigator.clipboard.writeText(text).then(
              () => toast("Report copied — paste it in chat for tweaks"),
              () => toast("Could not copy — select the text instead"),
            );
          }}
        />
      )}
    </div>
  );
}

function WalletCard({ wallet }: { wallet: WalletView }) {
  const poly = wallet.id === "poly";
  return (
    <div
      className={cn(
        "rounded-2xl p-4 text-surface shadow-[var(--shadow-card)]",
        poly ? "bg-poly" : "bg-core",
      )}
    >
      <p className="text-xs font-semibold tracking-wide uppercase opacity-80">
        {poly ? "Polymarket" : "Stocks + crypto"}
      </p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{compactMoney(wallet.equity)}</p>
      <p className="mt-1 text-sm opacity-90">
        cash {compactMoney(wallet.cash)} ·{" "}
        <span className="font-semibold">{signedMoney(wallet.netPnl)}</span>
      </p>
    </div>
  );
}

function layerTone(status: RiskLayer["status"]) {
  if (status === "hot") return "bg-down";
  if (status === "warn") return "bg-warn";
  return "bg-core";
}

function RiskBoard({ desk }: { desk: DeskSnapshot }) {
  const risk = desk.risk;
  if (!risk) return null;
  const copyFail = risk.copyQuality.filter((q) => !q.ok);
  return (
    <section className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex items-center gap-2">
        <Shield className="size-5 text-core" />
        <div>
          <h2 className="font-display text-xl font-semibold">Risk layers</h2>
          <p className="text-xs text-muted">
            4-layer paper protection. Tickets shrink when a layer heats up — bots keep running.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {risk.layers.map((layer) => (
          <div key={layer.id} className="rounded-xl bg-elevated p-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold tracking-wide text-muted uppercase">{layer.label}</p>
              <p className="font-mono text-xs text-muted">{layer.limitPct.toFixed(0)}% cap</p>
            </div>
            <p className={cn("mt-1 font-display text-lg font-semibold tabular-nums", signedClass(layer.usd))}>
              {signedMoney(layer.usd)}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full transition-[width] duration-300", layerTone(layer.status))}
                style={{ width: `${Math.min(100, layer.usedPct)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Tickets at {Math.round(risk.sizeMult * 100)}% of base. {risk.sizeWhy}
      </p>
      {copyFail.length > 0 && (
        <p className="mt-2 text-sm text-warn">
          Smart money: {copyFail.map((q) => q.name.replace(/^Copy /, "")).join(", ")} paused for new copies.
        </p>
      )}
    </section>
  );
}

function fmtSpot(n: number) {
  if (!(n > 0)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : 4 });
}

function RoundBoard({
  quotes,
  positions,
  fills,
  onBuy,
}: {
  quotes: Quote[];
  positions: Record<string, Position>;
  fills: Fill[];
  onBuy: (id: string, notional: number) => void;
}) {
  const [, tick] = useState(0);
  const [pick, setPick] = useState("BTC-5m");
  const [cross, setCross] = useState<null | "up" | "down">(null);
  const shownRef = useRef(0);
  const leadRef = useRef<boolean | null>(null);
  const roundStampRef = useRef("");
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const now = Date.now();
  type Round = {
    key: string;
    asset: string;
    horizon: string;
    up?: Quote;
    down?: Quote;
  };
  const map = new Map<string, Round>();
  for (const q of quotes) {
    if (!q.horizon || !q.asset) continue;
    const key = `${q.asset}-${q.horizon}`;
    const row = map.get(key) || { key, asset: q.asset, horizon: q.horizon };
    if (q.leg === "down") row.down = q;
    else row.up = q;
    map.set(key, row);
  }
  const rounds = [...map.values()]
    .filter((r) => r.up)
    .sort((a, b) => {
      const ah = a.horizon === "5m" ? 0 : 1;
      const bh = b.horizon === "5m" ? 0 : 1;
      if (ah !== bh) return ah - bh;
      const ia = UPDOWN_ORDER.indexOf(a.asset as (typeof UPDOWN_ORDER)[number]);
      const ib = UPDOWN_ORDER.indexOf(b.asset as (typeof UPDOWN_ORDER)[number]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  const roundKeys = rounds.map((r) => r.key).join("|");
  const featured = rounds.find((r) => r.key === pick) || rounds[0];
  const q0 = featured?.up;
  const stamp = featured && q0 ? `${featured.key}-${q0.windowStart}` : "";
  const spot0 = q0?.spot || 0;
  const open0 = q0?.openPx || 0;
  const leading0 = spot0 >= open0;
  useEffect(() => {
    const keys = roundKeys.split("|").filter(Boolean);
    if (keys.length && !keys.includes(pick)) setPick(keys[0]!);
  }, [pick, roundKeys]);
  useEffect(() => {
    if (!stamp) return;
    if (roundStampRef.current !== stamp) {
      roundStampRef.current = stamp;
      shownRef.current = spot0;
      leadRef.current = null;
      setCross(null);
      return;
    }
    if (leadRef.current === null) {
      leadRef.current = leading0;
      return;
    }
    if (leadRef.current !== leading0 && open0 > 0 && spot0 > 0) {
      leadRef.current = leading0;
      setCross(leading0 ? "up" : "down");
      const t = setTimeout(() => setCross(null), 1500);
      return () => clearTimeout(t);
    }
  }, [stamp, leading0, open0, spot0]);
  if (!featured || !q0) return null;

  const q = q0;
  const total = featured.horizon === "15m" ? 900 : 300;
  const left = Math.max(0, ((q.windowEnd || now) - now) / 1000);
  const p = Math.max(0, Math.min(1, left / total));
  const upPx = q.price;
  const dnPx = featured.down?.price ?? 1 - upPx;
  const fair = q.fair ?? 0.5;
  const spot = q.spot || 0;
  const open = q.openPx || 0;
  if (spot > 0) {
    const cur = shownRef.current || spot;
    shownRef.current = Math.abs(spot - cur) < 0.02 ? spot : cur + (spot - cur) * 0.28;
  }
  const shown = shownRef.current || spot;
  const delta = open ? ((shown - open) / open) * 100 : 0;
  const leadingUp = shown >= open;
  const mm = Math.floor(left / 60);
  const ss = Math.floor(left % 60)
    .toString()
    .padStart(2, "0");
  const edge = Math.abs(fair - upPx);
  const upPos = q.id ? positions[q.id] : undefined;
  const dnPos = featured.down?.id ? positions[featured.down.id] : undefined;
  const hedged = !!(upPos && dnPos);
  const tape = fills
    .filter((f) => {
      const qq = quotes.find((x) => x.id === f.symbol);
      return qq?.horizon;
    })
    .slice(0, 6);
  const urgent = left < 30;
  const flash = tape[0];
  const flashUp = flash?.side === "buy" && flash.symbol === q.id && now - flash.ts < 8000;
  const flashDn =
    flash?.side === "buy" && featured.down && flash.symbol === featured.down.id && now - flash.ts < 8000;

  return (
    <section>
      <div className="mb-3">
        <h2 className="font-display text-2xl font-semibold">Live rounds</h2>
        <p className="text-sm text-muted">
          BTC, ETH, SOL, XRP, DOGE, BNB, HYPE racing Price-to-Beat. Cheap side when the book is off — hedge the other, never dump.
        </p>
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {rounds.map((r) => {
          const rq = r.up!;
          const rLeft = Math.max(0, ((rq.windowEnd || now) - now) / 1000);
          const heldHere = !!(positions[rq.id] || (r.down && positions[r.down.id]));
          const rLead = (rq.spot || 0) >= (rq.openPx || 0);
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setPick(r.key)}
              className={cn(
                "min-h-11 rounded-full px-4 text-sm font-semibold transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]",
                pick === r.key ? "bg-fg text-bg" : "bg-surface text-muted shadow-[var(--shadow-card)]",
              )}
            >
              {r.asset} {r.horizon}
              {heldHere ? " · in" : ""}
              <span className={cn("ml-1 font-mono text-xs tabular-nums opacity-80", rLead ? "text-primary" : "text-down")}>
                {Math.floor(rLeft / 60)}:{Math.floor(rLeft % 60).toString().padStart(2, "0")}
              </span>
            </button>
          );
        })}
      </div>
      <article
        className={cn(
          "relative overflow-hidden rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] md:p-5",
          urgent && "round-lock",
        )}
      >
        {cross && (
          <div
            className={cn(
              "race-cross pointer-events-none absolute inset-x-0 top-0 z-10 px-4 py-2 text-center font-display text-lg font-semibold",
              cross === "up" ? "bg-primary text-surface" : "bg-down text-surface",
            )}
          >
            {cross === "up" ? "Up takes the lead" : "Down takes the lead"}
          </div>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
              <span className="round-pulse inline-block size-2 rounded-full bg-down" />
              Live · {featured.asset} {featured.horizon}
              {hedged ? " · hedged" : upPos ? " · long UP" : dnPos ? " · long DN" : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-8">
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Price to Beat</p>
                <p className="mt-0.5 font-mono text-2xl font-semibold tabular-nums tracking-tight md:text-3xl">
                  {fmtSpot(open)}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Live</p>
                <TickPrice
                  value={shown}
                  className="mt-0.5 text-3xl font-semibold md:text-4xl"
                />
                <p className={cn("text-xs font-medium tabular-nums", leadingUp ? "text-primary" : "text-down")}>
                  {open ? `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}%` : "Waiting for open"}
                  {leadingUp ? " · UP winning" : " · DOWN winning"}
                </p>
              </div>
            </div>
          </div>
          <div
            className="round-ring grid size-24 shrink-0 place-items-center rounded-full"
            style={{
              ["--p" as string]: `${p * 360}deg`,
              ["--ring" as string]: urgent ? "var(--color-down)" : "var(--color-primary)",
            }}
          >
            <span className="grid size-20 place-items-center rounded-full bg-surface font-mono text-base font-semibold tabular-nums">
              {mm}:{ss}
            </span>
          </div>
        </div>
        <div className="mt-4 overflow-hidden rounded-xl bg-elevated px-1 pt-2 pb-1">
          <PriceRace
            spark={q.spark}
            open={open}
            spot={shown}
            windowStart={q.windowStart}
            windowEnd={q.windowEnd}
            now={now}
          />
          <div className="mt-1 flex justify-between px-2 pb-1 text-xs text-muted">
            <span>Open</span>
            <span className="font-mono">beat {fmtSpot(open)}</span>
            <span>{mm}:{ss} left</span>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onBuy(q.id, 20)}
            className={cn(
              "min-h-14 rounded-xl px-4 py-3 text-left transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]",
              leadingUp ? "bg-primary/15 race-lead-up" : "bg-elevated",
              flashUp && "race-chip-flash",
            )}
            style={flashUp ? { ["--flash" as string]: "var(--color-primary)" } : undefined}
          >
            <div className="flex items-baseline justify-between">
              <span className={cn("font-display text-xl font-semibold", leadingUp && "round-pulse text-primary")}>
                Up
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums">{(upPx * 100).toFixed(0)}¢</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              fair {(fair * 100).toFixed(0)}¢
              {upPos ? ` · you ${qtyFmt(upPos.qty)} @ ${(upPos.avg * 100).toFixed(0)}¢` : ""}
            </p>
          </button>
          <button
            type="button"
            onClick={() => featured.down && onBuy(featured.down.id, 20)}
            className={cn(
              "min-h-14 rounded-xl px-4 py-3 text-left transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.98]",
              !leadingUp ? "bg-down/15 race-lead-dn" : "bg-elevated",
              flashDn && "race-chip-flash",
            )}
            style={flashDn ? { ["--flash" as string]: "var(--color-down)" } : undefined}
          >
            <div className="flex items-baseline justify-between">
              <span className={cn("font-display text-xl font-semibold", !leadingUp && "round-pulse text-down")}>
                Down
              </span>
              <span className="font-mono text-xl font-semibold tabular-nums">{(dnPx * 100).toFixed(0)}¢</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              fair {((1 - fair) * 100).toFixed(0)}¢
              {dnPos ? ` · you ${qtyFmt(dnPos.qty)} @ ${(dnPos.avg * 100).toFixed(0)}¢` : ""}
            </p>
          </button>
        </div>
        <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-elevated">
          <div className="round-odds absolute inset-y-0 left-0 bg-primary" style={{ width: `${upPx * 100}%` }} />
          <div
            className="absolute top-0 h-full w-0.5 bg-fg"
            style={{ left: `${fair * 100}%` }}
            title="Fair value"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {hedged
            ? "Both sides on. Holding the pair to settle — that's the hedge, not a dump."
            : edge >= 0.06
              ? `Edge ${(edge * 100).toFixed(1)}¢ — bot can take the cheap side.`
              : `Edge ${(edge * 100).toFixed(1)}¢ — waiting for a real misprice (6¢).`}
        </p>
        {tape.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border pt-3">
            {tape.map((f) => {
              const qq = quotes.find((x) => x.id === f.symbol);
              return (
                <li key={f.id} className="flex justify-between gap-3 font-mono text-xs text-muted">
                  <span>
                    {f.source === "bot" ? "bot" : "you"} {f.side} {qq?.symbol ?? f.symbol} @{" "}
                    {(f.price * 100).toFixed(0)}¢
                  </span>
                  <span>{ago(f.ts)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </article>
    </section>
  );
}

function HomePane({
  desk,
  holdings,
  botsOn,
  onSellAll,
  onSellHalf,
  onBuy,
  onAddSymbol,
}: {
  desk: DeskSnapshot;
  holdings: Position[];
  botsOn: DeskSnapshot["bots"];
  onSellAll: (id: string) => void;
  onSellHalf: (id: string) => void;
  onBuy: (id: string, notional: number) => void;
  onAddSymbol: (symbol: string) => Promise<string | null>;
}) {
  const [buyOpen, setBuyOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [notional, setNotional] = useState(25);
  const [picked, setPicked] = useState("NVDA");

  return (
    <div className="space-y-6 px-4 py-5 md:px-8">
      <RoundBoard
        quotes={Object.values(desk.quotes)}
        positions={desk.positions}
        fills={desk.fills}
        onBuy={onBuy}
      />
      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-semibold">Open bags</h2>
            <p className="text-sm text-muted">Sell lives here — not on the log, not on a market board.</p>
          </div>
          <button
            type="button"
            className="min-h-11 rounded-full bg-surface px-4 text-sm font-semibold shadow-[var(--shadow-card)]"
            onClick={() => setBuyOpen((v) => !v)}
          >
            {buyOpen ? "Hide buy" : "Buy yourself"}
          </button>
        </div>

        {buyOpen && (
          <form
            className="mb-4 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]"
            onSubmit={(e) => {
              e.preventDefault();
              const q = query.trim();
              if (q) {
                void onAddSymbol(q).then((id) => {
                  if (id) {
                    setPicked(id);
                    onBuy(id, notional);
                  } else toast("Couldn't find that ticker");
                });
              } else onBuy(picked, notional);
            }}
          >
            <p className="text-sm font-semibold">Override the bots</p>
            <p className="mt-1 text-xs text-muted">Pays from the matching wallet. Polymarket stays in its $200.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="AAPL, BTC, or a Polymarket ticker…"
                className="min-h-11 min-w-40 flex-1 rounded-md bg-elevated px-3 text-sm outline-none"
              />
              {SIZES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setNotional(n)}
                  className={cn(
                    "min-h-11 rounded-md px-3 font-mono text-sm",
                    notional === n ? "bg-core text-surface" : "bg-elevated",
                  )}
                >
                  {compactMoney(n)}
                </button>
              ))}
              <button
                type="submit"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-core px-4 text-sm font-semibold text-surface"
              >
                <Search className="size-4" />
                Buy {compactMoney(notional)}
              </button>
            </div>
          </form>
        )}

        {holdings.length === 0 ? (
          <div className="rounded-2xl bg-surface px-5 py-8 text-center shadow-[var(--shadow-card)]">
            <p className="font-display text-xl font-semibold">Nothing open</p>
            <p className="mt-1 text-sm text-muted">When a bot buys, it shows up here so you can sell it any time.</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {holdings.map((p) => {
              const q = desk.quotes[p.symbol];
              const mark = q?.price ?? p.avg;
              const mtm = (mark - p.avg) * p.qty;
              const value = p.qty * mark;
              return (
                <li key={p.symbol} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <p className="font-display text-xl font-semibold">{q?.symbol ?? p.symbol}</p>
                      <p className="text-xs text-muted">{kindLabel(p.kind)}</p>
                    </div>
                    <p className={cn("font-mono text-lg font-semibold tabular-nums", signedClass(mtm))}>
                      {signedMoney(mtm)}
                    </p>
                  </div>
                  <p className="mt-2 font-mono text-xs text-muted">
                    {qtyFmt(p.qty)} · {money(value)} · avg{" "}
                    {p.kind === "poly" ? eventOdds(p.avg) : money(p.avg)}
                    {q && p.kind === "poly" ? ` · now ${eventOdds(mark)}` : ""}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-elevated text-sm font-semibold"
                      onClick={() => onSellHalf(p.symbol)}
                    >
                      Sell ½
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-down text-sm font-semibold text-surface"
                      onClick={() => onSellAll(p.symbol)}
                    >
                      Sell all
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-2xl font-semibold">Latest fills</h2>
          <p className="text-xs text-muted">Full tape is on Log</p>
        </div>
        {desk.fills.length === 0 ? (
          <p className="text-sm text-muted">No trades yet today.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {desk.fills.slice(0, 10).map((f) => (
              <FillRow key={f.id} fill={f} symbol={desk.quotes[f.symbol]?.symbol ?? f.symbol} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold">This test</h2>
        <p className="mb-3 text-sm text-muted">
          Running {durationFmt(Date.now() - (desk.runStartedAt || Date.now()))}
          {desk.runStartedAt
            ? ` · started ${new Date(desk.runStartedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
            : ""}
        </p>
        {(!desk.tests || desk.tests.length === 0) && (
          <p className="text-sm text-muted">Tap New $1,000 test after a run to save it here.</p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {(desk.tests || []).map((t) => (
            <li key={t.id} className="rounded-2xl bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted">{runWindow(t.startedAt, t.endedAt)}</p>
              <p className={cn("mt-1 font-mono text-sm", signedClass(t.netPnl))}>
                {t.trades} trades · {signedMoney(t.netPnl)}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-2xl font-semibold">Bots that are on</h2>
        <p className="mb-3 text-sm text-muted">Turn them On/Off on the Bots and Copy tabs.</p>
        {botsOn.length === 0 ? (
          <p className="text-sm text-muted">Every bot is off. Open Bots to start one.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {botsOn.map((b) => (
              <li key={b.id} className="rounded-2xl bg-surface px-4 py-3 shadow-[var(--shadow-card)]">
                <p className="text-sm font-semibold">{b.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{b.lastReason || "Waiting for a signal."}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BotsPane({
  desk,
  quotes,
  onToggle,
  onRemove,
  onAdd,
}: {
  desk: DeskSnapshot;
  quotes: Quote[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (input: {
    name: string;
    symbol: string;
    strategy: StrategyId;
    sizeUsd: number;
    scope: ScanScope;
    maxNames: number;
  }) => void;
}) {
  const [name, setName] = useState("Scan bot");
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState<StrategyId>("sma");
  const [scope, setScope] = useState<ScanScope>("stock");
  const [size, setSize] = useState(25);
  const stratBots = desk.bots.filter((b) => b.strategy !== "copy");
  const selectedQuote = quotes.find((q) => q.id === symbol) ?? quotes[0];
  const pumpStrats: StrategyId[] = ["sniper", "scalp"];
  const bookStrats: StrategyId[] = ["sma", "meanrev", "momentum", "dca"];
  const stratOptions =
    scope === "poly" ? pumpStrats : scope === "all" ? bookStrats : bookStrats;
  const activeStrategy = stratOptions.includes(strategy) ? strategy : stratOptions[0]!;
  const maxNames = scope === "one" ? 1 : scope === "poly" ? 3 : scope === "all" ? 6 : 4;

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)] md:px-8">
      <div>
        <h2 className="font-display text-2xl font-semibold">Scan bots</h2>
        <p className="mb-3 text-sm leading-relaxed text-muted">
          These hunt stocks, crypto, and BTC–HYPE 5m & 15m Polymarket rounds. People to copy live on the Copy tab.
        </p>
        <Scoreboard scores={desk.scores} />
        <ul className="mt-4 space-y-2">
          {stratBots.map((b) => {
            const score = desk.scores.find((s) => s.botId === b.id);
            const scopeLabel = SCOPE_COPY[b.scope || "one"]?.label || "One ticker";
            return (
              <li key={b.id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-muted">
                      {scopeLabel} · {STRATEGY_COPY[b.strategy]?.label} · {money(b.sizeUsd, 0)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <OnOff on={b.enabled} onClick={() => onToggle(b.id)} />
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center rounded-lg bg-elevated text-muted"
                      onClick={() => onRemove(b.id)}
                      aria-label="Remove bot"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {b.lastReason || STRATEGY_COPY[b.strategy]?.blurb}
                </p>
                {score && (
                  <p className={cn("mt-1 font-mono text-xs", score.netPnl >= 0 ? "text-primary" : "text-down")}>
                    {score.trades} trades · net {money(score.netPnl)} after {money(score.fees)} fees
                  </p>
                )}
                {b.enabled && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted">
                      Last scan{b.lastScan?.length ? ` · ${b.lastScan.length} names` : ""}
                    </summary>
                    <ScanTape notes={b.lastScan || []} empty="Waiting for the next 15s pass." />
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <form
        className="h-fit space-y-2 rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selectedQuote && scope === "one") return;
          onAdd({
            name,
            symbol: selectedQuote?.id || "SPY",
            strategy: activeStrategy,
            sizeUsd: size,
            scope,
            maxNames,
          });
        }}
      >
        <p className="font-display text-lg font-semibold">Add a bot</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
          placeholder="Name"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as ScanScope)}
          className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
        >
          {(Object.keys(SCOPE_COPY) as ScanScope[]).map((k) => (
            <option key={k} value={k}>
              {SCOPE_COPY[k].label}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-muted">{SCOPE_COPY[scope]?.blurb}</p>
        {scope === "one" && (
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
          >
            {quotes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.symbol} — {q.name}
              </option>
            ))}
          </select>
        )}
        <select
          value={activeStrategy}
          onChange={(e) => setStrategy(e.target.value as StrategyId)}
          className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
        >
          {stratOptions.map((k) => (
            <option key={k} value={k}>
              {STRATEGY_COPY[k].label}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-muted">{STRATEGY_COPY[activeStrategy]?.blurb}</p>
        <input
          type="number"
          min={10}
          value={size}
          onChange={(e) => setSize(Number(e.target.value) || 0)}
          className="min-h-11 w-full rounded-md bg-elevated px-3 font-mono text-sm outline-none"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-core text-sm font-semibold text-surface"
        >
          <Plus className="size-4" />
          Add bot
        </button>
      </form>
    </div>
  );
}

function Scoreboard({ scores }: { scores: BotScore[] }) {
  if (!scores.length) return null;
  const rows = [...scores].sort((a, b) => b.netPnl - a.netPnl);
  return (
    <div className="overflow-x-auto rounded-2xl bg-surface shadow-[var(--shadow-card)]">
      <table className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Bot</th>
            <th className="px-3 py-2 font-medium">Trades</th>
            <th className="px-3 py-2 font-medium">Fees</th>
            <th className="px-3 py-2 font-medium">SQN</th>
            <th className="px-3 py-2 font-medium">Net P/L</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((s) => (
            <tr key={s.botId} className="border-t border-border">
              <td className="px-3 py-2 font-sans">
                {s.name}
                {s.enabled ? " · on" : ""}
              </td>
              <td className="px-3 py-2">{s.trades}</td>
              <td className="px-3 py-2">{money(s.fees)}</td>
              <td className="px-3 py-2">{s.sells >= 5 ? s.sqn.toFixed(1) : "—"}</td>
              <td className={cn("px-3 py-2", signedClass(s.netPnl))}>{signedMoney(s.netPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyPane({ desk, onToggle }: { desk: DeskSnapshot; onToggle: (id: string) => void }) {
  const copyBots = copyPeopleFirst(desk.bots.filter((b) => b.strategy === "copy"));
  const groups: { title: string; kinds: string[] }[] = [
    { title: "Warren Buffett / ARKK / Ackman", kinds: ["star"] },
    { title: "Crypto top traders", kinds: ["crypto-top"] },
    { title: "Congress", kinds: ["congress", "spouse"] },
    { title: "Public figures", kinds: ["public"] },
  ];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:px-8">
      <div className="flex items-center gap-2">
        <Users className="size-5 text-sky" />
        <h2 className="font-display text-2xl font-semibold">Copy people</h2>
      </div>
      <p className="rounded-2xl bg-sky/10 px-4 py-3 text-sm leading-relaxed text-sky">
        Turn one On. Filings are late. Crypto whales are paper longs only — not Polymarket, not shorts.
      </p>
      {groups.map((g) => {
        const bots = copyBots.filter((b) => {
          const leader = COPY_LEADERS.find((l) => l.id === b.leaderId);
          if (leader) return g.kinds.includes(leader.kind);
          if (g.kinds.includes("crypto-top") && (b.leaderId || "").startsWith("hl-")) return true;
          return false;
        });
        if (!bots.length) return null;
        return (
          <div key={g.title}>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{g.title}</h3>
            <ul className="space-y-2">
              {bots.map((b) => {
                const leader = COPY_LEADERS.find((l) => l.id === b.leaderId);
                const events = desk.copyEvents.filter((e) => e.leaderId === b.leaderId).slice(0, 4);
                const score = desk.scores.find((s) => s.botId === b.id);
                return (
                  <li key={b.id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{b.name.replace(/^Copy /, "")}</p>
                        <p className="text-xs text-muted">
                          {leader?.role} · {money(b.sizeUsd, 0)} per copy
                        </p>
                      </div>
                      <OnOff on={b.enabled} onClick={() => onToggle(b.id)} />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{leader?.blurb}</p>
                    <p className="mt-1 text-xs text-muted">{b.lastReason || "Off."}</p>
                    {desk.risk?.copyQuality.find((q) => q.botId === b.id)?.ok === false && (
                      <p className="mt-1 text-xs text-warn">
                        {desk.risk.copyQuality.find((q) => q.botId === b.id)?.why}
                      </p>
                    )}
                    {score && score.trades > 0 && (
                      <p className={cn("mt-1 font-mono text-xs", score.netPnl >= 0 ? "text-primary" : "text-down")}>
                        {score.trades} copies · net {money(score.netPnl)}
                        {score.sells >= 8 ? ` · PF ${score.profitFactor.toFixed(2)}` : ""}
                      </p>
                    )}
                    {events.map((e) => (
                      <p key={e.id} className="mt-1 font-mono text-xs">
                        <span className={e.side === "buy" ? "text-primary" : "text-down"}>
                          {e.side === "buy" ? "BUY" : "SELL"} {e.ticker}
                        </span>
                        <span className="text-muted">
                          {" "}
                          {e.amount}
                          {e.delayDays ? ` · ${e.delayDays}d late` : ""}
                        </span>
                      </p>
                    ))}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function LogPane({
  desk,
  onCopyReport,
}: {
  desk: DeskSnapshot;
  onCopyReport: (text: string) => void;
}) {
  const [logTab, setLogTab] = useState<"all" | MarketKind>("all");
  const logTabs: { id: "all" | MarketKind; label: string }[] = [
    { id: "all", label: "All" },
    { id: "stock", label: "Stocks" },
    { id: "crypto", label: "Crypto" },
    { id: "poly", label: "Polymarket" },
  ];
  const fills =
    logTab === "all"
      ? desk.fills
      : logTab === "poly"
        ? desk.fills.filter((f) => f.kind === "poly" || f.kind === "pump")
        : desk.fills.filter((f) => f.kind === logTab);
  const sellPnl = fills.filter((f) => f.side === "sell").reduce((n, f) => n + (f.realizedPnl || 0), 0);
  const fees = fills.reduce((n, f) => n + f.fee, 0);

  return (
    <div className="grid gap-6 p-4 md:grid-cols-2 md:px-8">
      <div>
        <h2 className="font-display text-2xl font-semibold">Scanner</h2>
        <p className="mb-2 text-sm text-muted">Why it bought, sold, or skipped.</p>
        <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
          <ScanTape notes={desk.scanTape || []} empty="No scan yet — wait about 15 seconds." />
        </div>
        <h2 className="mt-6 font-display text-2xl font-semibold">Reports</h2>
        {(!desk.reports || desk.reports.length === 0) && (
          <p className="mt-1 text-sm text-muted">Tap Save report, then paste it in chat.</p>
        )}
        <ul className="mt-3 space-y-2">
          {(desk.reports || []).map((r: DeskReport) => (
            <li key={r.id} className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">{clock(r.ts)}</p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-elevated px-3 text-xs font-semibold"
                  onClick={() => onCopyReport(r.text)}
                >
                  <ClipboardCopy className="size-3.5" />
                  Copy
                </button>
              </div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted">
                {r.text}
              </pre>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold">Trade log</h2>
        <div className="mt-3 mb-2 flex gap-1 overflow-x-auto">
          {logTabs.map((t) => {
            const n = t.id === "all" ? desk.fills.length : desk.fills.filter((f) => f.kind === t.id).length;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setLogTab(t.id)}
                className={cn(
                  "min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold",
                  logTab === t.id ? "bg-fg text-bg" : "bg-surface text-muted shadow-[var(--shadow-card)]",
                )}
              >
                {t.label}
                <span className="ml-1 font-mono text-xs opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
        {fills.length > 0 && (
          <p className="mb-2 font-mono text-xs">
            <span className={signedClass(sellPnl)}>{signedMoney(sellPnl)}</span>
            <span className="text-muted"> cashed in · fees {money(fees)}</span>
          </p>
        )}
        <ul className="max-h-[70dvh] space-y-2 overflow-y-auto">
          {fills.length === 0 && (
            <li className="text-sm text-muted">
              {logTab === "all"
                ? "No trades yet."
                : logTab === "poly"
                  ? "No Polymarket trades yet."
                  : logTab === "crypto"
                    ? "No crypto trades yet."
                    : "No stock trades yet."}
            </li>
          )}
          {fills.slice(0, 80).map((f) => (
            <FillRow key={f.id} fill={f} symbol={desk.quotes[f.symbol]?.symbol ?? f.symbol} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ScanTape({ notes, empty }: { notes: ScanNote[]; empty?: string }) {
  if (!notes.length) {
    return <p className="text-sm text-muted">{empty || "Nothing scanned yet."}</p>;
  }
  return (
    <ul className="max-h-56 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug">
      {notes.map((n, i) => (
        <li key={`${n.botId}-${n.symbol}-${n.ts}-${i}`} className="flex gap-2">
          <span
            className={cn(
              "w-9 shrink-0",
              n.decision === "buy" && "text-primary",
              n.decision === "sell" && "text-down",
              n.decision === "skip" && "text-muted",
            )}
          >
            {n.decision === "buy" ? "BUY" : n.decision === "sell" ? "SELL" : "skip"}
          </span>
          <span className="w-16 shrink-0 text-fg">{n.ticker}</span>
          <span className="min-w-0 text-muted">{n.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function OnOff({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 min-w-16 rounded-full px-4 text-sm font-semibold",
        on ? "bg-core text-surface" : "bg-elevated text-muted",
      )}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

function feeLine(fill: Fill): string {
  const bits: string[] = [];
  if (fill.gasFee) bits.push(`gas ${money(fill.gasFee)}`);
  if (fill.venueFee) bits.push(`venue ${money(fill.venueFee)}`);
  if (fill.regulatoryFee) bits.push(`reg ${money(fill.regulatoryFee)}`);
  if (!bits.length) return money(fill.fee);
  return `${money(fill.fee)} (${bits.join(" · ")})`;
}

function FillRow({ fill, symbol }: { fill: Fill; symbol: string }) {
  const who =
    fill.source === "manual"
      ? "You"
      : fill.source === "copy"
        ? fill.leaderName || fill.botName || "Copy"
        : fill.botName || "Bot";
  const totalOut = fill.notional + fill.fee;
  const netIn = fill.notional - fill.fee;
  const boughtFor = fill.side === "sell" ? netIn - fill.realizedPnl : 0;

  return (
    <li className="rounded-2xl bg-surface px-4 py-3 text-sm shadow-[var(--shadow-card)]">
      <div className="flex justify-between gap-2 font-mono text-xs">
        <span className={fill.side === "buy" ? "text-primary" : "text-fg"}>
          {fill.side === "buy" ? "BUY" : "SELL"} {symbol}
        </span>
        <span className="text-muted">{clock(fill.ts)}</span>
      </div>
      <p className="mt-1 text-xs text-muted">
        {who}
        {fill.kind === "poly" || fill.kind === "pump"
          ? fill.kind === "poly"
            ? " · Polymarket"
            : " · Pump.fun (old)"
          : fill.kind === "crypto"
            ? " · crypto"
            : " · stock"}
      </p>
      {fill.side === "buy" ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          <dt className="text-muted">Paid</dt>
          <dd className="text-right">{money(fill.notional)}</dd>
          <dt className="text-muted">Fees + gas</dt>
          <dd className="text-right">{feeLine(fill)}</dd>
          <dt className="text-muted">Total out</dt>
          <dd className="text-right font-medium">{money(totalOut)}</dd>
        </dl>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
          <dt className="text-muted">Sold</dt>
          <dd className="text-right">{money(fill.notional)}</dd>
          <dt className="text-muted">Fees + gas</dt>
          <dd className="text-right">{feeLine(fill)}</dd>
          <dt className="text-muted">Net in</dt>
          <dd className="text-right">{money(netIn)}</dd>
          <dt className="text-muted">Bought for</dt>
          <dd className="text-right">{money(boughtFor)} incl. fees</dd>
          <dt className={cn("font-medium", signedClass(fill.realizedPnl))}>P/L</dt>
          <dd className={cn("text-right font-medium", signedClass(fill.realizedPnl))}>
            {signedMoney(fill.realizedPnl)}
          </dd>
        </dl>
      )}
      <p className="mt-2 text-xs leading-relaxed text-muted">{fill.reason}</p>
    </li>
  );
}
