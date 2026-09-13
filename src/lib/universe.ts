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
  { id: "PLTR", symbol: "PLTR", name: "Palantir", kind: "stock", yahoo: "PLTR", seed: 38 },
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

export function slipBps(kind: MarketKind): number {
  if (kind === "stock") return 2;
  if (kind === "crypto") return 6;
  return 40;
}

export const STRATEGY_COPY: Record<StrategyId, { label: string; blurb: string }> = {
  sma: {
    label: "Trend follow",
    blurb: "Buys when the short-term average crosses above the long one. Sells when it crosses back down.",
  },
  meanrev: {
    label: "Buy the dip",
    blurb: "Buys when price is stretched down vs recent range. Sells when it bounces back.",
  },
  momentum: {
    label: "Ride the move",
    blurb: "Buys a quick jump. Sells if it fades or you're up about 4%.",
  },
  dca: {
    label: "Dip buyer",
    blurb: "Buys a set dollar amount when price is below its recent average. Sells around +6%.",
  },
  sniper: {
    label: "Pump chase",
    blurb: "Buys a sharp pump. Sells if it dumps from the peak or from your entry.",
  },
  copy: {
    label: "Copy a person",
    blurb: "Mirrors public STOCK Act filings or a known public holding. Often weeks late.",
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
  pump: {
    label: "Scan Pump.fun",
    blurb: "Looks through the live Pump.fun coins for a chase or a dump.",
  },
  all: {
    label: "Scan everything",
    blurb: "Stocks, crypto, and Pump.fun in one bot.",
  },
};
