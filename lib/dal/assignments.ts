import "server-only";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { RuleError, requireAdmin, type Actor } from "./guard";

/**
 * Admin side of Stream partners: which streams and countries a partner is assigned.
 * Only an admin with two-factor done can change them. Every change writes the audit log
 * (before and after). The rows themselves are READ for the partner through lib/dal/scope.ts.
 *
 * One stream belongs to at most one partner. That is enforced twice: here, with a friendly
 * message, and by the primary key on stream_partner_streams.stream_id, which stays true even
 * if two admins click at the same moment.
 */
const { users, streams, countries, streamPartnerStreams, streamPartnerCountries } = schema;

export type AssignInput = { streamIds: number[]; countryCodes: string[] };
export type AssignmentOptions = {
  streams: Array<{ id: number; name: string; active: boolean; partnerUserId: string | null; partnerName: string | null }>;
  countries: Array<{ code: string; name: string }>;
};
export type PartnerAssignment = { streamIds: number[]; countryCodes: string[] };

const BUSY = "Someone else just assigned one of those streams. Refresh the page and try again.";

/** The MySQL error code buried inside a driver or ORM error (duplicate key, deadlock). */
function mysqlCode(e: unknown): string | undefined {
  for (let x: unknown = e, i = 0; x && typeof x === "object" && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && code.startsWith("ER_")) return code;
  }
  return undefined;
}

const clean = <T extends string | number>(xs: T[]): T[] => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Runs the change and turns "someone else got there first" into a plain message. */
export async function guardedAssign<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = mysqlCode(e);
    if (code === "ER_DUP_ENTRY" || code === "ER_LOCK_DEADLOCK") throw new RuleError(BUSY);
    throw e;
  }
}

/**
 * Sets a partner's streams and countries to exactly this list, inside the caller's transaction.
 * Streams that belong to someone else are refused by name. Wrap the whole transaction in guardedAssign.
 */
export async function applyAssignments(tx: Tx, actor: Actor, target: { id: string; email: string }, input: AssignInput): Promise<void> {
  const streamIds = clean(input.streamIds);
  const countryCodes = clean(input.countryCodes);

  if (streamIds.length) {
    const found = await tx.select({ id: streams.id }).from(streams).where(inArray(streams.id, streamIds));
    if (found.length !== streamIds.length) throw new RuleError("Choose streams from the list.");
  }
  if (countryCodes.length) {
    const found = await tx.select({ code: countries.code }).from(countries).where(inArray(countries.code, countryCodes));
    if (found.length !== countryCodes.length) throw new RuleError("Choose countries from the list.");
  }

  // lock this person's rows and any row for the wanted streams, so two admins can't both claim a stream
  const held = await tx
    .select({ streamId: streamPartnerStreams.streamId, userId: streamPartnerStreams.userId })
    .from(streamPartnerStreams)
    .where(streamIds.length ? or(eq(streamPartnerStreams.userId, target.id), inArray(streamPartnerStreams.streamId, streamIds)) : eq(streamPartnerStreams.userId, target.id))
    .for("update");
  const clash = held.find((r) => r.userId !== target.id && streamIds.includes(r.streamId));
  if (clash) {
    const [row] = await tx
      .select({ stream: streams.name, partner: users.fullName, email: users.email })
      .from(streams)
      .innerJoin(users, eq(users.id, clash.userId))
      .where(eq(streams.id, clash.streamId));
    throw new RuleError(`${row?.stream ?? "That stream"} already belongs to ${row?.partner || row?.email || "another partner"}. A stream can have only one partner.`);
  }
  const currentStreams = clean(held.filter((r) => r.userId === target.id).map((r) => r.streamId));
  const currentCountries = clean(
    (await tx.select({ code: streamPartnerCountries.countryCode }).from(streamPartnerCountries).where(eq(streamPartnerCountries.userId, target.id)).for("update")).map((r) => r.code)
  );

  const names = async (ids: number[]) =>
    ids.length ? (await tx.select({ n: streams.name }).from(streams).where(inArray(streams.id, ids)).orderBy(asc(streams.name))).map((r) => r.n) : [];
  const same = <T>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

  if (!same(currentStreams, streamIds)) {
    const toRemove = currentStreams.filter((s) => !streamIds.includes(s));
    const toAdd = streamIds.filter((s) => !currentStreams.includes(s));
    if (toRemove.length) await tx.delete(streamPartnerStreams).where(and(eq(streamPartnerStreams.userId, target.id), inArray(streamPartnerStreams.streamId, toRemove)));
    if (toAdd.length) await tx.insert(streamPartnerStreams).values(toAdd.map((streamId) => ({ streamId, userId: target.id, assignedBy: actor.userId })));
    const [before, after] = [await names(currentStreams), await names(streamIds)];
    await writeAudit(tx, actorRef(actor), {
      action: "assign",
      entity: "stream_partner_streams",
      entityId: target.id,
      summary: `Streams for ${target.email}: ${after.length ? after.join(", ") : "none"}`,
      before: { streamIds: currentStreams, streams: before },
      after: { streamIds, streams: after },
    });
  }

  if (!same(currentCountries, countryCodes)) {
    const toRemove = currentCountries.filter((c) => !countryCodes.includes(c));
    const toAdd = countryCodes.filter((c) => !currentCountries.includes(c));
    if (toRemove.length) await tx.delete(streamPartnerCountries).where(and(eq(streamPartnerCountries.userId, target.id), inArray(streamPartnerCountries.countryCode, toRemove)));
    if (toAdd.length) await tx.insert(streamPartnerCountries).values(toAdd.map((countryCode) => ({ userId: target.id, countryCode, assignedBy: actor.userId })));
    await writeAudit(tx, actorRef(actor), {
      action: "assign",
      entity: "stream_partner_countries",
      entityId: target.id,
      summary: `Countries for ${target.email}: ${countryCodes.length ? countryCodes.join(", ") : "none"}`,
      before: { countryCodes: currentCountries },
      after: { countryCodes },
    });
  }
}

/** Used when someone stops being a Stream partner: their streams and countries are freed (logged); nothing else is touched. */
export async function releaseAssignments(tx: Tx, actor: Actor, target: { id: string; email: string }): Promise<void> {
  await applyAssignments(tx, actor, target, { streamIds: [], countryCodes: [] });
}

/** Admin: replace a stream partner's streams and countries. */
export async function setAssignments(actor: Actor, input: { userId: string } & AssignInput): Promise<void> {
  requireAdmin(actor);
  await guardedAssign(() =>
    getDb().transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, input.userId)).for("update");
      if (!u) throw new RuleError("That person no longer exists. Refresh the page.");
      if (u.presetId !== "stream_partner") throw new RuleError("Only stream partners have streams and countries.");
      await applyAssignments(tx, actor, { id: u.id, email: u.email }, input);
    })
  );
}

/** For the Team page: every stream with its partner, every country, and each partner's current assignment. */
export async function assignmentOverview(actor: Actor): Promise<{ options: AssignmentOptions; byUser: Record<string, PartnerAssignment> }> {
  requireAdmin(actor);
  const db = getDb();
  const [streamRows, countryRows, owned, countrySel] = await Promise.all([
    db.select().from(streams).orderBy(asc(streams.sort), asc(streams.name)),
    db.select().from(countries).orderBy(asc(countries.sort), asc(countries.name)),
    db
      .select({ streamId: streamPartnerStreams.streamId, userId: streamPartnerStreams.userId, name: users.fullName, email: users.email })
      .from(streamPartnerStreams)
      .innerJoin(users, eq(users.id, streamPartnerStreams.userId)),
    db.select({ userId: streamPartnerCountries.userId, code: streamPartnerCountries.countryCode }).from(streamPartnerCountries),
  ]);
  const byUser: Record<string, PartnerAssignment> = {};
  const slot = (id: string) => (byUser[id] ??= { streamIds: [], countryCodes: [] });
  for (const o of owned) slot(o.userId).streamIds.push(o.streamId);
  for (const c of countrySel) slot(c.userId).countryCodes.push(c.code);
  const owner = new Map(owned.map((o) => [o.streamId, o]));
  return {
    options: {
      streams: streamRows.map((s) => {
        const o = owner.get(s.id);
        return { id: s.id, name: s.name, active: s.active, partnerUserId: o?.userId ?? null, partnerName: o ? o.name || o.email : null };
      }),
      countries: countryRows.map((c) => ({ code: c.code, name: c.name })),
    },
    byUser,
  };
}
