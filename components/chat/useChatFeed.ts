"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSync } from "@/lib/chat-types";

/**
 * Live updates for the open conversation. The transport is swappable: it
 * starts with Server-Sent Events (/api/chat/stream, short 25-second streams
 * that reconnect with the latest cursor), and falls back to polling
 * /api/chat/sync every 4 seconds if events don't arrive (a proxy that
 * buffers them, or a browser without EventSource). Both return the same data.
 */
export type Transport = "events" | "polling";
type Params = { channelId: string; since: string };
type Feed = { stop: () => void };
type Start = (p: Params, onData: (d: ChatSync) => void, onFail: () => void) => Feed;

const query = (p: Params) => {
  const q = new URLSearchParams({ c: p.channelId, since: p.since, read: document.visibilityState === "visible" ? "1" : "0" });
  return q.toString();
};

const startEvents: Start = (p, onData, onFail) => {
  let es: EventSource | null = null;
  let stopped = false;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let cursor = p.since;
  const open = () => {
    if (stopped) return;
    es = new EventSource(`/api/chat/stream?${query({ ...p, since: cursor })}`);
    // nothing at all within 8 seconds: events are being held back somewhere, so poll instead
    quietTimer = setTimeout(() => onFail(), 8000);
    es.onmessage = (e) => {
      failures = 0;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = null;
      const data = JSON.parse(e.data) as ChatSync;
      cursor = data.now;
      onData(data);
    };
    es.onerror = () => {
      es?.close();
      if (quietTimer) clearTimeout(quietTimer);
      // the server ends each stream after ~25s; reopen with the latest cursor, give up after 3 failures in a row
      failures++;
      if (failures >= 3) onFail();
      else setTimeout(open, 1000);
    };
  };
  open();
  return {
    stop: () => {
      stopped = true;
      if (quietTimer) clearTimeout(quietTimer);
      es?.close();
    },
  };
};

const startPolling: Start = (p, onData) => {
  let cursor = p.since;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch(`/api/chat/sync?${query({ ...p, since: cursor })}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as ChatSync;
        cursor = data.now;
        onData(data);
      }
    } catch {
      /* offline for a moment: try again next tick */
    }
    if (!stopped) timer = setTimeout(tick, 4000);
  };
  tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
};

export function useChatFeed(channelId: string, since: string, onData: (d: ChatSync) => void): Transport {
  const [transport, setTransport] = useState<Transport>(() => (typeof EventSource === "undefined" ? "polling" : "events"));
  const handler = useRef(onData);
  handler.current = onData;
  useEffect(() => {
    const deliver = (d: ChatSync) => handler.current(d);
    const feed = (transport === "events" ? startEvents : startPolling)({ channelId, since }, deliver, () => setTransport("polling"));
    return () => feed.stop();
    // `since` is only the starting point; each feed keeps its own cursor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, transport]);
  return transport;
}
