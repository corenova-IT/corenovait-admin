"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconBell, IconChevronDown, IconLock, IconLogout, IconSearch } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { NAV } from "@/lib/nav";
import type { Theme } from "@/lib/theme";
import { ThemeToggle } from "./ThemeToggle";
import { useBadges, type Badges } from "./badges";

function ProfileMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const item = "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-12 items-center gap-2 rounded-[14px] border border-line bg-surface pl-1.5 pr-3 text-ink-2 hover:border-accent-line"
      >
        <Avatar name={name} size={36} />
        <span className="sr-only">Account menu for {name}</span>
        <IconChevronDown size={16} />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-14 z-40 w-64 p-2">
          <div className="border-b border-line px-3 pb-3 pt-2">
            <p className="clamp-2 text-sm font-semibold text-ink">{name}</p>
            <p className="clamp-2 text-xs text-muted">{email}</p>
          </div>
          <div className="pt-2">
            <Link role="menuitem" href="/account" className={item} onClick={() => setOpen(false)}>
              <IconLock size={16} /> Security and two-factor
            </Link>
            <form action="/auth/signout" method="post">
              <button role="menuitem" type="submit" className={item}>
                <IconLogout size={16} /> Sign out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the window is at least 640px wide; the server assumes a wide screen. */
function useWide() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(min-width: 640px)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(min-width: 640px)").matches,
    () => true
  );
}

export function Topbar({ name, email, theme, badges: initial }: { name: string; email: string; theme: Theme; badges: Badges }) {
  const unread = useBadges(initial).notifications;
  const pathname = usePathname();
  // on a phone the long hint ("Search clients, invoices, tasks") would be cut off, so just "Search"
  const wide = useWide();
  const placeholder = (wide && NAV.find((n) => pathname.startsWith(n.href))?.search) || "Search";
  return (
    <div className="flex items-center gap-3">
      <form role="search" className="relative min-w-0 flex-1" action="#" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="global-search" className="sr-only">
          Search
        </label>
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">
          <IconSearch size={17} />
        </span>
        <input
          id="global-search"
          type="search"
          placeholder={placeholder}
          className="h-12 w-full rounded-[14px] border border-line bg-surface pl-11 pr-4 text-[15px] text-ink placeholder:text-muted focus-visible:border-accent-line"
        />
      </form>
      <ThemeToggle initial={theme} />
      <Link
        href="/notifications"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications, none unread"}
        className="relative grid size-12 shrink-0 place-items-center rounded-[14px] border border-line bg-surface text-ink-2 hover:border-accent-line hover:text-ink"
      >
        <IconBell />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute right-2 top-2 grid min-w-4 place-items-center rounded-full bg-accent px-1 font-mono text-[10px] leading-4 text-on-accent">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Link>
      <ProfileMenu name={name} email={email} />
    </div>
  );
}
