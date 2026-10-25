import { describe, expect, it } from "vitest";
import {
  convertToBaseMinor,
  formatMinor,
  parseMoneyToMinor,
  percentChange,
  splitMinor,
  sumMinor,
} from "@/lib/money";

describe("parseMoneyToMinor", () => {
  it.each([
    ["1250", 125000n],
    ["1,250.5", 125050n],
    ["1250.05", 125005n],
    ["0.01", 1n],
    [" 48 650.24 ", 4865024n],
  ])("%s -> %s", (input, expected) => expect(parseMoneyToMinor(input)).toBe(expected));

  it.each(["", "abc", "-5", "1.234", "1e5", "12..3"])("rejects %j", (input) =>
    expect(() => parseMoneyToMinor(input)).toThrow()
  );
});

describe("convertToBaseMinor", () => {
  it("converts GBP to AUD with a manual rate", () => {
    expect(convertToBaseMinor(100_000n, "1.95")).toBe(195_000n);
  });
  it("rounds half away from zero like Postgres round(numeric)", () => {
    // 1 cent * 1.5 = 1.5 -> 2 ; 1 cent * 1.49999999 -> 1
    expect(convertToBaseMinor(1n, "1.5")).toBe(2n);
    expect(convertToBaseMinor(1n, "1.49999999")).toBe(1n);
  });
  it("never loses precision on large amounts", () => {
    expect(convertToBaseMinor(123_456_789_012n, "1.00000001")).toBe(123_456_790_247n);
  });
  it("rejects zero and malformed rates", () => {
    expect(() => convertToBaseMinor(100n, "0")).toThrow();
    expect(() => convertToBaseMinor(100n, "1.123456789")).toThrow();
  });
});

describe("totals and change", () => {
  it("sums exactly where floats would drift", () => {
    expect(sumMinor([10n, 20n, 30n])).toBe(60n);
    expect(sumMinor(Array(10).fill(10n))).toBe(100n); // 0.1 * 10 in cents
  });
  it("percentChange", () => {
    expect(percentChange(118_200n, 100_000n)).toBe(18.2);
    expect(percentChange(90n, 100n)).toBe(-10);
    expect(percentChange(5n, 0n)).toBeNull();
  });
});

describe("formatting", () => {
  it("formats with symbol and separators", () => {
    expect(formatMinor(69_400_000n, "AUD")).toBe("A$694,000.00");
    expect(formatMinor(4_865_024n, "GBP")).toBe("£48,650.24");
    expect(formatMinor(-1_500n, "AUD")).toBe("-A$15.00");
    expect(formatMinor(69_400_000n, "AUD", { cents: false })).toBe("A$694,000");
  });
  it("splits decimals for the lighter-grey display", () => {
    expect(splitMinor(8_465_824n, "AUD")).toEqual({ main: "A$84,658", decimals: ".24" });
  });
});
