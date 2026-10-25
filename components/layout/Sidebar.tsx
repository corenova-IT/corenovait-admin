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

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
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
                      {item.label}
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

function UserCard({ name, role }: { name: string; role: string }) {
  return (
    <div className="glass flex items-center gap-3 rounded-[18px] p-3.5">
      <Avatar name={name} ring />
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-ink">{name}</p>
        <p className="truncate text-xs text-muted">{role}</p>
      </div>
    </div>
  );
}

export function Sidebar({ items, userName, userRole }: { items: NavItem[]; userName: string; userRole: string }) {
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
          <NavList items={items} />
        </nav>
        <UserCard name={userName} role={userRole} />
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
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </nav>
            <UserCard name={userName} role={userRole} />
          </div>
        </div>
      )}
    </>
  );
}
