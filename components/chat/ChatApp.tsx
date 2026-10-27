"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import { setBadges } from "@/components/layout/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormMessage, Select, Textarea } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";
import type { ChannelSummary, ChatMessage, ChatSync } from "@/lib/chat-types";
import { ChannelAdmin, type AdminChannel } from "./ChannelAdmin";
import { useChatFeed } from "./useChatFeed";

type State = { ok?: string; error?: string; message?: ChatMessage; channelId?: string; messages?: ChatMessage[]; hasOlder?: boolean };
type Action = (prev: State, fd: FormData) => Promise<State>;
export type ChatActions = { send: Action; edit: Action; remove: Action; typing: Action; startDm: Action; older: Action; saveChannel: Action; archive: Action };

export type OpenConversation = {
  channel: { id: string; kind: "channel" | "dm"; name: string; topic: string; archived: boolean; isDefault: boolean };
  members: Array<{ id: string; name: string; online: boolean }>;
  messages: ChatMessage[];
  hasOlder: boolean;
  lastReadAt: string;
};

const MENTION = /(@[\p{L}\p{N}._-]{2,40})/u;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Message text with @mentions picked out; plain text otherwise (never HTML). */
function Body({ text }: { text: string }) {
  return (
    <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">
      {text.split(MENTION).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-accent-soft px-0.5 font-medium text-accent-text">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </p>
  );
}

function Attachment({ file }: { file: NonNullable<ChatMessage["file"]> }) {
  const href = `/api/files/${file.id}`;
  if (file.mimeType.startsWith("image/"))
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={href} alt={file.name} className="max-h-56 max-w-full rounded-xl border border-line object-contain" loading="lazy" />
      </a>
    );
  return (
    <a href={`${href}?download=1`} className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink hover:border-accent-line">
      <span className="font-mono text-xs text-muted">PDF</span>
      <span className="min-w-0 [overflow-wrap:anywhere]">{file.name}</span>
      <span className="shrink-0 font-mono text-xs text-muted">{kb(file.sizeBytes)}</span>
    </a>
  );
}

function Message({ m, showHeader, canEdit, canDelete, actions, onChange }: { m: ChatMessage; showHeader: boolean; canEdit: boolean; canDelete: boolean; actions: ChatActions; onChange: (m: ChatMessage) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (action: Action, fields: Record<string, string>, after: (r: State) => void) =>
    start(async () => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const r = await action({}, fd);
      if (r.error) setError(r.error);
      else {
        setError(null);
        after(r);
      }
    });

  return (
    <li className={cx("group flex gap-3 rounded-xl px-2", showHeader ? "mt-3 pt-1" : "mt-0.5")}>
      <span className="w-9 shrink-0">{showHeader && <Avatar name={m.authorName} size={34} />}</span>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold text-ink">{m.authorName}</span>
            <time dateTime={m.createdAt} className="font-mono text-xs text-muted">
              {time(m.createdAt)}
            </time>
          </p>
        )}
        {m.deleted ? (
          <p className="text-sm italic text-muted">Message deleted</p>
        ) : editing ? (
          <form
            className="mt-1 flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(actions.edit, { id: m.id, body: text }, (r) => {
                if (r.message) onChange(r.message);
                setEditing(false);
              });
            }}
          >
            <label htmlFor={`edit-${m.id}`} className="sr-only">
              Edit message
            </label>
            <Textarea id={`edit-${m.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={4000} autoFocus />
            <span className="flex gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setEditing(false), setText(m.body))}>
                Cancel
              </Button>
            </span>
          </form>
        ) : (
          <>
            {m.body && <Body text={m.body} />}
            {m.file && <Attachment file={m.file} />}
            {m.editedAt && <span className="text-xs text-muted"> (edited)</span>}
          </>
        )}
        {error && <p className="mt-1 text-xs text-accent-text">{error}</p>}
      </div>
      {m.mine && !m.deleted && !editing && (canEdit || canDelete) && (
        <span className="flex shrink-0 items-start gap-1 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100">
          {canEdit && (
            <button type="button" className="rounded-md px-1.5 py-0.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink" onClick={() => setEditing(true)}>
              Edit<span className="sr-only"> message from {time(m.createdAt)}</span>
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="rounded-md px-1.5 py-0.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-accent-text"
              disabled={pending}
              onClick={() => {
                if (window.confirm("Delete this message? Everyone in the conversation will see that it was deleted.")) run(actions.remove, { id: m.id }, () => onChange({ ...m, deleted: true, body: "", file: null }));
              }}
            >
              Delete<span className="sr-only"> message from {time(m.createdAt)}</span>
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function ConversationList({ conversations, current, people, canPost, actions }: { conversations: ChannelSummary[]; current: string | null; people: Array<{ id: string; name: string }>; canPost: boolean; actions: ChatActions }) {
  const router = useRouter();
  const [dmError, setDmError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const group = (kind: "channel" | "dm") => conversations.filter((c) => c.kind === kind);
  const item = (c: ChannelSummary) => (
    <li key={c.id}>
      <Link
        href={`/chat?c=${c.id}`}
        aria-current={c.id === current ? "page" : undefined}
        className={cx("flex items-center gap-2 rounded-xl px-2.5 py-2 text-[15px]", c.id === current ? "nav-item-active border border-accent-line font-semibold text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink", c.archived && "opacity-60")}
      >
        {c.kind === "dm" && (
          <span className={cx("size-2.5 shrink-0 rounded-full", c.online ? "bg-success" : "border border-muted")} aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {c.label}
          {c.kind === "dm" && <span className="sr-only">{c.online ? ", online" : ", offline"}</span>}
          {c.archived && <span className="ml-1 text-xs text-muted">(archived)</span>}
        </span>
        {c.unread > 0 && (
          <span className="grid min-w-6 place-items-center rounded-full bg-accent px-1.5 font-mono text-[11px] leading-5 text-on-accent">
            {c.unread}
            <span className="sr-only"> unread</span>
          </span>
        )}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Conversations" className="flex flex-col gap-5">
      <div>
        <h2 className="label-mono mb-2 px-2.5">Channels</h2>
        <ul className="flex flex-col gap-0.5">{group("channel").map(item)}</ul>
      </div>
      <div>
        <h2 className="label-mono mb-2 px-2.5">Direct messages</h2>
        {group("dm").length === 0 && <p className="px-2.5 text-sm text-muted">None yet.</p>}
        <ul className="flex flex-col gap-0.5">{group("dm").map(item)}</ul>
      </div>
      {canPost && people.length > 0 && (
        <form
          className="flex flex-col gap-2 border-t border-line px-1 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              const r = await actions.startDm({}, fd);
              if (r.channelId) router.push(`/chat?c=${r.channelId}`);
              else setDmError(r.error ?? "That conversation couldn't be opened.");
            });
          }}
        >
          <label htmlFor="dm-person" className="text-sm font-medium text-ink">
            Message someone
          </label>
          <Select id="dm-person" name="userId" defaultValue="">
            <option value="" disabled>
              Choose a person
            </option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Open conversation
          </Button>
          {dmError && <p className="text-xs text-accent-text">{dmError}</p>}
        </form>
      )}
    </nav>
  );
}

/**
 * Team chat: the conversation list and the open conversation, kept live by
 * useChatFeed (events, or polling as a fallback).
 */
export function ChatApp({
  conversations: initialConversations,
  current,
  people,
  serverNow,
  can,
  admin,
  actions,
}: {
  conversations: ChannelSummary[];
  current: OpenConversation | null;
  people: Array<{ id: string; name: string }>;
  serverNow: string;
  can: { post: boolean; edit: boolean; delete: boolean };
  admin: { channels: AdminChannel[]; people: Array<{ id: string; name: string }> } | null;
  actions: ChatActions;
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [messages, setMessages] = useState<ChatMessage[]>(current?.messages ?? []);
  const [hasOlder, setHasOlder] = useState(current?.hasOlder ?? false);
  const [typing, setTyping] = useState<string[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set(current?.members.filter((m) => m.online).map((m) => m.id)));
  const [error, setError] = useState<string | null>(null);
  const [sending, startSend] = useTransition();
  const [loadingOlder, startOlder] = useTransition();
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const lastPing = useRef(0);
  // the "new messages" line stays where it was when the conversation opened
  const [firstUnread] = useState(() => current?.messages.find((m) => !m.mine && m.createdAt > current.lastReadAt)?.id ?? null);

  const upsert = useCallback((incoming: ChatMessage[]) => {
    if (!incoming.length) return;
    setMessages((list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }, []);

  const transport = useChatFeed(current?.channel.id ?? "", serverNow, (d: ChatSync) => {
    upsert(d.changes);
    setTyping(d.typing);
    if (current) setOnline(new Set(d.online));
    setConversations((list) => list.map((c) => ({ ...c, ...(d.conversations.find((x) => x.id === c.id) ?? {}), ...(c.id === current?.channel.id ? { unread: 0 } : {}) })));
    setBadges({ chat: d.unreadTotal, notifications: d.notificationsUnread });
  });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!current) {
    return (
      <div className="grid gap-cards @min-[56rem]:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="glass card-pad">
          <ConversationList conversations={conversations} current={null} people={people} canPost={can.post} actions={actions} />
        </div>
        <div className="glass card-pad text-sm text-muted">Choose a conversation.</div>
      </div>
    );
  }

  const ch = current.channel;
  const title = ch.kind === "dm" ? (conversations.find((c) => c.id === ch.id)?.label ?? "Direct message") : `#${ch.name}`;
  const other = ch.kind === "dm" ? current.members.find((m) => conversations.find((c) => c.id === ch.id)?.otherUserId === m.id) : null;
  const onlineCount = current.members.filter((m) => online.has(m.id)).length;

  const send = (fd: FormData) =>
    startSend(async () => {
      setError(null);
      stick.current = true;
      const r = await actions.send({}, fd);
      if (r.message) {
        upsert([r.message]);
        form.current?.reset();
      } else setError(r.error ?? "That message couldn't be sent.");
    });

  const ping = () => {
    if (Date.now() - lastPing.current < 3000) return;
    lastPing.current = Date.now();
    const fd = new FormData();
    fd.set("channelId", ch.id);
    void actions.typing({}, fd);
  };

  let lastAuthor = "";
  let lastDay = "";
  let lastTime = 0;

  return (
    <div className="grid gap-cards @min-[56rem]:grid-cols-[17rem_minmax(0,1fr)]">
      <div className="glass card-pad">
        <details className="@min-[56rem]:hidden">
          <summary className="cursor-pointer text-sm font-medium text-ink">
            All conversations{conversations.some((c) => c.unread > 0) ? ` · ${conversations.reduce((a, c) => a + c.unread, 0)} unread` : ""}
          </summary>
          <div className="mt-4">
            <ConversationList conversations={conversations} current={ch.id} people={people} canPost={can.post} actions={actions} />
          </div>
        </details>
        <div className="hidden @min-[56rem]:block">
          <ConversationList conversations={conversations} current={ch.id} people={people} canPost={can.post} actions={actions} />
        </div>
        {admin && (
          <div className="mt-5 border-t border-line pt-4">
            <ChannelAdmin channels={admin.channels} people={admin.people} save={actions.saveChannel} archive={actions.archive} />
          </div>
        )}
      </div>

      <section className="glass flex min-h-[32rem] min-w-0 flex-col" aria-label={`Conversation: ${title}`}>
        <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-[var(--space-card)] py-4">
          <h2 className="title-card min-w-0 font-bold text-ink [overflow-wrap:anywhere]">{title}</h2>
          {ch.archived && <Badge>Archived · read-only</Badge>}
          <p className="text-sm text-muted">
            {ch.kind === "dm"
              ? other && online.has(other.id)
                ? "Online now"
                : "Offline"
              : `${current.members.length} ${current.members.length === 1 ? "member" : "members"} · ${onlineCount} online${ch.topic ? ` · ${ch.topic}` : ""}`}
          </p>
          <span className="ml-auto font-mono text-[11px] text-muted" title={transport === "events" ? "Live updates (server events)" : "Live updates (checking every 4 seconds)"}>
            {transport === "events" ? "live" : "live · polling"}
          </span>
        </header>

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
          className="h-[min(62dvh,40rem)] overflow-y-auto px-[calc(var(--space-card)-0.5rem)] py-3"
        >
          {hasOlder && (
            <div className="mb-2 text-center">
              <Button
                size="sm"
                variant="ghost"
                disabled={loadingOlder}
                onClick={() =>
                  startOlder(async () => {
                    const fd = new FormData();
                    fd.set("channelId", ch.id);
                    fd.set("before", messages[0]?.createdAt ?? "");
                    stick.current = false;
                    const r = await actions.older({}, fd);
                    if (r.messages) {
                      upsert(r.messages);
                      setHasOlder(!!r.hasOlder);
                    }
                  })
                }
              >
                {loadingOlder ? "Loading…" : "Show older messages"}
              </Button>
            </div>
          )}
          {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet. Say hello.</p>}
          <ol className="flex flex-col" aria-live="polite" aria-relevant="additions">
            {messages.map((m) => {
              const day = dayOf(m.createdAt);
              const t = new Date(m.createdAt).getTime();
              const newDay = day !== lastDay;
              const showHeader = newDay || m.authorId !== lastAuthor || t - lastTime > 5 * 60_000 || m.id === firstUnread;
              lastAuthor = m.authorId;
              lastDay = day;
              lastTime = t;
              return (
                <li key={m.id} className="list-none">
                  {newDay && (
                    <p className="my-3 flex items-center gap-3 text-xs text-muted">
                      <span className="h-px flex-1 bg-line" />
                      {day}
                      <span className="h-px flex-1 bg-line" />
                    </p>
                  )}
                  {m.id === firstUnread && (
                    <p className="my-2 flex items-center gap-3 font-mono text-xs text-accent-text">
                      <span className="h-px flex-1 bg-accent-line" />
                      New messages
                      <span className="h-px flex-1 bg-accent-line" />
                    </p>
                  )}
                  <ul>
                    <Message m={m} showHeader={showHeader} canEdit={can.edit && !ch.archived} canDelete={can.delete && !ch.archived} actions={actions} onChange={(x) => upsert([x])} />
                  </ul>
                </li>
              );
            })}
          </ol>
        </div>

        <p className="min-h-6 px-[var(--space-card)] text-xs text-muted" aria-live="polite">
          {typing.length === 1 ? `${typing[0]} is typing…` : typing.length > 1 ? `${typing.slice(0, 3).join(", ")} are typing…` : ""}
        </p>

        {ch.archived ? (
          <p className="border-t border-line px-[var(--space-card)] py-4 text-sm text-muted">This channel is archived. You can read it, but not post.</p>
        ) : can.post ? (
          <form
            ref={form}
            className="flex flex-col gap-2 border-t border-line px-[var(--space-card)] py-4"
            onSubmit={(e) => {
              e.preventDefault();
              send(new FormData(e.currentTarget));
            }}
          >
            {error && <FormMessage tone="error">{error}</FormMessage>}
            <input type="hidden" name="channelId" value={ch.id} />
            <label htmlFor="chat-body" className="sr-only">
              Message {title}
            </label>
            <Textarea
              id="chat-body"
              name="body"
              rows={2}
              maxLength={4000}
              placeholder={`Message ${title} · @name to mention someone`}
              onChange={ping}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                <span className="shrink-0">Attach</span>
                <input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="min-w-0 max-w-[14rem] text-xs file:mr-2 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-2 file:py-1 file:text-ink" />
              </label>
              <span className="flex items-center gap-3">
                <span className="hidden text-xs text-muted @min-[40rem]:inline">Enter to send · Shift+Enter for a new line</span>
                <Button type="submit" size="sm" disabled={sending}>
                  {sending ? "Sending…" : "Send"}
                </Button>
              </span>
            </div>
          </form>
        ) : (
          <p className="border-t border-line px-[var(--space-card)] py-4 text-sm text-muted">You can read chat but not post.</p>
        )}
      </section>
    </div>
  );
}
