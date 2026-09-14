import type { MarketKind, Quote, ScanScope, StrategyId } from "./types";

export type Seed = {
  id: string;
  symbol: string;
  name: string;
  kind: MarketKind;
  yahoo?: string;
  seed: number;
};

export const STOCKS: Seed[] = [
  { id: "AAPL", symbol: "AAPL", name: "Apple", kind: "stock", yahoo: "AAPL", seed: 227 },
  { id: "MSFT", symbol: "MSFT", name: "Microsoft", kind: "stock", yahoo: "MSFT", seed: 428 },
  { id: "NVDA", symbol: "NVDA", name: "NVIDIA", kind: "stock", yahoo: "NVDA", seed: 128 },
  { id: "TSLA", symbol: "TSLA", name: "Tesla", kind: "stock", yahoo: "TSLA", seed: 248 },
  { id: "AMZN", symbol: "AMZN", name: "Amazon", kind: "stock", yahoo: "AMZN", seed: 196 },
  { id: "META", symbol: "META", name: "Meta", kind: "stock", yahoo: "META", seed: 572 },
  { id: "GOOGL", symbol: "GOOGL", name: "Alphabet", kind: "stock", yahoo: "GOOGL", seed: 176 },
  { id: "AMD", symbol: "AMD", name: "AMD", kind: "stock", yahoo: "AMD", seed: 158 },
  { id: "AXP", symbol: "AXP", name: "American Express", kind: "stock", yahoo: "AXP", seed: 268 },
  { id: "KO", symbol: "KO", name: "Coca-Cola", kind: "stock", yahoo: "KO", seed: 68 },
  { id: "BAC", symbol: "BAC", name: "Bank of America", kind: "stock", yahoo: "BAC", seed: 42 },
  { id: "CMG", symbol: "CMG", name: "Chipotle", kind: "stock", yahoo: "CMG", seed: 58 },
  { id: "COIN", symbol: "COIN", name: "Coinbase", kind: "stock", yahoo: "COIN", seed: 248 },
  { id: "MSTR", symbol: "MSTR", name: "MicroStrategy", kind: "stock", yahoo: "MSTR", seed: 318 },
  { id: "HOOD", symbol: "HOOD", name: "Robinhood", kind: "stock", yahoo: "HOOD", seed: 24 },
  { id: "DJT", symbol: "DJT", name: "Trump Media", kind: "stock", yahoo: "DJT", seed: 18 },
  { id: "SPY", symbol: "SPY", name: "S&P 500 ETF", kind: "stock", yahoo: "SPY", seed: 564 },
  { id: "QQQ", symbol: "QQQ", name: "Nasdaq 100", kind: "stock", yahoo: "QQQ", seed: 492 },
];

export const CRYPTO: Seed[] = [
  { id: "BTC", symbol: "BTC", name: "Bitcoin", kind: "crypto", yahoo: "BTC-USD", seed: 112400 },
  { id: "ETH", symbol: "ETH", name: "Ethereum", kind: "crypto", yahoo: "ETH-USD", seed: 4280 },
  { id: "SOL", symbol: "SOL", name: "Solana", kind: "crypto", yahoo: "SOL-USD", seed: 218 },
  { id: "DOGE", symbol: "DOGE", name: "Dogecoin", kind: "crypto", yahoo: "DOGE-USD", seed: 0.18 },
  { id: "XRP", symbol: "XRP", name: "XRP", kind: "crypto", yahoo: "XRP-USD", seed: 2.85 },
  { id: "AVAX", symbol: "AVAX", name: "Avalanche", kind: "crypto", yahoo: "AVAX-USD", seed: 36 },
  { id: "LINK", symbol: "LINK", name: "Chainlink", kind: "crypto", yahoo: "LINK-USD", seed: 22 },
  { id: "PEPE", symbol: "PEPE", name: "Pepe", kind: "crypto", yahoo: "PEPE-USD", seed: 0.000009 },
  { id: "SUI", symbol: "SUI", name: "Sui", kind: "crypto", yahoo: "SUI-USD", seed: 3.4 },
  { id: "HYPE", symbol: "HYPE", name: "Hyperliquid", kind: "crypto", yahoo: "HYPE-USD", seed: 42 },
];

export const POLY_FALLBACK: Seed[] = [
  { id: "poly:fed", symbol: "FED", name: "Fed decision (placeholder)", kind: "poly", seed: 0.55 },
  { id: "poly:btc", symbol: "BTC-100K", name: "Bitcoin milestone (placeholder)", kind: "poly", seed: 0.42 },
  { id: "poly:election", symbol: "ELECTION", name: "Politics market (placeholder)", kind: "poly", seed: 0.48 },
];

export const CORE_SEEDS = [...STOCKS, ...CRYPTO];

export function seedQuote(s: Seed): Quote {
  return {
    id: s.id,
    symbol: s.symbol,
    name: s.name,
    kind: s.kind,
    price: s.seed,
    changePct: 0,
    volume: 0,
    spark: [s.seed],
    live: false,
  };
}

export function slipBps(kind: MarketKind): number {
  if (kind === "stock") return 5;
  if (kind === "crypto") return 12;
  if (kind === "poly") return 25;
  return 80;
}

export const STRATEGY_COPY: Record<StrategyId, { label: string; blurb: string }> = {
  sma: {
    label: "Trend follow",
    blurb: "Buys when the short-term average crosses above the long one. −3.5% stop. No new buys in the first 10 min or last 15 min.",
  },
  meanrev: {
    label: "Buy the dip",
    blurb: "Buys a real dip, holds at least 20 minutes, and skips coins where gas would eat the trade. Does not scalp noise.",
  },
  momentum: {
    label: "Runners",
    blurb: "Looks at how much it is up today. Buys a liquid runner (4–9%, $50M+ volume). Trail after +5%, out at −4% or 60 min.",
  },
  dca: {
    label: "Dip buyer",
    blurb: "Buys a set dollar amount when price is stretched below its recent average (z-score). Holds 20 minutes. Sells around +6% or a 3.5% stop.",
  },
  sniper: {
    label: "5m / 15m Up-Down",
    blurb: "BTC & ETH 5m/15m rounds. Fair from live spot vs Price-to-Beat plus a 1-minute momentum tilt. Buys the cheap side; if price reverses it buys the other leg instead of dumping. Holds hedged pairs to settle. ~$20 tickets.",
  },
  scalp: {
    label: "Fade stretch",
    blurb: "Longer Polymarket events only. Buys a dumped YES (3–8¢ off) that ticks back up. +5¢ target, −4¢ stop, 90 minutes max.",
  },
  copy: {
    label: "Copy a person",
    blurb:
      "Mirrors a star investor’s public book, a Hyperliquid whale’s longs, or STOCK Act filings. Stocks are delayed. Crypto is paper longs only — not Polymarket.",
  },
};

export const SCOPE_COPY: Record<ScanScope, { label: string; blurb: string }> = {
  one: {
    label: "One ticker only",
    blurb: "Watches just the name you pick.",
  },
  stock: {
    label: "Scan all stocks",
    blurb: "Looks through every stock on the desk for a buy or sell.",
  },
  crypto: {
    label: "Scan all crypto",
    blurb: "Looks through Bitcoin, ETH, SOL, and the rest of the crypto list.",
  },
  poly: {
    label: "Scan Polymarket",
    blurb: "BTC/ETH 5- and 15-minute Up/Down, plus longer events for Fade. Never spends stocks/crypto cash.",
  },
  all: {
    label: "Scan stocks + crypto",
    blurb: "Looks through stocks and crypto. Polymarket has its own bots so it cannot mix rules.",
  },
};
