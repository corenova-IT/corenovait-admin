import { Sparkline } from "@/components/charts/Sparkline";
import { cx } from "./cx";

/**
 * Stat card from the Overview design: mono label, big glowing number,
 * a coloured line of context, and a sparkline bottom-right.
 */
export function StatCard({
  label,
  value,
  decimals,
  note,
  noteTone = "neutral",
  detail,
  trend,
  trendLabel,
}: {
  label: string;
  value: string;
  /** shown in a lighter grey after the main number, e.g. ".24" */
  decimals?: string;
  note?: React.ReactNode;
  noteTone?: "neutral" | "green" | "amber" | "red";
  detail?: React.ReactNode;
  trend?: number[];
  trendLabel?: string;
}) {
  return (
    <article className="glass glass-glow flex min-h-[188px] flex-col justify-between p-6">
      <div>
        <p className="label-mono">{label}</p>
        <p className="num glow-text mt-4 text-[34px] font-bold leading-none text-ink sm:text-[36px]">
          {value}
          {decimals && <span className="text-muted">{decimals}</span>}
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-[6.5rem] flex-1">
          {note && (
            <p
              className={cx(
                "font-mono text-sm",
                noteTone === "green" && "text-success",
                noteTone === "amber" && "text-warning",
                noteTone === "red" && "text-accent-text",
                noteTone === "neutral" && "text-ink-2"
              )}
            >
              {note}
            </p>
          )}
          {detail && <p className="mt-0.5 text-sm leading-snug text-muted">{detail}</p>}
        </div>
        {trend && <Sparkline values={trend} label={trendLabel ?? `${label} trend`} />}
      </div>
    </article>
  );
}
