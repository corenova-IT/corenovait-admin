import { describe, expect, it } from "vitest";
import { dueLabel, fmtDate, fmtShortDate } from "@/lib/format";

describe("date labels for lists", () => {
  const now = new Date("2026-10-26T03:00:00Z");

  it("drops the year inside the current year, so list metadata fits on one line", () => {
    expect(fmtShortDate("2026-10-29", now)).toBe("29 Oct");
  });

  it("keeps a two-digit year outside the current year", () => {
    expect(fmtShortDate("2027-01-03", now)).toBe("3 Jan 27");
  });

  it("handles missing and invalid dates", () => {
    expect(fmtShortDate(null, now)).toBe("—");
    expect(fmtShortDate("not a date", now)).toBe("not a date");
  });

  it("formats full dates as calendar days, not shifted by time zone", () => {
    expect(fmtDate("2026-09-15")).toMatch(/^15 Sept? 2026$/); // en-AU spells it "Sept" in newer ICU data
  });

  it("describes due dates in words", () => {
    expect(dueLabel(-2)).toBe("2 days overdue");
    expect(dueLabel(0)).toBe("today");
    expect(dueLabel(1)).toBe("tomorrow");
    expect(dueLabel(12)).toBe("in 12 days");
  });
});
