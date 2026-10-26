import Link from "next/link";
import { Sparkline } from "@/components/charts/Sparkline";
import { FitText } from "@/components/ui/FitText";
import { Pill } from "@/components/ui/Pill";

/**
 * Clickable summary card for a revenue stream or a country. Fixed slots, top
 * to bottom: name + share, the big number, the sparkline on its own row, then
 * the figures in a grid. Every slot is always there (an empty figure reads
 * "None"), so the cards in a row have the same height and line up.
 */
export function SummaryCard({
  href,
  tag,
  name,
  sharePct,
  value,
  valueLabel,
  trend,
  trendLabel,
  stats,
  children,
}: {
  href: string;
  tag?: string;
  name: string;
  sharePct: number;
  value: string;
  valueLabel?: string;
  trend?: number[];
  trendLabel?: string;
  stats: Array<{ label: string; value: string; tone?: "warning" }>;
  children?: React.ReactNode;
}) {
  return (
    <Link href={href} className="glass glass-glow @container flex h-full min-w-0 flex-col gap-4 card-pad transition-colors hover:border-accent-line">
      <div className="flex items-start gap-3">
        {tag && <span className="mt-0.5 shrink-0 rounded-lg border border-line px-2 py-0.5 font-mono text-xs text-ink-2">{tag}</span>}
        <p className="title-card clamp-2 min-w-0 flex-1 font-bold text-ink">{name}</p>
        <Pill className="shrink-0">{sharePct}%</Pill>
      </div>
      <div>
        {valueLabel && <p className="label-mono mb-1.5">{valueLabel}</p>}
        <FitText className="kpi-number glow-text font-bold text-ink">{value}</FitText>
      </div>
      {trend && (
        <div className="h-10">
          <Sparkline values={trend} label={trendLabel ?? `${name}: revenue by month`} width={240} height={40} fluid partialLast />
        </div>
      )}
      {children}
      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 @[17rem]:grid-cols-3">
        {stats.map((st) => (
          <div key={st.label} className="min-w-0">
            <dt className="label-mono">{st.label}</dt>
            <dd className={`mt-1 whitespace-nowrap font-mono text-sm ${st.tone === "warning" ? "text-warning" : "text-ink"}`}>{st.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
