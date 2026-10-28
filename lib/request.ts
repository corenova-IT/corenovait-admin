import "server-only";
import { headers } from "next/headers";
import { pickClientIp } from "./client-ip";

/** Best-effort client IP and user agent (Hostinger sits behind a proxy). Used for rate limits and the audit log. */
export async function requestContext(): Promise<{ ip: string; userAgent: string | null }> {
  const h = await headers();
  return { ip: pickClientIp(h.get("x-forwarded-for"), h.get("x-real-ip")), userAgent: h.get("user-agent") };
}

export async function clientIp(): Promise<string> {
  return (await requestContext()).ip;
}
