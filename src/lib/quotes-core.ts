import { CORE_SEEDS, PUMP_FALLBACK, STOCKS, seedQuote } from "./universe";
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

async function binanceOne(sym: string): Promise<Quote | null> {
  try {
    const json = (await fetchJson(
      `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(sym)}USDT`,
      6000,
    )) as { lastPrice?: string; priceChangePercent?: string; quoteVolume?: string };
    const price = Number(json.lastPrice);
    if (!price || !Number.isFinite(price)) return null;
    return {
      id: sym,
      symbol: sym,
      name: sym,
      kind: "crypto",
      price,
      changePct: Number(json.priceChangePercent) || 0,
      volume: Number(json.quoteVolume) || 0,
      spark: [price],
      live: true,
    };
  } catch {
    return null;
  }
}

/** Live prices for whatever we currently hold, so exits are not stuck on a stale print. */
export async function refreshHeldAll(
  held: { id: string; kind: Quote["kind"] }[],
): Promise<Quote[]> {
  const pumpIds = held.filter((h) => h.kind === "pump").map((h) => h.id);
  const crypto = held.filter((h) => h.kind === "crypto");
  const stocks = held.filter((h) => h.kind === "stock");
  const [pump, coins, shares] = await Promise.all([
    refreshHeldPumps(pumpIds),
    Promise.all(crypto.map((h) => binanceOne(h.id))),
    Promise.all(stocks.map((h) => yahooOne(h.id))),
  ]);
  return [...pump, ...coins.filter((q): q is Quote => !!q), ...shares.filter((q): q is Quote => !!q)];
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

/** Keep a live price on Pump.fun coins we already hold, even after they leave the hot board. */
export async function refreshHeldPumps(heldIds: string[]): Promise<Quote[]> {
  const mints = heldIds.filter((id) => id.startsWith("pump:")).map((id) => id.slice(5));
  if (!mints.length) return [];
  const out: Quote[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < mints.length; i += 20) {
    const batch = mints.slice(i, i + 20);
    try {
      const json = (await fetchJson(
        `https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`,
        8000,
      )) as { pairs?: DexPair[] };
      for (const p of json.pairs || []) {
        const mint = (p.baseToken?.address || "").trim();
        if (!mint || seen.has(mint)) continue;
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
      }
    } catch {
      /* next batch */
    }
  }

  for (const mint of mints) {
    if (seen.has(mint)) continue;
    try {
      const json = (await fetchJson(
        `https://frontend-api-v3.pump.fun/coins/${mint}`,
        6000,
        PUMP_HEADERS,
      )) as PumpCoin;
      const q = coinToQuote(json, 200, 0);
      if (q) {
        seen.add(mint);
        out.push(q);
      }
    } catch {
      /* leave last known quote */
    }
  }
  return out;
}

const STABLES = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "BUSD",
  "DAI",
  "TUSD",
  "USDP",
  "USDE",
  "USD1",
  "EUR",
  "AEUR",
  "PYUSD",
  "USDS",
]);

function isLeveragedToken(sym: string): boolean {
  return /(?:UP|DOWN|BEAR|BULL|3L|3S)$/.test(sym);
}

type BinanceTicker = {
  symbol?: string;
  lastPrice?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  volume?: string;
};

async function binanceCryptoBoard(): Promise<Quote[]> {
  const json = await fetchJson("https://data-api.binance.vision/api/v3/ticker/24hr", 10000);
  const rows = Array.isArray(json) ? (json as BinanceTicker[]) : [];
  const stockIds = new Set(STOCKS.map((s) => s.id));
  const scored: { q: Quote; vol: number }[] = [];
  for (const row of rows) {
    const pair = row.symbol || "";
    if (!pair.endsWith("USDT")) continue;
    const sym = pair.slice(0, -4);
    if (!/^[A-Z0-9]{2,12}$/.test(sym)) continue;
    if (STABLES.has(sym) || isLeveragedToken(sym) || stockIds.has(sym)) continue;
    const price = Number(row.lastPrice);
    if (!price || !Number.isFinite(price)) continue;
    const vol = Number(row.quoteVolume) || 0;
    scored.push({
      vol,
      q: {
        id: sym,
        symbol: sym,
        name: sym,
        kind: "crypto",
        price,
        changePct: Number(row.priceChangePercent) || 0,
        volume: vol,
        spark: [price],
        live: true,
      },
    });
  }
  scored.sort((a, b) => b.vol - a.vol);
  return scored.slice(0, 80).map((x) => x.q);
}

type PaprikaTicker = {
  name?: string;
  symbol?: string;
  quotes?: { USD?: { price?: number; percent_change_24h?: number; volume_24h?: number } };
};

async function paprikaCryptoBoard(): Promise<Quote[]> {
  const json = await fetchJson("https://api.coinpaprika.com/v1/tickers", 10000);
  const rows = Array.isArray(json) ? (json as PaprikaTicker[]) : [];
  const stockIds = new Set(STOCKS.map((s) => s.id));
  const out: Quote[] = [];
  for (const row of rows) {
    const sym = (row.symbol || "").toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(sym)) continue;
    if (STABLES.has(sym) || isLeveragedToken(sym) || stockIds.has(sym)) continue;
    const usd = row.quotes?.USD;
    const price = Number(usd?.price);
    if (!price || !Number.isFinite(price)) continue;
    out.push({
      id: sym,
      symbol: sym,
      name: row.name || sym,
      kind: "crypto",
      price,
      changePct: Number(usd?.percent_change_24h) || 0,
      volume: Number(usd?.volume_24h) || 0,
      spark: [price],
      live: true,
    });
    if (out.length >= 200) break;
  }
  return out;
}

async function cryptoBoard(): Promise<Quote[]> {
  try {
    const live = await binanceCryptoBoard();
    if (live.length >= 40) return live;
  } catch {
    /* paprika backup */
  }
  try {
    return await paprikaCryptoBoard();
  } catch {
    return [];
  }
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
  const [core, board] = await Promise.all([yahooQuotes(), cryptoBoard()]);
  const byId = new Map(core.map((q) => [q.id, q]));
  for (const q of board) {
    const prev = byId.get(q.id);
    if (prev?.kind === "stock") continue;
    byId.set(q.id, q);
  }
  const merged = [...byId.values()];
  const sol = merged.find((q) => q.id === "SOL")?.price ?? 200;
  const pump = await pumpQuotes(sol).catch(() => PUMP_FALLBACK.map((s) => seedQuote(s)));
  const quotes = [...merged, ...pump];
  const live = quotes.some((q) => q.live);
  return { quotes, live, at: Date.now() };
}
