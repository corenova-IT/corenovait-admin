import "server-only";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { TASK_PRIORITIES, TASK_STATUSES } from "@/lib/work";
import { actorRef, writeAudit } from "./audit";
import { checkExpenseRefs, expenseValues, moneyValues, type ExpenseInput } from "./finance";
import { RuleError, requirePerm, type Actor } from "./guard";
import { CYCLE_LABEL, companyToday, subscriptionInput, type SubscriptionInput } from "./payments";
import { nextCycleDate } from "@/lib/dates";
import { ownEmployee } from "./partner-employees";
import { saveUpload } from "./files";
import { simplePdf } from "@/lib/pdf";
import { formatMoney } from "@/lib/money";
import type { Attachment } from "./finance";
import { NotFound, assertCountryAllowed, assertStreamAllowed, moneyRowsWhere, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * What a Partner may add, edit and archive: expenses, subscriptions and tasks in their own
 * streams (and countries, for money). Every row is found through lib/dal/scope.ts; the stream, country
 * and project in a form are never trusted, they are checked against the partner's assignment here.
 *
 * - They can't enter income, change shares, or touch anything outside their assignment. A row that
 *   isn't theirs gives the same "That no longer exists." as a row that doesn't exist.
 * - "Delete" is an archive: the row stays in the database (an expense or task gets archived_at; a
 *   subscription becomes cancelled) and drops out of lists and totals.
 * - Every add, edit and archive writes the audit log (shown to the admin as "Changes made").
 * - Documents: a partner can attach an invoice or receipt to an expense of theirs, or have a simple bill made for it.
 *   The file is stored under the stream_partner module and only served to that partner (their own expense) and to
 *   admins who can see transactions (not for a project hidden from them): see partner-files.ts.
 */
const { expenses, subscriptions, tasks, projects, streams, projectMembers, employeeAssignments, users } = schema;

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

/** A project on an expense must be one of the partner's own (in the expense's stream, not hidden from them): anything else is "not found". */
async function checkOwnProject(db: Db | Tx, actor: Actor, projectId: string | null | undefined, streamId: number) {
  if (!projectId) return;
  const [p] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.streamId, streamId), streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id)));
  if (!p) throw new NotFound();
}

export async function createMyExpense(actor: Actor, input: ExpenseInput, attachment?: Attachment): Promise<string> {
  ensure(actor, "create");
  const values = expenseValues(input);
  const where = money(actor, values);
  const db = getDb();
  values.category = await checkExpenseRefs(db, { ...values, ...where });
  await checkOwnProject(db, actor, values.projectId, where.streamId);
  const id = crypto.randomUUID();
  const file = attachment ? await saveUpload(actor, { module: "stream_partner", entityType: "expenses", entityId: id, ...attachment }) : null;
  await db.transaction(async (tx) => {
    await tx.insert(expenses).values({ id, ...values, ...where, receiptFileId: file?.id ?? null, createdBy: actor.userId });
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: id, summary: `Added expense: ${values.vendor || values.category}`, after });
  });
  return id;
}

export async function updateMyExpense(actor: Actor, id: string, input: ExpenseInput, attachment?: Attachment) {
  ensure(actor, "edit");
  const values = expenseValues(input);
  const where = money(actor, values);
  const db = getDb();
  if (attachment) {
    const [own] = await db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.id, id), expenseOwn(actor), isNull(expenses.archivedAt)));
    if (!own) throw new NotFound();
  }
  const file = attachment ? await saveUpload(actor, { module: "stream_partner", entityType: "expenses", entityId: id, ...attachment }) : null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(and(eq(expenses.id, id), expenseOwn(actor), isNull(expenses.archivedAt))).for("update");
    if (!before) throw new NotFound();
    values.category = await checkExpenseRefs(tx, { ...values, ...where }, before.category);
    await checkOwnProject(tx, actor, values.projectId, where.streamId);
    await tx.update(expenses).set({ ...values, ...where, ...(file ? { receiptFileId: file.id } : {}) }).where(eq(expenses.id, id));
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "expenses", entityId: id, summary: `Edited expense: ${after.vendor || after.category}`, before, after });
  });
}

/**
 * A simple bill for one of their expenses (company name, a bill number, the date, the items and the amount), as a
 * PDF kept with the expense. It replaces the expense's current document (the old file stays stored).
 */
export async function generateMyExpenseBill(actor: Actor, id: string): Promise<{ fileId: string; billNumber: string }> {
  ensure(actor, "edit");
  const db = getDb();
  const [e] = await db.select().from(expenses).where(and(eq(expenses.id, id), expenseOwn(actor), isNull(expenses.archivedAt)));
  if (!e) throw new NotFound();
  const [s] = await db.select({ company: schema.settings.companyName }).from(schema.settings).where(eq(schema.settings.id, 1));
  const billNumber = `BILL-${e.expenseDate.replaceAll("-", "")}-${e.id.slice(0, 6).toUpperCase()}`;
  const item = [e.vendor, e.description].filter(Boolean).join(" - ") || e.category;
  const total = formatMoney(e.amountMinor, e.currency);
  const bytes = simplePdf([
    { text: s?.company || "CoreNovaIT", y: 780, size: 20, bold: true },
    { text: "BILL", y: 750, size: 14, bold: true },
    { text: `Bill number: ${billNumber}`, y: 720 },
    { text: `Date: ${e.expenseDate}`, y: 704 },
    { text: `Prepared by: ${actor.fullName || actor.email}`, y: 688 },
    { text: "Item", y: 640, bold: true },
    { text: "Category", x: 320, y: 640, bold: true },
    { text: "Amount", x: 460, y: 640, bold: true },
    { text: item.slice(0, 60), y: 620 },
    { text: e.category.slice(0, 24), x: 320, y: 620 },
    { text: total, x: 460, y: 620 },
    { text: "Total", x: 380, y: 570, size: 13, bold: true },
    { text: total, x: 460, y: 570, size: 13, bold: true },
  ]);
  const file = await saveUpload(actor, { module: "stream_partner", entityType: "expenses", entityId: id, name: `${billNumber}.pdf`, bytes });
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({ receiptFileId: file.id }).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "expenses", entityId: id, summary: `Generated a bill (${billNumber}) for expense: ${e.vendor || e.category}`, before: { receiptFileId: e.receiptFileId }, after: { receiptFileId: file.id } });
  });
  return { fileId: file.id, billNumber };
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

/**
 * A partner marks one of THEIR subscriptions as paid. It only records the cost (an expense under the
 * same stream and country) and moves the due date on one cycle, exactly like the admin's version in
 * lib/dal/payments.ts. Nothing else changes. Both changes are logged.
 */
export async function markMySubscriptionPaid(actor: Actor, id: string, opts: { paidDate?: string } = {}): Promise<{ expenseId: string; nextDueDate: string | null }> {
  ensure(actor, "edit");
  const db = getDb();
  const paidDate = opts.paidDate || (await companyToday(db));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) throw new RuleError("Choose the date it was paid.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(and(eq(subscriptions.id, id), subOwn(actor), ne(subscriptions.status, "cancelled"))).for("update");
    if (!before) throw new NotFound();
    if (before.status !== "active") throw new RuleError("Only an active subscription can be marked as paid.");
    const expenseId = crypto.randomUUID();
    await tx.insert(expenses).values({
      id: expenseId,
      expenseDate: paidDate,
      category: before.category,
      vendor: before.vendor,
      description: before.description || `${CYCLE_LABEL[before.billingCycle]} payment`,
      amountMinor: before.amountMinor,
      currency: before.currency,
      fxRateToBase: before.fxRateToBase,
      isRecurring: before.billingCycle !== "once",
      countryCode: before.countryCode,
      streamId: before.streamId,
      subscriptionId: id,
      notes: before.paidFrom ? `Paid from ${before.paidFrom}` : null,
      createdBy: actor.userId,
    });
    const next = nextCycleDate(before.nextDueDate, before.billingCycle);
    await tx.update(subscriptions).set(next ? { nextDueDate: next } : { status: "completed" }).where(eq(subscriptions.id, id));
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, expenseId));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: expenseId, summary: `Added expense: paid ${before.vendor} (due ${before.nextDueDate})`, after: expense });
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "subscriptions",
      entityId: id,
      summary: `Edited subscription: ${before.vendor} marked paid`,
      before: { nextDueDate: before.nextDueDate, status: before.status },
      after: next ? { nextDueDate: next, status: before.status } : { status: "completed" },
    });
    return { expenseId, nextDueDate: next };
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
  /** one of THEIR employees, or nobody */
  assigneeId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()).optional(),
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
  if (v.assigneeId) {
    await ownEmployee(db, actor, v.assigneeId); // someone else's employee = not found
    if (v.projectId) {
      const [on] = await db.select({ u: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, v.projectId), eq(projectMembers.userId, v.assigneeId)));
      if (!on) throw new RuleError("Put them on that project first (on the Projects page).");
    }
  }
  return { title: v.title, description: v.description || null, status: v.status, priority: v.priority, dueDate: v.dueDate ?? null, streamId: v.streamId, projectId: v.projectId ?? null, assigneeId: v.assigneeId ?? null };
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
  const [streamChoices, countryRows, categoryRows, projectRows, employeeRows] = await Promise.all([
    myStreamChoices(actor),
    scope.countryCodes.length ? db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.sort)) : [],
    db.select({ name: schema.expenseCategories.name, active: schema.expenseCategories.active }).from(schema.expenseCategories).orderBy(asc(schema.expenseCategories.sort), asc(schema.expenseCategories.name)),
    scope.hasData
      ? db.select({ id: projects.id, name: projects.name, streamId: projects.streamId }).from(projects).where(and(streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id), eq(projects.active, true))).orderBy(asc(projects.name))
      : [],
    db
      .select({ id: users.id, name: users.fullName, email: users.email })
      .from(employeeAssignments)
      .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
      .where(and(eq(employeeAssignments.partnerUserId, actor.userId), ne(users.status, "deactivated")))
      .orderBy(asc(users.fullName)),
  ]);
  const base = (await db.select({ c: schema.settings.baseCurrency }).from(schema.settings).where(eq(schema.settings.id, 1)))[0]?.c ?? "AUD";
  return {
    streams: streamChoices,
    countries: countryRows.filter((c) => scope.countryCodes.includes(c.code)),
    categories: categoryRows.filter((c) => c.active).map((c) => c.name),
    projects: projectRows,
    employees: employeeRows.map((e) => ({ id: e.id, name: e.name || e.email })),
    baseCurrency: base,
    hasData: scope.hasData,
  };
}
