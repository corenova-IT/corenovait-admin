/** "2026-09-15" -> "15 Sep 2026". Calendar dates have no time zone, so format them as UTC. */
export function fmtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "2026-09" -> "Sep" (or "Sep 26" with the year). */
export function fmtMonth(yyyymm: string, withYear = false): string {
  const d = new Date(`${yyyymm}-01T00:00:00Z`);
  return d.toLocaleDateString("en-AU", { month: "short", ...(withYear ? { year: "2-digit" } : {}), timeZone: "UTC" });
}

/** Builds a link that keeps the current query, with some values changed or removed. */
export function hrefWith(path: string, current: Record<string, string | undefined>, changes: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) if (v !== undefined && v !== "") params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** "in 3 days", "today", "tomorrow", "2 days overdue". */
export function dueLabel(days: number): string {
  if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** Short date for one-line list metadata: "29 Oct", or "29 Oct 27" outside the current year. */
export function fmtShortDate(isoDate: string | null | undefined, now = new Date()): string {
  if (!isoDate) return "—";
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "2-digit" }), timeZone: "UTC" });
}
