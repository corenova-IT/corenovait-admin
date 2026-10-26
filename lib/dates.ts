/**
 * Calendar-date helpers on "YYYY-MM-DD" strings. No times, no time zones:
 * "today" is worked out once in the company's time zone and passed in.
 */
export type CycleName = "weekly" | "monthly" | "quarterly" | "yearly" | "once";

const toUtc = (d: string) => new Date(`${d}T00:00:00Z`);
const fromUtc = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in a time zone, e.g. todayIn("Australia/Sydney") -> "2026-10-26". */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return fromUtc(now);
  }
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

/** Months added on the calendar, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: string, months: number): string {
  const d = toUtc(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function nextCycleDate(date: string, cycle: CycleName): string | null {
  switch (cycle) {
    case "weekly":
      return addDays(date, 7);
    case "monthly":
      return addMonths(date, 1);
    case "quarterly":
      return addMonths(date, 3);
    case "yearly":
      return addMonths(date, 12);
    case "once":
      return null;
  }
}

/**
 * Every due date from `first` up to and including `until`. Monthly dates are
 * stepped from the original date (so 31 Jan -> 28 Feb -> 31 Mar, not 28 Mar).
 */
export function dueDatesUntil(first: string, cycle: CycleName, until: string, max = 60): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < max; i++) {
    const d =
      cycle === "weekly" ? addDays(first, 7 * i) : cycle === "monthly" ? addMonths(first, i) : cycle === "quarterly" ? addMonths(first, 3 * i) : cycle === "yearly" ? addMonths(first, 12 * i) : i === 0 ? first : null;
    if (!d || d > until) break;
    out.push(d);
  }
  return out;
}

/** "2026-10" style month keys between two dates, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let d = `${from.slice(0, 7)}-01`;
  while (d.slice(0, 7) <= to.slice(0, 7)) {
    out.push(d.slice(0, 7));
    d = addMonths(d, 1);
  }
  return out;
}
