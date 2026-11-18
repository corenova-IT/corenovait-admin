import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/work";
import { actorRef, writeAudit } from "./audit";
import { checkExpenseRefs, expenseValues, moneyValues, type ExpenseInput } from "./finance";
import { RuleError, requirePerm, type Actor } from "./guard";
import { subscriptionInput, type SubscriptionInput } from "./payments";
import { NotFound, assertCountryAllowed, assertStreamAllowed, moneyRowsWhere, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * What a Stream partner may add, edit and archive: expenses, subscriptions and tasks in their own
 * streams (and countries, for money). Every row is found through lib/dal/scope.ts; the stream, country
 * and project in a form are never trusted, they are checked against the partner's assignment here.
 *
 * - They can't enter income, change shares, or touch anything outside their assignment. A row that
 *   isn't theirs gives the same "That no longer exists." as a row that doesn't exist.
 * - "Delete" is an archive: the row stays in the database (an expense or task gets archived_at; a
 *   subscription becomes cancelled) and drops out of lists and totals.
 * - Every add, edit and archive writes the audit log (shown to the admin as "Changes made").
 * - No file attachments for partners (a plan decision).
 */
const { expenses, subscriptions, tasks, projects, streams } = schema;

function ensure(actor: Actor, action: "view" | "create" | "edit") {
  requirePerm(actor, "stream_partner", action);
  partnerScope(actor);
}

const expenseOwn = (actor: Actor) => moneyRowsWhere(actor, { streamId: expenses.streamId, countryCode: expenses.countryCode });
const subOwn = (actor: Actor) => moneyRowsWhere(actor, { streamId: subscriptions.streamId, countryCode: subscriptions.countryCode });

// ---------------------------------------------------------------- expenses
export async function myExpenses(actor: Actor, limit = 100) {
  ensure(actor, "view");
  return getDb().select().from(expenses).where(and(expenseOwn(actor), isNull(expenses.archivedAt))).orderBy(desc(expenses.expenseDate), asc(expenses.id)).limit(limit);
}

/** Checks the form's stream and country against the assignment. Both are required for money. */
function money(actor: Actor, v: { streamId?: number | null; countryCode: string | null }): { streamId: number; countryCode: string } {
  if (!v.streamId) throw new RuleError("Choose a stream.");
  if (!v.countryCode) throw new RuleError("Choose a country.");
  assertStreamAllowed(actor, v.streamId);
  assertCountryAllowed(actor, v.countryCode);
  return { streamId: v.streamId, countryCode: v.countryCode };
}

export async function createMyExpense(actor: Actor, input: ExpenseInput): Promise<string> {
  ensure(actor, "create");
  const values = expenseValues(input);
  const where = money(actor, values);
  const db = getDb();
  values.category = await checkExpenseRefs(db, { ...values, ...where });
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(expenses).values({ id, ...values, ...where, createdBy: actor.userId });
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: id, summary: `Added expense: ${values.vendor || values.category}`, after });
  });
  return id;
}

export async function updateMyExpense(actor: Actor, id: string, input: ExpenseInput) {
  ensure(actor, "edit");
  const values = expenseValues(input);
  const where = money(actor, values);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(and(eq(expenses.id, id), expenseOwn(actor), isNull(expenses.archivedAt))).for("update");
    if (!before) throw new NotFound();
    values.category = await checkExpenseRefs(tx, { ...values, ...where }, before.category);
    await tx.update(expenses).set({ ...values, ...where }).where(eq(expenses.id, id));
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "expenses", entityId: id, summary: `Edited expense: ${after.vendor || after.category}`, before, after });
  });
}

export async function archiveMyExpense(actor: Actor, id: string) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(and(eq(expenses.id, id), expenseOwn(actor), isNull(expenses.archivedAt))).for("update");
    if (!before) throw new NotFound();
    await tx.update(expenses).set({ archivedAt: new Date() }).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "archive", entity: "expenses", entityId: id, summary: `Archived expense: ${before.vendor || before.category}`, before: { archived: false }, after: { archived: true } });
  });
}

// ---------------------------------------------------------------- subscriptions
export async function mySubscriptions(actor: Actor, limit = 100) {
  ensure(actor, "view");
  return getDb().select().from(subscriptions).where(and(subOwn(actor), ne(subscriptions.status, "cancelled"))).orderBy(asc(subscriptions.nextDueDate), asc(subscriptions.id)).limit(limit);
}

function subscriptionValues(input: SubscriptionInput) {
  const parsed = subscriptionInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the payment and try again.");
  const v = parsed.data;
  return {
    vendor: v.vendor,
    category: v.category,
    description: v.description,
    ...moneyValues(v),
    billingCycle: v.billingCycle,
    nextDueDate: v.nextDueDate,
    reminderDays: v.reminderDays,
    paidFrom: v.paidFrom,
    notes: v.notes || null,
    countryCode: v.countryCode || null,
    streamId: v.streamId ?? null,
  };
}

export async function createMySubscription(actor: Actor, input: SubscriptionInput): Promise<string> {
  ensure(actor, "create");
  const { countryCode, streamId, ...values } = subscriptionValues(input);
  const where = money(actor, { countryCode, streamId });
  const db = getDb();
  values.category = await checkExpenseRefs(db, { category: values.category, ...where });
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(subscriptions).values({ id, ...values, ...where, responsibleUserId: null, createdBy: actor.userId });
    const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "subscriptions", entityId: id, summary: `Added subscription: ${values.vendor}`, after });
  });
  return id;
}

export async function updateMySubscription(actor: Actor, id: string, input: SubscriptionInput) {
  ensure(actor, "edit");
  const { countryCode, streamId, ...values } = subscriptionValues(input);
  const where = money(actor, { countryCode, streamId });
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(and(eq(subscriptions.id, id), subOwn(actor), ne(subscriptions.status, "cancelled"))).for("update");
    if (!before) throw new NotFound();
    values.category = await checkExpenseRefs(tx, { category: values.category, ...where }, before.category);
    await tx.update(subscriptions).set({ ...values, ...where }).where(eq(subscriptions.id, id));
    const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "subscriptions", entityId: id, summary: `Edited subscription: ${after.vendor}`, before, after });
  });
}

/** Archiving a subscription cancels it: it stays in the database but drops out of every list and total. */
export async function archiveMySubscription(actor: Actor, id: string) {
  ensure(actor, "edit");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(and(eq(subscriptions.id, id), subOwn(actor), ne(subscriptions.status, "cancelled"))).for("update");
    if (!before) throw new NotFound();
    await tx.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "archive", entity: "subscriptions", entityId: id, summary: `Archived subscription: ${before.vendor}`, before: { status: before.status }, after: { status: "cancelled" } });
  });
}

// ---------------------------------------------------------------- tasks
export const myTaskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.string().trim().max(10_000).optional(),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  streamId: z.coerce.number().int().positive("Choose a stream."),
  projectId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()).optional(),
});
export type MyTaskInput = z.input<typeof myTaskInput>;

const taskOwn = (db: Db | Tx, actor: Actor) => and(streamRowsWhere(actor, { streamId: tasks.streamId }), notHiddenFrom(db, actor, tasks.projectId), isNull(tasks.archivedAt));

export async function myTasks(actor: Actor, limit = 200) {
  ensure(actor, "view");
  const db = getDb();
  return db.select().from(tasks).where(taskOwn(db, actor)).orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id)).limit(limit);
}

async function taskValues(db: Db | Tx, actor: Actor, input: MyTaskInput) {
  const parsed = myTaskInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the task and try again.");
  const v = parsed.data;
  assertStreamAllowed(actor, v.streamId);
  if (v.projectId) {
    // a project must be in the same stream and not hidden from this partner: anything else is "not found"
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, v.projectId), eq(projects.streamId, v.streamId), streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id)));
    if (!p) throw new NotFound();
  }
  return { title: v.title, description: v.description || null, status: v.status, priority: v.priority, dueDate: v.dueDate ?? null, streamId: v.streamId, projectId: v.projectId ?? null };
}

export async function createMyTask(actor: Actor, input: MyTaskInput): Promise<string> {
  ensure(actor, "create");
  const db = getDb();
  const values = await taskValues(db, actor, input);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(tasks).values({ id, ...values, completedAt: values.status === "done" ? new Date() : null, createdBy: actor.userId });
    const [after] = await tx.select().from(tasks).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "tasks", entityId: id, summary: `Added task: ${values.title}`, after });
  });
  return id;
}

export async function updateMyTask(actor: Actor, id: string, input: MyTaskInput) {
  ensure(actor, "edit");
  const db = getDb();
  const values = await taskValues(db, actor, input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(tasks).where(and(eq(tasks.id, id), taskOwn(tx, actor))).for("update");
    if (!before) throw new NotFound();
    const completedAt = values.status === "done" ? (before.completedAt ?? new Date()) : null;
    await tx.update(tasks).set({ ...values, completedAt }).where(eq(tasks.id, id));
    const [after] = await tx.select().from(tasks).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, summary: `Edited task: ${after.title}`, before, after });
  });
}

export async function archiveMyTask(actor: Actor, id: string) {
  ensure(actor, "edit");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(tasks).where(and(eq(tasks.id, id), taskOwn(tx, actor))).for("update");
    if (!before) throw new NotFound();
    await tx.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "archive", entity: "tasks", entityId: id, summary: `Archived task: ${before.title}`, before: { archived: false }, after: { archived: true } });
  });
}

/** The streams a partner may file things under (for the forms). */
export async function myStreamChoices(actor: Actor) {
  const scope = partnerScope(actor);
  if (!scope.hasData) return [];
  const rows = await getDb().select({ id: streams.id, name: streams.name }).from(streams).orderBy(asc(streams.sort), asc(streams.name));
  return rows.filter((s) => scope.streamIds.includes(s.id));
}

/** Everything the three forms need: only the partner's own streams, countries and (visible) projects. */
export async function myFormChoices(actor: Actor) {
  ensure(actor, "view");
  const scope = partnerScope(actor);
  const db = getDb();
  const [streamChoices, countryRows, categoryRows, projectRows] = await Promise.all([
    myStreamChoices(actor),
    scope.countryCodes.length ? db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.sort)) : [],
    db.select({ name: schema.expenseCategories.name, active: schema.expenseCategories.active }).from(schema.expenseCategories).orderBy(asc(schema.expenseCategories.sort), asc(schema.expenseCategories.name)),
    scope.hasData
      ? db.select({ id: projects.id, name: projects.name, streamId: projects.streamId }).from(projects).where(and(streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id), eq(projects.active, true))).orderBy(asc(projects.name))
      : [],
  ]);
  const base = (await db.select({ c: schema.settings.baseCurrency }).from(schema.settings).where(eq(schema.settings.id, 1)))[0]?.c ?? "AUD";
  return {
    streams: streamChoices,
    countries: countryRows.filter((c) => scope.countryCodes.includes(c.code)),
    categories: categoryRows.filter((c) => c.active).map((c) => c.name),
    projects: projectRows,
    baseCurrency: base,
    hasData: scope.hasData,
  };
}
