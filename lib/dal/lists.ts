import "server-only";
import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, requirePerm, type Actor } from "./guard";

/**
 * The lists admins edit in Settings: revenue streams, countries and expense
 * categories. Admin only (Settings permission + Admin role + two-factor).
 * Anything in use can be renamed or archived, but not deleted, so history
 * and reports never point at something that's gone.
 */
const { streams, countries, expenseCategories, incomeEntries, expenses, subscriptions } = schema;

function requireSettingsAdmin(actor: Actor, action: "view" | "edit") {
  requirePerm(actor, "settings", action);
  if (!actor.isAdmin) throw new AccessDenied("Only admins can change these lists.");
  if (!actor.mfaVerified) throw new AccessDenied("Verify your two-factor code, then try again.");
}

const name80 = z.string().trim().min(1, "Enter a name.").max(80, "Use 80 characters or fewer.");
const sortNum = z.coerce.number().int().min(0).max(32_000).default(100);

export async function settingsLists(actor: Actor) {
  requireSettingsAdmin(actor, "view");
  const db = getDb();
  const [s, c, cats, streamUse, countryIncome, countryExp, countrySubs, catExp, catSubs] = await Promise.all([
    db.select().from(streams).orderBy(asc(streams.sort), asc(streams.name)),
    db.select().from(countries).orderBy(asc(countries.sort), asc(countries.name)),
    db.select().from(expenseCategories).orderBy(asc(expenseCategories.sort), asc(expenseCategories.name)),
    db.select({ id: incomeEntries.streamId, n: count() }).from(incomeEntries).groupBy(incomeEntries.streamId),
    db.select({ code: incomeEntries.countryCode, n: count() }).from(incomeEntries).groupBy(incomeEntries.countryCode),
    db.select({ code: expenses.countryCode, n: count() }).from(expenses).groupBy(expenses.countryCode),
    db.select({ code: subscriptions.countryCode, n: count() }).from(subscriptions).groupBy(subscriptions.countryCode),
    db.select({ name: expenses.category, n: count() }).from(expenses).groupBy(expenses.category),
    db.select({ name: subscriptions.category, n: count() }).from(subscriptions).groupBy(subscriptions.category),
  ]);
  const used = <K extends string | number | null>(rows: Array<{ n: number } & Record<string, unknown>>, key: string, value: K) =>
    rows.filter((r) => r[key] === value).reduce((a, r) => a + r.n, 0);
  return {
    streams: s.map((x) => ({ id: x.id, name: x.name, active: x.active, sort: x.sort, uses: used(streamUse, "id", x.id) })),
    countries: c.map((x) => ({ code: x.code, name: x.name, sort: x.sort, uses: used(countryIncome, "code", x.code) + used(countryExp, "code", x.code) + used(countrySubs, "code", x.code) })),
    categories: cats.map((x) => ({ id: x.id, name: x.name, active: x.active, sort: x.sort, uses: used(catExp, "name", x.name) + used(catSubs, "name", x.name) })),
  };
}

// ---------------------------------------------------------------- streams
export async function saveStream(actor: Actor, input: { id?: number | null; name: string; sort?: number | string }) {
  requireSettingsAdmin(actor, "edit");
  const v = z.object({ name: name80, sort: sortNum }).safeParse(input);
  if (!v.success) throw new RuleError(v.error.issues[0].message);
  await getDb().transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: streams.id })
      .from(streams)
      .where(input.id ? and(eq(streams.name, v.data.name), ne(streams.id, input.id)) : eq(streams.name, v.data.name));
    if (clash) throw new RuleError("There's already a stream with that name.");
    if (!input.id) {
      const [res] = await tx.insert(streams).values({ name: v.data.name, sort: v.data.sort }).$returningId();
      const [after] = await tx.select().from(streams).where(eq(streams.id, res.id));
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "streams", entityId: String(res.id), after });
      return;
    }
    const [before] = await tx.select().from(streams).where(eq(streams.id, input.id)).for("update");
    if (!before) throw new RuleError("That stream no longer exists.");
    await tx.update(streams).set({ name: v.data.name, sort: v.data.sort }).where(eq(streams.id, input.id));
    const [after] = await tx.select().from(streams).where(eq(streams.id, input.id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "streams", entityId: String(input.id), before, after });
  });
}

export async function setStreamActive(actor: Actor, id: number, active: boolean) {
  requireSettingsAdmin(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(streams).where(eq(streams.id, id)).for("update");
    if (!before) throw new RuleError("That stream no longer exists.");
    await tx.update(streams).set({ active }).where(eq(streams.id, id));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "streams",
      entityId: String(id),
      summary: `${before.name} ${active ? "restored" : "archived"}`,
      before: { active: before.active },
      after: { active },
    });
  });
}

export async function deleteStream(actor: Actor, id: number) {
  requireSettingsAdmin(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(streams).where(eq(streams.id, id)).for("update");
    if (!before) throw new RuleError("That stream no longer exists.");
    const [{ n }] = await tx.select({ n: count() }).from(incomeEntries).where(eq(incomeEntries.streamId, id));
    if (n > 0) throw new RuleError(`${before.name} is used by ${n} income ${n === 1 ? "entry" : "entries"}. Archive it instead, so those entries keep their stream.`);
    await tx.delete(streams).where(eq(streams.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "streams", entityId: String(id), before });
  });
}

// ---------------------------------------------------------------- countries
const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2,8}$/, "Use a short code of 2 to 8 letters, like NZ or US.");

export async function saveCountry(actor: Actor, input: { code: string; name: string; sort?: number | string; isNew: boolean }) {
  requireSettingsAdmin(actor, "edit");
  const v = z.object({ code: countryCode, name: name80, sort: sortNum }).safeParse(input);
  if (!v.success) throw new RuleError(v.error.issues[0].message);
  await getDb().transaction(async (tx) => {
    const [existing] = await tx.select().from(countries).where(eq(countries.code, v.data.code)).for("update");
    if (input.isNew) {
      if (existing) throw new RuleError(`There's already a country with the code ${v.data.code}.`);
      await tx.insert(countries).values(v.data);
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "countries", entityId: v.data.code, after: v.data });
      return;
    }
    if (!existing) throw new RuleError("That country no longer exists.");
    await tx.update(countries).set({ name: v.data.name, sort: v.data.sort }).where(eq(countries.code, v.data.code));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "countries", entityId: v.data.code, before: existing, after: v.data });
  });
}

async function countryUses(tx: Tx, code: string) {
  const [[a], [b], [c]] = await Promise.all([
    tx.select({ n: count() }).from(incomeEntries).where(eq(incomeEntries.countryCode, code)),
    tx.select({ n: count() }).from(expenses).where(eq(expenses.countryCode, code)),
    tx.select({ n: count() }).from(subscriptions).where(eq(subscriptions.countryCode, code)),
  ]);
  return a.n + b.n + c.n;
}

export async function deleteCountry(actor: Actor, code: string) {
  requireSettingsAdmin(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(countries).where(eq(countries.code, code)).for("update");
    if (!before) throw new RuleError("That country no longer exists.");
    const uses = await countryUses(tx, code);
    if (uses > 0) throw new RuleError(`${before.name} is used by ${uses} ${uses === 1 ? "record" : "records"}, so it can't be deleted. Rename it if needed.`);
    await tx.delete(countries).where(eq(countries.code, code));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "countries", entityId: code, before });
  });
}

// ---------------------------------------------------------------- expense categories
export async function saveCategory(actor: Actor, input: { id?: number | null; name: string; sort?: number | string }) {
  requireSettingsAdmin(actor, "edit");
  const v = z.object({ name: name80, sort: sortNum }).safeParse(input);
  if (!v.success) throw new RuleError(v.error.issues[0].message);
  await getDb().transaction(async (tx) => {
    const [clash] = await tx
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(input.id ? and(eq(expenseCategories.name, v.data.name), ne(expenseCategories.id, input.id)) : eq(expenseCategories.name, v.data.name));
    if (clash) throw new RuleError("There's already a category with that name.");
    if (!input.id) {
      const [res] = await tx.insert(expenseCategories).values({ name: v.data.name, sort: v.data.sort }).$returningId();
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "expense_categories", entityId: String(res.id), after: { ...v.data, active: true } });
      return;
    }
    const [before] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, input.id)).for("update");
    if (!before) throw new RuleError("That category no longer exists.");
    await tx.update(expenseCategories).set({ name: v.data.name, sort: v.data.sort }).where(eq(expenseCategories.id, input.id));
    // expenses and payments store the name, so a rename carries over to them
    let moved = 0;
    if (before.name !== v.data.name) {
      const [r1] = await tx.update(expenses).set({ category: v.data.name }).where(eq(expenses.category, before.name));
      const [r2] = await tx.update(subscriptions).set({ category: v.data.name }).where(eq(subscriptions.category, before.name));
      moved = (r1.affectedRows ?? 0) + (r2.affectedRows ?? 0);
    }
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "expense_categories",
      entityId: String(input.id),
      summary: moved ? `Renamed; ${moved} expenses and payments updated` : null,
      before: { name: before.name, sort: before.sort },
      after: v.data,
    });
  });
}

export async function setCategoryActive(actor: Actor, id: number, active: boolean) {
  requireSettingsAdmin(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, id)).for("update");
    if (!before) throw new RuleError("That category no longer exists.");
    await tx.update(expenseCategories).set({ active }).where(eq(expenseCategories.id, id));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "expense_categories",
      entityId: String(id),
      summary: `${before.name} ${active ? "restored" : "archived"}`,
      before: { active: before.active },
      after: { active },
    });
  });
}

export async function deleteCategory(actor: Actor, id: number) {
  requireSettingsAdmin(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(expenseCategories).where(eq(expenseCategories.id, id)).for("update");
    if (!before) throw new RuleError("That category no longer exists.");
    const [[a], [b]] = await Promise.all([
      tx.select({ n: count() }).from(expenses).where(eq(expenses.category, before.name)),
      tx.select({ n: count() }).from(subscriptions).where(eq(subscriptions.category, before.name)),
    ]);
    const uses = a.n + b.n;
    if (uses > 0) throw new RuleError(`${before.name} is used by ${uses} ${uses === 1 ? "expense or payment" : "expenses and payments"}. Archive it instead.`);
    await tx.delete(expenseCategories).where(eq(expenseCategories.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "expense_categories", entityId: String(id), before });
  });
}
