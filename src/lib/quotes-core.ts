import { CORE_SEEDS, POLY_FALLBACK, STOCKS, seedQuote } from "./universe";
import type { Quote } from "./types";
import { currentWindows, fairUp, momFromCloses, parsePolyId, sigmaFromCloses } from "./updown";

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
  const ticker = symbol.replace(/^(pump:|poly:)/, "").toUpperCase();
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
  const polyIds = held.filter((h) => h.kind === "poly" || h.kind === "pump").map((h) => h.id);
  const crypto = held.filter((h) => h.kind === "crypto");
  const stocks = held.filter((h) => h.kind === "stock");
  const [poly, coins, shares] = await Promise.all([
    refreshHeldPoly(polyIds),
    Promise.all(crypto.map((h) => binanceOne(h.id))),
    Promise.all(stocks.map((h) => yahooOne(h.id))),
  ]);
  return [...poly, ...coins.filter((q): q is Quote => !!q), ...shares.filter((q): q is Quote => !!q)];
}

type GammaMarket = {
  id?: string;
  question?: string;
  slug?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[] | number[];
  volume?: string | number;
  volume24hr?: number;
  liquidity?: string | number;
  bestBid?: number;
  bestAsk?: number;
  closed?: boolean;
  active?: boolean;
  enableOrderBook?: boolean;
  endDate?: string;
  startDate?: string;
};

type GammaEvent = {
  title?: string;
  slug?: string;
  markets?: GammaMarket[];
};

const POLY_STOP = new Set([
  "will",
  "the",
  "be",
  "a",
  "an",
  "in",
  "of",
  "to",
  "for",
  "on",
  "after",
  "by",
  "and",
  "or",
  "at",
  "vs",
]);

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function polyTicker(slug: string, question: string): string {
  const raw = (slug || question || "poly").toLowerCase().replace(/-\d+$/, "");
  const words = raw.split(/[^a-z0-9]+/).filter((w) => w && !POLY_STOP.has(w) && w.length > 1);
  return (words.slice(0, 3).join("-") || "poly").toUpperCase().slice(0, 16);
}

function marketToQuote(m: GammaMarket, allowSettled = false): Quote | null {
  if (!m.id) return null;
  if (!allowSettled && (m.closed || m.active === false)) return null;
  const prices = parseJsonArray(m.outcomePrices).map(Number);
  const yes = prices[0];
  if (!Number.isFinite(yes) || yes < 0) return null;
  const vol = Number(m.volume24hr ?? m.volume ?? 0);
  const liq = Number(m.liquidity ?? 0);
  if (!allowSettled && vol < 20_000 && liq < 10_000) return null;
  const bid = Number(m.bestBid);
  const ask = Number(m.bestAsk);
  let spreadBps: number | undefined;
  if (bid > 0 && ask > bid) spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
  const px = Math.min(0.999, Math.max(0.001, yes || (allowSettled ? 0.001 : 0)));
  return {
    id: `poly:${m.id}`,
    symbol: polyTicker(m.slug || "", m.question || ""),
    name: m.question || m.slug || `Market ${m.id}`,
    kind: "poly",
    price: px,
    changePct: 0,
    volume: vol || liq,
    spark: [px],
    live: true,
    spreadBps,
  };
}

async function polyBoard(): Promise<Quote[]> {
  const [events, rounds] = await Promise.all([
    polyEventBoard().catch(() => [] as Quote[]),
    fetchUpDownRounds().catch(() => [] as Quote[]),
  ]);
  const byId = new Map<string, Quote>();
  for (const q of events) byId.set(q.id, q);
  for (const q of rounds) byId.set(q.id, q);
  const ranked = [...byId.values()].sort((a, b) => {
    const ah = a.horizon ? 1 : 0;
    const bh = b.horizon ? 1 : 0;
    if (ah !== bh) return bh - ah;
    return (b.volume || 0) - (a.volume || 0);
  });
  if (ranked.length) return ranked.slice(0, 56);
  return POLY_FALLBACK.map((s) => seedQuote(s));
}

async function polyEventBoard(): Promise<Quote[]> {
  const urls = [
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=50",
    "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=liquidity&ascending=false&limit=40",
  ];
  const byId = new Map<string, Quote>();
  await Promise.all(
    urls.map(async (url) => {
      try {
        const json = await fetchJson(url, 9000, {
          "User-Agent": "Mozilla/5.0 (compatible; CoraDesktop/1.0; +https://cora.datosfarm.com)",
        });
        const rows = Array.isArray(json) ? (json as GammaMarket[]) : [];
        for (const m of rows) {
          const q = marketToQuote(m);
          if (!q) continue;
          if (q.price < 0.1 || q.price > 0.9) continue;
          const prev = byId.get(q.id);
          if (!prev || q.volume > prev.volume) byId.set(q.id, q);
        }
      } catch {
        /* next page */
      }
    }),
  );
  return [...byId.values()].sort((a, b) => b.volume - a.volume).slice(0, 24);
}

async function fetchBinanceTape(
  symbol: string,
): Promise<{ spot: number; rows: { t: number; o: number; c: number }[] } | null> {
  try {
    const [klines, ticker] = await Promise.all([
      fetchJson(
        `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&limit=30`,
        6000,
      ),
      fetchJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`, 4000),
    ]);
    const raw = Array.isArray(klines) ? (klines as unknown[]) : [];
    const rows: { t: number; o: number; c: number }[] = [];
    for (const row of raw) {
      if (!Array.isArray(row)) continue;
      const t = Number(row[0]);
      const o = Number(row[1]);
      const c = Number(row[4]);
      if (t > 0 && c > 0) rows.push({ t, o, c });
    }
    const spot = Number((ticker as { price?: string })?.price) || rows[rows.length - 1]?.c || 0;
    if (!spot || !rows.length) return null;
    return { spot, rows };
  } catch {
    return null;
  }
}

function openFromTape(
  rows: { t: number; o: number; c: number }[],
  windowStart: number,
  horizon: "5m" | "15m",
): number {
  const hit = rows.find((r) => r.t === windowStart);
  if (hit?.o) return hit.o;
  const interval = horizon === "15m" ? 900_000 : 300_000;
  const inside = rows.find((r) => r.t >= windowStart && r.t < windowStart + interval && r.o > 0);
  return inside?.o || 0;
}

function windowCloses(
  rows: { t: number; o: number; c: number }[],
  windowStart: number,
  spot: number,
): number[] {
  const inside = rows.filter((r) => r.t >= windowStart).map((r) => r.c);
  const tape = inside.length >= 2 ? inside : rows.map((r) => r.c).slice(-15);
  if (!tape.length) return [spot];
  if (tape[tape.length - 1] !== spot) tape.push(spot);
  return tape.slice(-20);
}

async function fetchUpDownRounds(): Promise<Quote[]> {
  const windows = currentWindows();
  const symbols = [...new Set(windows.map((w) => w.binance))];
  const tapes = new Map<string, { spot: number; rows: { t: number; o: number; c: number }[] }>();
  await Promise.all(
    symbols.map(async (sym) => {
      const tape = await fetchBinanceTape(sym);
      if (tape) tapes.set(sym, tape);
    }),
  );
  const out: Quote[] = [];
  await Promise.all(
    windows.map(async (w) => {
      try {
        const json = await fetchJson(
          `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(w.slug)}`,
          7000,
          { "User-Agent": "Mozilla/5.0 (compatible; CoraDesktop/1.0; +https://cora.datosfarm.com)" },
        );
        const ev = Array.isArray(json) ? (json as GammaEvent[])[0] : (json as GammaEvent);
        const m = ev?.markets?.[0];
        if (!m?.id) return;
        const prices = parseJsonArray(m.outcomePrices).map(Number);
        const upPx = Number.isFinite(prices[0]) ? prices[0]! : 0.5;
        const downPx = Number.isFinite(prices[1]) ? prices[1]! : Math.max(0.001, 1 - upPx);
        const tape = tapes.get(w.binance);
        const open = tape ? openFromTape(tape.rows, w.windowStart, w.horizon) : 0;
        const spot = tape?.spot || 0;
        const closes = tape ? tape.rows.map((r) => r.c) : [];
        const sigma1m = sigmaFromCloses(closes);
        const { mom } = momFromCloses(closes);
        const tau = Math.max(0, (w.windowEnd - Date.now()) / 1000);
        const fair = spot && open ? fairUp(spot, open, sigma1m, tau, mom) : 0.5;
        const spark = tape && open ? windowCloses(tape.rows, w.windowStart, spot) : [spot || upPx];
        const vol = Number(m.volume24hr ?? m.volume ?? 0);
        const bid = Number(m.bestBid);
        const ask = Number(m.bestAsk);
        let spreadBps: number | undefined;
        if (bid > 0 && ask > bid) spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
        const upId = `poly:${m.id}:up`;
        const downId = `poly:${m.id}:down`;
        const base = {
          kind: "poly" as const,
          live: true,
          volume: vol,
          spreadBps,
          fair,
          windowStart: w.windowStart,
          windowEnd: w.windowEnd,
          spot: spot || undefined,
          openPx: open || undefined,
          asset: w.asset,
          horizon: w.horizon,
          spark,
        };
        const delta = spot && open ? ((spot - open) / open) * 100 : 0;
        out.push({
          ...base,
          id: upId,
          symbol: `${w.asset}-${w.horizon}-UP`,
          name: ev?.title || `${w.asset} Up ${w.horizon}`,
          price: Math.min(0.999, Math.max(0.001, upPx)),
          changePct: delta,
          pairId: downId,
          leg: "up",
        });
        out.push({
          ...base,
          id: downId,
          symbol: `${w.asset}-${w.horizon}-DN`,
          name: `${w.asset} Down ${w.horizon}`,
          price: Math.min(0.999, Math.max(0.001, downPx)),
          changePct: -delta,
          pairId: upId,
          leg: "down",
        });
      } catch {
        /* skip this window */
      }
    }),
  );
  return out;
}

export async function refreshHeldPoly(heldIds: string[]): Promise<Quote[]> {
  const rounds = await fetchUpDownRounds().catch(() => [] as Quote[]);
  const wanted = new Set(heldIds);
  const fromRounds = rounds.filter((q) => wanted.has(q.id));
  const leftover = heldIds.filter((id) => !fromRounds.some((q) => q.id === id));
  if (!leftover.length) return fromRounds;
  const out = [...fromRounds];
  for (const id of leftover) {
    const { marketId } = parsePolyId(id);
    if (!/^\d+$/.test(marketId)) continue;
    try {
      const json = await fetchJson(
        `https://gamma-api.polymarket.com/markets?id=${encodeURIComponent(marketId)}`,
        7000,
      );
      const row = Array.isArray(json) ? (json as GammaMarket[])[0] : (json as GammaMarket);
      const q = row ? marketToQuote(row, true) : null;
      if (q) out.push({ ...q, id });
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

async function binanceBooks(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const json = await fetchJson("https://data-api.binance.vision/api/v3/ticker/bookTicker", 8000);
    if (!Array.isArray(json)) return map;
    for (const r of json as { symbol?: string; bidPrice?: string; askPrice?: string }[]) {
      const bid = Number(r.bidPrice);
      const ask = Number(r.askPrice);
      if (!(bid > 0) || !(ask > bid)) continue;
      map.set(r.symbol || "", ((ask - bid) / ((ask + bid) / 2)) * 10_000);
    }
  } catch {
    /* spread filter just skips missing */
  }
  return map;
}

async function binanceCryptoBoard(): Promise<Quote[]> {
  const [json, books] = await Promise.all([
    fetchJson("https://data-api.binance.vision/api/v3/ticker/24hr", 10000),
    binanceBooks(),
  ]);
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
    if (vol < 50_000_000) continue;
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
        spreadBps: books.get(pair),
      },
    });
  }
  scored.sort((a, b) => b.vol - a.vol);
  return scored.slice(0, 40).map((x) => x.q);
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
    const vol = Number(usd?.volume_24h) || 0;
    if (vol < 50_000_000) continue;
    out.push({
      id: sym,
      symbol: sym,
      name: row.name || sym,
      kind: "crypto",
      price,
      changePct: Number(usd?.percent_change_24h) || 0,
      volume: vol,
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
    if (live.length >= 12) return live;
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
    const vol = q.kind === "poly" ? 0.012 : q.kind === "crypto" ? 0.004 : q.kind === "pump" ? 0.035 : 0.0015;
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
  const [core, board, poly] = await Promise.all([
    yahooQuotes(),
    cryptoBoard(),
    polyBoard().catch(() => POLY_FALLBACK.map((s) => seedQuote(s))),
  ]);
  const byId = new Map(core.map((q) => [q.id, q]));
  for (const q of board) {
    const prev = byId.get(q.id);
    if (prev?.kind === "stock") continue;
    byId.set(q.id, q);
  }
  const quotes = [...byId.values(), ...poly];
  const live = quotes.some((q) => q.live);
  return { quotes, live, at: Date.now() };
}
