export type LiveBook = {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  ts: number;
};

type ClobG = typeof globalThis & {
  __coraClob?: {
    ws?: WebSocket;
    books: Map<string, LiveBook>;
    want: Set<string>;
    sub: Set<string>;
    timer?: ReturnType<typeof setTimeout>;
    ping?: ReturnType<typeof setInterval>;
  };
};

function store() {
  const g = globalThis as ClobG;
  if (!g.__coraClob) g.__coraClob = { books: new Map(), want: new Set(), sub: new Set() };
  return g.__coraClob;
}

function bestFromLevels(
  bids: { price: number; size: number }[],
  asks: { price: number; size: number }[],
): Omit<LiveBook, "ts"> | null {
  const bid = bids.filter((r) => r.price > 0 && r.size > 0).sort((a, b) => b.price - a.price)[0];
  const ask = asks.filter((r) => r.price > 0 && r.size > 0).sort((a, b) => a.price - b.price)[0];
  if (!bid || !ask || !(ask.price > bid.price)) return null;
  return { bid: bid.price, ask: ask.price, bidSize: bid.size, askSize: ask.size };
}

function setBook(id: string, patch: Partial<LiveBook> & { bid?: number; ask?: number }) {
  if (!id) return;
  const s = store();
  const prev = s.books.get(id);
  const bid = patch.bid && patch.bid > 0 ? patch.bid : prev?.bid || 0;
  const ask = patch.ask && patch.ask > 0 ? patch.ask : prev?.ask || 0;
  if (!(bid > 0) || !(ask > bid)) return;
  s.books.set(id, {
    bid,
    ask,
    bidSize: patch.bidSize ?? prev?.bidSize ?? 0,
    askSize: patch.askSize ?? prev?.askSize ?? 0,
    ts: Date.now(),
  });
}

function ingest(raw: unknown) {
  const msg = raw as {
    event_type?: string;
    asset_id?: string;
    bids?: { price?: string; size?: string }[];
    asks?: { price?: string; size?: string }[];
    best_bid?: string;
    best_ask?: string;
    price_changes?: {
      asset_id?: string;
      best_bid?: string;
      best_ask?: string;
      size?: string;
      side?: string;
    }[];
  };
  const t = msg.event_type;
  if (t === "book" && msg.asset_id) {
    const top = bestFromLevels(
      (msg.bids || []).map((r) => ({ price: Number(r.price), size: Number(r.size) })),
      (msg.asks || []).map((r) => ({ price: Number(r.price), size: Number(r.size) })),
    );
    if (top) setBook(msg.asset_id, top);
    return;
  }
  if (t === "best_bid_ask" && msg.asset_id) {
    setBook(msg.asset_id, { bid: Number(msg.best_bid), ask: Number(msg.best_ask) });
    return;
  }
  if (t === "price_change") {
    for (const c of msg.price_changes || []) {
      if (!c.asset_id) continue;
      setBook(c.asset_id, { bid: Number(c.best_bid), ask: Number(c.best_ask) });
    }
  }
}

function sendSub(ws: WebSocket, ids: string[], op?: "subscribe" | "unsubscribe") {
  if (!ids.length) return;
  if (op) {
    ws.send(JSON.stringify({ assets_ids: ids, operation: op, custom_feature_enabled: true }));
    return;
  }
  ws.send(JSON.stringify({ type: "market", assets_ids: ids, custom_feature_enabled: true }));
}

function connect() {
  const s = store();
  if (s.ws && (s.ws.readyState === WebSocket.OPEN || s.ws.readyState === WebSocket.CONNECTING)) return;
  try {
    const ws = new WebSocket("wss://ws-subscriptions-clob.polymarket.com/ws/market");
    s.ws = ws;
    ws.addEventListener("open", () => {
      s.sub = new Set();
      const ids = [...s.want];
      if (ids.length) {
        sendSub(ws, ids);
        s.sub = new Set(ids);
      }
      if (s.ping) clearInterval(s.ping);
      s.ping = setInterval(() => {
        try {
          if (ws.readyState === WebSocket.OPEN) ws.send("PING");
        } catch {
          /* reconnect via close */
        }
      }, 10_000);
    });
    ws.addEventListener("message", (ev) => {
      const text = String(ev.data);
      if (text === "PONG" || text === "PING") return;
      try {
        ingest(JSON.parse(text));
      } catch {
        /* ignore */
      }
    });
    ws.addEventListener("close", () => {
      s.ws = undefined;
      if (s.ping) clearInterval(s.ping);
      if (s.timer) clearTimeout(s.timer);
      s.timer = setTimeout(connect, 1500);
    });
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        /* close handler reconnects */
      }
    });
  } catch {
    if (s.timer) clearTimeout(s.timer);
    s.timer = setTimeout(connect, 3000);
  }
}

export function ensureClobStream(tokenIds: string[]) {
  const s = store();
  const next = new Set(tokenIds.filter(Boolean));
  s.want = next;
  connect();
  const ws = s.ws;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const add = [...next].filter((id) => !s.sub.has(id));
  const drop = [...s.sub].filter((id) => !next.has(id));
  if (add.length) sendSub(ws, add, "subscribe");
  if (drop.length) sendSub(ws, drop, "unsubscribe");
  s.sub = next;
}

export function clobLive(tokenId: string, maxAgeMs = 4000): LiveBook | null {
  if (!tokenId) return null;
  const row = store().books.get(tokenId);
  if (!row || Date.now() - row.ts > maxAgeMs) return null;
  return row;
}
