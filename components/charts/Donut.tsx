import { formatCompact, formatMoney } from "@/lib/money";

/** Series colours from the design: red, white, pink, then greys. The legend always carries the name and number too. */
const COLOURS = ["var(--accent)", "var(--text)", "#f08a8a", "var(--muted)", "#5c6375", "var(--text-2)", "#b04545", "#3a3f4c"];

/**
 * "Revenue by source" donut: the total in the middle, and a legend with each
 * slice's amount and share in text.
 */
export function Donut({ items, currency, caption, centerLabel }: { items: Array<{ key: string; label: string; value: number }>; currency: string; caption: string; centerLabel: string }) {
  const total = items.reduce((a, i) => a + Math.max(0, i.value), 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const gap = items.filter((i) => i.value > 0).length > 1 ? 4 : 0;

  return (
    <figure className="m-0 flex flex-col items-center gap-6">
      <div className="relative">
        <svg viewBox="0 0 200 200" width={200} height={200} role="img" aria-label={`${caption}: total ${formatMoney(total, currency, { cents: false })}`}>
          <circle cx={100} cy={100} r={R} fill="none" stroke="var(--surface-2)" strokeWidth={26} />
          {total > 0 &&
            items.map((it, i) => {
              if (it.value <= 0) return null;
              const len = (it.value / total) * C;
              const dash = Math.max(0.5, len - gap);
              const el = (
                <circle
                  key={it.key}
                  cx={100}
                  cy={100}
                  r={R}
                  fill="none"
                  stroke={COLOURS[i % COLOURS.length]}
                  strokeWidth={26}
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 100 100)"
                >
                  <title>{`${it.label}: ${formatMoney(it.value, currency, { cents: false })}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <span className="num glow-text font-display text-[28px] font-extrabold text-ink">{formatCompact(total, currency)}</span>
          <span className="label-mono mt-1">{centerLabel}</span>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-3">
        {items.map((it, i) => (
          <li key={it.key} className="flex items-center justify-between gap-3 text-[15px]">
            <span className="flex min-w-0 items-center gap-3">
              <span className="size-3 shrink-0 rounded-[3px]" style={{ background: COLOURS[i % COLOURS.length] }} aria-hidden="true" />
              <span className="clamp-2 text-ink">{it.label}</span>
            </span>
            <span className="flex shrink-0 gap-4 font-mono text-sm">
              <span className="text-muted">{formatCompact(it.value, currency)}</span>
              <span className="w-10 text-right text-ink">{total ? Math.round((it.value / total) * 100) : 0}%</span>
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
