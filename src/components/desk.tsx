import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Bot,
  CircleAlert,
  ClipboardCopy,
  FileText,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Spark } from "@/components/spark";
import { cn } from "@/lib/cn";
import { COPY_LEADERS } from "@/lib/copy-leaders";
import { ago, clock, compactMoney, money, pct, qtyFmt } from "@/lib/format";
import { useServerDesk } from "@/lib/store";
import type {
  BotScore,
  DeskReport,
  DeskSnapshot,
  Fill,
  MarketKind,
  Position,
  Quote,
  ScanScope,
  StrategyId,
  WalletView,
} from "@/lib/types";
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

const TABS = ["Markets", "Bots", "Copy", "Log"] as const;
type Tab = (typeof TABS)[number];
const SIZES = [10, 25, 50, 100];

function kindLabel(k: MarketKind) {
  if (k === "stock") return "Stock";
  if (k === "crypto") return "Crypto";
  return "Pump.fun";
}

export function Desk() {
  const remote = useServerDesk();
  const desk = remote.desk;
  const [tab, setTab] = useState<Tab>("Markets");
  const [filter, setFilter] = useState<"all" | MarketKind>("all");
  const [notional, setNotional] = useState(25);
  const [selectedId, setSelectedId] = useState("NVDA");
  const [query, setQuery] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetName, setResetName] = useState("");

  const quotes = useMemo(() => {
    if (!desk) return [];
    const list = Object.values(desk.quotes);
    const filtered = filter === "all" ? list : list.filter((q) => q.kind === filter);
    return filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [desk, filter]);

  if (!desk) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        <p className="text-sm">Starting Cora Desktop…</p>
      </div>
    );
  }

  const selected = desk.quotes[selectedId] ?? quotes[0];
  const equity = desk.equityNow;
  const dayPnl = equity - desk.dayStartEquity;
  const botsOn = desk.bots.filter((b) => b.enabled).length;
  const pumpLive = Object.values(desk.quotes).filter((q) => q.kind === "pump" && q.live).length;
  const cryptoLive = Object.values(desk.quotes).filter((q) => q.kind === "crypto" && q.live).length;
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
        theme="dark"
        toastOptions={{ className: "bg-elevated text-fg border-border font-sans" }}
      />
      <header className="border-b border-border bg-surface px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-elevated shadow-[var(--shadow-border)]">
              <Activity className="size-4 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold leading-tight">Cora Desktop</h1>
                <span className="rounded-sm bg-elevated px-2 py-0.5 font-mono text-xs text-warn">
                  Paper · Core $800 · Pump $200
                </span>
              </div>
              <p className="text-xs text-muted">
                {botsOn} bot{botsOn === 1 ? "" : "s"} on ·{" "}
                {cryptoLive > 0 ? `${cryptoLive} live crypto · ` : ""}
                {pumpLive > 0
                  ? `${pumpLive} live Pump.fun coins · `
                  : "Pump.fun board estimated · "}
                {desk.stockMarketOpen ? "US stocks open" : "US stocks closed"} · last check{" "}
                {ago(desk.loopAt)}
                {last
                  ? ` · last trade ${last.side} ${desk.quotes[last.symbol]?.symbol ?? last.symbol}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto font-mono text-xs">
            {(desk.walletViews || []).map((w) => (
              <WalletPill key={w.id} wallet={w} />
            ))}
            <Pill label="Total" value={compactMoney(equity)} tone={desk.stats.netPnl >= 0 ? "up" : "down"} />
            <Pill
              label="Today"
              value={pct((dayPnl / Math.max(desk.dayStartEquity, 1)) * 100)}
              tone={dayPnl >= 0 ? "up" : "down"}
            />
          </div>
        </div>

        {resetOpen ? (
          <div className="mt-3 rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-sm font-medium">Start a new $1,000 test</p>
            <p className="mt-1 text-xs text-muted">
              $800 stocks + crypto, $200 Pump.fun. Saves this run. Bots stay as they are.
            </p>
            <input
              value={resetName}
              onChange={(e) => setResetName(e.target.value)}
              placeholder={`Test ${(desk.tests?.length ?? 0) + 1}`}
              className="mt-2 min-h-11 w-full rounded-md bg-surface px-3 text-sm outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                className="min-h-11 flex-1 rounded-md bg-primary font-medium text-bg"
                onClick={() => {
                  void remote.reset(resetName).then(() => {
                    toast("New $1,000 test started — bots kept");
                    setResetOpen(false);
                    setResetName("");
                  });
                }}
              >
                Save & reset
              </button>
              <button
                type="button"
                className="min-h-11 flex-1 rounded-md bg-surface text-sm"
                onClick={() => setResetOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-elevated px-3 text-sm"
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw className="size-3.5" />
              New $1,000 test
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-elevated px-3 text-sm"
              onClick={() => {
                void remote.saveReport().then(async (next) => {
                  const text = next?.reports?.[0]?.text;
                  if (text) {
                    try {
                      await navigator.clipboard.writeText(text);
                      toast("Report saved and copied — paste it in chat to have Grok tweak the bots");
                    } catch {
                      toast("Report saved in Log — copy it from there");
                    }
                    setTab("Log");
                  } else toast("Could not build a report");
                });
              }}
            >
              <FileText className="size-3.5" />
              Save report
            </button>
          </div>
        )}

        {(desk.halted || desk.walletViews?.some((w) => w.halted) || remote.err) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warn">
            <CircleAlert className="size-3.5" />
            {desk.haltReason || desk.walletViews?.find((w) => w.halted)?.haltReason || remote.err}
            {(desk.halted || desk.walletViews?.some((w) => w.halted)) && (
              <button
                type="button"
                className="rounded-sm bg-elevated px-2 py-1 text-fg"
                onClick={() => void remote.resume()}
              >
                Resume
              </button>
            )}
          </div>
        )}
      </header>

      {holdings.length > 0 && (
        <HoldingsStrip
          desk={desk}
          onSelect={(id) => {
            setSelectedId(id);
            setTab("Markets");
          }}
          onSellAll={sellAll}
          onSellHalf={sellHalf}
        />
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 rounded-md px-4 font-medium text-sm",
              tab === t ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Markets" && (
        <div className="grid gap-px bg-border md:grid-cols-[minmax(16rem,28%)_minmax(0,1fr)]">
          <Watch
            quotes={quotes}
            filter={filter}
            setFilter={setFilter}
            selectedId={selected?.id}
            query={query}
            setQuery={setQuery}
            onSearch={(symbol) => {
              void remote.addSymbol(symbol).then((next) => {
                if (!next) return;
                const found =
                  next.quotes[symbol.toUpperCase()] ||
                  Object.values(next.quotes).find(
                    (q) => q.symbol.toUpperCase() === symbol.toUpperCase(),
                  );
                if (found) {
                  setSelectedId(found.id);
                  toast(`Added ${found.symbol}`);
                } else toast("Couldn't find that ticker");
              });
            }}
            onSelect={setSelectedId}
            holdings={desk.positions}
            onSellAll={sellAll}
          />
          {selected && (
            <ChartAndTicket
              quote={selected}
              notional={notional}
              setNotional={setNotional}
              position={desk.positions[selected.id]}
              lockUntil={desk.manualLocks?.[selected.id] ?? 0}
              onTrade={(side, close) => {
                if (side === "sell" && !desk.positions[selected.id]) {
                  toast("You don't hold this — nothing to sell");
                  return;
                }
                void remote.trade(side, selected.id, notional, close).then((next) => {
                  if (!next) {
                    toast("Trade failed");
                    return;
                  }
                  if (side === "buy") toast(`Bought ${selected.symbol}`);
                  else if (close) toast(`Sold all ${selected.symbol}`);
                  else toast(`Sold ${selected.symbol}`);
                });
              }}
              equity={desk.equity}
              stats={desk.stats}
              marketOpen={desk.stockMarketOpen}
              wallet={desk.walletViews?.find((w) => (selected.kind === "pump" ? w.id === "pump" : w.id === "core"))}
            />
          )}
        </div>
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

      {tab === "Copy" && (
        <CopyPane
          desk={desk}
          onToggle={(id) => void remote.toggleBot(id)}
        />
      )}

      {tab === "Log" && (
        <LogPane
          desk={desk}
          onSelect={setSelectedId}
          onSellAll={sellAll}
          onOpenMarkets={() => setTab("Markets")}
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

function WalletPill({ wallet }: { wallet: WalletView }) {
  const tone = wallet.netPnl >= 0 ? "up" : "down";
  return (
    <div className="min-w-[9.5rem] rounded-md bg-elevated px-2.5 py-1.5 shadow-[var(--shadow-border)]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted">{wallet.id === "core" ? "Core" : "Pump"}</span>
        <span className="tabular-nums">{compactMoney(wallet.equity)}</span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-muted">cash {compactMoney(wallet.cash)}</span>
        <span className={cn("tabular-nums", tone === "up" ? "text-primary" : "text-down")}>
          {money(wallet.netPnl)}
        </span>
      </div>
    </div>
  );
}

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "warn";
}) {
  return (
    <div className="rounded-md bg-elevated px-2.5 py-1.5 shadow-[var(--shadow-border)]">
      <span className="mr-2 text-muted">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          tone === "up" && "text-primary",
          tone === "down" && "text-down",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function HoldingsStrip({
  desk,
  onSelect,
  onSellAll,
  onSellHalf,
}: {
  desk: DeskSnapshot;
  onSelect: (id: string) => void;
  onSellAll: (id: string) => void;
  onSellHalf: (id: string) => void;
}) {
  const rows = Object.values(desk.positions);
  return (
    <section className="border-b border-border bg-surface px-4 py-3 md:px-6">
      <div className="mb-2 flex items-center gap-2">
        <Wallet className="size-3.5 text-primary" />
        <p className="text-xs font-medium">
          Your positions · sell any time, no bot needed
        </p>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {rows.map((p) => {
          const q = desk.quotes[p.symbol];
          const mark = q?.price ?? p.avg;
          const mtm = (mark - p.avg) * p.qty;
          const value = p.qty * mark;
          return (
            <li
              key={p.symbol}
              className="min-w-[15.5rem] shrink-0 rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]"
            >
              <button
                type="button"
                className="w-full text-left"
                onClick={() => onSelect(p.symbol)}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-sm">{q?.symbol ?? p.symbol}</span>
                  <span className={cn("font-mono text-xs", mtm >= 0 ? "text-primary" : "text-down")}>
                    {money(mtm)}
                  </span>
                </span>
                <span className="mt-0.5 block font-mono text-xs text-muted">
                  {qtyFmt(p.qty)} · {money(value)} · avg {money(p.avg)}
                </span>
              </button>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-surface text-xs font-medium"
                  onClick={() => onSellHalf(p.symbol)}
                >
                  Sell ½
                </button>
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-down text-xs font-semibold text-fg"
                  onClick={() => onSellAll(p.symbol)}
                >
                  Sell all
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Watch({
  quotes,
  filter,
  setFilter,
  selectedId,
  onSelect,
  query,
  setQuery,
  onSearch,
  holdings,
  onSellAll,
}: {
  quotes: Quote[];
  filter: "all" | MarketKind;
  setFilter: (f: "all" | MarketKind) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  onSearch: (symbol: string) => void;
  holdings: Record<string, Position>;
  onSellAll: (id: string) => void;
}) {
  const filters: Array<"all" | MarketKind> = ["all", "stock", "crypto", "pump"];
  return (
    <div className="flex h-full flex-col bg-bg">
      <form
        className="flex gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) onSearch(query.trim());
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add ticker (AAPL, BTC-USD…)"
          className="min-h-11 min-w-0 flex-1 rounded-md bg-elevated px-3 text-sm outline-none"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-elevated"
          aria-label="Add ticker"
        >
          <Search className="size-4" />
        </button>
      </form>
      <div className="flex gap-1 overflow-x-auto px-3 pb-2">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-11 rounded-md px-3 text-xs font-medium",
              filter === f ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            {f === "all" ? "All" : kindLabel(f)}
          </button>
        ))}
      </div>
      <ul className="max-h-[70dvh] overflow-y-auto md:max-h-[calc(100dvh-16rem)]">
        {quotes.map((q) => {
          const up = q.changePct >= 0;
          const held = holdings[q.id];
          const mtm = held ? (q.price - held.avg) * held.qty : 0;
          return (
            <li key={q.id}>
              <div
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2.5 transition-colors duration-150",
                  selectedId === q.id ? "bg-elevated" : "hover:bg-surface",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(q.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="w-16 font-mono text-xs text-muted">{kindLabel(q.kind)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm">{q.symbol}</span>
                    <span className="block truncate text-xs text-muted">
                      {held ? `You hold ${qtyFmt(held.qty)}` : q.name}
                    </span>
                  </span>
                  <Spark data={q.spark} up={up} />
                  <span className="w-24 text-right font-mono text-xs tabular-nums">
                    <span className="block">{money(q.price)}</span>
                    <span className={held ? (mtm >= 0 ? "text-primary" : "text-down") : up ? "text-primary" : "text-down"}>
                      {held ? money(mtm) : pct(q.changePct)}
                    </span>
                  </span>
                </button>
                {held && (
                  <button
                    type="button"
                    className="min-h-11 shrink-0 rounded-md bg-down px-2.5 text-xs font-semibold text-fg"
                    onClick={() => onSellAll(q.id)}
                  >
                    Sell
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChartAndTicket({
  quote,
  notional,
  setNotional,
  position,
  lockUntil,
  onTrade,
  equity,
  stats,
  marketOpen,
  wallet,
}: {
  quote: Quote;
  notional: number;
  setNotional: (n: number) => void;
  position?: { qty: number; avg: number };
  lockUntil: number;
  onTrade: (side: "buy" | "sell", close?: boolean) => void;
  equity: { t: number; v: number }[];
  stats: DeskSnapshot["stats"];
  marketOpen: boolean;
  wallet?: WalletView;
}) {
  const up = quote.changePct >= 0;
  const chartData = quote.spark.map((v, i) => ({ i, v }));
  const eqData = equity.map((p) => ({ i: p.t, v: p.v }));
  const pnl = position ? (quote.price - position.avg) * position.qty : 0;

  return (
    <div className="flex flex-col gap-4 bg-bg p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs tracking-widest text-muted uppercase">
            {kindLabel(quote.kind)}
            {quote.kind === "stock" ? (marketOpen ? " · market open" : " · market closed") : ""}
            {quote.live ? " · live price" : " · estimated price"}
          </p>
          <h2 className="text-2xl font-semibold">
            {quote.symbol}{" "}
            <span className="text-base font-normal text-muted">{quote.name}</span>
          </h2>
        </div>
        <div className="text-right font-mono">
          <p className="text-2xl tabular-nums">{money(quote.price)}</p>
          <p className={cn("text-sm", up ? "text-primary" : "text-down")}>{pct(quote.changePct)}</p>
        </div>
      </div>

      <div className="h-48 rounded-lg bg-surface p-2 shadow-[var(--shadow-border)] md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={up ? "var(--color-primary)" : "var(--color-down)"} stopOpacity={0.35} />
                <stop offset="100%" stopColor={up ? "var(--color-primary)" : "var(--color-down)"} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{
                background: "var(--color-elevated)",
                border: "1px solid var(--color-border)",
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                color: "var(--color-fg)",
              }}
              formatter={(value) => money(Number(value ?? 0))}
              labelFormatter={() => quote.symbol}
            />
            <Area
              type="monotone"
              dataKey="v"
              stroke={up ? "var(--color-primary)" : "var(--color-down)"}
              fill="url(#px)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid gap-3 rounded-lg bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>
            Pays from the {quote.kind === "pump" ? "Pump.fun" : "stocks + crypto"} wallet
            {wallet ? ` · cash ${money(wallet.cash)}` : ""}
          </span>
          {position && (
            <span className="font-mono text-fg">
              You own {qtyFmt(position.qty)} @ {money(position.avg)}{" "}
              <span className={pnl >= 0 ? "text-primary" : "text-down"}>{money(pnl)}</span>
            </span>
          )}
        </div>
        {wallet?.halted && <p className="text-xs text-warn">{wallet.haltReason}</p>}
        {lockUntil > Date.now() && (
          <p className="text-xs text-warn">
            You sold this. Bots skip {quote.symbol} until{" "}
            {new Date(lockUntil).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.
            You can still buy it yourself any time.
          </p>
        )}
        <p className="text-xs text-muted">Dollar amount (buy, or sell part of a position)</p>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNotional(n)}
              className={cn(
                "min-h-11 rounded-md px-3 font-mono text-sm",
                notional === n ? "bg-primary text-bg" : "bg-elevated",
              )}
            >
              {compactMoney(n)}
            </button>
          ))}
        </div>
        <input
          type="number"
          min={10}
          step={25}
          value={notional}
          onChange={(e) => setNotional(Number(e.target.value) || 0)}
          className="min-h-11 w-full rounded-md bg-elevated px-3 font-mono text-sm text-fg outline-none"
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTrade("buy")}
            className="min-h-11 rounded-md bg-primary font-semibold text-bg"
          >
            Buy {compactMoney(notional)}
          </button>
          <button
            type="button"
            onClick={() => onTrade("sell")}
            disabled={!position}
            className="min-h-11 rounded-md bg-elevated font-semibold text-fg disabled:opacity-40"
          >
            Sell {compactMoney(notional)}
          </button>
        </div>
        <button
          type="button"
          onClick={() => onTrade("sell", true)}
          disabled={!position}
          className="min-h-11 w-full rounded-md bg-down font-semibold text-fg disabled:opacity-40"
        >
          {position
            ? `Sell all ${quote.symbol} · ${qtyFmt(position.qty)} · ${money(position.qty * quote.price)}`
            : "Sell all — you don't hold this"}
        </button>
        <p className="text-xs text-muted">
          Paper fills hit now. You do not wait for a bot. Fees come out of the fill.
        </p>
        <p className="text-xs text-muted">
          Open profit {money(stats.unrealizedPnl)} · Cashed in {money(stats.realizedPnl)} · Fees{" "}
          {money(stats.feesPaid)}
        </p>
      </div>

      <div className="h-24 rounded-lg bg-surface p-2 shadow-[var(--shadow-border)]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={eqData}>
            <XAxis dataKey="i" hide />
            <YAxis hide domain={["auto", "auto"]} />
            <Area type="monotone" dataKey="v" stroke="var(--color-fg)" fill="transparent" strokeWidth={1.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
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
  const copyBots = copyPeopleFirst(desk.bots.filter((b) => b.strategy === "copy"));
  const selectedQuote = quotes.find((q) => q.id === symbol) ?? quotes[0];
  const pumpStrats: StrategyId[] = ["sniper", "scalp"];
  const bookStrats: StrategyId[] = ["sma", "meanrev", "momentum", "dca"];
  const stratOptions =
    scope === "pump" ? pumpStrats : scope === "all" ? [...bookStrats, ...pumpStrats] : bookStrats;
  const activeStrategy = stratOptions.includes(strategy) ? strategy : stratOptions[0]!;
  const maxNames = scope === "one" ? 1 : scope === "pump" ? 3 : scope === "all" ? 6 : 4;

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Which bots are making money</h2>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Scan bots look through matching names each pass. Elon, Congress, and Hyperliquid whales
          are under Copy people below — also on the Copy tab. Leave one person On.
        </p>
        <Scoreboard scores={desk.scores} />
        <ul className="mt-4 space-y-2">
          {stratBots.map((b) => {
            const score = desk.scores.find((s) => s.botId === b.id);
            const scopeLabel = SCOPE_COPY[b.scope || "one"]?.label || "One ticker";
            return (
              <li key={b.id} className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{b.name}</p>
                    <p className="text-xs text-muted">
                      {scopeLabel} · {STRATEGY_COPY[b.strategy]?.label} · {money(b.sizeUsd, 0)} each
                      {b.scope && b.scope !== "one" ? ` · up to ${b.maxNames || 4} names` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <OnOff on={b.enabled} onClick={() => onToggle(b.id)} />
                    <button
                      type="button"
                      className="flex size-11 items-center justify-center rounded-md bg-elevated text-muted"
                      onClick={() => onRemove(b.id)}
                      aria-label="Remove bot"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {b.enabled ? "On — scans even after you close this page." : "Off."}{" "}
                  {b.lastReason || STRATEGY_COPY[b.strategy]?.blurb}
                </p>
                {score && (
                  <p className={cn("mt-1 font-mono text-xs", score.netPnl >= 0 ? "text-primary" : "text-down")}>
                    {score.trades} trades · net {money(score.netPnl)} after {money(score.fees)} fees
                    {score.unrealizedPnl ? ` · open ${money(score.unrealizedPnl)}` : ""}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {copyBots.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Copy people</h2>
            </div>
            <p className="mb-2 text-xs text-muted">
              Same On/Off as the Copy tab. Pick one whale or one person — not nine.
            </p>
            <ul className="space-y-2">
              {copyBots.map((b) => {
                const leader = COPY_LEADERS.find((l) => l.id === b.leaderId);
                return (
                  <li key={b.id} className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{b.name.replace(/^Copy /, "")}</p>
                        <p className="text-xs text-muted">
                          {leader?.role || "Copy"} · {money(b.sizeUsd, 0)} per copy
                        </p>
                      </div>
                      <OnOff on={b.enabled} onClick={() => onToggle(b.id)} />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {b.lastReason || leader?.blurb || "Waiting for a public trade or holding."}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
      <form
        className="h-fit space-y-2 rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]"
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
        <p className="text-sm font-medium">Add a bot</p>
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
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-md bg-elevated text-sm font-medium"
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
  const sorted = [...scores].sort((a, b) => b.netPnl - a.netPnl);
  return (
    <div className="overflow-x-auto rounded-lg bg-surface shadow-[var(--shadow-border)]">
      <table className="w-full text-left text-xs">
        <thead className="text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Bot</th>
            <th className="px-3 py-2 font-medium">Trades</th>
            <th className="px-3 py-2 font-medium">Fees</th>
            <th className="px-3 py-2 font-medium">Net P/L</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {sorted.map((s) => (
            <tr key={s.botId} className="border-t border-border">
              <td className="px-3 py-2 font-sans">
                {s.name}
                {s.enabled ? " · on" : ""}
              </td>
              <td className="px-3 py-2">{s.trades}</td>
              <td className="px-3 py-2">{money(s.fees)}</td>
              <td className={cn("px-3 py-2", s.netPnl >= 0 ? "text-primary" : "text-down")}>
                {money(s.netPnl)}
              </td>
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
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Copy top traders</h2>
      </div>
      <p className="rounded-lg bg-elevated px-3 py-2 text-xs leading-relaxed text-warn">
        Stocks: Buffett / ARKK / Ackman are public filings or ETF books — weeks to months late.
        Crypto: top 5 Hyperliquid wallets by 30-day PnL. We copy coins they are long.
        Not Pump.fun, not their live clicks, not shorts. Turn one On, the rest Off.
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
                  <li key={b.id} className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{b.name.replace(/^Copy /, "")}</p>
                        <p className="text-xs text-muted">
                          {leader?.role} · {money(b.sizeUsd, 0)} per copy
                        </p>
                      </div>
                      <OnOff on={b.enabled} onClick={() => onToggle(b.id)} />
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted">{leader?.blurb}</p>
                    <p className="mt-1 text-xs text-muted">{b.lastReason || "Off."}</p>
                    {score && score.trades > 0 && (
                      <p className={cn("mt-1 font-mono text-xs", score.netPnl >= 0 ? "text-primary" : "text-down")}>
                        {score.trades} copies · net {money(score.netPnl)}
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
  onSelect,
  onSellAll,
  onOpenMarkets,
  onCopyReport,
}: {
  desk: DeskSnapshot;
  onSelect: (id: string) => void;
  onSellAll: (id: string) => void;
  onOpenMarkets: () => void;
  onCopyReport: (text: string) => void;
}) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <h2 className="mb-2 text-sm font-semibold">Reports for Grok</h2>
        {(!desk.reports || desk.reports.length === 0) && (
          <p className="text-xs text-muted">
            Tap Save report. It copies a log you can paste in chat so Grok can tweak the bots.
          </p>
        )}
        <ul className="mb-4 space-y-2">
          {(desk.reports || []).map((r: DeskReport) => (
            <li key={r.id} className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted">{clock(r.ts)}</p>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-elevated px-3 text-xs"
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
        <h2 className="mb-2 text-sm font-semibold">Saved tests</h2>
        {(!desk.tests || desk.tests.length === 0) && (
          <p className="text-xs text-muted">
            After a run, tap New $1,000 test to save it here and compare what worked.
          </p>
        )}
        <ul className="space-y-2">
          {(desk.tests || []).map((t) => (
            <li key={t.id} className="rounded-lg bg-surface px-3 py-2 shadow-[var(--shadow-border)]">
              <p className="text-sm font-medium">{t.name}</p>
              <p className={cn("font-mono text-xs", t.netPnl >= 0 ? "text-primary" : "text-down")}>
                {t.trades} trades · net {money(t.netPnl)} · fees {money(t.feesPaid)}
              </p>
              <p className="text-xs text-muted">
                {compactMoney(t.startingCash)} → {compactMoney(t.endingEquity)}
              </p>
            </li>
          ))}
        </ul>
        <h2 className="mt-4 mb-2 text-sm font-semibold">Open positions</h2>
        <ul className="space-y-1">
          {Object.values(desk.positions).length === 0 && (
            <li className="text-xs text-muted">Nothing open.</li>
          )}
          {Object.values(desk.positions).map((p) => {
            const q = desk.quotes[p.symbol];
            const mtm = q ? (q.price - p.avg) * p.qty : 0;
            return (
              <li
                key={p.symbol}
                className="flex items-center justify-between gap-2 rounded-md bg-surface px-3 py-2"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left font-mono text-xs"
                  onClick={() => {
                    onSelect(p.symbol);
                    onOpenMarkets();
                  }}
                >
                  <span>{q?.symbol ?? p.symbol}</span>
                  <span className="block text-muted">
                    {qtyFmt(p.qty)} @ {money(p.avg)}
                  </span>
                </button>
                <span className={cn("font-mono text-xs", mtm >= 0 ? "text-primary" : "text-down")}>
                  {money(mtm)}
                </span>
                <button
                  type="button"
                  className="min-h-11 rounded-md bg-down px-3 text-xs font-semibold text-fg"
                  onClick={() => onSellAll(p.symbol)}
                >
                  Sell all
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div>
        <h2 className="mb-2 text-sm font-semibold">Trade log</h2>
        <ul className="max-h-[70dvh] space-y-2 overflow-y-auto">
          {desk.fills.length === 0 && <li className="text-xs text-muted">No trades yet.</li>}
          {desk.fills.slice(0, 60).map((f) => (
            <FillRow key={f.id} fill={f} symbol={desk.quotes[f.symbol]?.symbol ?? f.symbol} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function OnOff({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 min-w-16 rounded-md px-3 text-sm font-semibold",
        on ? "bg-primary text-bg" : "bg-elevated text-muted",
      )}
    >
      {on ? "On" : "Off"}
    </button>
  );
}

function FillRow({ fill, symbol }: { fill: Fill; symbol: string }) {
  const who =
    fill.source === "manual"
      ? "You"
      : fill.source === "copy"
        ? fill.leaderName || fill.botName || "Copy"
        : fill.botName || "Bot";
  return (
    <li className="rounded-md bg-surface px-3 py-2 text-xs">
      <div className="flex justify-between font-mono">
        <span className={fill.side === "buy" ? "text-primary" : "text-down"}>
          {fill.side === "buy" ? "BUY" : "SELL"} {symbol}
        </span>
        <span>{money(fill.price)}</span>
      </div>
      <p className="mt-1 leading-relaxed text-muted">{fill.reason}</p>
      <div className="mt-1 font-mono text-muted">
        {who} · {qtyFmt(fill.qty)} · fee {money(fill.fee)}
        {fill.gasFee ? ` · gas ${money(fill.gasFee)}` : ""} · {clock(fill.ts)}
      </div>
      {fill.side === "sell" && (
        <div className={fill.realizedPnl >= 0 ? "text-primary" : "text-down"}>
          Profit {money(fill.realizedPnl)}
        </div>
      )}
    </li>
  );
}
