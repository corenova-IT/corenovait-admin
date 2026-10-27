"use client";

import Link from "next/link";
import { useCallback, useOptimistic, useState, useTransition } from "react";
import { FormMessage } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import { addDays, daysBetween } from "@/lib/dates";
import { KIND_LABEL, KIND_STYLE, type CalendarItem, type CalendarKind } from "@/lib/work";
import { WEEKDAYS_SHORT } from "@/lib/zoned";
import { EventPanel, type CalAction, type EventLookups } from "./EventForms";

const PREFIX: Partial<Record<CalendarKind, string>> = { task: "Due", payment: "Pay", deadline: "Deadline" };

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { ...opts, timeZone: "UTC" });

function Chip({ item, onOpen, draggable, onDragStart, onDragEnd, roomy = false }: { item: CalendarItem; onOpen: (i: CalendarItem) => void; draggable: boolean; onDragStart: () => void; onDragEnd: () => void; roomy?: boolean }) {
  const lead = item.time ?? PREFIX[item.kind] ?? (item.event?.allDay ? "All day" : "");
  const body = (
    <>
      <span className="sr-only">{KIND_LABEL[item.kind]}: </span>
      {lead && <span className="mr-1 font-mono text-[11px] text-ink-2">{lead}</span>}
      <span className={cx("text-ink", item.overdue && "text-accent-text")}>{item.title}</span>
      {roomy && item.meta && <span className="block text-[11px] text-muted">{item.meta}</span>}
      {roomy && item.time && item.endTime && <span className="block font-mono text-[11px] text-muted">until {item.endTime}</span>}
    </>
  );
  const cls = cx("clamp-2 block w-full rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-snug hover:brightness-110", KIND_STYLE[item.kind], draggable && "cursor-grab");
  if (item.href) {
    return (
      <Link href={item.href} draggable={false} className={cls} title={`${KIND_LABEL[item.kind]}: ${item.title}${item.meta ? ` (${item.meta})` : ""}`}>
        {body}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/event-id", item.id);
        e.dataTransfer.effectAllowed = "move";
        // Chrome cancels a drag if the dragged element changes during dragstart, so restyle a frame later
        requestAnimationFrame(onDragStart);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(item)}
      title={`${KIND_LABEL[item.kind]}: ${item.title}${draggable ? " (drag to another day to move it)" : ""}`}
    >
      {body}
    </button>
  );
}

/**
 * Month, week and agenda views over the same items. Events you may change
 * can be dragged to another day (time and length are kept); the Edit form
 * does the same from the keyboard.
 */
export function CalendarView({
  view,
  days,
  month,
  today,
  items,
  lookups,
  canDelete,
  actions,
}: {
  view: "month" | "week" | "agenda";
  days: string[];
  month: string;
  today: string;
  items: CalendarItem[];
  lookups: EventLookups;
  canDelete: boolean;
  actions: { save: CalAction; move: CalAction; remove: CalAction };
}) {
  const [optimistic, shift] = useOptimistic(items, (list, m: { id: string; to: string }) =>
    list.map((i) => (i.event && i.id === m.id ? { ...i, date: m.to, endDate: addDays(m.to, daysBetween(i.date, i.endDate)) } : i))
  );
  const [open, setOpen] = useState<CalendarItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const close = useCallback(() => setOpen(null), []);

  const on = (d: string) =>
    optimistic
      .filter((i) => i.date <= d && i.endDate >= d)
      .sort((a, b) => Number(!!a.time) - Number(!!b.time) || (a.time ?? "").localeCompare(b.time ?? "") || a.title.localeCompare(b.title));

  const drop = (to: string, id: string) => {
    const item = optimistic.find((i) => i.event && i.id === id);
    if (!item || !item.editable || item.date === to) return;
    setError(null);
    startTransition(async () => {
      shift({ id, to });
      const fd = new FormData();
      fd.set("id", id);
      fd.set("date", to);
      const r = await actions.move({}, fd);
      if (r.error) setError(r.error);
    });
  };
  const dropProps = (d: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes("text/event-id")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(d);
    },
    onDragLeave: () => setOver((o) => (o === d ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      drop(d, e.dataTransfer.getData("text/event-id"));
    },
  });
  const chip = (i: CalendarItem, roomy = false) => (
    <Chip key={`${i.key}`} item={i} roomy={roomy} onOpen={setOpen} draggable={!!i.event && i.editable} onDragStart={() => setDragging(i.id)} onDragEnd={() => setDragging(null)} />
  );

  return (
    <div className="flex flex-col gap-3">
      {error && <FormMessage tone="error">{error}</FormMessage>}

      {view === "agenda" ? (
        (() => {
          const withItems = days.filter((d) => on(d).length > 0);
          return withItems.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nothing in the next {days.length} days.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {withItems.map((d) => (
                <li key={d} className="grid gap-3 py-4 first:pt-0 @min-[36rem]:grid-cols-[9rem_minmax(0,1fr)]">
                  <h3 className={cx("font-display text-[15px] font-bold", d === today ? "text-accent-text" : "text-ink")}>
                    {dayLabel(d, { weekday: "short", day: "numeric", month: "short" })}
                    {d === today && <span className="ml-2 font-mono text-xs font-normal">today</span>}
                  </h3>
                  <ul className="grid gap-2 @min-[48rem]:grid-cols-2">{on(d).map((i) => <li key={i.key}>{chip(i, true)}</li>)}</ul>
                </li>
              ))}
            </ol>
          );
        })()
      ) : (
        <div className="scroll-x -mx-1 px-1 pb-1">
          <div className={cx("grid min-w-[44rem] grid-cols-7 gap-px overflow-hidden rounded-[14px] border border-line bg-line")}>
            {WEEKDAYS_SHORT.map((w) => (
              <div key={w} className="bg-surface px-2 py-2 text-center">
                <span className="label-mono">{w}</span>
              </div>
            ))}
            {days.map((d) => {
              const list = on(d);
              const outside = view === "month" && d.slice(0, 7) !== month;
              return (
                <div
                  key={d}
                  {...dropProps(d)}
                  aria-label={dayLabel(d, { weekday: "long", day: "numeric", month: "long" })}
                  className={cx(
                    "flex min-w-0 flex-col gap-1 bg-surface p-1.5",
                    view === "month" ? "min-h-28" : "min-h-72",
                    outside && "bg-surface-2/60",
                    over === d && "outline-2 -outline-offset-2 outline-accent-line"
                  )}
                >
                  <span className={cx("self-start rounded-md px-1.5 font-mono text-xs", d === today ? "bg-accent text-on-accent" : outside ? "text-muted" : "text-ink-2")}>
                    {view === "week" ? dayLabel(d, { day: "numeric", month: "short" }) : Number(d.slice(8))}
                  </span>
                  {list.map((i) => chip(i, view === "week"))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open?.event && (
        <EventPanel event={open.event} editable={open.editable} canDelete={canDelete} lookups={lookups} save={actions.save} remove={actions.remove} onClose={close} />
      )}
    </div>
  );
}
