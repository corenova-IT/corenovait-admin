/**
 * iCalendar (.ics, RFC 5545) for exporting events to Google Calendar,
 * Outlook or Apple Calendar. Pure functions, no database access.
 */

export type IcsEvent = {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  /** local calendar dates for all-day events: first day and the day after the last */
  startDate?: string;
  endDateExclusive?: string;
  location?: string;
  description?: string | null;
  videoUrl?: string;
  reminderMinutes?: number | null;
  updatedAt?: Date;
  /** a repeating event: an RRULE line and EXDATE lines for skipped occurrences */
  rrule?: string;
  exdates?: string[];
};

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const dateOnly = (iso: string) => iso.replace(/-/g, "");

/** Escapes text per RFC 5545: backslash, semicolon, comma and line breaks. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets continue on the next line, which starts with a space. */
export function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(events: IcsEvent[], opts: { calendarName: string; now?: Date }): string {
  const stamp = utc(opts.now ?? new Date());
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CoreNovaIT//Portal//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText(opts.calendarName)}`];
  for (const e of events) {
    const description = [e.description ?? "", e.videoUrl ? `Video link: ${e.videoUrl}` : ""].filter(Boolean).join("\n\n");
    lines.push("BEGIN:VEVENT", `UID:${e.id}@corenovait`, `DTSTAMP:${stamp}`);
    if (e.allDay && e.startDate && e.endDateExclusive) lines.push(`DTSTART;VALUE=DATE:${dateOnly(e.startDate)}`, `DTEND;VALUE=DATE:${dateOnly(e.endDateExclusive)}`);
    else lines.push(`DTSTART:${utc(e.startsAt)}`, `DTEND:${utc(e.endsAt)}`);
    if (e.rrule) lines.push(e.rrule, ...(e.exdates ?? []));
    lines.push(`SUMMARY:${icsText(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsText(e.location)}`);
    if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
    if (e.videoUrl) lines.push(`URL:${e.videoUrl}`);
    if (e.updatedAt) lines.push(`LAST-MODIFIED:${utc(e.updatedAt)}`);
    if (e.reminderMinutes != null) lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:-PT${e.reminderMinutes}M`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
