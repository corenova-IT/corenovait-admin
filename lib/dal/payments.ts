import "server-only";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { addDays, daysBetween, dueDatesUntil, nextCycleDate, todayIn, type CycleName } from "@/lib/dates";
import { actorRef, writeAudit } from "./audit";
import { baseCurrency, checkExpenseRefs, moneyFields, moneyValues } from "./finance";
import { AccessDenied, RuleError, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";

/**
 * Payments and subscriptions (module "payments").
 * Scope: own = ones you added; assigned = also ones you're responsible for.
 * "Mark as paid" records an expense and moves the due date on one cycle.
 */
const { subscriptions, expenses, users, settings } = schema;

export const CYCLES = ["weekly", "monthly", "quarterly", "yearly", "once"] as const;
export const CYCLE_LABEL: Record<CycleName, string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", once: "One-off" };

export async function companyToday(db: Db | Tx = getDb()): Promise<string> {
  const [s] = await db.select({ tz: settings.timezone }).from(settings).where(eq(settings.id, 1));
  return todayIn(s?.tz ?? "Australia/Sydney");
}

/**
 * What one charge costs per month, in whole cents, rounded half away from zero:
 * weekly x 52/12, quarterly / 3, yearly / 12. One-off payments aren't recurring.
 */
export function monthlyEquivalent(amountBaseMinor: number, cycle: CycleName): number {
  const [num, den] = cycle === "weekly" ? [52n, 12n] : cycle === "monthly" ? [1n, 1n] : cycle === "quarterly" ? [1n, 3n] : cycle === "yearly" ? [1n, 12n] : [0n, 1n];
  const p = BigInt(amountBaseMinor) * num;
  const q = p / den;
  return Number((p % den) * 2n >= den ? q + 1n : q);
}

function subScope(actor: Actor): SQL | undefined {
  return scopeWhere(actor, "payments", { owner: subscriptions.createdBy, assignedTo: (uid) => eq(subscriptions.responsibleUserId, uid) });
}

const n = (v: unknown) => Number(v ?? 0);

export type SubscriptionRow = {
  id: string;
  vendor: string;
  category: string;
  description: string;
  amountMinor: number;
  currency: string;
  fxRateToBase: string;
  amountBaseMinor: number;
  billingCycle: CycleName;
  nextDueDate: string;
  status: "active" | "paused" | "cancelled" | "completed";
  reminderDays: number;
  paidFrom: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  countryCode: string | null;
  notes: string | null;
  monthlyBaseMinor: number;
  daysUntilDue: number;
  dueSoon: boolean;
  overdue: boolean;
};

async function loadSubs(db: Db | Tx, actor: Actor, extra?: SQL) {
  const today = await companyToday(db);
  const rows = await db
    .select({ s: subscriptions, responsibleName: users.fullName })
    .from(subscriptions)
    .leftJoin(users, eq(users.id, subscriptions.responsibleUserId))
    .where(and(subScope(actor), extra))
    .orderBy(asc(subscriptions.nextDueDate), asc(subscriptions.vendor));
  return {
    today,
    rows: rows.map(({ s, responsibleName }): SubscriptionRow => {
      const days = daysBetween(today, s.nextDueDate);
      const live = s.status === "active";
      return {
        id: s.id,
        vendor: s.vendor,
        category: s.category,
        description: s.description,
        amountMinor: s.amountMinor,
        currency: s.currency,
        fxRateToBase: s.fxRateToBase,
        amountBaseMinor: n(s.amountBaseMinor),
        billingCycle: s.billingCycle,
        nextDueDate: s.nextDueDate,
        status: s.status,
        reminderDays: s.reminderDays,
        paidFrom: s.paidFrom,
        responsibleUserId: s.responsibleUserId,
        responsibleName,
        countryCode: s.countryCode,
        notes: s.notes,
        monthlyBaseMinor: live ? monthlyEquivalent(n(s.amountBaseMinor), s.billingCycle) : 0,
        daysUntilDue: days,
        dueSoon: live && days >= 0 && days <= s.reminderDays,
        overdue: live && days < 0,
      };
    }),
  };
}

export type Occurrence = { subscriptionId: string; vendor: string; category: string; dueDate: string; daysUntil: number; amountBaseMinor: number; amountMinor: number; currency: string; dueSoon: boolean; overdue: boolean };

/**
 * Upcoming charges for active subscriptions: every due date up to `days`
 * ahead (a weekly one appears several times), plus anything already overdue.
 */
export function timeline(rows: SubscriptionRow[], today: string, days: number): Occurrence[] {
  const until = addDays(today, days);
  const out: Occurrence[] = [];
  for (const s of rows) {
    if (s.status !== "active") continue;
    for (const d of dueDatesUntil(s.nextDueDate, s.billingCycle, until)) {
      const daysUntil = daysBetween(today, d);
      out.push({
        subscriptionId: s.id,
        vendor: s.vendor,
        category: s.category,
        dueDate: d,
        daysUntil,
        amountBaseMinor: s.amountBaseMinor,
        amountMinor: s.amountMinor,
        currency: s.currency,
        dueSoon: daysUntil >= 0 && daysUntil <= s.reminderDays,
        overdue: daysUntil < 0,
      });
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.vendor.localeCompare(b.vendor));
}

const sumOf = (xs: Occurrence[]) => xs.reduce((a, o) => a + o.amountBaseMinor, 0);

/** Everything the Payments page and the Home "upcoming payments" card need. */
export async function paymentsOverview(actor: Actor, opts: { country?: string } = {}) {
  requirePerm(actor, "payments", "view");
  const db = getDb();
  // a country view includes that country's subscriptions only; shared ones show under "All"
  const { today, rows } = await loadSubs(db, actor, opts.country ? eq(subscriptions.countryCode, opts.country) : undefined);
  const ninety = timeline(rows, today, 90);
  const within = (d: number) => ninety.filter((o) => o.daysUntil <= d);
  return {
    today,
    baseCurrency: await baseCurrency(db),
    subscriptions: rows,
    timeline: ninety,
    due30: { count: within(30).length, totalBaseMinor: sumOf(within(30)) },
    due60: { count: within(60).length, totalBaseMinor: sumOf(within(60)) },
    due90: { count: ninety.length, totalBaseMinor: sumOf(ninety) },
    overdue: { count: ninety.filter((o) => o.overdue).length, totalBaseMinor: sumOf(ninety.filter((o) => o.overdue)) },
    monthlyRecurringBaseMinor: rows.reduce((a, s) => a + s.monthlyBaseMinor, 0),
    activeCount: rows.filter((s) => s.status === "active").length,
  };
}

// ---------------------------------------------------------------- create / edit
export const subscriptionInput = z.object({
  vendor: z.string().trim().min(1, "Enter who it's paid to.").max(200),
  category: z.string().trim().min(1, "Choose a category.").max(80),
  description: z.string().trim().max(500).default(""),
  ...moneyFields,
  billingCycle: z.enum(CYCLES).default("monthly"),
  nextDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the next due date."),
  reminderDays: z.coerce.number().int("Use a whole number of days.").min(0, "Use 0 to 90 days.").max(90, "Use 0 to 90 days.").default(3),
  paidFrom: z.string().trim().max(120).default(""),
  responsibleUserId: z.union([z.literal(""), z.string().uuid()]).nullable().optional(),
  countryCode: z.string().trim().toUpperCase().max(8).nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type SubscriptionInput = z.input<typeof subscriptionInput>;

async function loadOwned(tx: Db | Tx, actor: Actor, id: string, lock = false) {
  const q = tx.select().from(subscriptions).where(eq(subscriptions.id, id));
  const [row] = lock ? await q.for("update") : await q;
  if (!row || !rowAllowed(actor, "payments", { ownerId: row.createdBy, assigneeId: row.responsibleUserId })) {
    throw new AccessDenied("That payment doesn't exist or isn't yours to change.");
  }
  return row;
}

export async function saveSubscription(actor: Actor, id: string | null, input: SubscriptionInput): Promise<string> {
  requirePerm(actor, "payments", id ? "edit" : "create");
  const parsed = subscriptionInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the payment and try again.");
  const v = parsed.data;
  const db = getDb();
  const existing = id ? await loadOwned(db, actor, id) : null;
  const values = {
    vendor: v.vendor,
    category: await checkExpenseRefs(db, { category: v.category, countryCode: v.countryCode || null }, existing?.category ?? null),
    description: v.description,
    ...moneyValues(v),
    billingCycle: v.billingCycle,
    nextDueDate: v.nextDueDate,
    reminderDays: v.reminderDays,
    paidFrom: v.paidFrom,
    responsibleUserId: v.responsibleUserId || null,
    countryCode: v.countryCode || null,
    notes: v.notes || null,
  };
  if (values.responsibleUserId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, values.responsibleUserId));
    if (!u) throw new RuleError("That person no longer exists.");
  }
  return db.transaction(async (tx) => {
    if (!id) {
      const newId = crypto.randomUUID();
      await tx.insert(subscriptions).values({ id: newId, ...values, createdBy: actor.userId });
      const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, newId));
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "subscriptions", entityId: newId, after });
      return newId;
    }
    const before = await loadOwned(tx, actor, id, true);
    await tx.update(subscriptions).set(values).where(eq(subscriptions.id, id));
    const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "subscriptions", entityId: id, before, after });
    return id;
  });
}

/** Pause, cancel or resume. Cancelled and completed ones can't be resumed (add a new one). */
export async function setSubscriptionStatus(actor: Actor, id: string, status: "active" | "paused" | "cancelled") {
  requirePerm(actor, "payments", "edit");
  await getDb().transaction(async (tx) => {
    const before = await loadOwned(tx, actor, id, true);
    if (before.status === status) return;
    if (status === "active" && before.status !== "paused") throw new RuleError("Only a paused payment can be resumed.");
    if (before.status === "cancelled" || before.status === "completed") throw new RuleError("This payment has ended. Add a new one instead.");
    await tx.update(subscriptions).set({ status }).where(eq(subscriptions.id, id));
    const [after] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "subscriptions",
      entityId: id,
      summary: `${before.vendor}: ${status === "active" ? "resumed" : status}`,
      before: { status: before.status },
      after: { status: after.status },
    });
  });
}

/**
 * Records the payment as an expense (same amount, currency, rate, category
 * and country) and moves the due date on one cycle from the DUE date, so a
 * late payment doesn't shift the schedule. A one-off payment is completed.
 */
export async function markSubscriptionPaid(actor: Actor, id: string, opts: { paidDate?: string } = {}): Promise<{ expenseId: string; nextDueDate: string | null }> {
  requirePerm(actor, "payments", "edit");
  const db = getDb();
  const paidDate = opts.paidDate ?? (await companyToday(db));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)) throw new RuleError("Choose the date it was paid.");
  return db.transaction(async (tx) => {
    const before = await loadOwned(tx, actor, id, true);
    if (before.status !== "active") throw new RuleError("Only an active payment can be marked as paid. Resume it first.");
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
      subscriptionId: id,
      notes: before.paidFrom ? `Paid from ${before.paidFrom}` : null,
      createdBy: actor.userId,
    });
    const next = nextCycleDate(before.nextDueDate, before.billingCycle);
    await tx
      .update(subscriptions)
      .set(next ? { nextDueDate: next } : { status: "completed" })
      .where(eq(subscriptions.id, id));
    const [expense] = await tx.select().from(expenses).where(eq(expenses.id, expenseId));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "expenses", entityId: expenseId, summary: `Paid: ${before.vendor} (due ${before.nextDueDate})`, after: expense });
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "subscriptions",
      entityId: id,
      summary: `${before.vendor}: marked paid`,
      before: { nextDueDate: before.nextDueDate, status: before.status },
      after: next ? { nextDueDate: next, status: before.status } : { status: "completed" },
    });
    return { expenseId, nextDueDate: next };
  });
}

export async function deleteSubscription(actor: Actor, id: string) {
  requirePerm(actor, "payments", "delete");
  await getDb().transaction(async (tx) => {
    const before = await loadOwned(tx, actor, id, true);
    await tx.delete(subscriptions).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "subscriptions", entityId: id, before });
  });
}

/** People who can be made responsible for a payment. */
export async function responsibleCandidates(actor: Actor) {
  requirePerm(actor, "payments", "view");
  return getDb()
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.fullName));
}
