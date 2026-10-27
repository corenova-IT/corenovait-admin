import { describe, expect, it } from "vitest";
import { localParts, toLocalInput, zonedToUtc } from "@/lib/zoned";

const SYD = "Australia/Sydney";

describe("company time zone (Australia/Sydney, with daylight saving)", () => {
  it("reads a UTC instant as the local weekday and hour in summer (+11)", () => {
    // Tue 6 Jan 2026 23:30 UTC = Wed 7 Jan 10:30 in Sydney
    expect(localParts(new Date("2026-01-06T23:30:00Z"), SYD)).toEqual({ date: "2026-01-07", month: "2026-01", weekday: 2, hour: 10, minute: 30 });
  });

  it("and in winter (+10)", () => {
    // Tue 7 Jul 2026 00:30 UTC = Tue 7 Jul 10:30 in Sydney
    expect(localParts(new Date("2026-07-07T00:30:00Z"), SYD)).toMatchObject({ date: "2026-07-07", weekday: 1, hour: 10 });
  });

  it("puts an instant in the right local month across midnight", () => {
    // 30 Sep 2026 15:00 UTC is already 1 Oct in Sydney
    expect(localParts(new Date("2026-09-30T15:00:00Z"), SYD).month).toBe("2026-10");
  });

  it("turns a typed local time into UTC, both sides of a daylight-saving change", () => {
    expect(zonedToUtc("2026-01-07T10:30", SYD).toISOString()).toBe("2026-01-06T23:30:00.000Z");
    expect(zonedToUtc("2026-07-07T10:30", SYD).toISOString()).toBe("2026-07-07T00:30:00.000Z");
    expect(zonedToUtc("2026-10-01", SYD).toISOString()).toBe("2026-09-30T14:00:00.000Z");
  });

  it("moves a time skipped by the clocks going forward to just after the gap", () => {
    // clocks go 02:00 -> 03:00 on Sun 4 Oct 2026; 02:30 doesn't exist and becomes 03:30
    const t = zonedToUtc("2026-10-04T02:30", SYD);
    expect(localParts(t, SYD)).toMatchObject({ date: "2026-10-04", hour: 3, minute: 30 });
  });

  it("takes the first of a repeated time when the clocks go back", () => {
    // clocks go 03:00 -> 02:00 on Sun 5 Apr 2026; 02:30 happens twice (+11 first, then +10)
    expect(zonedToUtc("2026-04-05T02:30", SYD).toISOString()).toBe("2026-04-04T15:30:00.000Z");
  });

  it("round-trips through the form value", () => {
    for (const s of ["2026-03-15T08:05", "2026-06-30T23:59", "2025-12-31T00:00"]) expect(toLocalInput(zonedToUtc(s, SYD), SYD)).toBe(s);
  });

  it("works for other zones too", () => {
    expect(zonedToUtc("2026-07-01T09:00", "Europe/London").toISOString()).toBe("2026-07-01T08:00:00.000Z");
    expect(localParts(new Date("2026-01-15T09:00:00Z"), "UTC")).toMatchObject({ hour: 9, weekday: 3 });
  });

  it("rejects text that isn't a date", () => {
    expect(() => zonedToUtc("next tuesday", SYD)).toThrow();
  });
});
