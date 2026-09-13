import { CORE_SEEDS, PUMP_FALLBACK, seedQuote } from "./universe";
import type { Quote } from "./types";

async function fetchJson(
  url: string,
  timeoutMs = 7000,
  extra: Record<string, string> = {},
): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": extra["User-Agent"] || "CoraDesktop/1.0 (paper-trading)",
        ...extra,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

const PUMP_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Origin: "https://pump.fun",
  Referer: "https://pump.fun/",
};

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketVolume?: number;
};

export async function yahooQuotes(): Promise<Quote[]> {
  try {
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
  } catch {
    return CORE_SEEDS.map((s) => seedQuote(s));
  }
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
  nsfw?: boolean;
};

function coinToQuote(c: PumpCoin, solUsd: number, i: number): Quote | null {
  const mint = (c.mint || "").trim();
  if (!mint) return null;
  const supply = 1_000_000_000;
  const usdMc = Number(c.usd_market_cap ?? c.market_cap ?? 0);
  let price = usdMc > 0 ? usdMc / supply : 0;
  if (!price && c.virtual_sol_reserves && c.virtual_token_reserves) {
    price = (c.virtual_sol_reserves / c.virtual_token_reserves) * solUsd;
  }
  if (!price || !Number.isFinite(price)) price = 0.00001 * (i + 1);
  const sym = (c.symbol || "MEME").replace(/^\$/, "").toUpperCase().slice(0, 10);
  return {
    id: `pump:${mint}`,
    symbol: sym || mint.slice(0, 6).toUpperCase(),
    name: c.name || sym,
    kind: "pump",
    price,
    changePct: 0,
    volume: Number(c.volume_24h ?? 0),
    spark: [price],
    live: true,
  };
}

async function pumpFunBoard(solUsd: number): Promise<Quote[]> {
  const sorts = ["last_trade_timestamp", "market_cap", "created_timestamp"];
  const byId = new Map<string, Quote>();
  for (const sort of sorts) {
    const url = `https://frontend-api-v3.pump.fun/coins?offset=0&limit=24&sort=${sort}&order=DESC&includeNsfw=false`;
    try {
      const json = await fetchJson(url, 7000, PUMP_HEADERS);
      const rows = Array.isArray(json) ? (json as PumpCoin[]) : [];
      rows.forEach((c, i) => {
        const q = coinToQuote(c, solUsd, i);
        if (q && !byId.has(q.id)) byId.set(q.id, q);
      });
    } catch {
      /* try next sort */
    }
  }
  return [...byId.values()].slice(0, 36);
}

type DexPair = {
  chainId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string;
  priceChange?: { m5?: number; h1?: number };
  volume?: { h24?: number };
};

async function dexPumpBoard(): Promise<Quote[]> {
  try {
    const json = (await fetchJson(
      "https://api.dexscreener.com/latest/dex/search?q=pump.fun",
      7000,
    )) as { pairs?: DexPair[] };
    const pairs = json.pairs || [];
    const out: Quote[] = [];
    const seen = new Set<string>();
    for (const p of pairs) {
      if (p.chainId && p.chainId !== "solana") continue;
      const mint = p.baseToken?.address || "";
      if (!mint.endsWith("pump")) continue;
      if (seen.has(mint)) continue;
      const price = Number(p.priceUsd);
      if (!price || !Number.isFinite(price)) continue;
      seen.add(mint);
      const sym = (p.baseToken?.symbol || "MEME").toUpperCase().slice(0, 10);
      out.push({
        id: `pump:${mint}`,
        symbol: sym,
        name: p.baseToken?.name || sym,
        kind: "pump",
        price,
        changePct: Number(p.priceChange?.m5 ?? p.priceChange?.h1 ?? 0),
        volume: Number(p.volume?.h24 ?? 0),
        spark: [price],
        live: true,
      });
      if (out.length >= 24) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function pumpQuotes(solUsd: number): Promise<Quote[]> {
  const primary = await pumpFunBoard(solUsd);
  if (primary.length >= 8) return primary;
  const dex = await dexPumpBoard();
  const byId = new Map(primary.map((q) => [q.id, q]));
  for (const q of dex) if (!byId.has(q.id)) byId.set(q.id, q);
  const merged = [...byId.values()];
  if (merged.length) return merged;
  return PUMP_FALLBACK.map((s) => seedQuote(s));
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
  const core = await yahooQuotes();
  const sol = core.find((q) => q.id === "SOL")?.price ?? 200;
  const pump = await pumpQuotes(sol).catch(() => PUMP_FALLBACK.map((s) => seedQuote(s)));
  const live = core.some((q) => q.live) || pump.some((q) => q.live);
  return { quotes: [...core, ...pump], live, at: Date.now() };
}
