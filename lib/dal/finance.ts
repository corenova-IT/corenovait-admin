import "server-only";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { parseMoneyToMinor, parseRate } from "@/lib/money";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";
import { rateToDecimal, toSafeNumber } from "./internal";

/**
 * Income and expenses (module "transactions"). Phase 1 ships the access rules
 * and audit trail; Phase 2 adds the screens, filters, totals and CSV.
 *
 * Scope: own = rows you created; assigned = also income credited to the
 * representative linked to your login.
 */
const { incomeEntries, expenses, representatives } = schema;

const repIdsFor = (db: Db | Tx, userId: string) =>
  db.select({ id: representatives.id }).from(representatives).where(eq(representatives.userId, userId));

function incomeScope(db: Db | Tx, actor: Actor): SQL | undefined {
  return scopeWhere(actor, "transactions", {
    owner: incomeEntries.createdBy,
    assignedTo: (uid) => inArray(incomeEntries.representativeId, repIdsFor(db, uid)),
  });
}

async function incomeRowAllowed(db: Db | Tx, actor: Actor, row: { createdBy: string; representativeId: string | null }) {
  let assigneeId: string | null = null;
  if (row.representativeId) {
    const [rep] = await db.select({ userId: representatives.userId }).from(representatives).where(eq(representatives.id, row.representativeId));
    assigneeId = rep?.userId ?? null;
  }
  return rowAllowed(actor, "transactions", { ownerId: row.createdBy, assigneeId });
}

const moneyFields = {
  amount: z.string().trim().min(1, "Enter an amount."),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like AUD or GBP."),
  fxRate: z.string().trim().default("1"),
};

export const incomeInput = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  streamId: z.coerce.number().int().positive("Choose a revenue stream."),
  countryCode: z.string().trim().max(8),
  client: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).default(""),
  ...moneyFields,
  invoiceRef: z.string().trim().max(80).optional(),
  status: z.enum(["pending", "paid", "overdue"]).default("pending"),
  representativeId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type IncomeInput = z.input<typeof incomeInput>;

function moneyValues(v: { amount: string; currency: string; fxRate: string }) {
  try {
    return { amountMinor: toSafeNumber(parseMoneyToMinor(v.amount)), currency: v.currency, fxRateToBase: rateToDecimal(parseRate(v.fxRate)) };
  } catch (e) {
    throw new RuleError(e instanceof Error ? e.message : "Check the amount and rate.");
  }
}

function incomeValues(input: IncomeInput) {
  const v = incomeInput.parse(input);
  return {
    entryDate: v.entryDate,
    streamId: v.streamId,
    countryCode: v.countryCode,
    client: v.client,
    description: v.description,
    ...moneyValues(v),
    invoiceRef: v.invoiceRef ?? null,
    status: v.status,
    representativeId: v.representativeId ?? null,
    notes: v.notes ?? null,
  };
}

export async function listIncome(actor: Actor, opts: { page?: number; pageSize?: number } = {}) {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(1, opts.page ?? 1);
  const where = incomeScope(db, actor);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(incomeEntries).where(where).orderBy(desc(incomeEntries.entryDate), desc(incomeEntries.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(incomeEntries).where(where),
  ]);
  return { rows, total: n };
}

/** Returns null both when the row doesn't exist and when it's outside the caller's scope. */
export async function getIncome(actor: Actor, id: string) {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const [row] = await db.select().from(incomeEntries).where(and(eq(incomeEntries.id, id), incomeScope(db, actor)));
  return row ?? null;
}

export async function createIncome(actor: Actor, input: IncomeInput): Promise<string> {
  requirePerm(actor, "transactions", "create");
  const values = incomeValues(input);
  const id = crypto.randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.insert(incomeEntries).values({ id, ...values, createdBy: actor.userId });
    const [after] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "income_entries", entityId: id, after });
  });
  return id;
}

export async function updateIncome(actor: Actor, id: string, input: IncomeInput) {
  requirePerm(actor, "transactions", "edit");
  const values = incomeValues(input);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id)).for("update");
    if (!before || !(await incomeRowAllowed(tx, actor, before))) throw new AccessDenied("That entry doesn't exist or isn't yours to change.");
    await tx.update(incomeEntries).set(values).where(eq(incomeEntries.id, id));
    const [after] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "income_entries", entityId: id, before, after });
  });
}

export async function deleteIncome(actor: Actor, id: string) {
  requirePerm(actor, "transactions", "delete");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id)).for("update");
    if (!before || !(await incomeRowAllowed(tx, actor, before))) throw new AccessDenied("That entry doesn't exist or isn't yours to delete.");
    await tx.delete(incomeEntries).where(eq(incomeEntries.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "income_entries", entityId: id, before });
  });
}

// ---------------------------------------------------------------- expenses
export const expenseInput = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  category: z.string().trim().min(1, "Choose a category.").max(80),
  vendor: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).default(""),
  ...moneyFields,
  isRecurring: z.boolean().default(false),
  notes: z.string().trim().max(5000).optional(),
});
export type ExpenseInput = z.input<typeof expenseInput>;

const expenseScope = (actor: Actor) => scopeWhere(actor, "transactions", { owner: expenses.createdBy });

export async function listExpenses(actor: Actor, opts: { page?: number; pageSize?: number } = {}) {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(1, opts.page ?? 1);
  const where = expenseScope(actor);
  const [rows, [{ n }]] = await Promise.all([
    db.select().from(expenses).where(where).orderBy(desc(expenses.expenseDate)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(expenses).where(where),
  ]);
  return { rows, total: n };
}

export async function createExpense(actor: Actor, input: ExpenseInput): Promise<string> {
  requirePerm(actor, "transactions", "create");
  const v = expenseInput.parse(input);
  const id = crypto.randomUUID();
  await getDb().transaction(async (tx) => {
    await tx.insert(expenses).values({
      id,
      expenseDate: v.expenseDate,
      category: v.category,
      vendor: v.vendor,
      description: v.description,
      ...moneyValues(v),
      isRecurring: v.isRecurring,
      notes: v.notes ?? null,
      createdBy: actor.userId,
    });
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: id, after });
  });
  return id;
}

/** Used by the file download check: may this person see the record a receipt belongs to? */
export async function financeRecordVisible(actor: Actor, entityType: string, entityId: string): Promise<boolean> {
  const db = getDb();
  if (entityType === "income_entries") {
    const [row] = await db.select().from(incomeEntries).where(eq(incomeEntries.id, entityId));
    return !!row && (await incomeRowAllowed(db, actor, row));
  }
  if (entityType === "expenses") {
    const [row] = await db.select({ createdBy: expenses.createdBy }).from(expenses).where(eq(expenses.id, entityId));
    return !!row && rowAllowed(actor, "transactions", { ownerId: row.createdBy });
  }
  return false;
}

/** Development only: true while sample rows from npm run db:local exist (drives the "Sample data" badge). */
export async function hasSampleData(actor: Actor): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false;
  assertCaller(actor);
  const db = getDb();
  const [[inc], [exp]] = await Promise.all([
    db.select({ n: count() }).from(incomeEntries).where(eq(incomeEntries.isSample, true)),
    db.select({ n: count() }).from(expenses).where(eq(expenses.isSample, true)),
  ]);
  return inc.n + exp.n > 0;
}
