"use client";

import { useEffect, useId, useRef } from "react";
import { IconX } from "@/components/icons";
import { cx } from "./cx";

/**
 * Modal and Drawer, both on the native <dialog> element: it traps focus,
 * closes on Escape, restores focus to the opener and hides the rest of the
 * page from screen readers.
 */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handle = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", handle);
    return () => el.removeEventListener("cancel", handle);
  }, [onClose]);
  return ref;
}

function Header({ id, title, description, onClose }: { id: string; title: string; description?: string; onClose: () => void }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 id={`${id}-title`} className="font-display text-2xl font-bold tracking-[-0.02em] text-ink [overflow-wrap:anywhere]">
          {title}
        </h2>
        {description && (
          <p id={`${id}-desc`} className="mt-1.5 text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="grid size-10 shrink-0 place-items-center rounded-xl border border-line text-ink-2 hover:border-accent-line hover:text-ink"
      >
        <IconX />
      </button>
    </div>
  );
}

const backdrop = "backdrop:bg-[var(--scrim)] backdrop:backdrop-blur-[3px]";

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useDialog(open, onClose);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx("glass m-auto w-[min(520px,calc(100vw-2rem))] p-7 text-left font-normal text-ink", backdrop, className)}
    >
      {open && (
        <>
          <Header id={id} title={title} description={description} onClose={onClose} />
          {children}
        </>
      )}
    </dialog>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useDialog(open, onClose);
  const id = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "glass fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full overflow-y-auto rounded-none rounded-l-[20px] p-6 text-left font-normal text-ink sm:p-8",
        wide ? "max-w-[900px]" : "max-w-[520px]",
        backdrop
      )}
    >
      {open && (
        <>
          <Header id={id} title={title} description={description} onClose={onClose} />
          {children}
        </>
      )}
    </dialog>
  );
}
