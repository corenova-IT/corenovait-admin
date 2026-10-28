import Image from "next/image";
import { cx } from "@/components/ui/cx";

/**
 * The CoreNovaIT atom and wordmark. Both versions of the atom are in the page
 * and CSS shows the one for the active theme (dark lines on light, light
 * lines on dark), so switching theme never flashes the wrong one.
 * The artwork is 768 × 774, nearly square: it's drawn in a square box with
 * object-contain, so it's never stretched or cut off.
 */
export function Logo({ compact = false, size = 40 }: { compact?: boolean; size?: number }) {
  const img = "logo-mark size-full object-contain";
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <Image src="/brand/corenova-logo.png" alt="CoreNovaIT" width={size} height={size} loading="eager" className={cx(img, "logo-for-light")} />
        <Image src="/brand/corenova-logo-light-lines.png" alt="CoreNovaIT" width={size} height={size} loading="eager" className={cx(img, "logo-for-dark")} />
      </span>
      {!compact && (
        <span aria-hidden="true" className="whitespace-nowrap font-display text-[20px] font-bold tracking-[-0.02em] text-ink">
          CoreNova<span className="text-accent-text">IT</span>
        </span>
      )}
    </span>
  );
}
