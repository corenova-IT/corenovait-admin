import { addDays, addMonths, daysBetween } from "./dates";

/**
 * Repeating events, worked out on calendar dates (the company's local days),
 * so a weekly 09:30 meeting stays at 09:30 through daylight-saving changes.
 *
 * - daily: every day from the first date
 * - weekly: the same weekday every week
 * - monthly: the same day of the month; on the 29th to 31st it falls on the
 *   last day in shorter months (31 Jan, 28 Feb, 31 Mar…)
 */
export type Recurrence = "none" | "daily" | "weekly" | "monthly";
export const RECURRENCE_LABEL: Record<Recurrence, string> = { none: "Doesn't repeat", daily: "Every day", weekly: "Every week", monthly: "Every month" };

/** The longest an event may last and still repeat at this rate (it can't overlap the next one). */
export const MAX_SPAN_DAYS: Record<Exclude<Recurrence, "none">, number> = { daily: 1, weekly: 7, monthly: 28 };

/**
 * Start dates of the occurrences that touch [from, to] (local dates,
 * inclusive), for an event lasting `spanDays` calendar days. Skips
 * `exceptions`; stops at `until` (the last date an occurrence may start).
 */
export function occurrenceDates(
  first: string,
  rule: Exclude<Recurrence, "none">,
  range: { from: string; to: string },
  opts: { until?: string | null; spanDays?: number; exceptions?: Iterable<string>; max?: number } = {}
): string[] {
  const span = Math.max(0, opts.spanDays ?? 0);
  const skip = new Set(opts.exceptions ?? []);
  const last = opts.until && opts.until < range.to ? opts.until : range.to;
  // an occurrence that started a few days before `from` can still be running on `from`
  const lower = addDays(range.from, -span);
  const out: string[] = [];
  const max = opts.max ?? 1000;
  if (last < first) return out;

  if (rule === "monthly") {
    // count whole months from the first date, then check each one (no drift: always from the first date)
    let n = Math.max(0, (Number(lower.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(lower.slice(5, 7)) - Number(first.slice(5, 7)) - 1);
    for (let i = 0; i < max + 2; i++, n++) {
      const d = addMonths(first, n);
      if (d > last) break;
      if (d >= lower && !skip.has(d)) out.push(d);
      if (out.length >= max) break;
    }
    return out;
  }

  const step = rule === "daily" ? 1 : 7;
  const gap = daysBetween(first, lower);
  let d = gap > 0 ? addDays(first, Math.ceil(gap / step) * step) : first;
  for (let i = 0; d <= last && out.length < max && i < 10_000; i++, d = addDays(d, step)) if (!skip.has(d)) out.push(d);
  return out;
}

/** iCalendar RRULE for a series (UNTIL in UTC for timed events, as a date for all-day ones). */
export function toRRule(rule: Exclude<Recurrence, "none">, untilUtc: string | null): string {
  return `RRULE:FREQ=${rule.toUpperCase()}${untilUtc ? `;UNTIL=${untilUtc}` : ""}`;
}
