import { COPY_LEADERS } from "./copy-leaders";
import type { CopyEvent } from "./types";

type RawRow = {
  disclosure_date?: string;
  transaction_date?: string;
  owner?: string;
  ticker?: string;
  type?: string;
  amount?: string;
  representative?: string;
  senator?: string;
  asset_description?: string;
};

const HOUSE =
  "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json";
const SENATE =
  "https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json";

function parseDate(raw?: string): Date | null {
  if (!raw) return null;
  const cleaned = raw.replaceAll("/", "-").trim();
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

function delayDays(trade?: string, filed?: string): number {
  const a = parseDate(trade);
  const b = parseDate(filed);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function sideOf(type?: string): "buy" | "sell" | null {
  const t = (type || "").toLowerCase();
  if (t.includes("purchase") || t === "buy") return "buy";
  if (t.includes("sale") || t.includes("sell")) return "sell";
  return null;
}

function tickerOf(row: RawRow): string | null {
  const t = (row.ticker || "").trim().toUpperCase().replace(/^\$/, "");
  if (!t || t === "--" || t === "N/A" || t === "NONE" || t.length > 6) return null;
  if (!/^[A-Z.]{1,6}$/.test(t)) return null;
  return t.replaceAll(".", "");
}

function haystack(row: RawRow): string {
  return `${row.representative || ""} ${row.senator || ""} ${row.owner || ""}`.toLowerCase();
}

function matchesLeader(row: RawRow, leaderId: string): boolean {
  const leader = COPY_LEADERS.find((l) => l.id === leaderId);
  if (!leader || !leader.needles.length) return false;
  const hay = haystack(row);
  if (!leader.needles.some((n) => hay.includes(n.toLowerCase()))) return false;
  const owner = (row.owner || "self").toLowerCase();
  if (leader.kind === "spouse") return owner.includes("spouse") || owner.includes("joint");
  if (leader.kind === "congress") return !owner.includes("spouse");
  return true;
}

async function loadAny(url: string, timeoutMs = 12000, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "CoraDesktop/1.0",
        ...headers,
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadJson(url: string): Promise<RawRow[]> {
  const json = await loadAny(url);
  return Array.isArray(json) ? (json as RawRow[]) : [];
}

export async function fetchCongressEvents(): Promise<CopyEvent[]> {
  const [house, senate] = await Promise.all([loadJson(HOUSE), loadJson(SENATE)]);
  const rows = [...house, ...senate];
  const cutoff = Date.now() - 1000 * 60 * 60 * 24 * 400;
  const events: CopyEvent[] = [];

  for (const row of rows) {
    const ticker = tickerOf(row);
    const side = sideOf(row.type);
    const filed = parseDate(row.disclosure_date);
    if (!ticker || !side || !filed) continue;
    if (filed.getTime() < cutoff) continue;
    const leader = COPY_LEADERS.find((l) => matchesLeader(row, l.id));
    if (!leader) continue;
    events.push({
      id: `${leader.id}-${ticker}-${row.transaction_date}-${row.disclosure_date}-${side}`,
      leaderId: leader.id,
      leaderName: leader.name,
      ticker,
      side,
      tradeDate: row.transaction_date || "",
      disclosureDate: row.disclosure_date || "",
      amount: row.amount || "",
      delayDays: delayDays(row.transaction_date, row.disclosure_date),
      consumed: false,
      note: row.asset_description || "",
    });
  }

  events.sort((a, b) => (a.disclosureDate < b.disclosureDate ? 1 : -1));
  const seen = new Set<string>();
  const unique: CopyEvent[] = [];
  for (const e of events) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    unique.push(e);
    if (unique.length >= 80) break;
  }
  return unique;
}

function packEvent(partial: Omit<CopyEvent, "consumed">): CopyEvent {
  return { ...partial, consumed: false };
}

async function fetchArkEvents(): Promise<CopyEvent[]> {
  const json = (await loadAny("https://arkfunds.io/api/v1/etf/holdings?symbol=ARKK")) as {
    date?: string;
    holdings?: { ticker?: string; weight?: number; company?: string }[];
  } | null;
  const holdings = json?.holdings ?? [];
  const date = json?.date || new Date().toISOString().slice(0, 10);
  return holdings
    .filter((h) => h.ticker && (h.weight ?? 0) >= 3)
    .slice(0, 8)
    .map((h) =>
      packEvent({
        id: `cathie-${h.ticker}-${date}`,
        leaderId: "cathie",
        leaderName: "Cathie Wood",
        ticker: String(h.ticker).toUpperCase(),
        side: "buy",
        tradeDate: date,
        disclosureDate: date,
        amount: `${(h.weight ?? 0).toFixed(1)}% of ARKK`,
        delayDays: 1,
        note: h.company || "ARKK holding",
      }),
    );
}

const HL_COINS: Record<string, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
  DOGE: "DOGE",
  XRP: "XRP",
  AVAX: "AVAX",
  LINK: "LINK",
  PEPE: "PEPE",
  HYPE: "HYPE",
  SUI: "SUI",
  ZEC: "ZEC",
  BNB: "BNB",
  ADA: "ADA",
  LTC: "LTC",
  BCH: "BCH",
  ARB: "ARB",
  OP: "OP",
  APT: "APT",
  TON: "TON",
  UNI: "UNI",
  AAVE: "AAVE",
  NEAR: "NEAR",
  INJ: "INJ",
  TIA: "TIA",
  SEI: "SEI",
  DOT: "DOT",
  ATOM: "ATOM",
  FIL: "FIL",
  WIF: "WIF",
  BONK: "BONK",
};

export type WhaleSnap = {
  id: string;
  name: string;
  detail: string;
  address: string;
  coins: string[];
  bookOk: boolean;
};

type HlRow = {
  ethAddress?: string;
  accountValue?: string;
  windowPerformances?: [string, { pnl?: string; roi?: string }][];
};

type HlPerp = {
  assetPositions?: { position?: { coin?: string; szi?: string } }[];
};

type HlSpot = {
  balances?: { coin?: string; total?: string }[];
};

async function postHl(body: Record<string, unknown>): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "CoraDesktop/1.0" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 429) {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 800));
        continue;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
    }
  }
  return null;
}

async function whaleLongs(address: string): Promise<{ coins: string[]; ok: boolean }> {
  const coins = new Set<string>();
  const perp = (await postHl({ type: "clearinghouseState", user: address })) as HlPerp | null;
  for (const ap of perp?.assetPositions ?? []) {
    const coin = (ap.position?.coin || "").toUpperCase();
    const szi = Number(ap.position?.szi || 0);
    const mapped = HL_COINS[coin];
    if (mapped && szi > 0) coins.add(mapped);
  }
  if (coins.size > 0) return { coins: [...coins], ok: true };

  const spot = (await postHl({ type: "spotClearinghouseState", user: address })) as HlSpot | null;
  for (const b of spot?.balances ?? []) {
    const coin = (b.coin || "").toUpperCase();
    const mapped = HL_COINS[coin];
    if (mapped && Number(b.total || 0) > 0.01) coins.add(mapped);
  }
  if (!perp && !spot) return { coins: [], ok: false };
  if (!spot && coins.size === 0) return { coins: [], ok: false };
  return { coins: [...coins], ok: true };
}

async function fetchHlPack(): Promise<{ events: CopyEvent[]; whales: WhaleSnap[] }> {
  const events: CopyEvent[] = [];
  const whales: WhaleSnap[] = [];
  try {
    const res = await fetch("https://stats-data.hyperliquid.xyz/Mainnet/leaderboard", {
      headers: { "User-Agent": "CoraDesktop/1.0", Range: "bytes=0-1200000" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { events, whales };
    const text = await res.text();
    const idx = text.lastIndexOf("},");
    if (idx < 0) return { events, whales };
    const data = JSON.parse(`${text.slice(0, idx + 1)}]}`) as { leaderboardRows?: HlRow[] };
    const ranked = (data.leaderboardRows ?? [])
      .map((row) => {
        const perf = Object.fromEntries(row.windowPerformances ?? []);
        const month = perf.month ?? {};
        return {
          address: (row.ethAddress || "").toLowerCase(),
          pnl: Number(month.pnl || 0),
          roi: Number(month.roi || 0),
          value: Number(row.accountValue || 0),
        };
      })
      .filter((r) => r.address && r.pnl > 0 && r.value > 50_000)
      .sort((a, b) => b.pnl - a.pnl)
      .slice(0, 5);

    const books: { coins: string[]; ok: boolean }[] = [];
    for (const w of ranked) {
      books.push(await whaleLongs(w.address));
    }

    for (let i = 0; i < ranked.length; i++) {
      const w = ranked[i]!;
      const id = `hl-${i + 1}`;
      const short = `${w.address.slice(0, 6)}…${w.address.slice(-4)}`;
      const pnlM =
        w.pnl >= 1_000_000 ? `$${(w.pnl / 1_000_000).toFixed(1)}M` : `$${(w.pnl / 1000).toFixed(0)}k`;
      const roiPct = `${(w.roi * 100).toFixed(1)}%`;
      const book = books[i] ?? { coins: [] as string[], ok: false };
      const coins = book.coins;
      const coinBit = !book.ok
        ? "Book unread this pass — retrying."
        : coins.length
          ? `Long ${coins.join(", ")}.`
          : "In cash — no copyable longs.";
      const snap: WhaleSnap = {
        id,
        name: `Crypto whale ${short}`,
        detail: `Hyperliquid 30d ${pnlM} (${roiPct} ROI). ${coinBit} Paper longs only — not Polymarket.`,
        address: w.address,
        coins,
        bookOk: book.ok,
      };
      whales.push(snap);

      if (!book.ok) continue;

      for (const ticker of coins) {
        events.push(
          packEvent({
            id: `${id}-${w.address.slice(0, 8)}-${ticker}-long`,
            leaderId: id,
            leaderName: snap.name,
            ticker,
            side: "buy",
            tradeDate: new Date().toISOString().slice(0, 10),
            disclosureDate: new Date().toISOString().slice(0, 10),
            amount: `30d ${pnlM}`,
            delayDays: 0,
            note: snap.detail,
          }),
        );
      }
    }
  } catch {
    return { events, whales };
  }
  return { events, whales };
}

export async function fetchCopyPack(): Promise<{ events: CopyEvent[]; whales: WhaleSnap[] }> {
  const [congress, ark, hl] = await Promise.all([
    fetchCongressEvents(),
    fetchArkEvents().catch(() => [] as CopyEvent[]),
    fetchHlPack().catch(() => ({ events: [] as CopyEvent[], whales: [] as WhaleSnap[] })),
  ]);
  const seen = new Set<string>();
  const events: CopyEvent[] = [];
  for (const e of [...hl.events, ...ark, ...congress]) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    events.push(e);
    if (events.length >= 120) break;
  }
  return { events, whales: hl.whales };
}

export async function fetchCopyEvents(): Promise<CopyEvent[]> {
  return (await fetchCopyPack()).events;
}

