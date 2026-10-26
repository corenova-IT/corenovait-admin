import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNull, like, lte, or, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { minorToDecimal, parseCsv, toCsv } from "@/lib/csv";
import { parseMoneyToMinor, parseRate } from "@/lib/money";
import { actorRef, writeAudit, writeAuditMany } from "./audit";
import { AccessDenied, RuleError, assertCaller, hasPerm, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";
import { saveUpload } from "./files";
import { rateToDecimal, toSafeNumber } from "./internal";

/**
 * Income and expenses (module "transactions").
 *
 * Scope: own = rows you created; assigned = also income credited to the
 * representative linked to your login. Every change is audited with the
 * row before and after. Money is integer minor units; exchange rates are
 * exact decimals; MySQL computes the base-currency amount.
 */
const { incomeEntries, expenses, representatives, streams, countries, settings, expenseCategories } = schema;

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

const expenseScope = (actor: Actor) => scopeWhere(actor, "transactions", { owner: expenses.createdBy });

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------------------------------------------------------------- money input
export const moneyFields = {
  amount: z.string().trim().min(1, "Enter an amount."),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like AUD or GBP."),
  fxRate: z.string().trim().default("1"),
};

export function moneyValues(v: { amount: string; currency: string; fxRate: string }) {
  try {
    return { amountMinor: toSafeNumber(parseMoneyToMinor(v.amount)), currency: v.currency, fxRateToBase: rateToDecimal(parseRate(v.fxRate)) };
  } catch (e) {
    throw new RuleError(e instanceof Error ? e.message : "Check the amount and rate.");
  }
}

export async function baseCurrency(db: Db | Tx = getDb()): Promise<string> {
  const [s] = await db.select({ c: settings.baseCurrency }).from(settings).where(eq(settings.id, 1));
  return s?.c ?? "AUD";
}

// ---------------------------------------------------------------- lookups for forms and filters
const FINANCE_MODULES = ["transactions", "streams", "countries", "representatives", "finances", "payments"] as const;

export async function financeLookups(actor: Actor) {
  assertCaller(actor);
  if (!FINANCE_MODULES.some((m) => hasPerm(actor, m, "view"))) throw new AccessDenied();
  const db = getDb();
  const [s, c, r, cats, base] = await Promise.all([
    db.select().from(streams).orderBy(asc(streams.sort), asc(streams.name)),
    db.select().from(countries).orderBy(asc(countries.sort)),
    db
      .select({ id: representatives.id, name: representatives.name, commissionRate: representatives.commissionRate, active: representatives.active })
      .from(representatives)
      .orderBy(asc(representatives.name)),
    db.select().from(expenseCategories).orderBy(asc(expenseCategories.sort), asc(expenseCategories.name)),
    baseCurrency(db),
  ]);
  return {
    streams: s.map((x) => ({ id: x.id, name: x.name, active: x.active })),
    countries: c.map((x) => ({ code: x.code, name: x.name })),
    representatives: r,
    /** active categories, for new entries */
    categories: cats.filter((x) => x.active).map((x) => x.name),
    /** every category, for filters and for editing older entries */
    allCategories: cats.map((x) => x.name),
    baseCurrency: base,
  };
}

/** Matches a typed category to the list (case-insensitive) and returns its exact name. */
async function canonicalCategory(db: Db | Tx, name: string, allowInactive: string | null = null): Promise<string> {
  const [cat] = await db.select().from(expenseCategories).where(eq(expenseCategories.name, name.trim()));
  if (cat && (cat.active || cat.name === allowInactive)) return cat.name;
  throw new RuleError(`"${name.trim()}" isn't an expense category. Choose one from the list, or ask an admin to add it in Settings.`);
}
export type FinanceLookups = Awaited<ReturnType<typeof financeLookups>>;

// ---------------------------------------------------------------- filters
const page = z.coerce.number().int().min(1).max(100_000).optional().catch(1);
const dir = z.enum(["asc", "desc"]).optional().catch(undefined);
const optText = (max: number) => z.string().trim().max(max).optional().catch(undefined);

export const incomeFilters = z.object({
  q: optText(100),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  stream: z.coerce.number().int().positive().optional().catch(undefined),
  country: z.string().regex(/^[A-Z]{2,8}$/).optional().catch(undefined),
  status: z.enum(["pending", "paid", "overdue"]).optional().catch(undefined),
  rep: z.union([z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  sort: z.enum(["date", "amount", "client", "status"]).optional().catch(undefined),
  dir,
  page,
});
export type IncomeFilters = z.infer<typeof incomeFilters>;

export const expenseFilters = z.object({
  q: optText(100),
  from: isoDate.optional().catch(undefined),
  to: isoDate.optional().catch(undefined),
  category: optText(80),
  recurring: z.enum(["yes", "no"]).optional().catch(undefined),
  /** a country code, or "shared" for costs not tied to a country */
  country: z.union([z.literal("shared"), z.string().regex(/^[A-Z]{2,8}$/)]).optional().catch(undefined),
  sort: z.enum(["date", "amount", "vendor", "category"]).optional().catch(undefined),
  dir,
  page,
});
export type ExpenseFilters = z.infer<typeof expenseFilters>;

function incomeWhere(db: Db | Tx, actor: Actor, f: IncomeFilters): SQL | undefined {
  const conds: Array<SQL | undefined> = [incomeScope(db, actor)];
  if (f.from) conds.push(gte(incomeEntries.entryDate, f.from));
  if (f.to) conds.push(lte(incomeEntries.entryDate, f.to));
  if (f.stream) conds.push(eq(incomeEntries.streamId, f.stream));
  if (f.country) conds.push(eq(incomeEntries.countryCode, f.country));
  if (f.status) conds.push(eq(incomeEntries.status, f.status));
  if (f.rep === "none") conds.push(isNull(incomeEntries.representativeId));
  else if (f.rep) conds.push(eq(incomeEntries.representativeId, f.rep));
  if (f.q) {
    const t = likeTerm(f.q);
    conds.push(or(like(incomeEntries.client, t), like(incomeEntries.description, t), like(incomeEntries.invoiceRef, t), like(incomeEntries.notes, t)));
  }
  return and(...conds);
}

function expenseWhere(actor: Actor, f: ExpenseFilters): SQL | undefined {
  const conds: Array<SQL | undefined> = [expenseScope(actor)];
  if (f.from) conds.push(gte(expenses.expenseDate, f.from));
  if (f.to) conds.push(lte(expenses.expenseDate, f.to));
  if (f.category) conds.push(eq(expenses.category, f.category));
  if (f.recurring) conds.push(eq(expenses.isRecurring, f.recurring === "yes"));
  if (f.country === "shared") conds.push(isNull(expenses.countryCode));
  else if (f.country) conds.push(eq(expenses.countryCode, f.country));
  if (f.q) {
    const t = likeTerm(f.q);
    conds.push(or(like(expenses.vendor, t), like(expenses.description, t), like(expenses.category, t), like(expenses.notes, t)));
  }
  return and(...conds);
}

const incomeSort = { date: incomeEntries.entryDate, amount: incomeEntries.amountBaseMinor, client: incomeEntries.client, status: incomeEntries.status };
const expenseSort = { date: expenses.expenseDate, amount: expenses.amountBaseMinor, vendor: expenses.vendor, category: expenses.category };

const incomeSelect = {
  id: incomeEntries.id,
  entryDate: incomeEntries.entryDate,
  streamId: incomeEntries.streamId,
  streamName: streams.name,
  countryCode: incomeEntries.countryCode,
  countryName: countries.name,
  client: incomeEntries.client,
  description: incomeEntries.description,
  amountMinor: incomeEntries.amountMinor,
  currency: incomeEntries.currency,
  fxRateToBase: incomeEntries.fxRateToBase,
  amountBaseMinor: incomeEntries.amountBaseMinor,
  invoiceRef: incomeEntries.invoiceRef,
  status: incomeEntries.status,
  representativeId: incomeEntries.representativeId,
  representativeName: representatives.name,
  commissionRate: incomeEntries.commissionRate,
  invoiceFileId: incomeEntries.invoiceFileId,
  notes: incomeEntries.notes,
  isSample: incomeEntries.isSample,
  createdBy: incomeEntries.createdBy,
};
export type IncomeRow = {
  id: string;
  entryDate: string;
  streamId: number;
  streamName: string;
  countryCode: string;
  countryName: string;
  client: string;
  description: string;
  amountMinor: number;
  currency: string;
  fxRateToBase: string;
  amountBaseMinor: number | null;
  invoiceRef: string | null;
  status: "pending" | "paid" | "overdue";
  representativeId: string | null;
  representativeName: string | null;
  commissionRate: string | null;
  invoiceFileId: string | null;
  notes: string | null;
  isSample: boolean;
  createdBy: string;
};

function incomeQuery(db: Db | Tx) {
  return db
    .select(incomeSelect)
    .from(incomeEntries)
    .innerJoin(streams, eq(streams.id, incomeEntries.streamId))
    .innerJoin(countries, eq(countries.code, incomeEntries.countryCode))
    .leftJoin(representatives, eq(representatives.id, incomeEntries.representativeId));
}

export type ExpenseRow = typeof expenses.$inferSelect;

export const PAGE_SIZE = 50;

export async function listIncome(actor: Actor, f: IncomeFilters = {}, pageSize = PAGE_SIZE) {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const where = incomeWhere(db, actor, f);
  const col = incomeSort[f.sort ?? "date"];
  const order = (f.dir ?? (f.sort && f.sort !== "date" && f.sort !== "amount" ? "asc" : "desc")) === "asc" ? asc(col) : desc(col);
  const p = f.page ?? 1;
  const [rows, [agg]] = await Promise.all([
    incomeQuery(db).where(where).orderBy(order, desc(incomeEntries.createdAt), asc(incomeEntries.id)).limit(pageSize).offset((p - 1) * pageSize),
    db
      .select({
        n: count(),
        total: sum(incomeEntries.amountBaseMinor),
        paid: sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then ${incomeEntries.amountBaseMinor} else 0 end), 0)`,
      })
      .from(incomeEntries)
      .where(where),
  ]);
  const totalBaseMinor = Number(agg.total ?? 0);
  const paidBaseMinor = Number(agg.paid ?? 0);
  return { rows: rows as IncomeRow[], total: agg.n, totalBaseMinor, paidBaseMinor, outstandingBaseMinor: totalBaseMinor - paidBaseMinor };
}

export async function listExpenses(actor: Actor, f: ExpenseFilters = {}, pageSize = PAGE_SIZE) {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const where = expenseWhere(actor, f);
  const col = expenseSort[f.sort ?? "date"];
  const order = (f.dir ?? (f.sort && f.sort !== "date" && f.sort !== "amount" ? "asc" : "desc")) === "asc" ? asc(col) : desc(col);
  const p = f.page ?? 1;
  const [rows, [agg]] = await Promise.all([
    db.select().from(expenses).where(where).orderBy(order, desc(expenses.createdAt), asc(expenses.id)).limit(pageSize).offset((p - 1) * pageSize),
    db.select({ n: count(), total: sum(expenses.amountBaseMinor) }).from(expenses).where(where),
  ]);
  return { rows, total: agg.n, totalBaseMinor: Number(agg.total ?? 0) };
}

/** Returns null both when the row doesn't exist and when it's outside the caller's scope. */
export async function getIncome(actor: Actor, id: string): Promise<IncomeRow | null> {
  requirePerm(actor, "transactions", "view");
  const db = getDb();
  const [row] = await incomeQuery(db).where(and(eq(incomeEntries.id, id), incomeScope(db, actor)));
  return (row as IncomeRow) ?? null;
}

export async function getExpense(actor: Actor, id: string) {
  requirePerm(actor, "transactions", "view");
  const [row] = await getDb().select().from(expenses).where(and(eq(expenses.id, id), expenseScope(actor)));
  return row ?? null;
}

// ---------------------------------------------------------------- income: create, edit, delete
export const incomeInput = z.object({
  entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  streamId: z.coerce.number().int().positive("Choose a revenue stream."),
  countryCode: z.string().trim().min(1, "Choose a country.").max(8),
  client: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).default(""),
  ...moneyFields,
  invoiceRef: z.string().trim().max(80).optional(),
  status: z.enum(["pending", "paid", "overdue"]).default("pending"),
  representativeId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type IncomeInput = z.input<typeof incomeInput>;

export type Attachment = { name: string; bytes: Buffer };

async function checkRefs(db: Db | Tx, v: { streamId: number; countryCode: string; representativeId?: string | null }) {
  const [[s], [c], rep] = await Promise.all([
    db.select({ id: streams.id }).from(streams).where(eq(streams.id, v.streamId)),
    db.select({ code: countries.code }).from(countries).where(eq(countries.code, v.countryCode)),
    v.representativeId
      ? db.select({ rate: representatives.commissionRate }).from(representatives).where(eq(representatives.id, v.representativeId))
      : Promise.resolve([]),
  ]);
  if (!s) throw new RuleError("Choose a revenue stream from the list.");
  if (!c) throw new RuleError("Choose a country from the list.");
  if (v.representativeId && !rep[0]) throw new RuleError("That representative no longer exists.");
  return rep[0]?.rate ?? null;
}

function incomeValues(input: IncomeInput) {
  const parsed = incomeInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the entry and try again.");
  const v = parsed.data;
  return {
    entryDate: v.entryDate,
    streamId: v.streamId,
    countryCode: v.countryCode.toUpperCase(),
    client: v.client,
    description: v.description,
    ...moneyValues(v),
    invoiceRef: v.invoiceRef || null,
    status: v.status,
    representativeId: v.representativeId ?? null,
    notes: v.notes || null,
  };
}

export async function createIncome(actor: Actor, input: IncomeInput, attachment?: Attachment): Promise<string> {
  requirePerm(actor, "transactions", "create");
  const values = incomeValues(input);
  const db = getDb();
  const commissionRate = await checkRefs(db, values);
  const id = crypto.randomUUID();
  const file = attachment ? await saveUpload(actor, { module: "transactions", entityType: "income_entries", entityId: id, ...attachment }) : null;
  await db.transaction(async (tx) => {
    await tx.insert(incomeEntries).values({ id, ...values, commissionRate, invoiceFileId: file?.id ?? null, createdBy: actor.userId });
    const [after] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "income_entries", entityId: id, after });
  });
  return id;
}

export async function updateIncome(actor: Actor, id: string, input: IncomeInput, attachment?: Attachment) {
  requirePerm(actor, "transactions", "edit");
  const values = incomeValues(input);
  const db = getDb();
  const repRate = await checkRefs(db, values);
  const [current] = await db.select().from(incomeEntries).where(eq(incomeEntries.id, id));
  if (!current || !(await incomeRowAllowed(db, actor, current))) throw new AccessDenied("That entry doesn't exist or isn't yours to change.");
  const file = attachment ? await saveUpload(actor, { module: "transactions", entityType: "income_entries", entityId: id, ...attachment }) : null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(incomeEntries).where(eq(incomeEntries.id, id)).for("update");
    if (!before || !(await incomeRowAllowed(tx, actor, before))) throw new AccessDenied("That entry doesn't exist or isn't yours to change.");
    // keep the commission rate agreed at the time unless the representative changes
    const commissionRate = values.representativeId === before.representativeId ? before.commissionRate : repRate;
    await tx
      .update(incomeEntries)
      .set({ ...values, commissionRate, ...(file ? { invoiceFileId: file.id } : {}) })
      .where(eq(incomeEntries.id, id));
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

// ---------------------------------------------------------------- expenses: create, edit, delete
export const expenseInput = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  category: z.string().trim().min(1, "Choose a category.").max(80),
  vendor: z.string().trim().max(200).default(""),
  description: z.string().trim().max(500).default(""),
  ...moneyFields,
  isRecurring: z.boolean().default(false),
  /** blank = a shared cost, not tied to one country */
  countryCode: z.string().trim().toUpperCase().max(8).nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type ExpenseInput = z.input<typeof expenseInput>;

function expenseValues(input: ExpenseInput) {
  const parsed = expenseInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the expense and try again.");
  const v = parsed.data;
  return {
    expenseDate: v.expenseDate,
    category: v.category,
    vendor: v.vendor,
    description: v.description,
    ...moneyValues(v),
    isRecurring: v.isRecurring,
    countryCode: v.countryCode || null,
    notes: v.notes || null,
  };
}

/** Category must be on the list; country must exist (or be blank for shared). */
export async function checkExpenseRefs(db: Db | Tx, v: { category: string; countryCode: string | null }, keepCategory: string | null = null) {
  const category = await canonicalCategory(db, v.category, keepCategory);
  if (v.countryCode) {
    const [c] = await db.select({ code: countries.code }).from(countries).where(eq(countries.code, v.countryCode));
    if (!c) throw new RuleError("Choose a country from the list, or leave it blank for a shared cost.");
  }
  return category;
}

export async function createExpense(actor: Actor, input: ExpenseInput, attachment?: Attachment): Promise<string> {
  requirePerm(actor, "transactions", "create");
  const values = expenseValues(input);
  values.category = await checkExpenseRefs(getDb(), values);
  const id = crypto.randomUUID();
  const file = attachment ? await saveUpload(actor, { module: "transactions", entityType: "expenses", entityId: id, ...attachment }) : null;
  await getDb().transaction(async (tx) => {
    await tx.insert(expenses).values({ id, ...values, receiptFileId: file?.id ?? null, createdBy: actor.userId });
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: id, after });
  });
  return id;
}

export async function updateExpense(actor: Actor, id: string, input: ExpenseInput, attachment?: Attachment) {
  requirePerm(actor, "transactions", "edit");
  const values = expenseValues(input);
  const db = getDb();
  const [current] = await db.select({ createdBy: expenses.createdBy, category: expenses.category }).from(expenses).where(eq(expenses.id, id));
  if (!current || !rowAllowed(actor, "transactions", { ownerId: current.createdBy })) throw new AccessDenied("That expense doesn't exist or isn't yours to change.");
  // an archived category may stay on an older expense, but can't be newly chosen
  values.category = await checkExpenseRefs(db, values, current.category);
  const file = attachment ? await saveUpload(actor, { module: "transactions", entityType: "expenses", entityId: id, ...attachment }) : null;
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!before || !rowAllowed(actor, "transactions", { ownerId: before.createdBy })) throw new AccessDenied("That expense doesn't exist or isn't yours to change.");
    await tx
      .update(expenses)
      .set({ ...values, ...(file ? { receiptFileId: file.id } : {}) })
      .where(eq(expenses.id, id));
    const [after] = await tx.select().from(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "expenses", entityId: id, before, after });
  });
}

export async function deleteExpense(actor: Actor, id: string) {
  requirePerm(actor, "transactions", "delete");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!before || !rowAllowed(actor, "transactions", { ownerId: before.createdBy })) throw new AccessDenied("That expense doesn't exist or isn't yours to delete.");
    await tx.delete(expenses).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "expenses", entityId: id, before });
  });
}

// ---------------------------------------------------------------- CSV export
const EXPORT_LIMIT = 20_000;

function describeFilters(f: Record<string, unknown>) {
  const parts = Object.entries(f)
    .filter(([k, v]) => v !== undefined && v !== "" && k !== "page" && k !== "sort" && k !== "dir")
    .map(([k, v]) => `${k}=${String(v)}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export const INCOME_CSV_HEADER = ["date", "stream", "country", "client", "description", "amount", "currency", "fx_rate", "invoice_ref", "status", "representative", "notes"];
export const EXPENSE_CSV_HEADER = ["date", "category", "vendor", "description", "amount", "currency", "fx_rate", "recurring", "country", "notes"];

/** Exports what the filters show, within the caller's scope. Logged in the audit log. */
export async function exportIncomeCsv(actor: Actor, f: IncomeFilters): Promise<{ filename: string; csv: string; rows: number }> {
  requirePerm(actor, "transactions", "export");
  const db = getDb();
  const base = await baseCurrency(db);
  const rows = (await incomeQuery(db)
    .where(incomeWhere(db, actor, f))
    .orderBy(desc(incomeEntries.entryDate), asc(incomeEntries.id))
    .limit(EXPORT_LIMIT)) as IncomeRow[];
  const csv = toCsv(
    [...INCOME_CSV_HEADER, `amount_${base.toLowerCase()}`],
    rows.map((r) => [
      r.entryDate,
      r.streamName,
      r.countryCode,
      r.client,
      r.description,
      minorToDecimal(r.amountMinor),
      r.currency,
      r.fxRateToBase,
      r.invoiceRef ?? "",
      r.status,
      r.representativeName ?? "",
      r.notes ?? "",
      minorToDecimal(r.amountBaseMinor ?? 0),
    ])
  );
  const filename = `income-${new Date().toISOString().slice(0, 10)}.csv`;
  await writeAudit(db, actorRef(actor), { action: "export", entity: "transactions", summary: `${filename}: ${rows.length} income rows${describeFilters(f)}` });
  return { filename, csv, rows: rows.length };
}

export async function exportExpensesCsv(actor: Actor, f: ExpenseFilters): Promise<{ filename: string; csv: string; rows: number }> {
  requirePerm(actor, "transactions", "export");
  const db = getDb();
  const base = await baseCurrency(db);
  const rows = await db.select().from(expenses).where(expenseWhere(actor, f)).orderBy(desc(expenses.expenseDate), asc(expenses.id)).limit(EXPORT_LIMIT);
  const csv = toCsv(
    [...EXPENSE_CSV_HEADER, `amount_${base.toLowerCase()}`],
    rows.map((r) => [
      r.expenseDate,
      r.category,
      r.vendor,
      r.description,
      minorToDecimal(r.amountMinor),
      r.currency,
      r.fxRateToBase,
      r.isRecurring ? "yes" : "no",
      r.countryCode ?? "",
      r.notes ?? "",
      minorToDecimal(r.amountBaseMinor ?? 0),
    ])
  );
  const filename = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
  await writeAudit(db, actorRef(actor), { action: "export", entity: "transactions", summary: `${filename}: ${rows.length} expense rows${describeFilters(f)}` });
  return { filename, csv, rows: rows.length };
}

// ---------------------------------------------------------------- CSV import
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_BYTES = 1024 * 1024;

export type ImportResult = { ok: true; created: number } | { ok: false; errors: string[] };

function readRows(text: string, required: string[]) {
  if (Buffer.byteLength(text, "utf8") > IMPORT_MAX_BYTES) throw new RuleError("That file is over 1 MB. Split it into smaller files.");
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch {
    throw new RuleError("That file isn't valid CSV. Save it from your spreadsheet as CSV (comma separated) and try again.");
  }
  if (table.length < 2) throw new RuleError("The file has no rows to import under the header.");
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const missing = required.filter((r) => !header.includes(r));
  if (missing.length) throw new RuleError(`The header row is missing: ${missing.join(", ")}. Download the template to see the expected columns.`);
  const body = table.slice(1);
  if (body.length > IMPORT_MAX_ROWS) throw new RuleError(`Import up to ${IMPORT_MAX_ROWS} rows at a time.`);
  return body.map((cells) => Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()])) as Record<string, string>);
}

/**
 * All or nothing: every row is checked first, and nothing is saved unless
 * every row is valid. Streams, countries and representatives are matched by name.
 */
export async function importIncomeCsv(actor: Actor, text: string): Promise<ImportResult> {
  requirePerm(actor, "transactions", "create");
  const rows = readRows(text, ["date", "stream", "country", "amount", "currency"]);
  const db = getDb();
  const [allStreams, allCountries, allReps] = await Promise.all([
    db.select().from(streams),
    db.select().from(countries),
    db.select({ id: representatives.id, name: representatives.name, rate: representatives.commissionRate }).from(representatives),
  ]);
  const byName = <T extends { name: string }>(list: T[], name: string) => list.find((x) => x.name.toLowerCase() === name.toLowerCase());
  const errors: string[] = [];
  const values: Array<typeof incomeEntries.$inferInsert> = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const stream = byName(allStreams, r.stream);
    const country = allCountries.find((c) => c.code.toLowerCase() === r.country.toLowerCase() || c.name.toLowerCase() === r.country.toLowerCase());
    const rep = r.representative ? byName(allReps, r.representative) : null;
    if (!stream) errors.push(`Row ${line}: no revenue stream called "${r.stream}".`);
    if (!country) errors.push(`Row ${line}: no country "${r.country}". Use GB, AU or OTHER.`);
    if (r.representative && !rep) errors.push(`Row ${line}: no representative called "${r.representative}".`);
    if (!stream || !country || (r.representative && !rep)) return;
    try {
      const v = incomeValues({
        entryDate: r.date,
        streamId: stream.id,
        countryCode: country.code,
        client: r.client ?? "",
        description: r.description ?? "",
        amount: r.amount,
        currency: r.currency,
        fxRate: r.fx_rate || "1",
        invoiceRef: r.invoice_ref || undefined,
        status: ((r.status || "pending").toLowerCase() as "pending"),
        representativeId: rep?.id ?? null,
        notes: r.notes || undefined,
      });
      values.push({ id: crypto.randomUUID(), ...v, commissionRate: rep?.rate ?? null, createdBy: actor.userId });
    } catch (e) {
      errors.push(`Row ${line}: ${e instanceof Error ? e.message : "invalid row"}`);
    }
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 25) };
  await db.transaction(async (tx) => {
    await tx.insert(incomeEntries).values(values);
    await writeAuditMany(
      tx,
      actorRef(actor),
      values.map((v) => ({ action: "create" as const, entity: "income_entries", entityId: v.id!, summary: "Imported from CSV", after: v }))
    );
  });
  return { ok: true, created: values.length };
}

export async function importExpensesCsv(actor: Actor, text: string): Promise<ImportResult> {
  requirePerm(actor, "transactions", "create");
  const rows = readRows(text, ["date", "category", "amount", "currency"]);
  const db = getDb();
  const [cats, allCountries] = await Promise.all([db.select().from(expenseCategories).where(eq(expenseCategories.active, true)), db.select().from(countries)]);
  const errors: string[] = [];
  const values: Array<typeof expenses.$inferInsert> = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const cat = cats.find((c) => c.name.toLowerCase() === r.category.toLowerCase());
    const country = r.country ? allCountries.find((c) => c.code.toLowerCase() === r.country.toLowerCase() || c.name.toLowerCase() === r.country.toLowerCase()) : null;
    if (!cat) errors.push(`Row ${line}: "${r.category}" isn't an expense category. Add it in Settings first.`);
    if (r.country && !country) errors.push(`Row ${line}: no country "${r.country}". Use GB, AU, OTHER, or leave blank for shared.`);
    if (!cat || (r.country && !country)) return;
    try {
      const v = expenseValues({
        expenseDate: r.date,
        category: cat.name,
        vendor: r.vendor ?? "",
        description: r.description ?? "",
        amount: r.amount,
        currency: r.currency,
        fxRate: r.fx_rate || "1",
        isRecurring: /^(yes|y|true|1)$/i.test(r.recurring ?? ""),
        countryCode: country?.code ?? null,
        notes: r.notes || undefined,
      });
      values.push({ id: crypto.randomUUID(), ...v, createdBy: actor.userId });
    } catch (e) {
      errors.push(`Row ${line}: ${e instanceof Error ? e.message : "invalid row"}`);
    }
  });
  if (errors.length) return { ok: false, errors: errors.slice(0, 25) };
  await getDb().transaction(async (tx) => {
    await tx.insert(expenses).values(values);
    await writeAuditMany(
      tx,
      actorRef(actor),
      values.map((v) => ({ action: "create" as const, entity: "expenses", entityId: v.id!, summary: "Imported from CSV", after: v }))
    );
  });
  return { ok: true, created: values.length };
}

// ---------------------------------------------------------------- file access + dev badge
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

