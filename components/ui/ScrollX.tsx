"use client";

import { useEffect, useRef } from "react";
import { cx } from "./cx";

/**
 * A box that scrolls sideways on narrow screens (wide tables, the calendar
 * grid, the board). While its content is wider than the box, it can be
 * focused with Tab and scrolled with the arrow keys; when everything fits it
 * is not an extra Tab stop.
 */
export function ScrollX({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const scrolls = el.scrollWidth > el.clientWidth + 1;
      if (scrolls) {
        el.tabIndex = 0;
        el.setAttribute("role", "region");
        el.setAttribute("aria-label", `${label} (scrolls sideways)`);
      } else {
        el.removeAttribute("tabindex");
        el.removeAttribute("role");
        el.removeAttribute("aria-label");
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [label]);
  return (
    <div ref={ref} className={cx("scroll-x", className)}>
      {children}
    </div>
  );
}
