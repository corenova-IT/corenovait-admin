import Link from "next/link";
import { IconCalendar, IconMegaphone, IconPlus, IconReceipt, IconCard, IconTasks } from "@/components/icons";
import { TaskMeta } from "@/components/tasks/Board";
import type { TaskView } from "@/components/tasks/TaskForms";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import type { CalendarItem } from "@/lib/dal/calendar";
import { addDays } from "@/lib/dates";
import { KIND_LABEL } from "@/lib/work";

const dayWord = (d: string, today: string) =>
  d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : new Date(`${d}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Upcoming meetings and other events, soonest first. */
export function MeetingList({ items, today, showDay = true }: { items: CalendarItem[]; today: string; showDay?: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((i) => (
        <li key={i.key} className="flex min-h-14 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
          <span className="w-16 shrink-0 font-mono text-sm text-ink">
            {i.time ?? "All day"}
            {showDay && <span className="block text-[11px] text-muted">{dayWord(i.date, today)}</span>}
          </span>
          <span className="min-w-0 flex-1">
            <Link href={`/calendar?view=agenda&date=${i.date}`} className="clamp-2 font-medium leading-snug text-ink hover:underline">
              {i.title}
            </Link>
            <span className="block text-xs text-muted">
              {KIND_LABEL[i.kind]}
              {i.event?.attendees.length ? ` · ${i.event.attendees.length} invited` : ""}
            </span>
          </span>
          {i.event?.videoUrl && (
            <a href={i.event.videoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 text-sm text-accent-text hover:underline">
              Join
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Open tasks with their due date, priority and progress. */
export function TaskList({ tasks }: { tasks: TaskView[] }) {
  return (
    <ul className="flex flex-col divide-y divide-line">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link href={`/tasks?task=${t.id}`} className="flex min-h-14 flex-col justify-center gap-1.5 py-2.5 hover:opacity-90">
            <span className="clamp-2 font-medium leading-snug text-ink">{t.title}</span>
            <TaskMeta task={t} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** How each person is doing with the tasks due this week. */
export function ProgressList({ people }: { people: Array<{ userId: string; name: string; open: number; overdue: number; weekTotal: number; weekDone: number }> }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {people.map((p) => {
        const pct = p.weekTotal ? Math.round((p.weekDone / p.weekTotal) * 100) : null;
        return (
          <li key={p.userId}>
            <Link href={`/tasks?assignee=${p.userId}`} className="flex items-center gap-3 hover:opacity-90">
              <Avatar name={p.name} size={30} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="clamp-2 text-sm font-medium text-ink">{p.name}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-2">{pct === null ? `${p.open} open` : `${p.weekDone}/${p.weekTotal}`}</span>
                </span>
                <span className="mt-1.5 block h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                  <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${pct ?? 0}%` }} />
                </span>
              </span>
              {p.overdue > 0 && <Badge tone="red">{p.overdue} late</Badge>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export type QuickAction = { href: string; label: string; icon: "task" | "event" | "marketing" | "income" | "payment" };
const ICONS = { task: IconTasks, event: IconCalendar, marketing: IconMegaphone, income: IconReceipt, payment: IconCard };

/** Shortcuts to the forms this person is allowed to use; each opens the form straight away. */
export function QuickActions({ actions, className }: { actions: QuickAction[]; className?: string }) {
  return (
    <ul className={cx("flex flex-wrap gap-2.5", className)}>
      {actions.map((a) => {
        const Icon = ICONS[a.icon];
        return (
          <li key={a.href}>
            <Link href={a.href} className={buttonClass("secondary")}>
              <Icon size={17} />
              <IconPlus size={12} />
              {a.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
