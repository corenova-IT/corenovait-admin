import "server-only";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { RuleError, requireOwner, type Actor } from "./guard";

/**
 * Projects and who can't see their money. Everything here is owner-only:
 * creating and switching off projects, and hiding a project's income from
 * named people. Changes are audited (and those audit rows are owner-only too,
 * see auditVisible in visibility.ts).
 */
const { projects, projectHiddenFrom, incomeEntries, streams, users } = schema;

const nameSchema = z.string().trim().min(1, "Give the project a name.").max(120, "Keep the name under 120 characters.");

export type OwnerProject = {
  id: string;
  name: string;
  streamId: number;
  streamName: string;
  active: boolean;
  entries: number;
  /** paid income in the base currency, whole cents */
  paidBaseMinor: number;
  hiddenFrom: string[];
};
export type HideCandidate = { id: string; name: string; email: string; status: "invited" | "active" | "deactivated" };

/** The owner's project screen: every project with its totals and who it's hidden from, and the people it could be hidden from. */
export async function ownerProjects(actor: Actor): Promise<{ projects: OwnerProject[]; people: HideCandidate[]; streams: Array<{ id: number; name: string }> }> {
  requireOwner(actor);
  const db = getDb();
  const [list, totals, hidden, people, streamRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name, streamId: projects.streamId, streamName: streams.name, active: projects.active })
      .from(projects)
      .innerJoin(streams, eq(streams.id, projects.streamId))
      .orderBy(asc(streams.sort), asc(streams.name), asc(projects.name)),
    db
      .select({
        projectId: incomeEntries.projectId,
        n: count(),
        paid: sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then ${incomeEntries.amountBaseMinor} else 0 end), 0)`,
      })
      .from(incomeEntries)
      .groupBy(incomeEntries.projectId),
    db.select({ projectId: projectHiddenFrom.projectId, userId: projectHiddenFrom.userId }).from(projectHiddenFrom),
    db
      .select({ id: users.id, name: users.fullName, email: users.email, status: users.status, isOwner: users.isOwner })
      .from(users)
      .orderBy(asc(users.fullName), asc(users.email)),
    db.select({ id: streams.id, name: streams.name }).from(streams).where(eq(streams.active, true)).orderBy(asc(streams.sort), asc(streams.name)),
  ]);
  return {
    streams: streamRows,
    projects: list.map((p) => {
      const t = totals.find((x) => x.projectId === p.id);
      return { ...p, entries: Number(t?.n ?? 0), paidBaseMinor: Number(t?.paid ?? 0), hiddenFrom: hidden.filter((h) => h.projectId === p.id).map((h) => h.userId) };
    }),
    // the owner can't be hidden from anything, so isn't offered
    people: people.filter((u) => !u.isOwner).map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status })),
  };
}

async function loadProject(db: ReturnType<typeof getDb>, id: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new RuleError("That project no longer exists. Refresh the page.");
  return p;
}

function duplicate(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return code === "ER_DUP_ENTRY";
}

export async function createProject(actor: Actor, input: { streamId: number; name: string }): Promise<string> {
  requireOwner(actor);
  const name = nameSchema.safeParse(input.name);
  if (!name.success) throw new RuleError(name.error.issues[0].message);
  const db = getDb();
  const [stream] = await db.select({ id: streams.id }).from(streams).where(eq(streams.id, Number(input.streamId)));
  if (!stream) throw new RuleError("Choose a revenue stream.");
  const id = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(projects).values({ id, streamId: stream.id, name: name.data, createdBy: actor.userId });
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "projects", entityId: id, summary: `Project "${name.data}" created`, after: { streamId: stream.id, name: name.data } });
    });
  } catch (e) {
    if (duplicate(e)) throw new RuleError("That stream already has a project with that name.");
    throw e;
  }
  return id;
}

export async function renameProject(actor: Actor, id: string, rawName: string) {
  requireOwner(actor);
  const name = nameSchema.safeParse(rawName);
  if (!name.success) throw new RuleError(name.error.issues[0].message);
  const db = getDb();
  const p = await loadProject(db, id);
  try {
    await db.transaction(async (tx) => {
      await tx.update(projects).set({ name: name.data }).where(eq(projects.id, id));
      await writeAudit(tx, actorRef(actor), { action: "update", entity: "projects", entityId: id, summary: `Project renamed to "${name.data}"`, before: { name: p.name }, after: { name: name.data } });
    });
  } catch (e) {
    if (duplicate(e)) throw new RuleError("That stream already has a project with that name.");
    throw e;
  }
}

/** Switching a project off stops new income being filed under it; existing entries keep it. */
export async function setProjectActive(actor: Actor, id: string, active: boolean) {
  requireOwner(actor);
  const db = getDb();
  const p = await loadProject(db, id);
  await db.transaction(async (tx) => {
    await tx.update(projects).set({ active }).where(eq(projects.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "projects", entityId: id, summary: `Project "${p.name}" ${active ? "switched on" : "switched off"}`, before: { active: p.active }, after: { active } });
  });
}

/** Only an empty project can be deleted; otherwise switch it off. */
export async function deleteProject(actor: Actor, id: string) {
  requireOwner(actor);
  const db = getDb();
  const p = await loadProject(db, id);
  await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(incomeEntries).where(eq(incomeEntries.projectId, id));
    if (n > 0) throw new RuleError("This project has income in it, so it can't be deleted. Switch it off instead.");
    await tx.delete(projects).where(eq(projects.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "projects", entityId: id, summary: `Project "${p.name}" deleted`, before: { streamId: p.streamId, name: p.name } });
  });
}

/**
 * Sets the whole "can't see this project's money" list in one go (what the
 * owner's screen submits). Each person added or removed is audited. Takes
 * effect on their very next request.
 */
export async function setProjectHiddenFrom(actor: Actor, projectId: string, userIds: string[]) {
  requireOwner(actor);
  const wanted = [...new Set(userIds)];
  const db = getDb();
  const p = await loadProject(db, projectId);
  await db.transaction(async (tx) => {
    const people = await tx.select({ id: users.id, email: users.email, isOwner: users.isOwner }).from(users);
    const known = new Map(people.map((u) => [u.id, u]));
    for (const id of wanted) {
      const u = known.get(id);
      if (!u) throw new RuleError("That person no longer exists. Refresh the page.");
      if (u.isOwner) throw new RuleError("The owner always sees everything.");
    }
    const current = new Set((await tx.select({ userId: projectHiddenFrom.userId }).from(projectHiddenFrom).where(eq(projectHiddenFrom.projectId, p.id)).for("update")).map((r) => r.userId));
    const add = wanted.filter((id) => !current.has(id));
    const remove = [...current].filter((id) => !wanted.includes(id));
    for (const id of add) {
      await tx.insert(projectHiddenFrom).values({ projectId: p.id, userId: id, hiddenBy: actor.userId });
      await writeAudit(tx, actorRef(actor), { action: "permissions", entity: "project_hidden_from", entityId: p.id, summary: `Hid project "${p.name}" from ${known.get(id)!.email}`, before: { hidden: false }, after: { hidden: true, userId: id } });
    }
    for (const id of remove) {
      await tx.delete(projectHiddenFrom).where(and(eq(projectHiddenFrom.projectId, p.id), eq(projectHiddenFrom.userId, id)));
      await writeAudit(tx, actorRef(actor), { action: "permissions", entity: "project_hidden_from", entityId: p.id, summary: `Showed project "${p.name}" to ${known.get(id)?.email ?? "a removed person"}`, before: { hidden: true }, after: { hidden: false, userId: id } });
    }
  });
}

/** Hide (or stop hiding) one project's money from one person. Takes effect on their very next request. */
export async function setProjectHidden(actor: Actor, input: { projectId: string; userId: string; hidden: boolean }) {
  requireOwner(actor);
  const db = getDb();
  const p = await loadProject(db, input.projectId);
  const [u] = await db.select({ id: users.id, email: users.email, isOwner: users.isOwner }).from(users).where(eq(users.id, input.userId));
  if (!u) throw new RuleError("That person no longer exists. Refresh the page.");
  if (u.isOwner) throw new RuleError("The owner always sees everything.");
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ userId: projectHiddenFrom.userId })
      .from(projectHiddenFrom)
      .where(and(eq(projectHiddenFrom.projectId, p.id), eq(projectHiddenFrom.userId, u.id)))
      .for("update");
    if (input.hidden === !!existing) return; // already the way it should be
    if (input.hidden) await tx.insert(projectHiddenFrom).values({ projectId: p.id, userId: u.id, hiddenBy: actor.userId });
    else await tx.delete(projectHiddenFrom).where(and(eq(projectHiddenFrom.projectId, p.id), eq(projectHiddenFrom.userId, u.id)));
    await writeAudit(tx, actorRef(actor), {
      action: "permissions",
      entity: "project_hidden_from",
      entityId: p.id,
      summary: `${input.hidden ? "Hid" : "Showed"} project "${p.name}" ${input.hidden ? "from" : "to"} ${u.email}`,
      before: { hidden: !input.hidden },
      after: { hidden: input.hidden, userId: u.id },
    });
  });
}
