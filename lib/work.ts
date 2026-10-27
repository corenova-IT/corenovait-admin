/** Task and calendar labels shared by the server and the browser (no database access here). */

export const TASK_STATUSES = ["todo", "in_progress", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = { todo: "To do", in_progress: "In progress", review: "Review", done: "Done" };

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: "Low", medium: "Medium", high: "High", urgent: "Urgent" };
export const PRIORITY_TONE: Record<TaskPriority, "neutral" | "amber" | "red"> = { low: "neutral", medium: "neutral", high: "amber", urgent: "red" };

export const EVENT_TYPES = ["meeting", "deadline", "payment", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABEL: Record<EventType, string> = { meeting: "Meeting", deadline: "Deadline", payment: "Payment", other: "Other" };

/** Reminder choices in minutes before the start (null = none). */
export const REMINDERS: Array<{ minutes: number | null; label: string }> = [
  { minutes: null, label: "No reminder" },
  { minutes: 0, label: "At the start" },
  { minutes: 10, label: "10 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
];

/**
 * What a calendar item is, for its colour and the word shown next to it (so
 * colour is never the only signal): events by their type, plus task deadlines
 * and payment due dates drawn from their own pages.
 */
export type CalendarKind = "meeting" | "deadline" | "task" | "payment" | "other";
export const KIND_LABEL: Record<CalendarKind, string> = { meeting: "Meeting", deadline: "Deadline", task: "Task due", payment: "Payment due", other: "Event" };

/** Labels are short lower-case tags; this keeps them tidy and unique. */
export function cleanLabels(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : (input ?? "").split(",");
  const out: string[] = [];
  for (const l of raw) {
    const v = l.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 8);
}

/** One item on the calendar (shared by the server and the browser). */
export type CalendarItem = {
  key: string;
  kind: CalendarKind;
  id: string;
  title: string;
  /** local dates (company time zone); `endDate` is the last day it covers */
  date: string;
  endDate: string;
  /** "09:30" for timed events, null for all-day items */
  time: string | null;
  endTime: string | null;
  editable: boolean;
  href?: string;
  meta?: string;
  overdue?: boolean;
  event?: EventDetail;
};
export type EventDetail = {
  id: string;
  title: string;
  type: EventType;
  allDay: boolean;
  startLocal: string;
  endLocal: string;
  location: string;
  videoUrl: string;
  description: string | null;
  reminderMinutes: number | null;
  attendees: Array<{ id: string; name: string }>;
  createdByName: string;
  mine: boolean;
};

/** Link to open a task's panel on the Tasks page, keeping the page's filters. */
export function taskHref(query: string, id: string): string {
  const p = new URLSearchParams(query);
  p.set("task", id);
  return `/tasks?${p.toString()}`;
}

/** Colour plus a word or time on every chip, so the kind never rests on colour alone. */
export const KIND_STYLE: Record<CalendarKind, string> = {
  meeting: "border-l-accent bg-accent-soft",
  deadline: "border-l-warning bg-warning-soft",
  task: "border-l-warning bg-warning-soft",
  payment: "border-l-success bg-success-soft",
  other: "border-l-muted bg-surface-2",
};
/** Solid swatches for the colour key. */
export const KIND_SWATCH: Record<CalendarKind, string> = { meeting: "bg-accent", deadline: "bg-warning", task: "bg-warning", payment: "bg-success", other: "bg-muted" };
