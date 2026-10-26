import Link from "next/link";
import { cx } from "./cx";

/**
 * Segmented pill switch, like the All / UK / AUS control in the Overview
 * design. Uses links so the choice lives in the URL (shareable, back-button safe).
 */
export function PillSwitch({
  label,
  options,
  value,
}: {
  label: string;
  options: Array<{ value: string; label: string; href: string }>;
  value: string;
}) {
  return (
    <nav aria-label={label} className="flex max-w-full flex-wrap items-center gap-1 rounded-[16px] border border-line bg-surface p-1">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Link
            key={o.value}
            href={o.href}
            aria-current={active ? "true" : undefined}
            className={cx(
              "whitespace-nowrap rounded-[12px] px-3.5 py-2 text-sm font-semibold transition-colors",
              active ? "btn-primary-glow bg-accent text-on-accent" : "text-ink-2 hover:text-ink"
            )}
          >
            {o.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Small rounded tag for monospace metadata, like "UK + AUS = 90%". */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center whitespace-nowrap rounded-lg border border-line px-2 py-1 font-mono text-xs text-ink-2", className)}>
      {children}
    </span>
  );
}
