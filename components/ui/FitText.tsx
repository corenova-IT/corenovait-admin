"use client";

import { useLayoutEffect, useRef } from "react";
import { cx } from "./cx";

/**
 * One line of text that shrinks to fit its box instead of being clipped, for
 * the big KPI figures. CSS already sizes the number to the card (container
 * query units); this is the safety net for unusually long values, and it
 * re-checks whenever the card changes width.
 */
export function FitText({ children, className, min = 0.6 }: { children: React.ReactNode; className?: string; min?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const i = inner.current;
    if (!b || !i) return;
    const fit = () => {
      i.style.fontSize = "";
      const ratio = b.clientWidth / i.scrollWidth;
      if (ratio < 1) i.style.fontSize = `${Math.max(min, ratio * 0.98)}em`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(b);
    return () => ro.disconnect();
  }, [children, min]);
  return (
    <span ref={box} className={cx("block min-w-0", className)}>
      <span ref={inner} className="inline-block whitespace-nowrap">
        {children}
      </span>
    </span>
  );
}
