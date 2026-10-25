"use client";

import { useState } from "react";
import { IconMoon, IconSun } from "@/components/icons";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

/** Remembers the choice in a cookie (so the server renders the right theme next time). */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
        setTheme(next);
      }}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="grid size-12 place-items-center rounded-[14px] border border-line bg-surface text-ink-2 hover:border-accent-line hover:text-ink"
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}
