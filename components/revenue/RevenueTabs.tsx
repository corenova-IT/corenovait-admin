"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";

type TabKey = "streams" | "countries" | "representatives" | "projects" | "overview";

const TABS: ReadonlyArray<{ href: string; label: string; key: TabKey }> = [
  { href: "/streams", label: "Streams", key: "streams" },
  { href: "/streams/countries", label: "Countries", key: "countries" },
  { href: "/streams/representatives", label: "Representatives", key: "representatives" },
  { href: "/streams/projects", label: "Projects", key: "projects" },
  { href: "/streams/overview", label: "Owner overview", key: "overview" },
];

/** Pill tabs for the revenue views; only the ones the person can open are shown (Projects and Owner overview are the owner's). */
export function RevenueTabs({ visible }: { visible: TabKey[] }) {
  const pathname = usePathname();
  const active: TabKey = pathname.startsWith("/streams/countries")
    ? "countries"
    : pathname.startsWith("/streams/representatives")
      ? "representatives"
      : pathname.startsWith("/streams/projects")
        ? "projects"
        : pathname.startsWith("/streams/overview")
          ? "overview"
          : "streams";
  const tabs = TABS.filter((t) => visible.includes(t.key));
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Revenue views" className="mb-6 flex w-fit max-w-full flex-wrap items-center gap-1 rounded-[16px] border border-line bg-surface p-1">
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
