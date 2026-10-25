import { useId } from "react";

/**
 * Small trend line with the red glow from the designs. Carries a text label
 * for screen readers, so the trend is never conveyed by colour/shape alone.
 */
export function Sparkline({
  values,
  label,
  width = 96,
  height = 36,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
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
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <defs>
        <filter id={`glow-${id}`} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <path d={d} fill="none" stroke="var(--accent)" strokeOpacity="0.55" strokeWidth="3" filter={`url(#glow-${id})`} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
