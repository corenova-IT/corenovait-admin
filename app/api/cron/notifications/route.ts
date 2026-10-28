import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupOrphanedChatFiles } from "@/lib/dal/files";
import { runScheduler } from "@/lib/dal/notifications";
import { cronSecret } from "@/lib/env";
import { limiters } from "@/lib/rate-limit";

/**
 * The scheduler: creates "due soon", meeting and payment reminders, sends
 * notification emails, and cleans up chat attachments no message uses. A Hostinger cron job calls it every 5 minutes (see the
 * README). Needs `Authorization: Bearer <CRON_SECRET>`; rate-limited; safe to
 * call any number of times (every reminder has a unique key and each email
 * is claimed before it's sent). The secret is never logged.
 */
export const dynamic = "force-dynamic";

const digest = (s: string) => createHash("sha256").update(s).digest();

async function handle(request: Request) {
  const secret = cronSecret();
  if (!secret) return NextResponse.json({ error: "The scheduler isn't set up: add CRON_SECRET (32+ characters)." }, { status: 503 });
  const given = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1]?.trim() ?? "";
  // compare fixed-length digests, so the check takes the same time whatever was sent
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  const limit = limiters.cron.hit("scheduler");
  if (!limit.ok) return NextResponse.json({ error: "Too many runs. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  const started = Date.now();
  const result = await runScheduler();
  const filesRemoved = await cleanupOrphanedChatFiles();
  return NextResponse.json({ ok: true, ...result, filesRemoved, ms: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
}

export const POST = handle;
/** GET works too, for cron tools that can only fetch a URL (the header is still required). */
export const GET = handle;
