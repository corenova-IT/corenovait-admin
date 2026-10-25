import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP for rate limiting (Hostinger sits behind a proxy). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip") || "unknown";
}
