import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth/session";
import { chatSync } from "@/lib/dal/chat";
import { hasPerm } from "@/lib/dal/guard";

/**
 * Live chat over Server-Sent Events. The server checks for changes every two
 * seconds and closes the stream after 25 seconds; the browser reconnects
 * with the latest cursor. Short streams like this survive shared hosting
 * (no long-lived connections), and the browser falls back to polling
 * /api/chat/sync every 4 seconds if events don't arrive. Only conversations
 * the caller is in are ever read (chatSync checks membership).
 */
export const dynamic = "force-dynamic";

const STREAM_MS = 25_000;
const TICK_MS = 2_000;

export async function GET(request: Request) {
  const s = await getSessionState();
  if (s.status !== "ok") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const actor = s.actor;
  if (!hasPerm(actor, "chat", "view")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const channelId = q.get("c") || undefined;
  const read = q.get("read") === "1";
  let since = q.get("since") || undefined;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
          return true;
        } catch {
          return false;
        }
      };
      write("retry: 1500\n\n");
      const end = Date.now() + STREAM_MS;
      let last = "";
      while (!request.signal.aborted && Date.now() < end) {
        try {
          const data = await chatSync(actor, { channelId, since, read });
          // only send when something changed (the one-second overlap repeats the same messages)
          const sig = JSON.stringify([data.changes.map((m) => `${m.id}:${m.editedAt}:${m.deleted}`), data.typing, data.online, data.conversations, data.notificationsUnread]);
          if (sig !== last) {
            if (!write(`data: ${JSON.stringify(data)}\n\n`)) break;
            last = sig;
          } else if (!write(": ping\n\n")) break;
          since = data.now;
        } catch {
          write(`event: problem\ndata: {}\n\n`);
          break;
        }
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
      try {
        controller.close();
      } catch {
        /* already closed by the browser */
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // tells nginx-style proxies (Hostinger) not to hold the stream back
      "X-Accel-Buffering": "no",
    },
  });
}
