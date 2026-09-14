export type MarketKind = "stock" | "crypto" | "pump";

export type StrategyId = "sma" | "meanrev" | "momentum" | "dca" | "sniper" | "scalp" | "copy";

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
  seenAt?: number;
};

export type Position = {
  symbol: string;
  kind: MarketKind;
  qty: number;
  avg: number;
  peak: number;
  openedAt: number;
};

export type FillSource = "manual" | "bot" | "copy";

export type Fill = {
  id: string;
  ts: number;
  side: "buy" | "sell";
  symbol: string;
  kind: MarketKind;
  qty: number;
  price: number;
  notional: number;
  venueFee: number;
  regulatoryFee: number;
  gasFee: number;
  fee: number;
  realizedPnl: number;
  source: FillSource;
  botId?: string;
  botName?: string;
  leaderName?: string;
  reason: string;
  note?: string;
};

export type ScanScope = "one" | "stock" | "crypto" | "pump" | "all";

export type Bot = {
  id: string;
  name: string;
  enabled: boolean;
  symbol: string;
  kind: MarketKind;
  strategy: StrategyId;
  sizeUsd: number;
  scope: ScanScope;
  maxNames: number;
  leaderId?: string;
  lastSignal: string;
  lastTickAt: number;
  lastReason: string;
  lastSold?: Record<string, number>;
  lastScan?: ScanNote[];
  /** Skip new buys until this time (Freqtrade StoplossGuard). */
  lockedUntil?: number;
};

export type ScanNote = {
  ts: number;
  botId: string;
  botName: string;
  symbol: string;
  ticker: string;
  decision: "buy" | "sell" | "skip";
  reason: string;
};

export type CopyEvent = {
  id: string;
  leaderId: string;
  leaderName: string;
  ticker: string;
  side: "buy" | "sell";
  tradeDate: string;
  disclosureDate: string;
  amount: string;
  delayDays: number;
  consumed: boolean;
  note: string;
};

export type EquityPoint = { t: number; v: number };

export type WalletId = "core" | "pump";

export type Wallet = {
  cash: number;
  startingCash: number;
  dayStartEquity: number;
  halted: boolean;
  haltReason: string;
};

export type WalletView = {
  id: WalletId;
  label: string;
  cash: number;
  equity: number;
  startingCash: number;
  dayPnl: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  feesPaid: number;
  halted: boolean;
  haltReason: string;
};

export type DeskReport = {
  id: string;
  ts: number;
  text: string;
};

export type DeskStats = {
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  netPnl: number;
  winCount: number;
  lossCount: number;
};

export type BotScore = {
  botId: string;
  name: string;
  trades: number;
  fees: number;
  realizedPnl: number;
  unrealizedPnl: number;
  netPnl: number;
  lastReason: string;
  enabled: boolean;
};

export type TestRun = {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  startingCash: number;
  endingEquity: number;
  realizedPnl: number;
  feesPaid: number;
  netPnl: number;
  trades: number;
};

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
  copyEvents: CopyEvent[];
  copyFetchedAt: number;
  equity: EquityPoint[];
  selectedId: string;
  liveQuotes: boolean;
  loopAt: number;
  loopOk: boolean;
  tests: TestRun[];
  runStartedAt: number;
  /** Unix ms until which bots must not re-buy this symbol after a manual close. */
  manualLocks: Record<string, number>;
  wallets: Record<WalletId, Wallet>;
  reports: DeskReport[];
  scanTape: ScanNote[];
};

export type DeskSnapshot = DeskState & {
  stats: DeskStats;
  equityNow: number;
  scores: BotScore[];
  lastFill: Fill | null;
  stockMarketOpen: boolean;
  walletViews: WalletView[];
};
