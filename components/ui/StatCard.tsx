import { Sparkline } from "@/components/charts/Sparkline";
import { cx } from "./cx";
import { FitText } from "./FitText";

/**
 * Stat card from the Overview design: mono label, big glowing number, a
 * coloured line of context and a sparkline. Every card in a row has the same
 * height and the same slots (number, note, detail, chart) whether or not each
 * is filled, so rows line up. The number sizes to the card and never clips.
 */
export function StatCard({
  label,
  value,
  note,
  noteTone = "neutral",
  detail,
  trend,
  trendLabel,
  valueTone = "ink",
  className,
}: {
  label: string;
  /** whole units for KPIs (no cents); decimals belong in tables and forms */
  value: string;
  note?: React.ReactNode;
  noteTone?: "neutral" | "green" | "amber" | "red";
  detail?: React.ReactNode;
  trend?: number[];
  trendLabel?: string;
  valueTone?: "ink" | "warning";
  className?: string;
}) {
  return (
    <article className={cx("glass glass-glow @container flex h-full min-w-0 flex-col card-pad", className)}>
      <p className="label-mono clamp-2">{label}</p>
      <FitText className={cx("kpi-number glow-text mt-3 font-bold", valueTone === "warning" ? "text-warning" : "text-ink")}>{value}</FitText>
      {/* the note sits right under the number on every card, so notes line up across a row */}
      <div className="pt-3">
        <p
          className={cx(
            "min-h-5 font-mono text-sm leading-5",
            noteTone === "green" && "text-success",
            noteTone === "amber" && "text-warning",
            noteTone === "red" && "text-accent-text",
            noteTone === "neutral" && "text-ink-2"
          )}
        >
          {note}
        </p>
        {detail && <p className="mt-1 text-[13px] leading-snug text-muted">{detail}</p>}
      </div>
      {trend && trend.length > 1 && (
        // the sparkline has its own full-width row, so it never squeezes or overlaps the text
        <div className="mt-auto shrink-0 pt-3">
          <Sparkline values={trend} label={trendLabel ?? `${label} trend`} width={200} height={36} fluid />
        </div>
      )}
    </article>
  );
}
