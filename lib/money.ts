/**
 * Money is always integer minor units (cents / pence) in a bigint-safe range.
 * Floats never touch an amount: parsing, conversion and formatting all work on
 * integers and decimal strings.
 */

// below Number.MAX_SAFE_INTEGER, so amounts survive JSON and MySQL BIGINT round trips
const MAX_MINOR = 9_000_000_000_000_000n / 1000n;

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
 * MySQL ROUND() on DECIMAL, so the app and the generated column agree.
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
  const showCents = opts.cents ?? true;
  // without cents, round to the nearest whole unit (half away from zero) rather than cutting off
  const whole = showCents ? abs / 100n : (abs + 50n) / 100n;
  const cents = abs % 100n;
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${symbol}${wholeStr}${showCents ? "." + cents.toString().padStart(2, "0") : ""}`;
}

/** Split for the "big number, lighter decimals" display. */
export function splitMinor(minor: bigint, currency: string): { main: string; decimals: string } {
  const full = formatMinor(minor, currency);
  const dot = full.lastIndexOf(".");
  return { main: full.slice(0, dot), decimals: full.slice(dot) };
}

const CURRENCY_SYMBOL: Record<string, string> = { AUD: "A$", GBP: "£", USD: "US$", EUR: "€", PKR: "Rs " };

/** Display helper for the integer minor units the database returns (null shows a dash). */
export function formatMoney(minor: number | bigint | null | undefined, currency: string, opts: { cents?: boolean } = {}): string {
  if (minor === null || minor === undefined) return "—";
  return formatMinor(BigInt(minor), currency, opts);
}

/** "0.1250" -> "12.5%" */
export function formatRatePercent(rate: string | null | undefined): string {
  if (!rate) return "—";
  const m = /^(\d+)\.(\d{4})$/.exec(rate);
  if (!m) return rate;
  const hundredths = Number(m[1]) * 10_000 + Number(m[2]);
  return `${(hundredths / 100).toString()}%`;
}

/** Minor units as an editable decimal string for form inputs ("125050" -> "1250.50"). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const v = BigInt(minor);
  return `${v / 100n}.${(v % 100n).toString().padStart(2, "0")}`;
}

/** Stored rate "1.95000000" -> "1.95" for form inputs. */
export function rateToInput(rate: string | null | undefined): string {
  if (!rate) return "1";
  return rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate;
}

/** Short labels for charts: 8_400_000 cents AUD -> "A$84k", 125_000_000 -> "A$1.25m". */
export function formatCompact(minor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  const whole = Math.round(minor / 100);
  const abs = Math.abs(whole);
  const sign = whole < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}m`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(abs >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `${sign}${symbol}${abs}`;
}
