"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";

const TABS = [
  { href: "/streams", label: "Streams", key: "streams" },
  { href: "/streams/countries", label: "Countries", key: "countries" },
  { href: "/streams/representatives", label: "Representatives", key: "representatives" },
] as const;

/** Pill tabs for the three revenue views; only the ones the person can open are shown. */
export function RevenueTabs({ visible }: { visible: Array<"streams" | "countries" | "representatives"> }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/streams/countries") ? "countries" : pathname.startsWith("/streams/representatives") ? "representatives" : "streams";
  const tabs = TABS.filter((t) => visible.includes(t.key));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Revenue views" className="mb-6 flex w-fit items-center gap-1 rounded-[16px] border border-line bg-surface p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={active === t.key ? "page" : undefined}
          className={cx(
            "rounded-[12px] px-4 py-2 text-sm font-semibold transition-colors",
            active === t.key ? "btn-primary-glow bg-accent text-on-accent" : "text-ink-2 hover:text-ink"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
