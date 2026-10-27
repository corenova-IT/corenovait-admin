"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Unread notification and chat counts for the top bar and sidebar. One
 * shared store: it refreshes from /api/me/badges every 30 seconds while the
 * tab is visible, and the chat page pushes fresher numbers into it.
 */
export type Badges = { notifications: number; chat: number };

let state: Badges = { notifications: 0, chat: 0 };
let seeded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setBadges(next: Partial<Badges>) {
  const merged = { ...state, ...next };
  if (merged.notifications === state.notifications && merged.chat === state.chat) return;
  state = merged;
  emit();
}

let timer: ReturnType<typeof setInterval> | null = null;
let users = 0;
async function refresh() {
  if (document.visibilityState !== "visible") return;
  try {
    const res = await fetch("/api/me/badges", { cache: "no-store" });
    if (res.ok) setBadges(await res.json());
  } catch {
    /* offline for a moment: keep the last numbers */
  }
}

/** The current counts; `initial` comes from the server render. */
export function useBadges(initial: Badges): Badges {
  if (!seeded) {
    state = initial;
    seeded = true;
  }
  useEffect(() => {
    users++;
    if (!timer) {
      timer = setInterval(refresh, 30_000);
      document.addEventListener("visibilitychange", refresh);
    }
    return () => {
      users--;
      if (users === 0 && timer) {
        clearInterval(timer);
        timer = null;
        document.removeEventListener("visibilitychange", refresh);
      }
    };
  }, []);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => initial
  );
}
