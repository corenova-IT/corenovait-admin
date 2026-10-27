import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionState } from "@/lib/auth/session";
import { eventIcs } from "@/lib/dal/calendar";
import { AccessDenied } from "@/lib/dal/guard";

/** One event the caller can see, to add to their own calendar app. 404 when it doesn't exist or isn't theirs to see. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  try {
    const out = await eventIcs(s.actor, id.data);
    if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(out.ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AccessDenied) return NextResponse.json({ error: "Not found" }, { status: 404 });
    throw e;
  }
}
