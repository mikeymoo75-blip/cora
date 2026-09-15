import type { Position, Quote } from "./types";

export type UpDownAsset = "BTC" | "ETH" | "SOL" | "XRP" | "DOGE" | "BNB" | "HYPE";
export type UpDownHorizon = "5m" | "15m";

export type UpDownFeed = {
  asset: UpDownAsset;
  binance: string;
  hl?: string;
};

/** Polymarket’s live crypto Up/Down set. HYPE has no Binance pair — use Hyperliquid. */
export const UPDOWN_ASSETS: UpDownFeed[] = [
  { asset: "BTC", binance: "BTCUSDT" },
  { asset: "ETH", binance: "ETHUSDT" },
  { asset: "SOL", binance: "SOLUSDT" },
  { asset: "XRP", binance: "XRPUSDT" },
  { asset: "DOGE", binance: "DOGEUSDT" },
  { asset: "BNB", binance: "BNBUSDT" },
  { asset: "HYPE", binance: "", hl: "HYPE" },
];

export const UPDOWN_ORDER = UPDOWN_ASSETS.map((a) => a.asset);

export type UpDownWindow = {
  asset: UpDownAsset;
  horizon: UpDownHorizon;
  windowStart: number;
  windowEnd: number;
  slug: string;
  binance: string;
};

function erf(x: number): number {
  const sign = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export function currentWindows(at = Date.now()): UpDownWindow[] {
  const sec = Math.floor(at / 1000);
  const w5 = Math.floor(sec / 300) * 300;
  const w15 = Math.floor(sec / 900) * 900;
  const assets = UPDOWN_ASSETS;
  const out: UpDownWindow[] = [];
  for (const a of assets) {
    const tag = a.asset.toLowerCase();
    out.push({
      asset: a.asset,
      horizon: "5m",
      windowStart: w5 * 1000,
      windowEnd: (w5 + 300) * 1000,
      slug: `${tag}-updown-5m-${w5}`,
      binance: a.binance,
    });
    out.push({
      asset: a.asset,
      horizon: "15m",
      windowStart: w15 * 1000,
      windowEnd: (w15 + 900) * 1000,
      slug: `${tag}-updown-15m-${w15}`,
      binance: a.binance,
    });
  }
  return out;
}

/** Seconds left in the current 5m/15m unix window — wall clock, not the quote. */
export function wallClockLeft(horizon: "5m" | "15m" | string, at = Date.now()): number {
  const span = horizon === "15m" ? 900 : 300;
  const sec = Math.floor(at / 1000);
  return span - (sec % span);
}

/** Last-minute log return + acceleration (change in 1m return). */
export function momFromCloses(closes: number[]): { mom: number; accel: number } {
  const n = closes.length;
  if (n < 4) return { mom: 0, accel: 0 };
  const a = closes[n - 3]!;
  const b = closes[n - 2]!;
  const c = closes[n - 1]!;
  if (!(a > 0) || !(b > 0) || !(c > 0)) return { mom: 0, accel: 0 };
  const r1 = Math.log(b / a);
  const r2 = Math.log(c / b);
  return { mom: r2, accel: r2 - r1 };
}

/**
 * P(up) from live spot vs window open.
 * Distance-from-open / realized vol, plus a small momentum tilt
 * (the public std0-style fair: spot, vol, last-minute drift).
 */
export function fairUp(
  spot: number,
  open: number,
  sigma1m: number,
  tauSec: number,
  mom = 0,
): number {
  if (!(spot > 0) || !(open > 0)) return 0.5;
  if (tauSec <= 2) return spot >= open ? 0.995 : 0.005;
  const vol = Math.max(sigma1m * Math.sqrt(Math.max(tauSec, 1) / 60), 1e-6);
  const z = Math.log(spot / open) / vol + 0.35 * (mom / Math.max(sigma1m, 1e-6));
  return Math.min(0.995, Math.max(0.005, phi(z)));
}

export function sigmaFromCloses(closes: number[]): number {
  if (closes.length < 6) return 0.0015;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1]!;
    const b = closes[i]!;
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  if (rets.length < 4) return 0.0015;
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const v = rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1);
  return Math.max(Math.sqrt(v), 0.0002);
}

export function parsePolyId(id: string): { marketId: string; leg: "up" | "down" | "" } {
  const raw = id.startsWith("poly:") ? id.slice(5) : id;
  const [marketId, rest] = raw.split(":");
  if (rest === "down") return { marketId: marketId || raw, leg: "down" };
  if (rest === "up") return { marketId: marketId || raw, leg: "up" };
  return { marketId: marketId || raw, leg: "" };
}

export function updownExplain(
  quote: Quote,
  pos: Position | undefined,
  other?: Position,
): { action: "buy" | "sell" | "hold"; why: string } {
  const last = quote.price;
  const pay = quote.ask && quote.ask > 0 ? quote.ask : last;
  const now = Date.now();
  const tau = quote.windowEnd ? (quote.windowEnd - now) / 1000 : 0;
  const elapsed = quote.windowStart ? (now - quote.windowStart) / 1000 : 0;
  const total = quote.horizon === "15m" ? 900 : 300;
  const fair = quote.fair ?? 0.5;
  const thisFair = quote.leg === "down" ? 1 - fair : fair;
  const edge = thisFair - pay;

  if (pos) {
    if (!last || last <= 0) return { action: "sell", why: "Odds print died — getting out." };
    if (quote.windowEnd && now >= quote.windowEnd - 500) {
      return { action: "sell", why: "Window closed — settling the round." };
    }
    if (last <= 0.02 || last >= 0.98) {
      return { action: "sell", why: `Round settling at ${Math.round(last * 100)}¢.` };
    }
    if (other) {
      return {
        action: "hold",
        why: `Hedged ${quote.asset} ${quote.horizon}. Holding both sides to settle. Fair Up ${(fair * 100).toFixed(0)}¢.`,
      };
    }
    const fromEntryC = (last - pos.avg) * 100;
    if (fromEntryC <= -10) {
      return { action: "sell", why: `Unhedged stop — this leg is down ${Math.abs(fromEntryC).toFixed(1)}¢.` };
    }
    return {
      action: "hold",
      why: `Watching ${quote.symbol}. Fair ${(thisFair * 100).toFixed(0)}¢ vs book ${(last * 100).toFixed(0)}¢. ${tau > 0 ? `${Math.ceil(tau)}s left.` : "Settling."}`,
    };
  }

  if (!quote.live || !quote.openPx || !quote.spot) {
    return { action: "hold", why: "Waiting on spot vs Price-to-Beat." };
  }
  if (elapsed < 15) return { action: "hold", why: "First 15s of the round — book is noisy." };
  if (tau <= 0) return { action: "hold", why: "Window is closed — no new tickets." };
  if (tau < 15) {
    return { action: "hold", why: `Last ${Math.ceil(tau)}s — no new tickets. Open bags hold to settle.` };
  }
  if (pay < 0.08 || pay > 0.92) {
    return { action: "hold", why: `Ask already at ${Math.round(pay * 100)}¢ — no misprice left.` };
  }
  const width = (quote.ask || last) - (quote.bid || last);
  if (width > 0.06) {
    return { action: "hold", why: `Book is ${Math.round(width * 100)}¢ wide — wouldn't lift that live.` };
  }
  if (quote.ask && last && quote.ask - last > 0.08) {
    return { action: "hold", why: `Ask ${Math.round(quote.ask * 100)}¢ vs mid ${Math.round(last * 100)}¢ — print is stale.` };
  }
  const minEdge = other ? 0.04 : 0.06;
  if (edge < minEdge) {
    return {
      action: "hold",
      why: `No edge. Fair ${Math.round(thisFair * 100)}¢ vs ask ${Math.round(pay * 100)}¢ (${(edge * 100).toFixed(1)}¢). Needs +${Math.round(minEdge * 100)}¢.`,
    };
  }
  const spotDelta = ((quote.spot - quote.openPx) / quote.openPx) * 100;
  const hedge = other ? "Hedge: " : "";
  return {
    action: "buy",
    why: `${hedge}${quote.asset} ${quote.horizon} ${quote.leg?.toUpperCase()}: fair ${Math.round(thisFair * 100)}¢ vs ask ${Math.round(pay * 100)}¢ (edge +${(edge * 100).toFixed(1)}¢). Spot ${spotDelta >= 0 ? "+" : ""}${spotDelta.toFixed(3)}% vs open. ${Math.max(0, Math.ceil(tau))}s left of ${total / 60}m.`,
  };
}
