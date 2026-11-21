import "server-only";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { mysqlCode } from "./assignments";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, hasPerm, requireAdmin, type Actor } from "./guard";

/**
 * Kinds of work for projects: a niche (Motion graphics, Web development, App development, 3D) and its
 * sub-categories (WordPress, Shopify, CRM, SaaS...). A partner picks one of each when adding a project and can
 * ADD THEIR OWN sub-category if the right one isn't there. A custom sub-category is shared (everyone sees it next
 * time); admins rename, archive or tidy the lists in Settings. Every change is logged.
 */
const { niches, subNiches } = schema;

export type NicheOption = { id: number; name: string; subs: Array<{ id: number; name: string; isCustom: boolean }> };

/** Who may read the lists: a partner, or an admin. */
function ensureReader(actor: Actor) {
  assertCaller(actor);
  if (!(actor.isAdmin || hasPerm(actor, "stream_partner", "view"))) throw new AccessDenied();
}

/** The active niches with their active sub-categories (for the project forms). */
export async function listNiches(actor: Actor): Promise<NicheOption[]> {
  ensureReader(actor);
  return loadNiches(getDb(), false);
}

async function loadNiches(db: Db | Tx, includeInactive: boolean): Promise<NicheOption[]> {
  const [n, s] = await Promise.all([
    db.select().from(niches).where(includeInactive ? undefined : eq(niches.active, true)).orderBy(asc(niches.sort), asc(niches.name)),
    db.select().from(subNiches).where(includeInactive ? undefined : eq(subNiches.active, true)).orderBy(asc(subNiches.sort), asc(subNiches.name)),
  ]);
  return n.map((x) => ({ id: x.id, name: x.name, subs: s.filter((y) => y.nicheId === x.id).map((y) => ({ id: y.id, name: y.name, isCustom: y.isCustom })) }));
}

const subName = z.string().trim().min(1, "Type a name for the sub-category.").max(80, "Use 80 characters or fewer.");

/**
 * Finds (case-insensitively) or adds a sub-category under a niche, inside the caller's transaction. A name that
 * already exists is reused (and brought back if it was archived), so "wordpress" and "WordPress" are one.
 */
export async function findOrAddSubNiche(tx: Tx, actor: Actor, nicheId: number, rawName: string): Promise<number> {
  const parsed = subName.safeParse(rawName);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0].message);
  const name = parsed.data.replace(/\s+/g, " ");
  const [niche] = await tx.select({ id: niches.id, active: niches.active }).from(niches).where(eq(niches.id, nicheId));
  if (!niche || !niche.active) throw new RuleError("Choose a niche from the list.");
  const [existing] = await tx.select().from(subNiches).where(and(eq(subNiches.nicheId, nicheId), sql`lower(${subNiches.name}) = ${name.toLowerCase()}`)).for("update");
  if (existing) {
    if (!existing.active) await tx.update(subNiches).set({ active: true }).where(eq(subNiches.id, existing.id));
    return existing.id;
  }
  try {
    const [res] = await tx.insert(subNiches).values({ nicheId, name, isCustom: true, createdBy: actor.userId, sort: 500 });
    const id = Number((res as unknown as { insertId: number }).insertId);
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "sub_niches", entityId: String(id), summary: `Added sub-category "${name}"`, after: { nicheId, name, custom: true } });
    return id;
  } catch (e) {
    if (mysqlCode(e) === "ER_DUP_ENTRY") {
      const [again] = await tx.select({ id: subNiches.id }).from(subNiches).where(and(eq(subNiches.nicheId, nicheId), sql`lower(${subNiches.name}) = ${name.toLowerCase()}`));
      if (again) return again.id;
    }
    throw e;
  }
}

/** Checks a niche and sub-category pair that came from a form: both active, and the sub-category belongs to the niche. */
export async function checkNichePair(tx: Db | Tx, nicheId: number | null, subNicheId: number | null): Promise<void> {
  if (!nicheId && !subNicheId) return;
  if (!nicheId) throw new RuleError("Choose a niche first.");
  const [n] = await tx.select({ id: niches.id, active: niches.active }).from(niches).where(eq(niches.id, nicheId));
  if (!n || !n.active) throw new RuleError("Choose a niche from the list.");
  if (subNicheId) {
    const [s] = await tx.select({ id: subNiches.id, active: subNiches.active }).from(subNiches).where(and(eq(subNiches.id, subNicheId), eq(subNiches.nicheId, nicheId)));
    if (!s || !s.active) throw new RuleError("Choose a sub-category that belongs to that niche.");
  }
}

// ---------------------------------------------------------------- admin: Settings
export async function nichesForAdmin(actor: Actor): Promise<Array<NicheOption & { active: boolean; subs: Array<{ id: number; name: string; isCustom: boolean; active: boolean }> }>> {
  requireAdmin(actor);
  const db = getDb();
  const [n, s] = await Promise.all([db.select().from(niches).orderBy(asc(niches.sort), asc(niches.name)), db.select().from(subNiches).orderBy(asc(subNiches.sort), asc(subNiches.name))]);
  return n.map((x) => ({ id: x.id, name: x.name, active: x.active, subs: s.filter((y) => y.nicheId === x.id).map((y) => ({ id: y.id, name: y.name, isCustom: y.isCustom, active: y.active })) }));
}

export async function saveNiche(actor: Actor, input: { id: number | null; name: string }) {
  requireAdmin(actor);
  const name = subName.safeParse(input.name);
  if (!name.success) throw new RuleError(name.error.issues[0].message);
  await getDb().transaction(async (tx) => {
    try {
      if (input.id) {
        const [before] = await tx.select().from(niches).where(eq(niches.id, input.id)).for("update");
        if (!before) throw new RuleError("That niche no longer exists.");
        if (before.name === name.data) return;
        await tx.update(niches).set({ name: name.data }).where(eq(niches.id, input.id));
        await writeAudit(tx, actorRef(actor), { action: "update", entity: "niches", entityId: String(input.id), before: { name: before.name }, after: { name: name.data } });
      } else {
        const [res] = await tx.insert(niches).values({ name: name.data, sort: 500 });
        await writeAudit(tx, actorRef(actor), { action: "create", entity: "niches", entityId: String((res as unknown as { insertId: number }).insertId), after: { name: name.data } });
      }
    } catch (e) {
      if (mysqlCode(e) === "ER_DUP_ENTRY") throw new RuleError("There is already a niche with that name.");
      throw e;
    }
  });
}

export async function saveSubNiche(actor: Actor, input: { id: number | null; nicheId: number; name: string }) {
  requireAdmin(actor);
  const name = subName.safeParse(input.name);
  if (!name.success) throw new RuleError(name.error.issues[0].message);
  await getDb().transaction(async (tx) => {
    if (!input.id) {
      await findOrAddSubNiche(tx, actor, input.nicheId, name.data);
      return;
    }
    const [before] = await tx.select().from(subNiches).where(eq(subNiches.id, input.id)).for("update");
    if (!before) throw new RuleError("That sub-category no longer exists.");
    if (before.name === name.data) return;
    try {
      await tx.update(subNiches).set({ name: name.data }).where(eq(subNiches.id, input.id));
    } catch (e) {
      if (mysqlCode(e) === "ER_DUP_ENTRY") throw new RuleError("That niche already has a sub-category with that name.");
      throw e;
    }
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "sub_niches", entityId: String(input.id), before: { name: before.name }, after: { name: name.data } });
  });
}

/** Archive or bring back a niche or sub-category. Projects that already use it keep it; nothing is deleted. */
export async function setNicheActive(actor: Actor, input: { kind: "niche" | "sub"; id: number; active: boolean }) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const table = input.kind === "niche" ? niches : subNiches;
    const [before] = await tx.select().from(table).where(eq(table.id, input.id)).for("update");
    if (!before) throw new RuleError("That no longer exists.");
    if (before.active === input.active) return;
    await tx.update(table).set({ active: input.active }).where(eq(table.id, input.id));
    await writeAudit(tx, actorRef(actor), { action: input.active ? "update" : "archive", entity: input.kind === "niche" ? "niches" : "sub_niches", entityId: String(input.id), summary: `${input.active ? "Restored" : "Archived"} ${before.name}`, before: { active: before.active }, after: { active: input.active } });
  });
}

/** Names for a set of ids (used by project lists). */
export async function nicheNames(db: Db | Tx, nicheIds: number[], subIds: number[]) {
  const [n, s] = await Promise.all([
    nicheIds.length ? db.select({ id: niches.id, name: niches.name }).from(niches).where(inArray(niches.id, nicheIds)) : [],
    subIds.length ? db.select({ id: subNiches.id, name: subNiches.name }).from(subNiches).where(inArray(subNiches.id, subIds)) : [],
  ]);
  return { niche: new Map(n.map((x) => [x.id, x.name])), sub: new Map(s.map((x) => [x.id, x.name])) };
}
