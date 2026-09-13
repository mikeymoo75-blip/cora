export type MarketKind = "stock" | "crypto" | "pump";

export type StrategyId = "sma" | "meanrev" | "momentum" | "dca" | "sniper";

export type Quote = {
  id: string;
  symbol: string;
  name: string;
  kind: MarketKind;
  price: number;
  changePct: number;
  volume: number;
  spark: number[];
  live: boolean;
};

export type Position = {
  symbol: string;
  kind: MarketKind;
  qty: number;
  avg: number;
  peak: number;
};

export type Fill = {
  id: string;
  ts: number;
  side: "buy" | "sell";
  symbol: string;
  kind: MarketKind;
  qty: number;
  price: number;
  fee: number;
  source: "manual" | "bot";
  botName?: string;
  note?: string;
};

export type Bot = {
  id: string;
  name: string;
  enabled: boolean;
  symbol: string;
  kind: MarketKind;
  strategy: StrategyId;
  sizeUsd: number;
  lastSignal: string;
  lastTickAt: number;
};

export type EquityPoint = { t: number; v: number };

export type DeskState = {
  cash: number;
  startingCash: number;
  dayStartEquity: number;
  dayStamp: string;
  maxDailyLossPct: number;
  halted: boolean;
  haltReason: string;
  quotes: Record<string, Quote>;
  positions: Record<string, Position>;
  fills: Fill[];
  bots: Bot[];
  equity: EquityPoint[];
  selectedId: string;
  liveQuotes: boolean;
};
