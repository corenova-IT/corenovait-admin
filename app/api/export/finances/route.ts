import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { countryFilter, exportFinanceCsv } from "@/lib/dal/analytics";
import { AccessDenied } from "@/lib/dal/guard";

/** Monthly revenue, outstanding, expenses and profit as CSV. Needs finances:export; audit-logged. */
export async function GET(request: Request) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const country = countryFilter.parse(new URL(request.url).searchParams.get("country") ?? undefined);
  try {
    const out = await exportFinanceCsv(s.actor, { country });
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
