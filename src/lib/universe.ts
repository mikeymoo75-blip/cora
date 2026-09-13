import type { MarketKind, Quote } from "./types";

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
];

export const PUMP_FALLBACK: Seed[] = [
  { id: "pump:CORA", symbol: "CORA", name: "Cora Coin", kind: "pump", seed: 0.00042 },
  { id: "pump:BARN", symbol: "BARN", name: "Barn Cat", kind: "pump", seed: 0.00018 },
  { id: "pump:HOOP", symbol: "HOOP", name: "Hardwood", kind: "pump", seed: 0.00007 },
  { id: "pump:FARM", symbol: "FARM", name: "Datos Farm", kind: "pump", seed: 0.00031 },
  { id: "pump:RIDGE", symbol: "RIDGE", name: "Ridgewood", kind: "pump", seed: 0.00012 },
  { id: "pump:BLIP", symbol: "BLIP", name: "Blip", kind: "pump", seed: 0.00005 },
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

export function feeBps(kind: MarketKind): number {
  if (kind === "stock") return 5;
  if (kind === "crypto") return 10;
  return 80;
}

export function slipBps(kind: MarketKind): number {
  if (kind === "stock") return 2;
  if (kind === "crypto") return 6;
  return 40;
}

export const STRATEGY_COPY: Record<
  string,
  { label: string; blurb: string }
> = {
  sma: {
    label: "SMA cross",
    blurb: "Buy when the fast average crosses above the slow. Sell on the reverse.",
  },
  meanrev: {
    label: "Mean reversion",
    blurb: "Buy stretched selloffs. Fade stretched rallies.",
  },
  momentum: {
    label: "Momentum",
    blurb: "Ride short-horizon strength. Cut when it fades.",
  },
  dca: {
    label: "DCA dip",
    blurb: "Buy a fixed notional when price sits below the 20-tick average.",
  },
  sniper: {
    label: "Pump sniper",
    blurb: "Paper-only meme chase: buy a surge, trail a stop, dump on a crash.",
  },
};
