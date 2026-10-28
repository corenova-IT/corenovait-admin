import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { readAvatar } from "@/lib/dal/profile";

/**
 * A person's profile picture, for signed-in people only (401 otherwise).
 * Read-only: pictures are changed on your own profile page. The URL carries
 * a version (?v=), so the browser may keep it for a day.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const bytes = await readAvatar(s.actor, (await params).id);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
