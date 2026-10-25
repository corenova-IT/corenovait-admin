/**
 * Small fixed-window limiter for login, password-reset and 2FA attempts.
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
};
export const limiters = g.__cnLimiters;
