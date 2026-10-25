import { cx } from "./cx";

export type BadgeTone = "neutral" | "red" | "green" | "amber";

const tones: Record<BadgeTone, string> = {
  neutral: "border-line text-ink-2 bg-surface-2",
  red: "border-accent-line text-accent-text bg-accent-soft",
  green: "border-success/40 text-success bg-success-soft",
  amber: "border-warning/45 text-warning bg-warning-soft",
};

/** Small status pill. Always carries text, so colour is never the only signal. */
export function Badge({ tone = "neutral", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11.5px] tracking-[0.04em]",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** The amber "SAMPLE DATA" marker from the designs. */
export function SampleDataBadge() {
  return (
    <Badge tone="amber" className="px-3 py-1 uppercase tracking-[0.16em]">
      Sample data
    </Badge>
  );
}

/** Change badge, e.g. +18.2% in green, -4.1% in red. */
export function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="font-mono text-sm text-muted">no prior data</span>;
  const up = value >= 0;
  return (
    <span className={cx("font-mono text-sm", up ? "text-success" : "text-accent-text")}>
      {up ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}
