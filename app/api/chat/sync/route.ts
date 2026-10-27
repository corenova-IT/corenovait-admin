import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { chatSync } from "@/lib/dal/chat";
import { AccessDenied } from "@/lib/dal/guard";

/** The polling fallback for live chat: one answer of "what changed since". Same data as the stream. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const q = new URL(request.url).searchParams;
  try {
    const data = await chatSync(s.actor, { channelId: q.get("c") || undefined, since: q.get("since") || undefined, read: q.get("read") === "1" });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AccessDenied) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    throw e;
  }
}
