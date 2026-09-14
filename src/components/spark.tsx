import { cn } from "@/lib/cn";

export function Spark({
  data,
  up,
  className,
}: {
  data: number[];
  up: boolean;
  className?: string;
}) {
  if (data.length < 2) return <div className={cn("h-8", className)} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 72;
  const h = 28;
  const d = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-7 w-16 overflow-visible", className)}
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke={up ? "var(--color-primary)" : "var(--color-down)"}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function TickDigit({ d }: { d: number }) {
  return (
    <span className="race-digit">
      <span className="race-strip" style={{ transform: `translateY(${-d * 10}%)` }}>
        {DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </span>
    </span>
  );
}

/** Rolling live price — the Polymarket "final price" tick, on paper. */
export function TickPrice({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  if (!(value > 0)) return <span className={className}>—</span>;
  const decimals = value >= 100 ? 2 : 4;
  const text = value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <span className={cn("inline-flex items-baseline font-mono tabular-nums tracking-tight", className)}>
      {text.split("").map((ch, i) =>
        ch >= "0" && ch <= "9" ? (
          <TickDigit key={`d${i}`} d={Number(ch)} />
        ) : (
          <span key={`s${i}`} className="race-punct">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

function downsample(data: number[], max = 240): number[] {
  if (data.length <= max) return data;
  const out: number[] = [];
  const step = (data.length - 1) / (max - 1);
  for (let i = 0; i < max - 1; i++) out.push(data[Math.round(i * step)]!);
  out.push(data[data.length - 1]!);
  return out;
}

/** Spot vs Price-to-Beat. The line only occupies elapsed time — empty right is what's left. */
export function PriceRace({
  spark,
  open,
  spot,
  windowStart,
  windowEnd,
  now,
  className,
}: {
  spark: number[];
  open: number;
  spot?: number;
  windowStart?: number;
  windowEnd?: number;
  now?: number;
  className?: string;
}) {
  const raw = spark.filter((n) => n > 0);
  if (spot && spot > 0) {
    if (raw.length) raw[raw.length - 1] = spot;
    else raw.push(spot);
  }
  const data = downsample(raw);
  if (data.length < 2 || !(open > 0)) return <div className={cn("h-44", className)} />;
  const all = [...data, open];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.22 || open * 0.0006;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const w = 640;
  const h = 168;
  const lookback = 60_000;
  const tOpen = windowStart || 0;
  const t0 = tOpen ? tOpen - lookback : 0;
  const t1 = windowEnd || 0;
  const tNow = now || Date.now();
  const chartMs = t1 > t0 ? t1 - t0 : 0;
  const elapsed = chartMs ? Math.max(0, Math.min(chartMs, tNow - t0)) : 1;
  const progress = chartMs ? elapsed / chartMs : 1;
  const openX = tOpen && chartMs ? ((tOpen - t0) / chartMs) * w : 0;
  const last = data[data.length - 1]!;
  const leadingUp = last >= open;
  const yOpen = h - ((open - lo) / span) * h;
  const n = data.length;
  const pts = data.map((v, i) => {
    const frac = n <= 1 ? progress : (i / (n - 1)) * progress;
    const x = frac * w;
    const y = h - ((v - lo) / span) * h;
    return { x, y };
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const tip = pts[pts.length - 1]!;
  const area = `${d} L${tip.x.toFixed(1)} ${yOpen.toFixed(1)} L0 ${yOpen.toFixed(1)} Z`;
  const lane = `M0 0 L${tip.x.toFixed(1)} 0 L${tip.x.toFixed(1)} ${h} L0 ${h} Z`;
  const stroke = leadingUp ? "var(--color-primary)" : "var(--color-down)";
  const fill = stroke;
  const yPct = (yOpen / h) * 100;
  const xPct = progress * 100;
  const marks = 4;
  const ticks = Array.from({ length: marks + 1 }, (_, i) => openX + ((w - openX) * i) / marks);
  return (
    <div className={cn("relative h-44 overflow-hidden", className)}>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full overflow-visible"
        preserveAspectRatio="none"
        aria-hidden
      >
        {ticks.map((x, i) => (
          <line
            key={i}
            x1={x}
            y1="0"
            x2={x}
            y2={h}
            stroke="var(--color-border)"
            strokeWidth="1"
          />
        ))}
        <rect
          x="0"
          y="0"
          width={openX}
          height={h}
          fill="var(--color-fg)"
          opacity="0.04"
        />
        <rect
          x={tip.x}
          y="0"
          width={Math.max(0, w - tip.x)}
          height={h}
          fill="var(--color-surface)"
          opacity="0.45"
        />
        <line
          x1="0"
          y1={yOpen}
          x2={w}
          y2={yOpen}
          stroke="var(--color-muted)"
          strokeWidth="1.8"
          strokeDasharray="8 6"
        />
        <line
          x1={openX}
          y1="0"
          x2={openX}
          y2={h}
          stroke="var(--color-fg)"
          strokeWidth="1.2"
          opacity="0.35"
        />
        <path d={lane} fill={fill} opacity="0.08" />
        <path d={area} fill={fill} opacity="0.28" />
        <path
          d={d}
          fill="none"
          stroke={stroke}
          strokeWidth="3.2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <line
          x1={tip.x}
          y1="0"
          x2={tip.x}
          y2={h}
          stroke="var(--color-fg)"
          strokeWidth="1.4"
          opacity="0.4"
        />
        <circle cx={tip.x} cy={tip.y} r="6.5" fill={stroke} className="round-live-dot" />
      </svg>
      <span
        className="pointer-events-none absolute left-2 font-mono text-xs font-semibold tracking-wide text-muted uppercase"
        style={{ top: `clamp(0.25rem, calc(${yPct}% - 0.7rem), calc(100% - 1.1rem))` }}
      >
        Beat
      </span>
      {xPct > 14 && (
        <span
          className="pointer-events-none absolute top-1 font-mono text-xs font-semibold tracking-wide text-muted uppercase"
          style={{ left: `clamp(2.4rem, calc(${xPct}% + 0.35rem), calc(100% - 2.4rem))` }}
        >
          Now
        </span>
      )}
    </div>
  );
}
