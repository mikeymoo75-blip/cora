export type MarketKind = "stock" | "crypto" | "poly" | "pump";

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
  /** Bid-ask in basis points when we have a book. */
  spreadBps?: number;
  /** Taker bid/ask (dollars, 0–1) for Polymarket. */
  bid?: number;
  ask?: number;
  /** Shares sitting on the best ask — paper only lifts this size. */
  askSize?: number;
  /** CLOB token id — live book stream. */
  clobTokenId?: string;
  /** Fair P(up) for 5m/15m crypto rounds. */
  fair?: number;
  windowStart?: number;
  windowEnd?: number;
  spot?: number;
  openPx?: number;
  /** True when spot/open came from Chainlink TWAP (ok to bet). Tape can still show Binance/HL. */
  twapLive?: boolean;
  pairId?: string;
  leg?: "up" | "down";
  asset?: string;
  horizon?: "5m" | "15m";
};

export type Position = {
  symbol: string;
  kind: MarketKind;
  qty: number;
  avg: number;
  peak: number;
  openedAt: number;
  /** Frozen at fill so the bag clock is this round, not the next chip. */
  windowStart?: number;
  windowEnd?: number;
  horizon?: "5m" | "15m";
  asset?: string;
  leg?: "up" | "down";
  /** Last live print — used to freeze P/L at 0:00. */
  lastMark?: number;
  lastSpot?: number;
  lastOpen?: number;
  /** Coin side at 0:00 vs Price-to-Beat. Frozen. */
  settleSide?: "up" | "down";
  /** Frozen at 0:00 until venue 0/1. */
  closedMark?: number;
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
  expectedPrice?: number;
  slipBps?: number;
  holdMs?: number;
};

export type ScanScope = "one" | "stock" | "crypto" | "poly" | "all";

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

export type WalletId = "core" | "poly";

export type Wallet = {
  cash: number;
  startingCash: number;
  dayStartEquity: number;
  halted: boolean;
  haltReason: string;
  peakEquity: number;
  monthStamp: string;
  monthStartEquity: number;
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

export type RiskLayer = {
  id: "daily" | "month" | "drawdown" | "total";
  label: string;
  usedPct: number;
  limitPct: number;
  usd: number;
  status: "ok" | "warn" | "hot";
};

export type CopyQuality = {
  botId: string;
  name: string;
  ok: boolean;
  why: string;
  winRate: number;
  profitFactor: number;
  sells: number;
};

export type RiskView = {
  layers: RiskLayer[];
  sizeMult: number;
  sizeWhy: string;
  copyQuality: CopyQuality[];
  peakEquity: number;
  drawdownPct: number;
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
  sqn: number;
  avgWin: number;
  avgLoss: number;
  payoff: number;
  loseStreak: number;
  sells: number;
  profitFactor: number;
  avgHoldMs: number;
  avgSlipBps: number;
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

export type HourClock = {
  /** 0–23 America/New_York */
  hour: number;
  buys: number;
  sells: number;
  wins: number;
  losses: number;
  net: number;
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
  /** Wins/losses by Eastern hour. Survives New $1,000 test. */
  hourClock: HourClock[];
  /** Bump to wipe the clock. 5 = empty, do not rebuild from old fills. */
  clockGen?: number;
  /** Fills before this ms do not count on the clock. */
  clockEpoch?: number;
  /** Per-hour wipe. Fills in that ET hour before this ms are ignored. */
  hourWipes?: Record<number, number>;
  /** 1 = dropped 6p/7p/8p ET ghost-sell hours. */
  clockScrub?: number;
};

export type DeskSnapshot = DeskState & {
  stats: DeskStats;
  equityNow: number;
  scores: BotScore[];
  lastFill: Fill | null;
  stockMarketOpen: boolean;
  walletViews: WalletView[];
  risk: RiskView;
};
