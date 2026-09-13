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
  Pause,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Spark } from "@/components/spark";
import { cn } from "@/lib/cn";
import { COPY_LEADERS } from "@/lib/copy-leaders";
import { ago, clock, compactMoney, money, pct, qtyFmt } from "@/lib/format";
import { useServerDesk } from "@/lib/store";
import type { Bot as BotRow, DeskSnapshot, Fill, MarketKind, Quote, StrategyId } from "@/lib/types";
import { STRATEGY_COPY } from "@/lib/universe";

const TABS = ["Watch", "Chart", "Trade", "Bots", "Copy", "Book"] as const;
type Tab = (typeof TABS)[number];

function kindLabel(k: MarketKind) {
  if (k === "stock") return "EQ";
  if (k === "crypto") return "CX";
  return "PF";
}

export function Desk() {
  const remote = useServerDesk();
  const desk = remote.desk;
  const [tab, setTab] = useState<Tab>("Watch");
  const [filter, setFilter] = useState<"all" | MarketKind>("all");
  const [notional, setNotional] = useState(1000);
  const [selectedId, setSelectedId] = useState("NVDA");

  const quotes = useMemo(() => {
    if (!desk) return [];
    const list = Object.values(desk.quotes);
    const filtered = filter === "all" ? list : list.filter((q) => q.kind === filter);
    return filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [desk, filter]);

  if (!desk) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-muted">
        <p className="font-mono text-sm">Starting server desk…</p>
      </div>
    );
  }

  const selected = desk.quotes[selectedId] ?? quotes[0];
  const equity = desk.equityNow;
  const dayPnl = equity - desk.dayStartEquity;
  const posList = Object.values(desk.positions);
  const botsOn = desk.bots.filter((b) => b.enabled).length;
  const copyOn = desk.bots.filter((b) => b.strategy === "copy" && b.enabled).length;

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Toaster
        theme="dark"
        toastOptions={{
          className: "bg-elevated text-fg border-border font-sans",
        }}
      />
      <header className="border-b border-border bg-surface px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-elevated shadow-[var(--shadow-border)]">
              <Activity className="size-4 text-primary" />
            </div>
            <div>
              <p className="font-mono text-xs tracking-widest text-muted uppercase">
                Server desk · {desk.loopOk ? "loop on" : "loop warm"} ·{" "}
                {ago(desk.loopAt)}
              </p>
              <h1 className="text-lg font-semibold leading-tight">Cora Desktop</h1>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto font-mono text-xs">
            <Pill
              label="Equity"
              value={compactMoney(equity)}
              tone={desk.stats.netPnl >= 0 ? "up" : "down"}
            />
            <Pill
              label="Day"
              value={pct((dayPnl / Math.max(desk.dayStartEquity, 1)) * 100)}
              tone={dayPnl >= 0 ? "up" : "down"}
            />
            <Pill
              label="Realized"
              value={compactMoney(desk.stats.realizedPnl)}
              tone={desk.stats.realizedPnl >= 0 ? "up" : "down"}
            />
            <Pill label="Fees" value={compactMoney(desk.stats.feesPaid)} />
            <Pill label="Cash" value={compactMoney(desk.cash)} />
            <Pill
              label="Feed"
              value={desk.liveQuotes ? "LIVE" : "SIM"}
              tone={desk.liveQuotes ? "up" : "warn"}
            />
            <Pill label="Bots" value={`${botsOn} on`} />
          </div>
        </div>
        <p className="mt-2 max-w-3xl text-pretty text-xs leading-relaxed text-muted">
          Bots run on the server every 15 seconds even if this page is closed.
          Fills, average cost, fees (SEC/TAF, crypto taker, Solana gas) and
          realized P/L stay on disk. Execution is still a paper book — no
          brokerage or wallet keys — so you can tune strategies before going
          live.
        </p>
        {(desk.halted || remote.err) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-warn">
            <CircleAlert className="size-3.5" />
            {desk.halted ? desk.haltReason : remote.err}
            {desk.halted && (
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

      <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 md:hidden">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "min-h-11 rounded-md px-3 font-medium text-sm",
              tab === t ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="grid gap-px bg-border md:grid-cols-[minmax(16rem,22%)_minmax(0,1fr)_minmax(16rem,26%)]">
        <section
          className={cn(
            "min-h-0 bg-bg md:block",
            tab === "Watch" ? "block" : "hidden md:block",
          )}
        >
          <Watch
            quotes={quotes}
            filter={filter}
            setFilter={setFilter}
            selectedId={selected?.id}
            onSelect={(id) => {
              setSelectedId(id);
              setTab("Chart");
            }}
          />
        </section>

        <section
          className={cn(
            "min-h-0 bg-bg md:block",
            tab === "Chart" || tab === "Trade" ? "block" : "hidden md:block",
          )}
        >
          {selected && (
            <ChartAndTicket
              quote={selected}
              notional={notional}
              setNotional={setNotional}
              position={desk.positions[selected.id]}
              onTrade={(side) => {
                void remote.trade(side, selected.id, notional).then(() => {
                  toast(`${side === "buy" ? "Bought" : "Sold"} ${selected.symbol}`);
                });
              }}
              equity={desk.equity}
              stats={desk.stats}
            />
          )}
        </section>

        <section
          className={cn(
            "min-h-0 bg-bg md:block",
            tab === "Bots" || tab === "Copy" || tab === "Book" ? "block" : "hidden md:block",
          )}
        >
          <RightRail
            focus={tab === "Book" ? "book" : tab === "Copy" ? "copy" : "bots"}
            desk={desk}
            quotes={Object.values(desk.quotes)}
            copyOn={copyOn}
            onToggle={(id) => void remote.toggleBot(id)}
            onRemove={(id) => void remote.removeBot(id)}
            onAdd={(input) =>
              void remote.addBot(input).then(() => toast(`Added ${input.name}`))
            }
          />
        </section>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted md:px-6">
        <span>
          Positions {posList.length} · Fills {desk.fills.length} · Fees{" "}
          {money(desk.stats.feesPaid)} · Net {money(desk.stats.netPnl)}
        </span>
        <button
          type="button"
          className="inline-flex min-h-11 items-center gap-1.5 text-fg"
          onClick={() => {
            void remote.reset().then(() => toast("Book reset to $100,000"));
          }}
        >
          <RotateCcw className="size-3.5" />
          Reset paper book
        </button>
      </footer>
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

function Watch({
  quotes,
  filter,
  setFilter,
  selectedId,
  onSelect,
}: {
  quotes: Quote[];
  filter: "all" | MarketKind;
  setFilter: (f: "all" | MarketKind) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const filters: Array<"all" | MarketKind> = ["all", "stock", "crypto", "pump"];
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 overflow-x-auto p-3">
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-11 rounded-md px-3 text-xs font-medium uppercase tracking-wide",
              filter === f ? "bg-elevated text-fg" : "text-muted",
            )}
          >
            {f === "all" ? "All" : f === "pump" ? "Pump.fun" : f}
          </button>
        ))}
      </div>
      <ul className="max-h-[70dvh] overflow-y-auto md:max-h-[calc(100dvh-13rem)]">
        {quotes.map((q) => {
          const up = q.changePct >= 0;
          return (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => onSelect(q.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150",
                  selectedId === q.id ? "bg-elevated" : "hover:bg-surface",
                )}
              >
                <span className="w-7 font-mono text-xs text-muted">
                  {kindLabel(q.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm">{q.symbol}</span>
                  <span className="block truncate text-xs text-muted">{q.name}</span>
                </span>
                <Spark data={q.spark} up={up} />
                <span className="w-24 text-right font-mono text-xs tabular-nums">
                  <span className="block">{money(q.price)}</span>
                  <span className={up ? "text-primary" : "text-down"}>
                    {pct(q.changePct)}
                  </span>
                </span>
              </button>
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
  onTrade,
  equity,
  stats,
}: {
  quote: Quote;
  notional: number;
  setNotional: (n: number) => void;
  position?: { qty: number; avg: number };
  onTrade: (side: "buy" | "sell") => void;
  equity: { t: number; v: number }[];
  stats: DeskSnapshot["stats"];
}) {
  const up = quote.changePct >= 0;
  const chartData = quote.spark.map((v, i) => ({ i, v }));
  const eqData = equity.map((p) => ({ i: p.t, v: p.v }));
  const pnl = position ? (quote.price - position.avg) * position.qty : 0;

  return (
    <div className="flex flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-mono text-xs tracking-widest text-muted uppercase">
            {quote.kind === "pump" ? "Pump.fun" : quote.kind}
            {quote.live ? " · live mark" : " · sim mark"}
          </p>
          <h2 className="text-2xl font-semibold">
            {quote.symbol}{" "}
            <span className="text-base font-normal text-muted">{quote.name}</span>
          </h2>
        </div>
        <div className="text-right font-mono">
          <p className="text-2xl tabular-nums">{money(quote.price)}</p>
          <p className={cn("text-sm", up ? "text-primary" : "text-down")}>
            {pct(quote.changePct)}
          </p>
        </div>
      </div>

      <div className="h-48 rounded-lg bg-surface p-2 shadow-[var(--shadow-border)] md:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor={up ? "var(--color-primary)" : "var(--color-down)"}
                  stopOpacity={0.35}
                />
                <stop
                  offset="100%"
                  stopColor={up ? "var(--color-primary)" : "var(--color-down)"}
                  stopOpacity={0}
                />
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
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Order ticket · fees taken on fill</span>
          {position && (
            <span className="font-mono text-fg">
              Long {qtyFmt(position.qty)} @ {money(position.avg)}{" "}
              <span className={pnl >= 0 ? "text-primary" : "text-down"}>
                {money(pnl)}
              </span>
            </span>
          )}
        </div>
        <label className="text-xs text-muted">
          Notional USD
          <input
            type="number"
            min={10}
            step={100}
            value={notional}
            onChange={(e) => setNotional(Number(e.target.value) || 0)}
            className="mt-1 min-h-11 w-full rounded-md bg-elevated px-3 font-mono text-sm text-fg outline-none shadow-[var(--shadow-border)]"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onTrade("buy")}
            className="min-h-11 rounded-md bg-primary font-semibold text-bg"
          >
            Buy
          </button>
          <button
            type="button"
            onClick={() => onTrade("sell")}
            disabled={!position}
            className="min-h-11 rounded-md bg-down font-semibold text-fg disabled:opacity-40"
          >
            Sell
          </button>
        </div>
        <p className="font-mono text-xs text-muted">
          Unrealized {money(stats.unrealizedPnl)} · Realized {money(stats.realizedPnl)}{" "}
          · Fees {money(stats.feesPaid)}
        </p>
      </div>

      <div>
        <p className="mb-2 text-xs tracking-widest text-muted uppercase">
          Equity curve
        </p>
        <div className="h-28 rounded-lg bg-surface p-2 shadow-[var(--shadow-border)]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={eqData}>
              <XAxis dataKey="i" hide />
              <YAxis hide domain={["auto", "auto"]} />
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--color-fg)"
                fill="transparent"
                strokeWidth={1.5}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function RightRail({
  focus,
  desk,
  quotes,
  copyOn,
  onToggle,
  onRemove,
  onAdd,
}: {
  focus: "bots" | "copy" | "book";
  desk: DeskSnapshot;
  quotes: Quote[];
  copyOn: number;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (input: { name: string; symbol: string; strategy: StrategyId; sizeUsd: number }) => void;
}) {
  const [name, setName] = useState("New bot");
  const [symbol, setSymbol] = useState("AAPL");
  const [strategy, setStrategy] = useState<StrategyId>("sma");
  const [size, setSize] = useState(2000);
  const selectedQuote = quotes.find((q) => q.id === symbol) ?? quotes[0];
  const stratBots = desk.bots.filter((b) => b.strategy !== "copy");
  const copyBots = desk.bots.filter((b) => b.strategy === "copy");

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className={cn(focus === "bots" ? "block" : "hidden md:block")}>
        <div className="mb-3 flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Automation</h2>
        </div>
        <BotList bots={stratBots} desk={desk} onToggle={onToggle} onRemove={onRemove} />
        <form
          className="mt-4 space-y-2 rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!selectedQuote) return;
            onAdd({
              name,
              symbol: selectedQuote.id,
              strategy,
              sizeUsd: size,
            });
          }}
        >
          <p className="text-xs font-medium">New server bot</p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
            placeholder="Name"
          />
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
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as StrategyId)}
            className="min-h-11 w-full rounded-md bg-elevated px-3 text-sm outline-none"
          >
            {(Object.keys(STRATEGY_COPY) as StrategyId[])
              .filter((k) => k !== "copy")
              .map((k) => (
                <option key={k} value={k}>
                  {STRATEGY_COPY[k].label}
                </option>
              ))}
          </select>
          <p className="text-xs leading-relaxed text-muted">
            {STRATEGY_COPY[strategy]?.blurb}
          </p>
          <input
            type="number"
            min={50}
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

      <div className={cn(focus === "copy" ? "block" : "hidden md:block")}>
        <div className="mb-2 flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Copy public filings</h2>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Congress trades are STOCK Act disclosures, often a month late.
          Elon / Trump are public holdings, not their brokerage. {copyOn} live.
        </p>
        <ul className="space-y-2">
          {copyBots.map((b) => {
            const leader = COPY_LEADERS.find((l) => l.id === b.leaderId);
            const events = desk.copyEvents.filter((e) => e.leaderId === b.leaderId).slice(0, 2);
            return (
              <li
                key={b.id}
                className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{leader?.name ?? b.name}</p>
                    <p className="text-xs text-muted">
                      {leader?.role} · {money(b.sizeUsd, 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="flex size-11 items-center justify-center rounded-md bg-elevated"
                    onClick={() => onToggle(b.id)}
                    aria-label={b.enabled ? "Pause copy" : "Start copy"}
                  >
                    {b.enabled ? (
                      <Pause className="size-4 text-warn" />
                    ) : (
                      <Play className="size-4 text-primary" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {leader?.blurb}
                </p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {b.enabled ? "copying" : "off"} · {b.lastSignal}
                </p>
                {events.map((e) => (
                  <p key={e.id} className="mt-1 font-mono text-xs">
                    <span className={e.side === "buy" ? "text-primary" : "text-down"}>
                      {e.side.toUpperCase()} {e.ticker}
                    </span>
                    <span className="text-muted">
                      {" "}
                      {e.amount} · {e.delayDays}d late
                    </span>
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      </div>

      <div className={cn(focus === "book" ? "block" : "hidden md:block")}>
        <h2 className="mb-2 text-sm font-semibold">Positions</h2>
        <ul className="space-y-1">
          {Object.values(desk.positions).length === 0 && (
            <li className="text-xs text-muted">No open positions.</li>
          )}
          {Object.values(desk.positions).map((p) => {
            const q = desk.quotes[p.symbol];
            const mtm = q ? (q.price - p.avg) * p.qty : 0;
            return (
              <li
                key={p.symbol}
                className="flex items-center justify-between rounded-md bg-surface px-3 py-2 font-mono text-xs"
              >
                <span>
                  {q?.symbol ?? p.symbol}
                  <span className="block text-muted">avg {money(p.avg)}</span>
                </span>
                <span className={mtm >= 0 ? "text-primary" : "text-down"}>
                  {qtyFmt(p.qty)} · {money(mtm)}
                </span>
              </li>
            );
          })}
        </ul>
        <h2 className="mt-4 mb-2 text-sm font-semibold">Blotter</h2>
        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {desk.fills.length === 0 && (
            <li className="text-xs text-muted">No fills yet.</li>
          )}
          {desk.fills.slice(0, 40).map((f) => (
            <FillRow key={f.id} fill={f} symbol={desk.quotes[f.symbol]?.symbol ?? f.symbol} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function BotList({
  bots,
  desk,
  onToggle,
  onRemove,
}: {
  bots: BotRow[];
  desk: DeskSnapshot;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {bots.map((b) => (
        <li
          key={b.id}
          className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium text-sm">{b.name}</p>
              <p className="font-mono text-xs text-muted">
                {desk.quotes[b.symbol]?.symbol ?? b.symbol} ·{" "}
                {STRATEGY_COPY[b.strategy]?.label} · {money(b.sizeUsd, 0)}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex size-11 items-center justify-center rounded-md bg-elevated"
                onClick={() => onToggle(b.id)}
                aria-label={b.enabled ? "Pause bot" : "Start bot"}
              >
                {b.enabled ? (
                  <Pause className="size-4 text-warn" />
                ) : (
                  <Play className="size-4 text-primary" />
                )}
              </button>
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
          <p className="mt-1 font-mono text-xs text-muted">
            {b.enabled ? "running on server" : "off"} · {b.lastSignal}
          </p>
        </li>
      ))}
    </ul>
  );
}

function FillRow({ fill, symbol }: { fill: Fill; symbol: string }) {
  return (
    <li className="rounded-md bg-surface px-3 py-2 font-mono text-xs">
      <div className="flex justify-between">
        <span className={fill.side === "buy" ? "text-primary" : "text-down"}>
          {fill.side.toUpperCase()} {symbol}
        </span>
        <span>{money(fill.price)}</span>
      </div>
      <div className="text-muted">
        {qtyFmt(fill.qty)} · {fill.source}
        {fill.botName ? `/${fill.botName}` : ""} · fee {money(fill.fee)}
        {fill.gasFee ? ` gas ${money(fill.gasFee)}` : ""}
      </div>
      {fill.side === "sell" && (
        <div className={fill.realizedPnl >= 0 ? "text-primary" : "text-down"}>
          P/L {money(fill.realizedPnl)}
        </div>
      )}
      <div className="text-muted">
        {clock(fill.ts)}
        {fill.note ? ` · ${fill.note}` : ""}
      </div>
    </li>
  );
}
