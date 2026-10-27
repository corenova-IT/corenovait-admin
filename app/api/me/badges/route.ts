import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { touchPresence, unreadChatTotal } from "@/lib/dal/chat";
import { unreadNotificationCount } from "@/lib/dal/notifications";

/**
 * The signed-in person's own counts for the top bar and sidebar (unread
 * notifications and chat messages). Called every 30 seconds while a page is
 * open, which also keeps their "online" status fresh.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await touchPresence(s.actor);
  const [notifications, chat] = await Promise.all([unreadNotificationCount(s.actor), unreadChatTotal(s.actor)]);
  return NextResponse.json({ notifications, chat }, { headers: { "Cache-Control": "no-store" } });
}
