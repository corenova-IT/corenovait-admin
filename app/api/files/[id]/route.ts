import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { getFileForDownload } from "@/lib/dal/files";

/**
 * The only way to read an uploaded file. The data-access layer checks the
 * module permission and data scope; "not found" and "not allowed" look the
 * same so file IDs can't be probed.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const file = await getFileForDownload(s.actor, (await params).id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const inline = file.mimeType.startsWith("image/") && new URL(request.url).searchParams.get("download") !== "1";
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/["\\]/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
