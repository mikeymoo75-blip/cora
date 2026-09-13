import { CORE_SEEDS, PUMP_FALLBACK, seedQuote } from "./universe";
import type { Quote } from "./types";

async function fetchJson(url: string, timeoutMs = 7000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "ApexDesk/1.0 (paper-trading)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
};

export async function yahooQuotes(): Promise<Quote[]> {
  const symbols = CORE_SEEDS.map((s) => s.yahoo).filter(Boolean).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
  const json = (await fetchJson(url)) as {
    quoteResponse?: { result?: YahooQuote[] };
  };
  const rows = json.quoteResponse?.result ?? [];
  const byYahoo = new Map(rows.map((r) => [r.symbol, r]));
  return CORE_SEEDS.map((seed) => {
    const row = seed.yahoo ? byYahoo.get(seed.yahoo) : undefined;
    const price = row?.regularMarketPrice;
    if (!price || !Number.isFinite(price)) return { ...seedQuote(seed), live: false };
    return {
      id: seed.id,
      symbol: seed.symbol,
      name: seed.name,
      kind: seed.kind,
      price,
      changePct: row?.regularMarketChangePercent ?? 0,
      volume: row?.regularMarketVolume ?? 0,
      spark: [price],
      live: true,
    };
  });
}

export async function yahooOne(symbol: string): Promise<Quote | null> {
  const ticker = symbol.replace(/^pump:/, "").toUpperCase();
  try {
    const json = (await fetchJson(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}`,
    )) as { quoteResponse?: { result?: YahooQuote[] } };
    const row = json.quoteResponse?.result?.[0];
    const price = row?.regularMarketPrice;
    if (!price || !Number.isFinite(price)) return null;
    return {
      id: ticker,
      symbol: ticker,
      name: row?.shortName || row?.longName || ticker,
      kind: "stock",
      price,
      changePct: row?.regularMarketChangePercent ?? 0,
      volume: row?.regularMarketVolume ?? 0,
      spark: [price],
      live: true,
    };
  } catch {
    return null;
  }
}

type PumpCoin = {
  mint?: string;
  name?: string;
  symbol?: string;
  usd_market_cap?: number;
  market_cap?: number;
  virtual_sol_reserves?: number;
  virtual_token_reserves?: number;
  volume_24h?: number;
};

async function pumpQuotes(solUsd: number): Promise<Quote[]> {
  const urls = [
    "https://frontend-api-v3.pump.fun/coins?offset=0&limit=12&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
    "https://frontend-api.pump.fun/coins?offset=0&limit=12&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
  ];
  let coins: PumpCoin[] = [];
  for (const url of urls) {
    try {
      const json = await fetchJson(url, 6000);
      if (Array.isArray(json)) {
        coins = json as PumpCoin[];
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!coins.length) return PUMP_FALLBACK.map((s) => seedQuote(s));
  return coins.slice(0, 12).map((c, i) => {
    const supply = 1_000_000_000;
    const usdMc = Number(c.usd_market_cap ?? c.market_cap ?? 0);
    let price = usdMc > 0 ? usdMc / supply : 0;
    if (!price && c.virtual_sol_reserves && c.virtual_token_reserves) {
      price = (c.virtual_sol_reserves / c.virtual_token_reserves) * solUsd;
    }
    if (!price) price = 0.00001 * (i + 1);
    const sym = (c.symbol || "MEME").toUpperCase().slice(0, 8);
    const id = `pump:${c.mint || sym}`;
    return {
      id,
      symbol: sym,
      name: c.name || sym,
      kind: "pump" as const,
      price,
      changePct: 0,
      volume: Number(c.volume_24h ?? 0),
      spark: [price],
      live: true,
    };
  });
}

function jitter(quotes: Quote[]): Quote[] {
  return quotes.map((q) => {
    const vol = q.kind === "pump" ? 0.035 : q.kind === "crypto" ? 0.004 : 0.0015;
    const shock = (Math.random() - 0.5) * 2 * vol;
    const price = Math.max(q.price * (1 + shock), 1e-12);
    return { ...q, price, changePct: q.changePct + shock * 25, live: false };
  });
}

export async function fetchMarketSnapshot(): Promise<{
  quotes: Quote[];
  live: boolean;
  at: number;
}> {
  try {
    const core = await yahooQuotes();
    const sol = core.find((q) => q.id === "SOL")?.price ?? 200;
    let pump: Quote[] = [];
    try {
      pump = await pumpQuotes(sol);
    } catch {
      pump = PUMP_FALLBACK.map((s) => seedQuote(s));
    }
    const live = core.some((q) => q.live);
    return { quotes: [...core, ...pump], live, at: Date.now() };
  } catch {
    const fallback = [...CORE_SEEDS, ...PUMP_FALLBACK].map((s) => seedQuote(s));
    return { quotes: jitter(fallback), live: false, at: Date.now() };
  }
}
