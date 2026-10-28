/**
 * Small fixed-window limiter for sign-in, links, 2FA, chat, uploads and exports.
 * Hostinger runs this app as one Node process, so in-memory state is enough.
 * Each account also locks for 15 minutes after 5 wrong passwords (in the database).
 */
type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now
  ) {}

  /** Records an attempt. Returns ok=false (with seconds to wait) once over the limit. */
  hit(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + this.windowMs };
      this.buckets.set(key, b);
    }
    b.count += 1;
    if (this.buckets.size > 10_000) this.sweep(t);
    if (b.count > this.max) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - t) / 1000) };
    return { ok: true };
  }

  reset(key: string) {
    this.buckets.delete(key);
  }

  private sweep(t: number) {
    for (const [k, b] of this.buckets) if (b.resetAt <= t) this.buckets.delete(k);
  }
}

const g = globalThis as unknown as { __cnLimiters?: Record<string, RateLimiter> };
g.__cnLimiters ??= {
  // 5 tries per email+IP and 20 per IP, per 15 minutes
  loginPerAccount: new RateLimiter(5, 15 * 60_000),
  loginPerIp: new RateLimiter(20, 15 * 60_000),
  resetPerIp: new RateLimiter(5, 15 * 60_000),
  mfaPerUser: new RateLimiter(6, 10 * 60_000),
  // the scheduler: a cron job calls it every few minutes; this leaves room for manual runs
  cron: new RateLimiter(6, 60_000),
  // invite and reset links: guessing a token is hopeless, but don't let anyone try for long
  linkPerIp: new RateLimiter(10, 15 * 60_000),
  // chat messages, file uploads (receipts, chat attachments, CSV imports) and downloads of whole lists
  chatPerUser: new RateLimiter(30, 60_000),
  uploadPerUser: new RateLimiter(30, 10 * 60_000),
  exportPerUser: new RateLimiter(20, 10 * 60_000),
};
export const limiters = g.__cnLimiters as Record<"loginPerAccount" | "loginPerIp" | "resetPerIp" | "mfaPerUser" | "cron" | "linkPerIp" | "chatPerUser" | "uploadPerUser" | "exportPerUser", RateLimiter>;

/** The message shown when a limit is reached. */
export const slowDown = (what: string, retryAfterSec: number) => `Too many ${what}. Try again in ${retryAfterSec < 90 ? `${retryAfterSec} seconds` : `${Math.ceil(retryAfterSec / 60)} minutes`}.`;
