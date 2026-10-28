import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { limiters, slowDown } from "@/lib/rate-limit";
import { exportCalendarIcs } from "@/lib/dal/calendar";
import { AccessDenied } from "@/lib/dal/guard";

/** Every event in the caller's scope (30 days back to a year ahead) as .ics. Needs calendar:export; audit-logged. */
export async function GET() {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const rl = limiters.exportPerUser.hit(s.actor.userId);
  if (!rl.ok) return NextResponse.json({ error: slowDown("downloads", rl.retryAfterSec) }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  try {
    const out = await exportCalendarIcs(s.actor);
    return new NextResponse(out.ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AccessDenied) return NextResponse.json({ error: e.message }, { status: 403 });
    throw e;
  }
}
