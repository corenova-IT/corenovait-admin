import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { limiters, slowDown } from "@/lib/rate-limit";
import { AccessDenied } from "@/lib/dal/guard";
import { exportActivitiesCsv, marketingFilters } from "@/lib/dal/marketing";

/** The activity log as CSV, with the page's filters. Needs marketing:export; follows the scope; audit-logged. */
export async function GET(request: Request) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const rl = limiters.exportPerUser.hit(s.actor.userId);
  if (!rl.ok) return NextResponse.json({ error: slowDown("downloads", rl.retryAfterSec) }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const f = marketingFilters.parse(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const out = await exportActivitiesCsv(s.actor, f);
    return new NextResponse(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
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
