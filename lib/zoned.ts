/**
 * Clock times in the company time zone. The database stores UTC instants;
 * people type and read times in the company's zone (e.g. Australia/Sydney,
 * with daylight saving). Uses Intl only, so it works without MySQL's time
 * zone tables (which shared hosting often doesn't have).
 */

export type LocalParts = {
  /** "2026-10-27" */
  date: string;
  /** "2026-10" */
  month: string;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** 0–23 */
  hour: number;
  minute: number;
};

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date, weekday and time of a UTC instant in a time zone. */
export function localParts(instant: Date, timeZone: string): LocalParts {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, month: date.slice(0, 7), weekday: WEEKDAY_INDEX[p.weekday], hour: Number(p.hour) % 24, minute: Number(p.minute) };
}

/** Offset of the zone from UTC at an instant, in minutes (Sydney in summer = +660). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(instant).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * A wall-clock time in a zone ("2026-10-27T09:30" or "2026-10-27") as a UTC
 * instant. A time skipped by daylight saving moves forward to the first
 * valid time; a repeated one takes the first (earlier) occurrence.
 */
export function zonedToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) throw new Error(`Not a date and time: ${local}`);
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0)];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const wanted = `${m[1]}-${m[2]}-${m[3]} ${h}:${mi}`;
  // the zone's offset a day either side covers any daylight-saving change in between
  const before = wall - offsetMinutes(new Date(wall - 86_400_000), timeZone) * 60_000;
  const after = wall - offsetMinutes(new Date(wall + 86_400_000), timeZone) * 60_000;
  const valid = [before, after].filter((c) => localKey(new Date(c), timeZone) === wanted).sort((a, b) => a - b);
  // skipped by daylight saving (no valid candidate): the pre-change offset lands just after the gap
  return new Date(valid[0] ?? before);
}

const localKey = (d: Date, tz: string) => {
  const p = localParts(d, tz);
  return `${p.date} ${p.hour}:${p.minute}`;
};

/** "2026-10-27T09:30", the value a datetime-local input expects, for an instant in a zone. */
export function toLocalInput(instant: Date, timeZone: string): string {
  const p = localParts(instant, timeZone);
  return `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "27 Oct, 09:30" (with the year when it isn't the current one) in the zone. */
export function fmtLocalDateTime(instant: Date, timeZone: string, now = new Date()): string {
  const sameYear = localParts(instant, timeZone).date.slice(0, 4) === localParts(now, timeZone).date.slice(0, 4);
  return new Intl.DateTimeFormat("en-AU", {
    timeZone,
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(instant);
}

/** "09:00–10:00" for an hour of the day. */
export const hourRange = (h: number) => `${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00`;
