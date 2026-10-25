import { cx } from "./cx";

export function initials(name: string, fallback = "?"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Initials in a ring, like "MU" in the designs. */
export function Avatar({ name, size = 40, ring = false, className }: { name: string; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        "grid shrink-0 place-items-center rounded-full border bg-surface-2 font-mono text-[12px] font-medium text-ink",
        ring ? "border-accent-line shadow-[0_0_16px_-6px_var(--glow-strong)]" : "border-line",
        className
      )}
    >
      {initials(name)}
    </span>
  );
}
