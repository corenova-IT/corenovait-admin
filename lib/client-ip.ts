/**
 * The client's IP behind Hostinger's proxy, for rate limits and the audit log.
 *
 * The proxy appends the address it saw to the right of X-Forwarded-For;
 * anything further left was sent by the client and can be made up. So the
 * address is taken TRUST_PROXY_HOPS entries from the right (default 1: one
 * proxy in front of the app). Taking the first entry would let anyone dodge
 * the per-IP login limits by sending a different fake address each time.
 */
export function pickClientIp(forwardedFor: string | null, realIp: string | null, hops = trustedHops()): string {
  const list = (forwardedFor ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = list.length ? list[Math.max(0, list.length - hops)] : realIp?.trim();
  return (ip || "unknown").slice(0, 45);
}

export function trustedHops(): number {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 1;
}
