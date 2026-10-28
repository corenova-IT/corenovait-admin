"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconMenu, IconX } from "@/components/icons";
import { Avatar } from "@/components/ui/Avatar";
import { cx } from "@/components/ui/cx";
import type { NavItem } from "@/lib/nav";
import { Logo } from "./Logo";
import { NavIcon } from "./NavIcon";
import { useBadges, type Badges } from "./badges";

function NavList({ items, onNavigate, badges: initial }: { items: NavItem[]; onNavigate?: () => void; badges: Badges }) {
  const pathname = usePathname();
  const chatUnread = useBadges(initial).chat;
  const groups: Array<{ key: NavItem["group"]; label: string }> = [
    { key: "workspace", label: "Workspace" },
    { key: "admin", label: "Admin" },
  ];
  return (
    <>
      {groups.map((g) => {
        const list = items.filter((i) => i.group === g.key);
        if (list.length === 0) return null;
        return (
          <div key={g.key} className="mb-6">
            <p className="label-mono mb-3 px-3 text-[11px]">{g.label}</p>
            <ul className="flex flex-col gap-1">
              {list.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-3 rounded-[14px] border px-3 py-2.5 text-[15px] transition-colors",
                        active
                          ? "nav-item-active font-semibold text-ink"
                          : "border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink"
                      )}
                    >
                      <span className={active ? "text-accent-text" : "text-muted"}>
                        <NavIcon name={item.icon} />
                      </span>
                      <span className="min-w-0 flex-1">{item.label}</span>
                      {item.href === "/chat" && chatUnread > 0 && (
                        <span className="grid min-w-6 place-items-center rounded-full bg-accent px-1.5 font-mono text-[11px] leading-5 text-on-accent">
                          {chatUnread > 99 ? "99+" : chatUnread}
                          <span className="sr-only"> unread</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </>
  );
}

/** Your name and picture; opens your profile. */
function UserCard({ name, role, avatar }: { name: string; role: string; avatar: string | null }) {
  return (
    <Link href="/account" className="glass flex items-center gap-3 rounded-[18px] p-3.5 hover:border-accent-line" aria-label={`Your profile: ${name}`}>
      <Avatar name={name} src={avatar} ring />
      <span className="min-w-0">
        <span className="clamp-2 block text-[15px] font-semibold leading-snug text-ink">{name}</span>
        <span className="clamp-2 block text-xs text-muted">{role}</span>
      </span>
    </Link>
  );
}

export function Sidebar({ items, userName, userRole, userAvatar, badges }: { items: NavItem[]; userName: string; userRole: string; userAvatar: string | null; badges: Badges }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      {/* desktop */}
      <aside className="sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col border-r border-line bg-sidebar px-5 py-6 lg:flex">
        <Link href="/home" className="mb-9 rounded-xl px-1">
          <Logo />
        </Link>
        <nav aria-label="Main" className="flex-1 overflow-y-auto">
          <NavList items={items} badges={badges} />
        </nav>
        <UserCard name={userName} role={userRole} avatar={userAvatar} />
      </aside>

      {/* phone and tablet */}
      <div className="flex items-center justify-between border-b border-line bg-sidebar px-4 py-3 lg:hidden">
        <Link href="/home" className="rounded-xl">
          <Logo />
        </Link>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="grid size-11 place-items-center rounded-xl border border-line text-ink"
        >
          <IconMenu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-[var(--scrim)]" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(300px,85vw)] flex-col border-r border-line bg-sidebar px-5 py-6">
            <div className="mb-8 flex items-center justify-between">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-10 place-items-center rounded-xl border border-line text-ink-2"
                autoFocus
              >
                <IconX />
              </button>
            </div>
            <nav aria-label="Main" className="flex-1 overflow-y-auto">
              <NavList items={items} badges={badges} onNavigate={() => setOpen(false)} />
            </nav>
            <UserCard name={userName} role={userRole} avatar={userAvatar} />
          </div>
        </div>
      )}
    </>
  );
}
