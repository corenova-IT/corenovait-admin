import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { openNotification } from "@/lib/dal/notifications";
import { safeNextPath } from "@/lib/safe-redirect";

/** Opens one of your notifications: marks it read and goes where it points (same site only). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  const base = new URL(request.url);
  if (s.status !== "ok") return NextResponse.redirect(new URL("/login", base));
  const id = (await params).id;
  const href = /^[0-9a-f-]{36}$/i.test(id) ? await openNotification(s.actor, id) : null;
  return NextResponse.redirect(new URL(safeNextPath(href, "/notifications"), base));
}
