import { describe, expect, it } from "vitest";
import { buildIcs, foldLine, icsText } from "@/lib/ics";

describe(".ics files", () => {
  it("escapes commas, semicolons, backslashes and line breaks", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });

  it("folds long lines at 75 bytes, continuing with a space", () => {
    const folded = foldLine(`SUMMARY:${"x".repeat(100)}`);
    const parts = folded.split("\r\n");
    expect(parts[0]).toHaveLength(75);
    expect(parts[1].startsWith(" ")).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(`SUMMARY:${"x".repeat(100)}`);
  });

  it("never splits a multi-byte character", () => {
    const folded = foldLine(`SUMMARY:${"é".repeat(60)}`);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"é".repeat(60)}`);
  });

  it("writes timed events in UTC and all-day events as dates, with a reminder", () => {
    const ics = buildIcs(
      [
        { id: "1", title: "Call", startsAt: new Date("2026-10-01T23:00:00Z"), endsAt: new Date("2026-10-02T00:00:00Z"), allDay: false, reminderMinutes: 10, videoUrl: "https://meet.example.test/x" },
        { id: "2", title: "Offsite", startsAt: new Date("2026-11-09T13:00:00Z"), endsAt: new Date("2026-11-11T13:00:00Z"), allDay: true, startDate: "2026-11-10", endDateExclusive: "2026-11-12" },
      ],
      { calendarName: "Test", now: new Date("2026-10-27T00:00:00Z") }
    );
    expect(ics).toContain("DTSTART:20261001T230000Z\r\nDTEND:20261002T000000Z");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261110\r\nDTEND;VALUE=DATE:20261112");
    expect(ics).toContain("TRIGGER:-PT10M");
    expect(ics).toContain("URL:https://meet.example.test/x");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
