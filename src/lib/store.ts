import { create } from "zustand";
import { persist } from "zustand/middleware";
import { applyFill, markToMarket, mergeQuotes, tickBots, todayStamp } from "./engine";
import { CORE_SEEDS, PUMP_FALLBACK, seedQuote } from "./universe";
import type { Bot, DeskState, MarketKind, Quote, StrategyId } from "./types";

const STARTING = 100_000;

function seedQuotes(): Record<string, Quote> {
  const out: Record<string, Quote> = {};
  for (const s of [...CORE_SEEDS, ...PUMP_FALLBACK]) out[s.id] = seedQuote(s);
  return out;
}

function defaultBots(): Bot[] {
  return [
    {
      id: "bot-nvda",
      name: "NVDA SMA",
      enabled: false,
      symbol: "NVDA",
      kind: "stock",
      strategy: "sma",
      sizeUsd: 5000,
      lastSignal: "idle",
      lastTickAt: 0,
    },
    {
      id: "bot-spy",
      name: "SPY dip",
      enabled: false,
      symbol: "SPY",
      kind: "stock",
      strategy: "dca",
      sizeUsd: 4000,
      lastSignal: "idle",
      lastTickAt: 0,
    },
    {
      id: "bot-btc",
      name: "BTC momentum",
      enabled: false,
      symbol: "BTC",
      kind: "crypto",
      strategy: "momentum",
      sizeUsd: 6000,
      lastSignal: "idle",
      lastTickAt: 0,
    },
    {
      id: "bot-sol",
      name: "SOL mean rev",
      enabled: false,
      symbol: "SOL",
      kind: "crypto",
      strategy: "meanrev",
      sizeUsd: 3500,
      lastSignal: "idle",
      lastTickAt: 0,
    },
    {
      id: "bot-pump",
      name: "Pump sniper",
      enabled: false,
      symbol: "pump:CORA",
      kind: "pump",
      strategy: "sniper",
      sizeUsd: 800,
      lastSignal: "idle",
      lastTickAt: 0,
    },
  ];
}

const initial: DeskState = {
  cash: STARTING,
  startingCash: STARTING,
  dayStartEquity: STARTING,
  dayStamp: todayStamp(),
  maxDailyLossPct: 8,
  halted: false,
  haltReason: "",
  quotes: seedQuotes(),
  positions: {},
  fills: [],
  bots: defaultBots(),
  equity: [{ t: Date.now(), v: STARTING }],
  selectedId: "NVDA",
  liveQuotes: false,
};

type Actions = {
  ingestQuotes: (quotes: Quote[], live: boolean) => void;
  select: (id: string) => void;
  trade: (side: "buy" | "sell", notional: number) => void;
  toggleBot: (id: string) => void;
  addBot: (bot: Omit<Bot, "id" | "lastSignal" | "lastTickAt">) => void;
  removeBot: (id: string) => void;
  setBotSymbol: (id: string, symbol: string, kind: MarketKind) => void;
  setBotStrategy: (id: string, strategy: StrategyId) => void;
  setBotSize: (id: string, sizeUsd: number) => void;
  runBots: () => void;
  simTick: () => void;
  reset: () => void;
  resume: () => void;
};

export const useDesk = create<DeskState & Actions>()(
  persist(
    (set, get) => ({
      ...initial,
      ingestQuotes: (quotes, live) => {
        const merged = mergeQuotes(get().quotes, quotes);
        const stamp = todayStamp();
        const patch: Partial<DeskState> = { quotes: merged, liveQuotes: live };
        if (stamp !== get().dayStamp) {
          patch.dayStamp = stamp;
          patch.dayStartEquity = markToMarket({ ...get(), quotes: merged });
          patch.halted = false;
          patch.haltReason = "";
        }
        set(patch);
      },
      select: (id) => set({ selectedId: id }),
      trade: (side, notional) => {
        const s = get();
        const q = s.quotes[s.selectedId];
        if (!q) return;
        const next = applyFill(s, side, q.id, q.kind, notional, "manual");
        set({
          cash: next.cash,
          positions: next.positions,
          fills: next.fills,
          equity: [...s.equity, { t: Date.now(), v: markToMarket(next) }].slice(-240),
        });
      },
      toggleBot: (id) =>
        set({
          bots: get().bots.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b)),
        }),
      addBot: (bot) =>
        set({
          bots: [
            ...get().bots,
            {
              ...bot,
              id: `bot-${Date.now()}`,
              lastSignal: "idle",
              lastTickAt: 0,
            },
          ],
        }),
      removeBot: (id) => set({ bots: get().bots.filter((b) => b.id !== id) }),
      setBotSymbol: (id, symbol, kind) =>
        set({
          bots: get().bots.map((b) => (b.id === id ? { ...b, symbol, kind } : b)),
        }),
      setBotStrategy: (id, strategy) =>
        set({
          bots: get().bots.map((b) => (b.id === id ? { ...b, strategy } : b)),
        }),
      setBotSize: (id, sizeUsd) =>
        set({
          bots: get().bots.map((b) => (b.id === id ? { ...b, sizeUsd } : b)),
        }),
      runBots: () => set(tickBots(get())),
      simTick: () => {
        if (get().liveQuotes) return;
        const quotes = { ...get().quotes };
        for (const id of Object.keys(quotes)) {
          const q = quotes[id]!;
          const vol = q.kind === "pump" ? 0.028 : q.kind === "crypto" ? 0.0035 : 0.0012;
          const shock = (Math.random() - 0.48) * 2 * vol;
          const price = Math.max(q.price * (1 + shock), 1e-12);
          quotes[id] = {
            ...q,
            price,
            spark: [...q.spark, price].slice(-48),
            changePct: q.changePct * 0.85 + shock * 90,
            live: false,
          };
        }
        set({ quotes });
      },
      reset: () =>
        set({
          ...initial,
          quotes: get().quotes,
          liveQuotes: get().liveQuotes,
          equity: [{ t: Date.now(), v: STARTING }],
          dayStamp: todayStamp(),
        }),
      resume: () => set({ halted: false, haltReason: "" }),
    }),
    {
      name: "apex-desk-v1",
      partialize: (s) => ({
        cash: s.cash,
        startingCash: s.startingCash,
        dayStartEquity: s.dayStartEquity,
        dayStamp: s.dayStamp,
        maxDailyLossPct: s.maxDailyLossPct,
        halted: s.halted,
        haltReason: s.haltReason,
        quotes: s.quotes,
        positions: s.positions,
        fills: s.fills,
        bots: s.bots,
        equity: s.equity,
        selectedId: s.selectedId,
        liveQuotes: s.liveQuotes,
      }),
    },
  ),
);
