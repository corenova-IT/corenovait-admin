import "server-only";
import { headers } from "next/headers";

/** Best-effort client IP and user agent (Hostinger sits behind a proxy). Used for rate limits and the audit log. */
export async function requestContext(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ip: (fwd || h.get("x-real-ip") || "unknown").slice(0, 45), userAgent: h.get("user-agent") };
}

export async function clientIp(): Promise<string> {
  return (await requestContext()).ip;
}
