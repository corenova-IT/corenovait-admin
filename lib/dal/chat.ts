import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, like, lt, ne, sql } from "drizzle-orm";
import { likeTerm } from "@/lib/search";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { can } from "@/lib/permissions";
import { actorRef, writeAudit } from "./audit";
import type { Attachment } from "./finance";
import { saveUpload } from "./files";
import { AccessDenied, RuleError, assertCaller, hasPerm, requirePerm, type Actor } from "./guard";
import { loadUserPerms } from "./internal";
import { notify } from "./notifications";
import type { ChannelSummary, ChatMessage } from "@/lib/chat-types";
export type { ChannelSummary, ChatMessage };

/**
 * Team chat (module "chat"): channels and direct messages.
 *
 * Reading anything needs membership of that channel or DM. There is no admin
 * override: admins create, rename, archive and set the members of channels
 * (and can add themselves, which is audited), but nobody can read a direct
 * message they aren't part of. #general includes every active person with
 * chat access automatically.
 *
 * Permissions: view = use chat; create = post and start DMs; edit = edit or
 * delete your own messages (delete permission also lets you delete your own).
 * Message text is never written to the audit log (DMs are private); edits,
 * deletes and every channel change are, without the content.
 */
const { chatChannels: channels, chatMembers: members, chatMessages: messages, users, userPresence, files } = schema;

export const ONLINE_SECONDS = 90;
export const MAX_MESSAGE = 4000;

const isAdminCaller = (actor: Actor) => actor.isAdmin && actor.mfaVerified && hasPerm(actor, "chat", "view");
function requireChatAdmin(actor: Actor) {
  requirePerm(actor, "chat", "view");
  if (!actor.isAdmin) throw new AccessDenied("Only admins can manage channels.");
  if (!actor.mfaVerified) throw new AccessDenied("Verify your two-factor code, then try again.");
}

// ---------------------------------------------------------------- membership
/** #general exists, and the caller is in every default channel. */
async function ensureDefaults(db: Db | Tx, actor: Actor) {
  let [general] = await db.select().from(channels).where(and(eq(channels.kind, "channel"), eq(channels.isDefault, true))).limit(1);
  if (!general) {
    const id = crypto.randomUUID();
    await db.insert(channels).values({ id, kind: "channel", name: "general", topic: "Company-wide chat", isDefault: true, createdBy: actor.userId });
    [general] = await db.select().from(channels).where(eq(channels.id, id));
  }
  const defaults = await db.select({ id: channels.id }).from(channels).where(and(eq(channels.isDefault, true), isNull(channels.archivedAt)));
  if (defaults.length)
    await db
      .insert(members)
      .values(defaults.map((c) => ({ channelId: c.id, userId: actor.userId, lastReadAt: new Date(0) })))
      .onDuplicateKeyUpdate({ set: { channelId: sql`${members.channelId}` } });
}

/** The caller's membership row, or null. The single gate for reading anything in a channel or DM. */
async function membership(db: Db | Tx, actor: Actor, channelId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) return null;
  const [row] = await db
    .select({ channel: channels, lastReadAt: members.lastReadAt })
    .from(members)
    .innerJoin(channels, eq(channels.id, members.channelId))
    .where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
  return row ?? null;
}

async function requireMember(db: Db | Tx, actor: Actor, channelId: string) {
  const m = await membership(db, actor, channelId);
  if (!m) throw new AccessDenied("That conversation doesn't exist or you're not in it.");
  return m;
}

/** People who can use chat (for starting DMs and choosing channel members). */
export async function chatPeople(actor: Actor) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  const rows = await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.status, "active")).orderBy(asc(users.fullName));
  const out: Array<{ id: string; name: string }> = [];
  for (const r of rows) if (can(await loadUserPerms(db, r.id), "chat", "view")) out.push({ id: r.id, name: r.name || r.email });
  return out;
}

// ---------------------------------------------------------------- the sidebar
async function onlineSet(db: Db | Tx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const since = new Date(Date.now() - ONLINE_SECONDS * 1000);
  const rows = await db.select({ id: userPresence.userId }).from(userPresence).where(and(inArray(userPresence.userId, ids), gt(userPresence.lastSeenAt, since)));
  return new Set(rows.map((r) => r.id));
}

/** Channels and DMs the caller is in, with unread counts. */
export async function myConversations(actor: Actor): Promise<ChannelSummary[]> {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  await ensureDefaults(db, actor);
  const mine = await db
    .select({ c: channels, lastReadAt: members.lastReadAt })
    .from(members)
    .innerJoin(channels, eq(channels.id, members.channelId))
    .where(eq(members.userId, actor.userId));
  const ids = mine.map((m) => m.c.id);
  if (!ids.length) return [];
  const [unread, last, dmOthers] = await Promise.all([
    db
      .select({ channelId: messages.channelId, n: count() })
      .from(messages)
      .innerJoin(members, and(eq(members.channelId, messages.channelId), eq(members.userId, actor.userId)))
      .where(and(inArray(messages.channelId, ids), ne(messages.authorId, actor.userId), isNull(messages.deletedAt), gt(messages.createdAt, members.lastReadAt)))
      .groupBy(messages.channelId),
    db.select({ channelId: messages.channelId, at: sql<Date>`max(${messages.createdAt})` }).from(messages).where(inArray(messages.channelId, ids)).groupBy(messages.channelId),
    db
      .select({ channelId: members.channelId, userId: members.userId, name: users.fullName, email: users.email })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .innerJoin(channels, eq(channels.id, members.channelId))
      .where(and(inArray(members.channelId, ids), eq(channels.kind, "dm"), ne(members.userId, actor.userId))),
  ]);
  const online = await onlineSet(db, dmOthers.map((d) => d.userId));
  return mine
    .map(({ c }) => {
      const other = c.kind === "dm" ? dmOthers.find((d) => d.channelId === c.id) : undefined;
      const lastAt = last.find((l) => l.channelId === c.id)?.at ?? null;
      return {
        id: c.id,
        kind: c.kind,
        label: c.kind === "dm" ? (other?.name || other?.email || "Former member") : `#${c.name}`,
        topic: c.topic,
        archived: !!c.archivedAt,
        unread: Number(unread.find((u) => u.channelId === c.id)?.n ?? 0),
        otherUserId: other?.userId ?? null,
        online: other ? online.has(other.userId) : false,
        lastAt: lastAt ? new Date(lastAt) : null,
      };
    })
    .sort((a, b) => Number(a.archived) - Number(b.archived) || (a.kind === b.kind ? (a.kind === "channel" ? a.label.localeCompare(b.label) : (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0)) : a.kind === "channel" ? -1 : 1));
}

/** Total unread messages across the caller's conversations (top bar, Home, My Day). */
export async function unreadChatTotal(actor: Actor): Promise<number> {
  if (!hasPerm(actor, "chat", "view")) return 0;
  const db = getDb();
  const [r] = await db
    .select({ n: count() })
    .from(messages)
    .innerJoin(members, and(eq(members.channelId, messages.channelId), eq(members.userId, actor.userId)))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(and(ne(messages.authorId, actor.userId), isNull(messages.deletedAt), isNull(channels.archivedAt), gt(messages.createdAt, members.lastReadAt)));
  return r.n;
}

// ---------------------------------------------------------------- messages
function messageQuery(db: Db | Tx) {
  return db
    .select({ m: messages, authorName: users.fullName, authorEmail: users.email, fileName: files.originalName, fileMime: files.mimeType, fileSize: files.sizeBytes })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .leftJoin(files, eq(files.id, messages.fileId));
}
type MessageRow = Awaited<ReturnType<ReturnType<typeof messageQuery>["execute"]>>[number];
const toMessage = (actor: Actor, r: MessageRow): ChatMessage => ({
  id: r.m.id,
  channelId: r.m.channelId,
  authorId: r.m.authorId,
  authorName: r.authorName || r.authorEmail || "Former member",
  body: r.m.deletedAt ? "" : r.m.body,
  file: r.m.fileId && !r.m.deletedAt ? { id: r.m.fileId, name: r.fileName ?? "attachment", mimeType: r.fileMime ?? "", sizeBytes: r.fileSize ?? 0 } : null,
  createdAt: r.m.createdAt.toISOString(),
  editedAt: r.m.editedAt?.toISOString() ?? null,
  deleted: !!r.m.deletedAt,
  removedByAdmin: r.m.removedByAdmin,
  mine: r.m.authorId === actor.userId,
});

export const PAGE = 50;

/** A conversation: its details, members and the latest messages (or older ones, before a time). */
export async function openConversation(actor: Actor, channelId: string, opts: { before?: string } = {}) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  await ensureDefaults(db, actor);
  const m = await requireMember(db, actor, channelId);
  const before = opts.before ? new Date(opts.before) : null;
  const rows = await messageQuery(db)
    .where(and(eq(messages.channelId, channelId), before && !Number.isNaN(before.getTime()) ? lt(messages.createdAt, before) : undefined))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(PAGE + 1);
  const people = await db
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.channelId, channelId))
    .orderBy(asc(users.fullName));
  const online = await onlineSet(db, people.map((p) => p.id));
  return {
    channel: { id: m.channel.id, kind: m.channel.kind, name: m.channel.name, topic: m.channel.topic, archived: !!m.channel.archivedAt, isDefault: m.channel.isDefault },
    members: people.map((p) => ({ id: p.id, name: p.name || p.email, online: online.has(p.id) })),
    messages: rows.slice(0, PAGE).reverse().map((r) => toMessage(actor, r)),
    hasOlder: rows.length > PAGE,
    lastReadAt: m.lastReadAt.toISOString(),
  };
}

const MENTION = /@([\p{L}\p{N}._-]{2,40})/gu;

/** People in the conversation named with @first-name, @fullname or @email-name (not the author). */
async function mentioned(db: Db | Tx, channelId: string, body: string, authorId: string) {
  const words = new Set([...body.matchAll(MENTION)].map((m) => m[1].toLowerCase()));
  if (!words.size) return [];
  const people = await db.select({ id: users.id, name: users.fullName, email: users.email }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(members.channelId, channelId));
  return people.filter((p) => {
    if (p.id === authorId) return false;
    const handles = [p.name.split(" ")[0], p.name.replace(/\s+/g, ""), p.email.split("@")[0]].map((h) => h.toLowerCase()).filter(Boolean);
    return handles.some((h) => words.has(h));
  });
}

const bodySchema = z.string().max(MAX_MESSAGE, `Keep messages under ${MAX_MESSAGE.toLocaleString("en-AU")} characters.`);

export async function sendMessage(actor: Actor, channelId: string, body: string, attachment?: Attachment): Promise<ChatMessage> {
  requirePerm(actor, "chat", "create");
  const parsed = bodySchema.safeParse(body.trim());
  if (!parsed.success) throw new RuleError(parsed.error.issues[0].message);
  const text = parsed.data;
  if (!text && !attachment) throw new RuleError("Write a message or attach a file.");
  const db = getDb();
  const m = await requireMember(db, actor, channelId);
  if (m.channel.archivedAt) throw new RuleError("This channel is archived, so it's read-only.");
  const id = crypto.randomUUID();
  // private: the file name isn't written to the audit log
  const file = attachment ? await saveUpload(actor, { module: "chat", entityType: "chat_messages", entityId: id, ...attachment, private: true }) : null;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({ id, channelId, authorId: actor.userId, body: text, fileId: file?.id ?? null, createdAt: now, updatedAt: now });
    await tx.update(members).set({ lastReadAt: now, typingUntil: null }).where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
    const where = m.channel.kind === "dm" ? "a direct message" : `#${m.channel.name}`;
    for (const p of await mentioned(tx, channelId, text, actor.userId))
      await notify(tx, {
        userId: p.id,
        type: "chat_mention",
        title: `${actor.fullName || actor.email} mentioned you in ${where}`,
        body: m.channel.kind === "dm" ? "" : text.slice(0, 200),
        href: `/chat?c=${channelId}`,
        dedupeKey: `mention:${id}:${p.id}`,
      });
  });
  const [row] = await messageQuery(db).where(eq(messages.id, id));
  return toMessage(actor, row);
}

async function ownMessage(tx: Tx, actor: Actor, id: string) {
  const [msg] = await tx.select().from(messages).where(eq(messages.id, id)).for("update");
  // someone else's message (or one in a conversation you're not in) looks the same as a missing one
  if (!msg || msg.authorId !== actor.userId || !(await membership(tx, actor, msg.channelId))) throw new AccessDenied("You can only change your own messages.");
  if (msg.deletedAt) throw new RuleError("That message was deleted.");
  const [ch] = await tx.select({ archivedAt: channels.archivedAt, kind: channels.kind }).from(channels).where(eq(channels.id, msg.channelId));
  if (ch?.archivedAt) throw new RuleError("This channel is archived, so it's read-only.");
  return { msg, kind: ch?.kind ?? "channel" };
}

export async function editMessage(actor: Actor, id: string, body: string): Promise<ChatMessage> {
  requirePerm(actor, "chat", "edit");
  const parsed = bodySchema.safeParse(body.trim());
  if (!parsed.success) throw new RuleError(parsed.error.issues[0].message);
  const db = getDb();
  await db.transaction(async (tx) => {
    const { msg, kind } = await ownMessage(tx, actor, id);
    if (!parsed.data && !msg.fileId) throw new RuleError("A message can't be empty. Delete it instead.");
    const now = new Date();
    await tx.update(messages).set({ body: parsed.data, editedAt: now, updatedAt: now }).where(eq(messages.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "chat_messages", entityId: id, summary: `Edited own message in ${kind === "dm" ? "a direct message" : "a channel"}` });
  });
  const [row] = await messageQuery(db).where(eq(messages.id, id));
  return toMessage(actor, row);
}

/** Deleting your own message needs chat edit or delete permission. The text and file go; a "deleted" marker stays. */
export async function deleteMessage(actor: Actor, id: string) {
  assertCaller(actor);
  if (!hasPerm(actor, "chat", "edit") && !hasPerm(actor, "chat", "delete")) throw new AccessDenied();
  await getDb().transaction(async (tx) => {
    const { msg, kind } = await ownMessage(tx, actor, id);
    const now = new Date();
    // the attachment can't be downloaded any more; the clean-up job (cron) removes it from disk and the database
    await tx.update(messages).set({ body: "", fileId: null, deletedAt: now, updatedAt: now }).where(eq(messages.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "chat_messages", entityId: id, summary: `Deleted own message in ${kind === "dm" ? "a direct message" : "a channel"}` });
  });
}

/**
 * Admins may remove someone else's message in a channel they are in, never
 * in a direct message. The text and file go; "Message removed by an admin"
 * stays. Audited with who wrote it, never what it said.
 */
export async function removeMessageAsAdmin(actor: Actor, id: string) {
  if (!isAdminCaller(actor)) throw new AccessDenied("Only admins can remove other people's messages.");
  await getDb().transaction(async (tx) => {
    const [msg] = await tx.select().from(messages).where(eq(messages.id, id)).for("update");
    const m = msg ? await membership(tx, actor, msg.channelId) : null;
    // a DM (or a channel the admin isn't in) looks the same as a missing message
    if (!msg || !m || m.channel.kind !== "channel") throw new AccessDenied("That message doesn't exist, or it's in a direct message, which admins can't moderate.");
    if (msg.deletedAt) throw new RuleError("That message was already deleted.");
    const now = new Date();
    await tx.update(messages).set({ body: "", fileId: null, deletedAt: now, removedByAdmin: true, updatedAt: now }).where(eq(messages.id, id));
    await writeAudit(tx, actorRef(actor), {
      action: "delete",
      entity: "chat_messages",
      entityId: id,
      summary: `Removed a message in #${m.channel.name} (moderation)`,
      before: { authorId: msg.authorId, channel: `#${m.channel.name}`, createdAt: msg.createdAt, hadFile: !!msg.fileId },
    });
  });
}

export async function markRead(actor: Actor, channelId: string) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  await requireMember(db, actor, channelId);
  await db.update(members).set({ lastReadAt: new Date() }).where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
}

/** "Is typing…" for about six seconds after each keystroke burst. */
export async function setTyping(actor: Actor, channelId: string) {
  requirePerm(actor, "chat", "create");
  const db = getDb();
  const m = await requireMember(db, actor, channelId);
  if (m.channel.archivedAt) return;
  await db.update(members).set({ typingUntil: new Date(Date.now() + 6000) }).where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
}

/** Online status: refreshed by the live connection, at most every 20 seconds per person. */
export async function touchPresence(actor: Actor) {
  assertCaller(actor);
  const db = getDb();
  const now = new Date();
  await db
    .insert(userPresence)
    .values({ userId: actor.userId, lastSeenAt: now })
    .onDuplicateKeyUpdate({ set: { lastSeenAt: sql`if(${userPresence.lastSeenAt} < ${new Date(now.getTime() - 20_000)}, ${now}, ${userPresence.lastSeenAt})` } });
}

/**
 * Everything that changed since a moment: messages created, edited or deleted
 * in the open conversation, who is typing there, unread counts everywhere and
 * who is online. The same answer feeds Server-Sent Events and the polling
 * fallback. Only conversations the caller is in are ever read.
 */
export async function chatSync(actor: Actor, opts: { channelId?: string; since?: string; read?: boolean }) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  const now = new Date();
  await touchPresence(actor);
  let changes: ChatMessage[] = [];
  let typing: string[] = [];
  let online: string[] = [];
  if (opts.channelId) {
    const m = await membership(db, actor, opts.channelId);
    if (m) {
      const since = opts.since ? new Date(opts.since) : null;
      // a second of overlap, so nothing written during the last check is missed (the browser de-duplicates)
      const from = since && !Number.isNaN(since.getTime()) ? new Date(since.getTime() - 1000) : new Date(now.getTime() - 60_000);
      changes = (await messageQuery(db).where(and(eq(messages.channelId, opts.channelId), gt(messages.updatedAt, from))).orderBy(asc(messages.createdAt)).limit(200)).map((r) => toMessage(actor, r));
      const people = await db
        .select({ id: users.id, name: users.fullName, email: users.email, typingUntil: members.typingUntil })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(eq(members.channelId, opts.channelId));
      typing = people.filter((p) => p.id !== actor.userId && p.typingUntil && p.typingUntil > now).map((p) => (p.name || p.email).split(" ")[0]);
      online = [...(await onlineSet(db, people.map((p) => p.id)))];
      if (opts.read) await db.update(members).set({ lastReadAt: now }).where(and(eq(members.channelId, opts.channelId), eq(members.userId, actor.userId)));
    }
  }
  const convs = await myConversations(actor);
  const [{ n: notificationsUnread }] = await db.select({ n: count() }).from(schema.notifications).where(and(eq(schema.notifications.userId, actor.userId), isNull(schema.notifications.readAt)));
  return {
    now: now.toISOString(),
    changes,
    typing,
    online,
    conversations: convs.map((c) => ({ id: c.id, unread: c.unread, online: c.online })),
    unreadTotal: convs.filter((c) => !c.archived).reduce((a, c) => a + c.unread, 0),
    notificationsUnread,
  };
}


/** Starts (or reopens) the one direct message between the caller and someone else. */
export async function openDirectMessage(actor: Actor, otherUserId: string): Promise<string> {
  requirePerm(actor, "chat", "create");
  if (otherUserId === actor.userId) throw new RuleError("Choose someone else to message.");
  const db = getDb();
  const [other] = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, otherUserId));
  if (!other || other.status !== "active" || !can(await loadUserPerms(db, other.id), "chat", "view")) throw new RuleError("That person can't use chat.");
  const key = [actor.userId, otherUserId].sort().join(":");
  const [existing] = await db.select({ id: channels.id }).from(channels).where(eq(channels.dmKey, key));
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(channels).values({ id, kind: "dm", dmKey: key, createdBy: actor.userId });
      await tx.insert(members).values([
        { channelId: id, userId: actor.userId },
        { channelId: id, userId: otherUserId, lastReadAt: new Date(0) },
      ]);
    });
  } catch {
    // two people opening the same DM at once: the unique key wins, use that one
    const [again] = await db.select({ id: channels.id }).from(channels).where(eq(channels.dmKey, key));
    if (again) return again.id;
    throw new RuleError("That conversation couldn't be opened. Try again.");
  }
  return id;
}

// ---------------------------------------------------------------- channel management (admins)
/** Every channel (never DMs) with member counts, for admins to manage. No messages. */
export async function channelsForAdmin(actor: Actor) {
  requireChatAdmin(actor);
  const db = getDb();
  await ensureDefaults(db, actor);
  const rows = await db.select().from(channels).where(eq(channels.kind, "channel")).orderBy(asc(channels.name));
  const counts = await db.select({ channelId: members.channelId, n: count() }).from(members).groupBy(members.channelId);
  const memberRows = await db.select({ channelId: members.channelId, userId: members.userId }).from(members).where(inArray(members.channelId, rows.map((r) => r.id).length ? rows.map((r) => r.id) : ["-"]));
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    topic: c.topic,
    isDefault: c.isDefault,
    archived: !!c.archivedAt,
    memberCount: Number(counts.find((x) => x.channelId === c.id)?.n ?? 0),
    memberIds: c.isDefault ? [] : memberRows.filter((m) => m.channelId === c.id).map((m) => m.userId),
  }));
}

const channelName = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^#/, "").replace(/\s+/g, "-"))
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9_-]{1,39}$/, "Use 2 to 40 letters, numbers, - or _, like projects or client-updates."));

async function checkMembers(db: Db | Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length > 200) throw new RuleError("Add up to 200 people.");
  for (const id of unique) {
    const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, id));
    if (!u || u.status !== "active" || !can(await loadUserPerms(db, id), "chat", "view")) throw new RuleError("Only active people with chat access can be added.");
  }
  return unique;
}

export async function saveChannel(actor: Actor, id: string | null, input: { name: string; topic?: string; memberIds: string[] }): Promise<string> {
  requireChatAdmin(actor);
  const name = channelName.safeParse(input.name);
  if (!name.success) throw new RuleError(name.error.issues[0].message);
  const topic = (input.topic ?? "").trim().slice(0, 200);
  const db = getDb();
  return db.transaction(async (tx) => {
    const [clash] = await tx.select({ id: channels.id }).from(channels).where(and(eq(channels.kind, "channel"), eq(channels.name, name.data)));
    if (clash && clash.id !== id) throw new RuleError(`There's already a #${name.data} channel.`);
    const snapshot = async (cid: string) => {
      const [c] = await tx.select().from(channels).where(eq(channels.id, cid));
      const m = await tx.select({ userId: members.userId }).from(members).where(eq(members.channelId, cid));
      return { name: c.name, topic: c.topic, archived: !!c.archivedAt, members: m.map((x) => x.userId).sort() };
    };
    if (!id) {
      const memberIds = await checkMembers(tx, [actor.userId, ...input.memberIds]);
      const newId = crypto.randomUUID();
      await tx.insert(channels).values({ id: newId, kind: "channel", name: name.data, topic, createdBy: actor.userId });
      await tx.insert(members).values(memberIds.map((userId) => ({ channelId: newId, userId, lastReadAt: userId === actor.userId ? new Date() : new Date(0) })));
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "chat_channels", entityId: newId, summary: `#${name.data}`, after: await snapshot(newId) });
      return newId;
    }
    const [current] = await tx.select().from(channels).where(eq(channels.id, id)).for("update");
    if (!current || current.kind !== "channel") throw new RuleError("That channel no longer exists.");
    const before = await snapshot(id);
    await tx.update(channels).set({ name: name.data, topic }).where(eq(channels.id, id));
    if (!current.isDefault) {
      // #general always has everyone; other channels have exactly the people chosen
      const memberIds = await checkMembers(tx, input.memberIds);
      const existing = (await tx.select({ userId: members.userId }).from(members).where(eq(members.channelId, id))).map((m) => m.userId);
      const gone = existing.filter((u) => !memberIds.includes(u));
      const added = memberIds.filter((u) => !existing.includes(u));
      if (gone.length) await tx.delete(members).where(and(eq(members.channelId, id), inArray(members.userId, gone)));
      if (added.length) await tx.insert(members).values(added.map((userId) => ({ channelId: id, userId, lastReadAt: new Date(0) })));
    }
    const after = await snapshot(id);
    const joinedSelf = !before.members.includes(actor.userId) && after.members.includes(actor.userId);
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "chat_channels", entityId: id, summary: `#${name.data}${joinedSelf ? " (added themselves)" : ""}`, before, after });
    return id;
  });
}

export async function setChannelArchived(actor: Actor, id: string, archived: boolean) {
  requireChatAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [c] = await tx.select().from(channels).where(eq(channels.id, id)).for("update");
    if (!c || c.kind !== "channel") throw new RuleError("That channel no longer exists.");
    if (c.isDefault && archived) throw new RuleError("#general can't be archived.");
    if (!!c.archivedAt === archived) return;
    await tx.update(channels).set({ archivedAt: archived ? new Date() : null }).where(eq(channels.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "chat_channels", entityId: id, summary: `#${c.name} ${archived ? "archived" : "restored"}`, before: { archived: !!c.archivedAt }, after: { archived } });
  });
}

export { isAdminCaller };

/**
 * For Home and My Day: conversations with unread messages (newest first) and
 * a short preview of the latest one. Only the caller's own conversations.
 */
/**
 * Top-bar search: messages in conversations the caller is a member of (never
 * anyone else's DMs), newest first. Removed messages are not searched.
 */
export async function searchMessages(actor: Actor, q: string, limit: number) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  const rows = await db
    .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, channelId: channels.id, kind: channels.kind, name: channels.name, authorName: users.fullName, authorEmail: users.email })
    .from(messages)
    .innerJoin(members, and(eq(members.channelId, messages.channelId), eq(members.userId, actor.userId)))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(isNull(messages.deletedAt), like(messages.body, likeTerm(q))))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  // a DM is named after the other person in it
  const dms = [...new Set(rows.filter((r) => r.kind === "dm").map((r) => r.channelId))];
  const others = dms.length
    ? await db
        .select({ channelId: members.channelId, name: users.fullName, email: users.email })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(inArray(members.channelId, dms), ne(members.userId, actor.userId)))
    : [];
  return rows.map((r) => {
    const other = others.find((o) => o.channelId === r.channelId);
    return {
      id: r.id,
      channelId: r.channelId,
      where: r.kind === "dm" ? `Direct message with ${other ? other.name || other.email : "a former member"}` : `#${r.name}`,
      author: r.authorName || r.authorEmail || "A former member",
      body: r.body,
      createdAt: r.createdAt,
    };
  });
}

export async function unreadChatSummary(actor: Actor, limit = 4) {
  requirePerm(actor, "chat", "view");
  const db = getDb();
  const convs = (await myConversations(actor)).filter((c) => !c.archived && c.unread > 0).sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
  const items = [];
  for (const c of convs.slice(0, limit)) {
    const [last] = await db
      .select({ body: messages.body, hasFile: sql<number>`${messages.fileId} is not null`, at: messages.createdAt, name: users.fullName, email: users.email })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, c.id), isNull(messages.deletedAt), ne(messages.authorId, actor.userId)))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    items.push({
      id: c.id,
      kind: c.kind,
      label: c.label,
      unread: c.unread,
      author: last ? (last.name || last.email || "").split(" ")[0] : "",
      preview: last ? (last.body ? last.body.slice(0, 120) : last.hasFile ? "Sent a file" : "") : "",
      at: last?.at ?? null,
    });
  }
  return { total: convs.reduce((a, c) => a + c.unread, 0), conversations: convs.length, items };
}
