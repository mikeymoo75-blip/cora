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

async function loadJson(url: string): Promise<RawRow[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "ApexDesk/1.0" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as RawRow[]) : [];
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

export async function fetchCopyEvents(): Promise<CopyEvent[]> {
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
