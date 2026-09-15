import { UPDOWN_ASSETS, type UpDownAsset } from "./updown";

type Tick = { t: number; px: number };

type TwapG = typeof globalThis & {
  __coraTwap?: {
    ws?: WebSocket;
    tapes: Map<string, Tick[]>;
    timer?: ReturnType<typeof setTimeout>;
  };
};

function store(): NonNullable<TwapG["__coraTwap"]> {
  const g = globalThis as TwapG;
  if (!g.__coraTwap) g.__coraTwap = { tapes: new Map() };
  return g.__coraTwap;
}

function key(asset: string, lookback: number) {
  return `${asset.toUpperCase()}-${lookback}`;
}

function assetFromSymbol(sym: string): UpDownAsset | null {
  const a = (sym.split("/")[0] || "").toUpperCase();
  return UPDOWN_ASSETS.some((x) => x.asset === a) ? (a as UpDownAsset) : null;
}

function pushTick(asset: string, lookback: number, t: number, px: number) {
  if (!(px > 0) || !(t > 0)) return;
  const k = key(asset, lookback);
  const s = store();
  const prev = s.tapes.get(k) || [];
  if (prev.length && prev[prev.length - 1]!.t === t) {
    prev[prev.length - 1] = { t, px };
  } else {
    prev.push({ t, px });
  }
  const cut = Date.now() - 25 * 60 * 1000;
  s.tapes.set(
    k,
    prev.filter((x) => x.t >= cut).slice(-800),
  );
}

function tape(asset: string, lookback: number): Tick[] {
  return store().tapes.get(key(asset, lookback)) || [];
}

function connect() {
  const s = store();
  if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) return;
  try {
    const ws = new WebSocket("wss://ws-live-data.polymarket.com");
    s.ws = ws;
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          action: "subscribe",
          subscriptions: [
            { topic: "crypto_prices_twap_sixty", type: "update" },
            { topic: "crypto_prices_twap_thirty", type: "update" },
          ],
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      let msg: {
        payload?: { symbol?: string; value?: number | string; timestamp?: number; window_s?: number };
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const p = msg.payload;
      if (!p) return;
      const asset = assetFromSymbol(p.symbol || "");
      if (!asset) return;
      const px = Number(p.value);
      const lookback = p.window_s === 30 ? 30 : 60;
      pushTick(asset, lookback, Number(p.timestamp) || Date.now(), px);
    });
    ws.addEventListener("close", () => {
      s.ws = undefined;
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(connect, 3000);
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* reconnect via close */
      }
    });
  } catch {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(connect, 5000);
  }
}

/** Polymarket RTDS Chainlink TWAP — same index the 5m/15m markets resolve on. */
export function ensureTwapStream() {
  connect();
}

export function twapNow(asset: string, lookback = 60): number {
  const arr = tape(asset, lookback);
  return arr[arr.length - 1]?.px || 0;
}

/** Opening TWAP at window start. Empty if we didn't see the print — do not substitute Binance. */
export function twapOpen(asset: string, windowStart: number, lookback = 60): number {
  const arr = tape(asset, lookback);
  if (!arr.length) return 0;
  const hit = arr.find((x) => x.t >= windowStart && x.t <= windowStart + 8000);
  if (hit) return hit.px;
  let before: Tick | undefined;
  for (const x of arr) {
    if (x.t <= windowStart && windowStart - x.t <= 2500) before = x;
  }
  return before?.px || 0;
}

export function twapCloses(asset: string, windowStart: number, lookback = 60): number[] {
  const arr = tape(asset, lookback);
  const out: number[] = [];
  for (const x of arr) {
    if (x.t < windowStart - 60_000) continue;
    if (!out.length || out[out.length - 1] !== x.px) out.push(x.px);
  }
  return out;
}
