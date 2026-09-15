import { CORE_SEEDS, POLY_FALLBACK, STOCKS, seedQuote } from "./universe";
import type { Quote } from "./types";
import { currentWindows, fairUp, momFromCloses, parsePolyId, sigmaFromCloses, UPDOWN_ASSETS } from "./updown";

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
  clobTokenIds?: string | string[];
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

async function clobTop(tokenId: string): Promise<{ bid: number; ask: number; bidSize: number; askSize: number } | null> {
  try {
    const json = (await fetchJson(
      `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`,
      5000,
    )) as { bids?: { price?: string; size?: string }[]; asks?: { price?: string; size?: string }[] };
    const bids = (json.bids || [])
      .map((r) => ({ price: Number(r.price), size: Number(r.size) }))
      .filter((r) => r.price > 0 && r.size > 0)
      .sort((a, b) => b.price - a.price);
    const asks = (json.asks || [])
      .map((r) => ({ price: Number(r.price), size: Number(r.size) }))
      .filter((r) => r.price > 0 && r.size > 0)
      .sort((a, b) => a.price - b.price);
    const bid = bids[0];
    const ask = asks[0];
    if (!bid || !ask || !(ask.price > bid.price)) return null;
    return { bid: bid.price, ask: ask.price, bidSize: bid.size, askSize: ask.size };
  } catch {
    return null;
  }
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
  const px = Math.min(0.999, Math.max(0.001, yes || (allowSettled ? 0.001 : 0)));
  const bid = Number(m.bestBid);
  const ask = Number(m.bestAsk);
  const hasBook = bid > 0 && ask > bid;
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
    spreadBps: hasBook ? ((ask - bid) / ((ask + bid) / 2)) * 10_000 : undefined,
    bid: hasBook ? bid : undefined,
    ask: hasBook ? ask : undefined,
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

type SpotTape = {
  spot: number;
  rows: { t: number; o: number; c: number }[];
  fine: { t: number; o: number; c: number }[];
};

async function fetchHlTape(coin: string): Promise<SpotTape | null> {
  try {
    const now = Date.now();
    const [candles, mids] = await Promise.all([
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "candleSnapshot",
          req: { coin, interval: "1m", startTime: now - 40 * 60_000, endTime: now },
        }),
        signal: AbortSignal.timeout(6000),
      }).then((r) => (r.ok ? r.json() : [])),
      fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allMids" }),
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : {})),
    ]);
    const rows: { t: number; o: number; c: number }[] = [];
    const list = Array.isArray(candles) ? candles : [];
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { t?: number; o?: string; c?: string };
      const t = Number(rec.t);
      const o = Number(rec.o);
      const c = Number(rec.c);
      if (t > 0 && c > 0) rows.push({ t, o, c });
    }
    const spot = Number((mids as Record<string, string>)?.[coin]) || rows[rows.length - 1]?.c || 0;
    if (!spot || !rows.length) return null;
    return { spot, rows, fine: rows };
  } catch {
    return null;
  }
}

async function fetchBinanceTape(symbol: string): Promise<SpotTape | null> {
  try {
    const [klines, fineRaw, ticker] = await Promise.all([
      fetchJson(
        `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&limit=30`,
        6000,
      ),
      fetchJson(
        `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1s&limit=1000`,
        6000,
      ).catch(() => []),
      fetchJson(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`, 4000),
    ]);
    const parse = (raw: unknown) => {
      const rows: { t: number; o: number; c: number }[] = [];
      const list = Array.isArray(raw) ? (raw as unknown[]) : [];
      for (const row of list) {
        if (!Array.isArray(row)) continue;
        const t = Number(row[0]);
        const o = Number(row[1]);
        const c = Number(row[4]);
        if (t > 0 && c > 0) rows.push({ t, o, c });
      }
      return rows;
    };
    const rows = parse(klines);
    const fine = parse(fineRaw);
    const spot = Number((ticker as { price?: string })?.price) || rows[rows.length - 1]?.c || 0;
    if (!spot || !rows.length) return null;
    return { spot, rows, fine };
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
  open: number,
  spot: number,
): number[] {
  const lookback = 60_000;
  const tape: number[] = [];
  let placedOpen = false;
  for (const r of rows) {
    if (r.t < windowStart - lookback) continue;
    if (!placedOpen && r.t >= windowStart) {
      if (open > 0 && tape[tape.length - 1] !== open) tape.push(open);
      placedOpen = true;
    }
    if (tape.length && r.c === tape[tape.length - 1]) continue;
    tape.push(r.c);
  }
  if (!placedOpen && open > 0) tape.push(open);
  if (spot > 0 && tape[tape.length - 1] !== spot) tape.push(spot);
  if (tape.length >= 2) return tape;
  const fallback = rows.map((r) => r.c).slice(-30);
  if (spot > 0 && fallback[fallback.length - 1] !== spot) fallback.push(spot);
  return fallback.length ? fallback : [spot || open];
}

async function poolMap<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) {
    await Promise.all(items.slice(i, i + n).map(fn));
  }
}

async function fetchUpDownRounds(): Promise<Quote[]> {
  const windows = currentWindows();
  const tapes = new Map<string, SpotTape>();
  await Promise.all(
    UPDOWN_ASSETS.map(async (a) => {
      const tape = a.hl ? await fetchHlTape(a.hl) : await fetchBinanceTape(a.binance);
      if (tape) tapes.set(a.asset, tape);
    }),
  );
  const out: Quote[] = [];
  await poolMap(windows, 6, async (w) => {
      try {
        const json = await fetchJson(
          `https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(w.slug)}`,
          7000,
          { "User-Agent": "Mozilla/5.0 (compatible; CoraDesktop/1.0; +https://cora.datosfarm.com)" },
        );
        const ev = Array.isArray(json) ? (json as GammaEvent[])[0] : (json as GammaEvent);
        const m = ev?.markets?.[0];
        if (!m?.id) return;
        const tokens = parseJsonArray(m.clobTokenIds);
        const [upTok, dnTok] = tokens;
        if (!upTok || !dnTok) return;
        const [upBook, dnBook] = await Promise.all([clobTop(upTok), clobTop(dnTok)]);
        if (!upBook || !dnBook) return;
        const tape = tapes.get(w.asset);
        const open = tape ? openFromTape(tape.rows, w.windowStart, w.horizon) : 0;
        const spot = tape?.spot || 0;
        const closes = tape ? tape.rows.map((r) => r.c) : [];
        const sigma1m = sigmaFromCloses(closes);
        const { mom } = momFromCloses(closes);
        const tau = Math.max(0, (w.windowEnd - Date.now()) / 1000);
        const fair = spot && open ? fairUp(spot, open, sigma1m, tau, mom) : 0.5;
        const fine = tape && tape.fine.length >= 8 ? tape.fine : tape?.rows;
        const spark = tape && open ? windowCloses(fine || tape.rows, w.windowStart, open, spot) : [spot || upBook.ask];
        const vol = Number(m.volume24hr ?? m.volume ?? 0);
        const upId = `poly:${m.id}:up`;
        const downId = `poly:${m.id}:down`;
        const base = {
          kind: "poly" as const,
          live: true,
          volume: vol,
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
        const upMid = (upBook.bid + upBook.ask) / 2;
        const dnMid = (dnBook.bid + dnBook.ask) / 2;
        out.push({
          ...base,
          id: upId,
          symbol: `${w.asset}-${w.horizon}-UP`,
          name: ev?.title || `${w.asset} Up ${w.horizon}`,
          price: upMid,
          changePct: delta,
          pairId: downId,
          leg: "up",
          spreadBps: ((upBook.ask - upBook.bid) / upMid) * 10_000,
          bid: upBook.bid,
          ask: upBook.ask,
          askSize: upBook.askSize,
        });
        out.push({
          ...base,
          id: downId,
          symbol: `${w.asset}-${w.horizon}-DN`,
          name: `${w.asset} Down ${w.horizon}`,
          price: dnMid,
          changePct: -delta,
          pairId: upId,
          leg: "down",
          spreadBps: ((dnBook.ask - dnBook.bid) / dnMid) * 10_000,
          bid: dnBook.bid,
          ask: dnBook.ask,
          askSize: dnBook.askSize,
        });
      } catch {
        /* skip this window */
      }
  });
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
      if (!row) continue;
      const { leg } = parsePolyId(id);
      const prices = parseJsonArray(row.outcomePrices).map(Number);
      const raw = leg === "down" ? prices[1] : prices[0];
      const px = Number.isFinite(raw) ? Math.min(0.999, Math.max(0.001, raw!)) : 0;
      if (!(px > 0)) continue;
      const resolved = px <= 0.04 || px >= 0.96;
      const q = marketToQuote(row, true);
      if (!q) continue;
      out.push({
        ...q,
        id,
        price: px,
        bid: resolved ? px : q.bid,
        ask: resolved ? px : q.ask,
        askSize: resolved ? 0 : q.askSize,
      });
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
