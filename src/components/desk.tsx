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
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Spark } from "@/components/spark";
import { cn } from "@/lib/cn";
import { COPY_LEADERS } from "@/lib/copy-leaders";
import { ago, clock, compactMoney, money, pct, qtyFmt } from "@/lib/format";
import { useServerDesk } from "@/lib/store";
import type { BotScore, DeskSnapshot, Fill, MarketKind, Quote, ScanScope, StrategyId } from "@/lib/types";
import { SCOPE_COPY, STRATEGY_COPY } from "@/lib/universe";

const TABS = ["Markets", "Bots", "Copy", "Log"] as const;
type Tab = (typeof TABS)[number];
const SIZES = [100, 500, 1000, 5000, 10000];

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
  const [notional, setNotional] = useState(1000);
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
  const last = desk.lastFill;

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
                  Paper money
                </span>
              </div>
              <p className="text-xs text-muted">
                {botsOn} bot{botsOn === 1 ? "" : "s"} on ·{" "}
                {desk.stockMarketOpen ? "US stocks open" : "US stocks closed"} · last check{" "}
                {ago(desk.loopAt)}
                {last
                  ? ` · last trade ${last.side} ${desk.quotes[last.symbol]?.symbol ?? last.symbol}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto font-mono text-xs">
            <Pill label="Value" value={compactMoney(equity)} tone={desk.stats.netPnl >= 0 ? "up" : "down"} />
            <Pill
              label="Today"
              value={pct((dayPnl / Math.max(desk.dayStartEquity, 1)) * 100)}
              tone={dayPnl >= 0 ? "up" : "down"}
            />
            <Pill
              label="Cashed in"
              value={compactMoney(desk.stats.realizedPnl)}
              tone={desk.stats.realizedPnl >= 0 ? "up" : "down"}
            />
            <Pill label="Fees" value={compactMoney(desk.stats.feesPaid)} />
            <Pill label="Cash" value={compactMoney(desk.cash)} />
          </div>
        </div>

        {resetOpen ? (
          <div className="mt-3 rounded-lg bg-elevated p-3 shadow-[var(--shadow-border)]">
            <p className="text-sm font-medium">Start a new $100,000 test</p>
            <p className="mt-1 text-xs text-muted">
              Saves this run, clears cash, trades, and P/L. Bots stay as they are.
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
                    toast("New test started — bots kept");
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
              New $100k test
            </button>
          </div>
        )}

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
          />
          {selected && (
            <ChartAndTicket
              quote={selected}
              notional={notional}
              setNotional={setNotional}
              position={desk.positions[selected.id]}
              onTrade={(side) => {
                void remote.trade(side, selected.id, notional).then(() => {
                  toast(side === "buy" ? `Bought ${selected.symbol}` : `Sold ${selected.symbol}`);
                });
              }}
              equity={desk.equity}
              stats={desk.stats}
              marketOpen={desk.stockMarketOpen}
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

      {tab === "Log" && <LogPane desk={desk} />}
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
  query,
  setQuery,
  onSearch,
}: {
  quotes: Quote[];
  filter: "all" | MarketKind;
  setFilter: (f: "all" | MarketKind) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  query: string;
  setQuery: (q: string) => void;
  onSearch: (symbol: string) => void;
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
                <span className="w-16 font-mono text-xs text-muted">{kindLabel(q.kind)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-sm">{q.symbol}</span>
                  <span className="block truncate text-xs text-muted">{q.name}</span>
                </span>
                <Spark data={q.spark} up={up} />
                <span className="w-24 text-right font-mono text-xs tabular-nums">
                  <span className="block">{money(q.price)}</span>
                  <span className={up ? "text-primary" : "text-down"}>{pct(q.changePct)}</span>
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
  marketOpen,
}: {
  quote: Quote;
  notional: number;
  setNotional: (n: number) => void;
  position?: { qty: number; avg: number };
  onTrade: (side: "buy" | "sell") => void;
  equity: { t: number; v: number }[];
  stats: DeskSnapshot["stats"];
  marketOpen: boolean;
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
        <div className="flex items-center justify-between text-xs text-muted">
          <span>Buy or sell · fees come out of the fill</span>
          {position && (
            <span className="font-mono text-fg">
              You own {qtyFmt(position.qty)} @ {money(position.avg)}{" "}
              <span className={pnl >= 0 ? "text-primary" : "text-down"}>{money(pnl)}</span>
            </span>
          )}
        </div>
        <p className="text-xs text-muted">Dollar amount</p>
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
          step={100}
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
  const [size, setSize] = useState(2000);
  const stratBots = desk.bots.filter((b) => b.strategy !== "copy");
  const selectedQuote = quotes.find((q) => q.id === symbol) ?? quotes[0];
  const maxNames = scope === "one" ? 1 : scope === "pump" ? 3 : scope === "all" ? 6 : 4;

  return (
    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Which bots are making money</h2>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Scan bots look through every matching name each pass, buy what fits the
          rule, and sell what no longer does. They will not stack two bots on the
          same ticker.
        </p>
        <Scoreboard scores={desk.scores.filter((s) => stratBots.some((b) => b.id === s.botId))} />
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
      </div>
      <form
        className="h-fit space-y-2 rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!selectedQuote && scope === "one") return;
          onAdd({
            name,
            symbol: selectedQuote?.id || "SPY",
            strategy,
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
        <p className="text-xs leading-relaxed text-muted">{STRATEGY_COPY[strategy]?.blurb}</p>
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
  const copyBots = desk.bots.filter((b) => b.strategy === "copy");
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <div className="flex items-center gap-2">
        <Users className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Copy public filings</h2>
      </div>
      <p className="rounded-lg bg-elevated px-3 py-2 text-xs leading-relaxed text-warn">
        This is not their live brokerage. Congress trades show up weeks later. Elon is a public
        Tesla holding. Trump is the public DJT ticker.
      </p>
      <ul className="space-y-2">
        {copyBots.map((b) => {
          const leader = COPY_LEADERS.find((l) => l.id === b.leaderId);
          const events = desk.copyEvents.filter((e) => e.leaderId === b.leaderId).slice(0, 3);
          const score = desk.scores.find((s) => s.botId === b.id);
          return (
            <li key={b.id} className="rounded-lg bg-surface p-3 shadow-[var(--shadow-border)]">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{leader?.name ?? b.name}</p>
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
                    {e.amount} · {e.delayDays}d late
                  </span>
                </p>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function LogPane({ desk }: { desk: DeskSnapshot }) {
  return (
    <div className="grid gap-4 p-4 md:grid-cols-2">
      <div>
        <h2 className="mb-2 text-sm font-semibold">Saved tests</h2>
        {(!desk.tests || desk.tests.length === 0) && (
          <p className="text-xs text-muted">
            After a run, tap New $100k test to save it here and compare what worked.
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
