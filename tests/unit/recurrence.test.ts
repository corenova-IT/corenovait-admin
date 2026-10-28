import { describe, expect, it } from "vitest";
import { occurrenceDates } from "@/lib/recurrence";

describe("repeating events", () => {
  it("daily, from the first date, inside the range, up to the end date", () => {
    expect(occurrenceDates("2026-10-26", "daily", { from: "2026-10-28", to: "2026-11-02" }, { until: "2026-10-31" })).toEqual(["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  });

  it("weekly keeps the weekday, and skips the dates edited or deleted on their own", () => {
    expect(occurrenceDates("2026-10-05", "weekly", { from: "2026-10-01", to: "2026-11-01" }, { exceptions: ["2026-10-19"] })).toEqual(["2026-10-05", "2026-10-12", "2026-10-26"]);
    // a range far from the start jumps straight there
    expect(occurrenceDates("2020-01-06", "weekly", { from: "2026-10-26", to: "2026-11-01" })).toEqual(["2026-10-26"]);
  });

  it("monthly on the 31st falls on the last day of shorter months, without drifting", () => {
    expect(occurrenceDates("2026-01-31", "monthly", { from: "2026-01-01", to: "2026-05-31" })).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
  });

  it("includes an occurrence that started before the range but is still running", () => {
    // a two-day weekly event starting Sundays: on Monday the 26th, Sunday's is still on
    expect(occurrenceDates("2026-10-04", "weekly", { from: "2026-10-26", to: "2026-10-26" }, { spanDays: 1 })).toEqual(["2026-10-25"]);
  });

  it("nothing before the first date or after the end date", () => {
    expect(occurrenceDates("2026-12-01", "daily", { from: "2026-10-01", to: "2026-10-31" })).toEqual([]);
    expect(occurrenceDates("2026-01-01", "monthly", { from: "2026-10-01", to: "2026-12-31" }, { until: "2026-09-30" })).toEqual([]);
  });
});
