/**
 * Money is always integer minor units (cents / pence) in a bigint-safe range.
 * Floats never touch an amount: parsing, conversion and formatting all work on
 * integers and decimal strings.
 */

const MAX_MINOR = 9_000_000_000_000_000n; // well inside Postgres bigint

/** "1,234.56" -> 123456. Rejects more than 2 decimals, negatives and junk. */
export function parseMoneyToMinor(input: string): bigint {
  const cleaned = input.trim().replace(/[,\s]/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) throw new Error("Enter an amount like 1250 or 1250.50");
  const minor = BigInt(m[1]) * 100n + BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  if (minor > MAX_MINOR) throw new Error("That amount is too large");
  return minor;
}

/** A manual exchange rate as a scaled integer (8 decimal places, like the DB column). */
const RATE_SCALE = 100_000_000n;

export function parseRate(input: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(input.trim());
  if (!m) throw new Error("Enter a rate like 1.95 (up to 8 decimals)");
  const scaled = BigInt(m[1]) * RATE_SCALE + BigInt((m[2] ?? "").padEnd(8, "0") || "0");
  if (scaled <= 0n) throw new Error("The rate must be more than 0");
  return scaled;
}

/**
 * Convert to the base currency, rounding half away from zero exactly like
 * Postgres round(numeric), so the app and the DB generated column agree.
 */
export function convertToBaseMinor(amountMinor: bigint, rate: string): bigint {
  const scaled = parseRate(rate);
  const product = amountMinor * scaled;
  const q = product / RATE_SCALE;
  const r = product % RATE_SCALE;
  return r * 2n >= RATE_SCALE ? q + 1n : q;
}

export function sumMinor(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

/** Percentage change in basis-point precision, e.g. 18.2 for +18.2%. null if no prior value. */
export function percentChange(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  const bp = ((current - previous) * 10_000n) / (previous < 0n ? -previous : previous);
  return Number(bp) / 100;
}

/** Format minor units for display, e.g. 6940000n, "AUD" -> "A$69,400.00". */
export function formatMinor(minor: bigint, currency: string, opts: { cents?: boolean } = {}): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = abs / 100n;
  const cents = abs % 100n;
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const showCents = opts.cents ?? true;
  return `${negative ? "-" : ""}${symbol}${wholeStr}${showCents ? "." + cents.toString().padStart(2, "0") : ""}`;
}

/** Split for the "big number, lighter decimals" display. */
export function splitMinor(minor: bigint, currency: string): { main: string; decimals: string } {
  const full = formatMinor(minor, currency);
  const dot = full.lastIndexOf(".");
  return { main: full.slice(0, dot), decimals: full.slice(dot) };
}

const CURRENCY_SYMBOL: Record<string, string> = { AUD: "A$", GBP: "£", USD: "US$", EUR: "€", PKR: "Rs " };
