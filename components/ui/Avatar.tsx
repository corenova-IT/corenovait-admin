import Image from "next/image";
import { cx } from "./cx";

export function initials(name: string, fallback = "?"): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A person's profile picture in a ring, or their initials (like "MU" in the
 * designs) when they haven't added one. Decorative: the name is always
 * written next to it.
 */
export function Avatar({ name, src, size = 40, ring = false, className }: { name: string; src?: string | null; size?: number; ring?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cx(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border bg-surface-2 font-mono text-[12px] font-medium text-ink",
        ring ? "border-accent-line shadow-[0_0_16px_-6px_var(--glow-strong)]" : "border-line",
        className
      )}
    >
      {src ? (
        // served by /api/avatars to signed-in people only, already a 512 px WebP, so not run through the image optimiser
        <Image src={src} alt="" width={size} height={size} unoptimized className="size-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  );
}
