export function money(n: number, digits = 2): string {
  const abs = Math.abs(n);
  const d = abs >= 1000 ? 2 : abs >= 1 ? digits : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

export function signedMoney(n: number, digits = 2): string {
  if (n > 0.0000005) return `+${money(n, digits)}`;
  return money(n, digits);
}

export function signedClass(n: number): "text-primary" | "text-down" | "text-muted" {
  if (n > 0.0000005) return "text-primary";
  if (n < -0.0000005) return "text-down";
  return "text-muted";
}

export function eventOdds(p: number): string {
  return `${(p * 100).toFixed(1)}¢`;
}

export function compactMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 10_000) return `${sign}$${(a / 1_000).toFixed(1)}k`;
  return money(n, 2);
}

export function pct(n: number, digits = 2): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function qtyFmt(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toPrecision(4);
}

export function day(ts: number | string): string {
  const d = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ago(ts: number): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function clock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function durationFmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

export function runWindow(startedAt: number, endedAt: number): string {
  if (!startedAt || !endedAt) return durationFmt(Math.max(0, endedAt - startedAt));
  const start = new Date(startedAt);
  const end = new Date(endedAt);
  const sameDay = start.toDateString() === end.toDateString();
  const t = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayBit = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const span = sameDay ? `${t(start)} – ${t(end)}` : `${dayBit} ${t(start)} – ${t(end)}`;
  return `${durationFmt(endedAt - startedAt)} · ${dayBit} · ${span}`;
}
