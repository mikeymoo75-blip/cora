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

/** Spot vs Price-to-Beat for a 5m/15m crypto round. */
export function PriceRace({
  spark,
  open,
  className,
}: {
  spark: number[];
  open: number;
  className?: string;
}) {
  const data = spark.filter((n) => n > 0);
  if (data.length < 2 || !(open > 0)) return <div className={cn("h-28", className)} />;
  const all = [...data, open];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.18 || open * 0.0005;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const w = 640;
  const h = 120;
  const last = data[data.length - 1]!;
  const leadingUp = last >= open;
  const yOpen = h - ((open - lo) / span) * h;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - lo) / span) * h;
    return { x, y };
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const area = `${d} L${w} ${h} L0 ${h} Z`;
  const tip = pts[pts.length - 1]!;
  const stroke = leadingUp ? "var(--color-primary)" : "var(--color-down)";
  const fill = leadingUp ? "var(--color-primary)" : "var(--color-down)";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-28 w-full overflow-visible", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="0"
        y1={yOpen}
        x2={w}
        y2={yOpen}
        stroke="var(--color-muted)"
        strokeWidth="1.4"
        strokeDasharray="6 6"
      />
      <path d={area} fill={fill} opacity="0.12" />
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="2.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={tip.x} cy={tip.y} r="5" fill={stroke} className="round-live-dot" />
    </svg>
  );
}
