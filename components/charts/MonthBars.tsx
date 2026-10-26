import { fmtMonth } from "@/lib/format";
import { formatCompact, formatMoney } from "@/lib/money";

/**
 * Twelve monthly bars on one shared scale, drawn on the server as SVG. Every
 * bar has a <title> tooltip and the same numbers are in a screen-reader table.
 * The current month is highlighted with the red glow.
 */
export function MonthBars({ data, currency, label }: { data: Array<{ month: string; value: number }>; currency: string; label: string }) {
  const W = 720;
  const H = 220;
  const padL = 56;
  const padB = 28;
  const padT = 12;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const plotH = H - padB - padT;
  const slot = (W - padL) / data.length;
  const barW = Math.min(36, slot * 0.56);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={label}>
        <defs>
          <filter id="bar-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={padL - 10} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" fontFamily="var(--font-plex-mono)">
              {formatCompact(t, currency)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = padL + i * slot + (slot - barW) / 2;
          const last = i === data.length - 1;
          const h = Math.max(d.value > 0 ? 2 : 0, plotH - (y(d.value) - padT));
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={padT + plotH - h}
                width={barW}
                height={h}
                rx={6}
                fill={last ? "var(--accent)" : "var(--accent-soft-strong, rgba(214,56,56,0.35))"}
                filter={last ? "url(#bar-glow)" : undefined}
              >
                <title>{`${fmtMonth(d.month, true)}: ${formatMoney(d.value, currency)}`}</title>
              </rect>
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--muted)" fontFamily="var(--font-plex-mono)">
                {fmtMonth(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{fmtMonth(d.month, true)}</th>
              <td>{formatMoney(d.value, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceStep(raw: number): number {
  if (raw <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
