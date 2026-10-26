import { useId } from "react";

/**
 * Small trend line with the red glow from the designs. Carries a text label
 * for screen readers, so the trend is never conveyed by colour/shape alone.
 * `fluid` stretches it to the width of its box (for a sparkline on its own row).
 * `partialLast` draws the final point (a month still in progress) as a faint
 * dashed step, so its lower running total doesn't read as a drop.
 */
export function Sparkline({
  values,
  label,
  width = 96,
  height = 36,
  fluid = false,
  partialLast = false,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  fluid?: boolean;
  partialLast?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 4;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (width - pad * 2),
    pad + (1 - (v - min) / span) * (height - pad * 2),
  ]);
  // smooth cubic path through the points
  const curve = (from: number, to: number) => {
    let d = `M${pts[from][0]},${pts[from][1]}`;
    for (let i = from + 1; i <= to; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return d;
  };
  const split = partialLast && pts.length > 2;
  const d = curve(0, split ? pts.length - 2 : pts.length - 1);
  return (
    <svg
      width={fluid ? "100%" : width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? "none" : undefined}
      role="img"
      aria-label={label}
      className="block overflow-visible"
    >
      <defs>
        <filter id={`glow-${id}`} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <path d={d} fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="3" filter={`url(#glow-${id})`} vectorEffect="non-scaling-stroke" />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {split && <path d={curve(pts.length - 2, pts.length - 1)} fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.4" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
