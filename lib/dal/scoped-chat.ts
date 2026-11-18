import "server-only";
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { ONLINE_SECONDS } from "./chat";
import { AccessDenied, RuleError, assertCaller, requireAdmin, requirePerm, type Actor } from "./guard";
import { NotFound } from "./scope";

/**
 * Chat for Stream partners and Employees (their own module; the older Team chat code is untouched and
 * refuses them, since they hold no chat permission).
 *
 * Who may talk to whom (direct messages only):
 *   - an employee: their own partner, and any admin;
 *   - a stream partner: their own employees, and any admin;
 *   - an admin: any stream partner or employee.
 * Never partner to partner, employee to employee, or an employee to another partner. Scoped people are
 * never in #general or any channel, and never appear in anyone else's people lists. A person who isn't
 * an allowed contact, and a person who doesn't exist, look exactly the same ("That no longer exists.").
 *
 * Oversight: an admin may read a conversation they are not in only if it includes at least one stream
 * partner or employee. Every such read writes the audit log (who, which conversation; never the
 * messages). Conversations between two admins stay private and can't be opened here.
 */
const { chatChannels: channels, chatMembers: members, chatMessages: messages, users, userPresence, employeeAssignments } = schema;

const MAX_MESSAGE = 4000;
const SCOPED = ["stream_partner", "employee"] as const;

function ensureScoped(actor: Actor, action: "view" | "create") {
  assertCaller(actor);
  const module = actor.presetId === "stream_partner" ? "stream_partner" : actor.presetId === "employee" ? "employee" : null;
  if (!module || !actor.scoped) throw new AccessDenied();
  requirePerm(actor, module, action);
}

type Person = { id: string; name: string; presetId: string };

/** Is this person someone the caller may chat with? (Active accounts only.) */
async function allowedContact(db: Db | Tx, actor: Actor, otherId: string): Promise<Person | null> {
  if (otherId === actor.userId) return null;
  const [o] = await db.select({ id: users.id, name: users.fullName, email: users.email, presetId: users.presetId, status: users.status }).from(users).where(eq(users.id, otherId));
  if (!o || o.status !== "active") return null;
  const person = { id: o.id, name: o.name || o.email, presetId: o.presetId };
  if (actor.isAdmin) return (SCOPED as readonly string[]).includes(o.presetId) ? person : null;
  if (o.presetId === "admin") return person;
  if (actor.scoped?.kind === "employee") return actor.scoped.partnerUserId === o.id ? person : null;
  if (actor.scoped?.kind === "stream_partner" && o.presetId === "employee") {
    const [a] = await db.select({ e: employeeAssignments.employeeUserId }).from(employeeAssignments).where(and(eq(employeeAssignments.employeeUserId, o.id), eq(employeeAssignments.partnerUserId, actor.userId)));
    return a ? person : null;
  }
  return null;
}

export type Contact = { id: string; name: string; role: "partner" | "employee" | "admin" };

/** The people the signed-in partner or employee may start a conversation with. */
export async function scopedContacts(actor: Actor): Promise<Contact[]> {
  ensureScoped(actor, "view");
  const db = getDb();
  const out: Contact[] = [];
  const admins = await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(and(eq(users.presetId, "admin"), eq(users.status, "active"))).orderBy(asc(users.fullName));
  if (actor.scoped?.kind === "employee" && actor.scoped.partnerUserId) {
    const [p] = await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(and(eq(users.id, actor.scoped.partnerUserId), eq(users.status, "active")));
    if (p) out.push({ id: p.id, name: p.name || p.email, role: "partner" });
  }
  if (actor.scoped?.kind === "stream_partner") {
    const staff = await db
      .select({ id: users.id, name: users.fullName, email: users.email })
      .from(employeeAssignments)
      .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
      .where(and(eq(employeeAssignments.partnerUserId, actor.userId), eq(users.status, "active")))
      .orderBy(asc(users.fullName));
    for (const s of staff) out.push({ id: s.id, name: s.name || s.email, role: "employee" });
  }
  for (const a of admins) out.push({ id: a.id, name: a.name || a.email, role: "admin" });
  return out;
}

async function openOrCreateDm(db: Db, actor: Actor, otherId: string): Promise<string> {
  const key = [actor.userId, otherId].sort().join(":");
  const [existing] = await db.select({ id: channels.id }).from(channels).where(eq(channels.dmKey, key));
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(channels).values({ id, kind: "dm", dmKey: key, createdBy: actor.userId });
      await tx.insert(members).values([
        { channelId: id, userId: actor.userId },
        { channelId: id, userId: otherId, lastReadAt: new Date(0) },
      ]);
    });
  } catch {
    const [again] = await db.select({ id: channels.id }).from(channels).where(eq(channels.dmKey, key));
    if (again) return again.id;
    throw new RuleError("That conversation couldn't be opened. Try again.");
  }
  return id;
}

/** A partner or employee starts (or reopens) a conversation with an allowed contact. */
export async function startScopedDm(actor: Actor, otherId: string): Promise<string> {
  ensureScoped(actor, "create");
  const db = getDb();
  if (!(await allowedContact(db, actor, otherId))) throw new NotFound();
  return openOrCreateDm(db, actor, otherId);
}

/** An admin starts a conversation with a stream partner or employee (it then shows in their normal Team chat). */
export async function startDmAsAdmin(actor: Actor, otherId: string): Promise<string> {
  requireAdmin(actor);
  const db = getDb();
  if (!(await allowedContact(db, actor, otherId))) throw new NotFound();
  return openOrCreateDm(db, actor, otherId);
}

export type ScopedConversation = { id: string; with: string; withId: string; online: boolean; unread: number; lastAt: Date | null };

/** The caller's conversations, hiding any with someone they may no longer talk to (e.g. an employee who moved partner). */
export async function scopedConversations(actor: Actor): Promise<ScopedConversation[]> {
  ensureScoped(actor, "view");
  const db = getDb();
  const mine = await db
    .select({ id: channels.id, lastReadAt: members.lastReadAt })
    .from(members)
    .innerJoin(channels, eq(channels.id, members.channelId))
    .where(and(eq(members.userId, actor.userId), eq(channels.kind, "dm"), isNull(channels.archivedAt)));
  if (!mine.length) return [];
  const ids = mine.map((m) => m.id);
  const [others, unread, last] = await Promise.all([
    db.select({ channelId: members.channelId, userId: members.userId }).from(members).where(and(inArray(members.channelId, ids), ne(members.userId, actor.userId))),
    db
      .select({ channelId: messages.channelId, n: count() })
      .from(messages)
      .innerJoin(members, and(eq(members.channelId, messages.channelId), eq(members.userId, actor.userId)))
      .where(and(inArray(messages.channelId, ids), ne(messages.authorId, actor.userId), isNull(messages.deletedAt), gt(messages.createdAt, members.lastReadAt)))
      .groupBy(messages.channelId),
    db.select({ channelId: messages.channelId, at: sql<Date>`max(${messages.createdAt})` }).from(messages).where(inArray(messages.channelId, ids)).groupBy(messages.channelId),
  ]);
  const since = new Date(Date.now() - ONLINE_SECONDS * 1000);
  const seen = others.length ? await db.select({ id: userPresence.userId }).from(userPresence).where(and(inArray(userPresence.userId, others.map((o) => o.userId)), gt(userPresence.lastSeenAt, since))) : [];
  const out: ScopedConversation[] = [];
  for (const m of mine) {
    const other = others.find((o) => o.channelId === m.id);
    if (!other) continue;
    const person = await allowedContact(db, actor, other.userId);
    if (!person) continue;
    const at = last.find((l) => l.channelId === m.id)?.at ?? null;
    out.push({ id: m.id, with: person.name, withId: person.id, online: seen.some((s) => s.id === other.userId), unread: Number(unread.find((u) => u.channelId === m.id)?.n ?? 0), lastAt: at ? new Date(at) : null });
  }
  return out.sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
}

/** The one gate: the caller is in this conversation AND the other person is still an allowed contact. */
async function requireMemberOfAllowed(db: Db | Tx, actor: Actor, channelId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) throw new NotFound();
  const [row] = await db
    .select({ id: channels.id, kind: channels.kind, archivedAt: channels.archivedAt })
    .from(members)
    .innerJoin(channels, eq(channels.id, members.channelId))
    .where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
  if (!row || row.kind !== "dm") throw new NotFound();
  const [other] = await db.select({ userId: members.userId }).from(members).where(and(eq(members.channelId, channelId), ne(members.userId, actor.userId)));
  const person = other ? await allowedContact(db, actor, other.userId) : null;
  if (!person) throw new NotFound();
  return { channel: row, other: person };
}

export type ScopedMessage = { id: string; mine: boolean; author: string; body: string; deleted: boolean; at: string };

async function loadMessages(db: Db | Tx, channelId: string, viewerId: string): Promise<ScopedMessage[]> {
  const rows = await db
    .select({ id: messages.id, authorId: messages.authorId, name: users.fullName, email: users.email, body: messages.body, deletedAt: messages.deletedAt, createdAt: messages.createdAt })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(200);
  return rows.reverse().map((r) => ({ id: r.id, mine: r.authorId === viewerId, author: r.name || r.email, body: r.deletedAt ? "" : r.body, deleted: !!r.deletedAt, at: r.createdAt.toISOString() }));
}

/** Opens one of the caller's conversations (and marks it read). */
export async function openScopedConversation(actor: Actor, channelId: string) {
  ensureScoped(actor, "view");
  const db = getDb();
  const { other } = await requireMemberOfAllowed(db, actor, channelId);
  await db.update(members).set({ lastReadAt: new Date() }).where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
  return { id: channelId, with: other.name, withId: other.id, messages: await loadMessages(db, channelId, actor.userId) };
}

export async function sendScopedMessage(actor: Actor, channelId: string, body: string): Promise<void> {
  ensureScoped(actor, "create");
  const text = body.trim();
  if (!text) throw new RuleError("Write a message first.");
  if (text.length > MAX_MESSAGE) throw new RuleError(`Keep messages under ${MAX_MESSAGE.toLocaleString("en-AU")} characters.`);
  const db = getDb();
  const { channel } = await requireMemberOfAllowed(db, actor, channelId);
  if (channel.archivedAt) throw new RuleError("This conversation is archived, so it's read-only.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(messages).values({ id: crypto.randomUUID(), channelId, authorId: actor.userId, body: text, createdAt: now, updatedAt: now });
    await tx.update(members).set({ lastReadAt: now, typingUntil: null }).where(and(eq(members.channelId, channelId), eq(members.userId, actor.userId)));
  });
}

// ---------------------------------------------------------------- admin oversight
export type OversightRow = { id: string; people: string[]; lastAt: Date | null; messages: number };

/** Conversations an admin is NOT in that include at least one stream partner or employee. Never admin-to-admin chats, never message text. */
export async function oversightConversations(actor: Actor): Promise<OversightRow[]> {
  requireAdmin(actor);
  const db = getDb();
  const dms = await db
    .select({ channelId: members.channelId, userId: members.userId, name: users.fullName, email: users.email, presetId: users.presetId })
    .from(members)
    .innerJoin(channels, eq(channels.id, members.channelId))
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(channels.kind, "dm"));
  const byChannel = new Map<string, typeof dms>();
  for (const d of dms) byChannel.set(d.channelId, [...(byChannel.get(d.channelId) ?? []), d]);
  const wanted = [...byChannel.entries()].filter(([, ps]) => ps.some((p) => (SCOPED as readonly string[]).includes(p.presetId)) && !ps.some((p) => p.userId === actor.userId));
  if (!wanted.length) return [];
  const ids = wanted.map(([id]) => id);
  const stats = await db
    .select({ channelId: messages.channelId, n: count(), at: sql<Date>`max(${messages.createdAt})` })
    .from(messages)
    .where(inArray(messages.channelId, ids))
    .groupBy(messages.channelId);
  return wanted
    .map(([id, ps]) => ({ id, people: ps.map((p) => p.name || p.email), lastAt: stats.find((s) => s.channelId === id)?.at ? new Date(stats.find((s) => s.channelId === id)!.at) : null, messages: Number(stats.find((s) => s.channelId === id)?.n ?? 0) }))
    .sort((a, b) => (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0));
}

/**
 * An admin reads a conversation they are not part of. Only when it includes a stream partner or employee;
 * the read itself is written to the audit log (never the messages). Anything else is "not found".
 */
export async function oversightRead(actor: Actor, channelId: string) {
  requireAdmin(actor);
  if (!/^[0-9a-f-]{36}$/i.test(channelId)) throw new NotFound();
  const db = getDb();
  const [ch] = await db.select({ id: channels.id, kind: channels.kind }).from(channels).where(eq(channels.id, channelId));
  if (!ch || ch.kind !== "dm") throw new NotFound();
  const people = await db
    .select({ id: users.id, name: users.fullName, email: users.email, presetId: users.presetId })
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.channelId, channelId));
  if (!people.some((p) => (SCOPED as readonly string[]).includes(p.presetId))) throw new NotFound(); // admin-to-admin chats stay private
  const names = people.map((p) => p.name || p.email);
  const isParticipant = people.some((p) => p.id === actor.userId);
  if (!isParticipant) {
    await writeAudit(db, actorRef(actor), { action: "read", entity: "chat_channels", entityId: channelId, summary: `Admin read a conversation between ${names.join(" and ")}`, after: { participants: people.map((p) => p.id) } });
  }
  return { id: channelId, people: names, messages: await loadMessages(db, channelId, actor.userId), participant: isParticipant };
}
