import Link from "next/link";
import { formatMoney } from "@/lib/money";

/**
 * Labelled horizontal bars, like "Revenue by country" in the Overview design:
 * name, amount and share in text, with a bar for the eye.
 */
export function BarList({
  items,
  currency,
  total,
}: {
  items: Array<{ key: string; label: string; tag?: string; value: number; href?: string; note?: string }>;
  currency: string;
  total?: number;
}) {
  const sum = total ?? items.reduce((a, i) => a + i.value, 0);
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="text-sm text-muted">Nothing recorded for this period.</p>;
  return (
    <ul className="flex flex-col gap-5">
      {items.map((i) => {
        const pct = sum ? Math.round((i.value / sum) * 100) : 0;
        const name = (
          <span className="flex min-w-0 items-center gap-3">
            {i.tag && <span className="rounded-lg border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2">{i.tag}</span>}
            <span className="clamp-2 font-medium text-ink">{i.label}</span>
          </span>
        );
        return (
          <li key={i.key}>
            <div className="mb-2 flex items-center justify-between gap-4">
              {i.href ? (
                <Link href={i.href} className="min-w-0 rounded hover:underline">
                  {name}
                </Link>
              ) : (
                name
              )}
              <span className="flex shrink-0 items-baseline gap-4 font-mono text-sm">
                <span className="text-ink-2">{formatMoney(i.value, currency, { cents: false })}</span>
                <span className="w-10 text-right text-ink">{pct}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-2" aria-hidden="true">
              <div className="h-2 rounded-full bg-accent shadow-[0_0_14px_rgba(214,56,56,0.45)]" style={{ width: `${Math.max(i.value > 0 ? 2 : 0, (i.value / max) * 100)}%` }} />
            </div>
            {i.note && <p className="mt-1.5 font-mono text-xs text-muted">{i.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
