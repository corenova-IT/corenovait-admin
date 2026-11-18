import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { addMonths } from "@/lib/dates";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { moneyFields, moneyValues } from "./finance";
import { AccessDenied, RuleError, assertCaller, requireAdmin, type Actor } from "./guard";
import { ownEmployee } from "./partner-employees";
import { companyToday } from "./payments";
import { NotFound, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * Employee pay: a fixed monthly amount, or a fixed amount for one project. Set by the employee's
 * stream partner OR an admin; both are logged. The employee never sees any of it.
 *
 * Counted exactly once. Pay lives ONLY in employee_pay_plans / employee_pay_records: it is never also
 * written as an expense, so the Finances expense list has none of it. Every screen that shows a partner's
 * costs (their dashboard, the admin Partners pages) adds these records to expenses through
 * lib/dal/partner-dashboard.ts, and company profit (lib/dal/analytics.ts) subtracts them once, on a
 * separate "Employee pay" line.
 *
 * - Monthly pay: one record per month (period "YYYY-MM"), a cost from the 1st of that month, created
 *   idempotently (unique on plan + period) by ensureMonthlyPay.
 * - Project pay: one record (period "project"), a cost only once it is marked paid, on the day it was paid.
 * - The stream (and country) on a record must be one of the employee's partner's, so the cost lands under
 *   that partner and follows the same stream AND country rule as every other cost.
 * - Currency and exchange rate are stored on each plan and copied onto each record.
 */
const { users, projects, projectMembers, employeeAssignments, employeePayPlans: plans, employeePayRecords: records, streamPartnerStreams, streamPartnerCountries } = schema;

const MAX_BACKFILL_MONTHS = 36;

export const payInput = z.object({
  employeeId: z.string().uuid(),
  kind: z.enum(["monthly", "project"]),
  streamId: z.coerce.number().int().positive().optional(),
  countryCode: z.string().trim().toUpperCase().max(8).optional(),
  projectId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.string().uuid().nullable()).optional(),
  startMonth: z.preprocess((v) => (v === "" ? undefined : v), z.string().regex(/^\d{4}-\d{2}$/, "Use a month like 2026-03.").optional()),
  ...moneyFields,
});
export type PayInput = z.input<typeof payInput>;

/**
 * Creates any monthly pay records that are missing, up to and including this month. Safe to call any
 * number of times (the unique key makes a second call a no-op), so every reader can call it first.
 */
export async function ensureMonthlyPay(db: Db | Tx, today?: string): Promise<number> {
  const now = today ?? (await companyToday(db));
  const through = now.slice(0, 7);
  const active = await db.select().from(plans).where(and(eq(plans.active, true), eq(plans.kind, "monthly")));
  if (!active.length) return 0;
  const existing = await db.select({ planId: records.planId, period: records.period }).from(records).where(inArray(records.planId, active.map((p) => p.id)));
  const have = new Set(existing.map((r) => `${r.planId}|${r.period}`));
  const floor = addMonths(`${through}-01`, -MAX_BACKFILL_MONTHS).slice(0, 7);
  const toMake: Array<typeof records.$inferInsert> = [];
  for (const p of active) {
    let m = p.startMonth && p.startMonth > floor ? p.startMonth : floor;
    while (m <= through) {
      if (!have.has(`${p.id}|${m}`)) {
        toMake.push({ planId: p.id, employeeUserId: p.employeeUserId, period: m, streamId: p.streamId, countryCode: p.countryCode, amountMinor: p.amountMinor, currency: p.currency, fxRateToBase: p.fxRateToBase, status: "due", costDate: `${m}-01` });
      }
      m = addMonths(`${m}-01`, 1).slice(0, 7);
    }
  }
  if (!toMake.length) return 0;
  await db.insert(records).values(toMake).onDuplicateKeyUpdate({ set: { planId: sql`${records.planId}` } });
  return toMake.length;
}

/**
 * Who may set this employee's pay, and which streams and countries it may land under. A stream partner:
 * their own employee only (anyone else is NotFound). An admin: any employee that has a partner.
 */
async function payContext(tx: Tx | Db, actor: Actor, employeeId: string) {
  assertCaller(actor);
  let partnerId: string;
  if (actor.isAdmin) {
    requireAdmin(actor);
    const [a] = await tx
      .select({ partner: employeeAssignments.partnerUserId })
      .from(employeeAssignments)
      .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
      .where(and(eq(employeeAssignments.employeeUserId, employeeId), eq(users.presetId, "employee")));
    if (!a) throw new RuleError("That person isn't an employee of a stream partner.");
    partnerId = a.partner;
  } else {
    if (actor.presetId !== "stream_partner") throw new AccessDenied();
    partnerScope(actor); // stream partner with two-factor done
    await ownEmployee(tx, actor, employeeId);
    partnerId = actor.userId;
  }
  const [streamRows, countryRows] = await Promise.all([
    tx.select({ id: streamPartnerStreams.streamId }).from(streamPartnerStreams).where(eq(streamPartnerStreams.userId, partnerId)),
    tx.select({ code: streamPartnerCountries.countryCode }).from(streamPartnerCountries).where(eq(streamPartnerCountries.userId, partnerId)),
  ]);
  const fail = () => (actor.isAdmin ? new RuleError("Pay has to land under one of that partner's streams and countries.") : new NotFound());
  return {
    partnerId,
    streamIds: streamRows.map((s) => s.id),
    countryCodes: countryRows.map((c) => c.code),
    assertWhere(streamId: number, countryCode: string) {
      if (!streamRows.some((s) => s.id === streamId) || !countryRows.some((c) => c.code === countryCode)) throw fail();
    },
  };
}

const planSummary = (p: { kind: string; streamId: number; countryCode: string; projectId: string | null; amountMinor: number; currency: string; fxRateToBase: string; startMonth: string | null; active: boolean }) => ({
  kind: p.kind,
  streamId: p.streamId,
  countryCode: p.countryCode,
  projectId: p.projectId,
  amountMinor: p.amountMinor,
  currency: p.currency,
  fxRateToBase: p.fxRateToBase,
  startMonth: p.startMonth,
  active: p.active,
});

/** Adds a pay arrangement for an employee (monthly or for one project). */
export async function addPayPlan(actor: Actor, input: PayInput): Promise<string> {
  const parsed = payInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the pay details and try again.");
  const v = parsed.data;
  const money = moneyValues(v);
  const db = getDb();
  const today = await companyToday(db);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    const ctx = await payContext(tx, actor, v.employeeId);
    let streamId = v.streamId;
    let projectId: string | null = null;
    if (v.kind === "project") {
      if (!v.projectId) throw new RuleError("Choose the project this pay is for.");
      // a partner can only use projects in their own streams that are not hidden from them (an admin, any project)
      const [p] = await tx
        .select({ id: projects.id, streamId: projects.streamId, active: projects.active })
        .from(projects)
        .where(actor.isAdmin ? eq(projects.id, v.projectId) : and(eq(projects.id, v.projectId), streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(tx, actor, projects.id)));
      if (!p) throw actor.isAdmin ? new RuleError("That project no longer exists.") : new NotFound();
      const [on] = await tx.select({ u: projectMembers.userId }).from(projectMembers).where(and(eq(projectMembers.projectId, p.id), eq(projectMembers.userId, v.employeeId)));
      if (!on) throw new RuleError("Put them on that project first.");
      streamId = p.streamId; // project pay costs the project's own stream
      projectId = p.id;
    } else if (v.projectId) {
      throw new RuleError("A project is only for project pay.");
    }
    if (!streamId || !v.countryCode) throw new RuleError(!streamId ? "Choose a stream." : "Choose a country.");
    ctx.assertWhere(streamId, v.countryCode);
    const startMonth = v.kind === "monthly" ? v.startMonth ?? today.slice(0, 7) : null;
    if (startMonth && startMonth > today.slice(0, 7)) throw new RuleError("Monthly pay can't start in a future month.");
    await tx.insert(plans).values({ id, employeeUserId: v.employeeId, kind: v.kind, streamId, countryCode: v.countryCode, projectId, startMonth, ...money, createdBy: actor.userId });
    if (v.kind === "project") {
      await tx.insert(records).values({ planId: id, employeeUserId: v.employeeId, period: "project", streamId, countryCode: v.countryCode, ...money, status: "due", costDate: null });
    }
    const [after] = await tx.select().from(plans).where(eq(plans.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "employee_pay_plans", entityId: v.employeeId, summary: `Set ${v.kind} pay for an employee`, before: null, after: { planId: id, ...planSummary(after) } });
  });
  await ensureMonthlyPay(db, today);
  return id;
}

async function loadPlan(tx: Tx, actor: Actor, planId: string) {
  const [p] = await tx.select().from(plans).where(eq(plans.id, planId)).for("update");
  if (!p) throw actor.isAdmin ? new RuleError("That pay arrangement no longer exists.") : new NotFound();
  const ctx = await payContext(tx, actor, p.employeeUserId); // NotFound for a partner if it isn't their employee's
  return { p, ctx };
}

/** Changes the amount. Monthly: from the next month that has no record yet; project: only while still unpaid. */
export async function updatePayAmount(actor: Actor, planId: string, input: { amount: string; currency: string; fxRate?: string }) {
  const parsed = z.object(moneyFields).safeParse({ fxRate: "1", ...input });
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the amount and try again.");
  const money = moneyValues(parsed.data);
  await getDb().transaction(async (tx) => {
    const { p } = await loadPlan(tx, actor, planId);
    if (!p.active) throw new RuleError("This pay has been stopped. Add new pay instead.");
    if (p.kind === "project") {
      const [rec] = await tx.select().from(records).where(and(eq(records.planId, p.id), eq(records.period, "project"))).for("update");
      if (rec?.status === "paid") throw new RuleError("This project pay was already paid, so its amount can't change.");
      if (rec) await tx.update(records).set(money).where(eq(records.id, rec.id));
    }
    await tx.update(plans).set(money).where(eq(plans.id, p.id));
    const [after] = await tx.select().from(plans).where(eq(plans.id, p.id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "employee_pay_plans", entityId: p.employeeUserId, summary: `Changed ${p.kind} pay for an employee`, before: { planId: p.id, ...planSummary(p) }, after: { planId: p.id, ...planSummary(after) } });
  });
}

/** Stops monthly pay (no more months are created; the ones already made stay). Project pay can be stopped while unpaid. */
export async function stopPayPlan(actor: Actor, planId: string) {
  await getDb().transaction(async (tx) => {
    const { p } = await loadPlan(tx, actor, planId);
    if (!p.active) return;
    if (p.kind === "project") {
      const [rec] = await tx.select().from(records).where(and(eq(records.planId, p.id), eq(records.period, "project"))).for("update");
      if (rec?.status === "paid") throw new RuleError("This project pay was already paid.");
    }
    await tx.update(plans).set({ active: false }).where(eq(plans.id, p.id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "employee_pay_plans", entityId: p.employeeUserId, summary: `Stopped ${p.kind} pay for an employee`, before: { planId: p.id, active: true }, after: { planId: p.id, active: false } });
  });
}

/** Project pay becomes a cost on the day it is marked paid. Marking it again changes nothing. */
export async function markProjectPayPaid(actor: Actor, planId: string, paidDate?: string) {
  const db = getDb();
  const date = paidDate || (await companyToday(db));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RuleError("Choose the date it was paid.");
  await db.transaction(async (tx) => {
    const { p } = await loadPlan(tx, actor, planId);
    if (p.kind !== "project") throw new RuleError("Monthly pay is a cost every month; only project pay is marked paid.");
    const [rec] = await tx.select().from(records).where(and(eq(records.planId, p.id), eq(records.period, "project"))).for("update");
    if (!rec) throw new RuleError("That pay arrangement has no payment to mark.");
    if (rec.status === "paid") return; // already counted: nothing changes
    await tx.update(records).set({ status: "paid", paidDate: date, costDate: date }).where(eq(records.id, rec.id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "employee_pay_records", entityId: p.employeeUserId, summary: "Marked project pay as paid", before: { planId: p.id, status: "due" }, after: { planId: p.id, status: "paid", paidDate: date, amountMinor: rec.amountMinor, currency: rec.currency } });
  });
}

export type PayChoices = {
  streams: Array<{ id: number; name: string }>;
  countries: Array<{ code: string; name: string }>;
  /** projects the employee is on (project pay is for one of these) */
  projects: Array<{ id: string; name: string; streamId: number }>;
};

/** What the "add pay" form may offer for this employee: only their partner's streams and countries, and their own projects. */
export async function payFormChoices(actor: Actor, employeeId: string): Promise<PayChoices> {
  const db = getDb();
  const ctx = await payContext(db, actor, employeeId);
  const [streamRows, countryRows, projectRows] = await Promise.all([
    ctx.streamIds.length ? db.select({ id: schema.streams.id, name: schema.streams.name }).from(schema.streams).where(inArray(schema.streams.id, ctx.streamIds)).orderBy(asc(schema.streams.name)) : [],
    ctx.countryCodes.length ? db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).where(inArray(schema.countries.code, ctx.countryCodes)).orderBy(asc(schema.countries.sort)) : [],
    db
      .select({ id: projects.id, name: projects.name, streamId: projects.streamId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, employeeId), eq(projects.active, true)))
      .orderBy(asc(projects.name)),
  ]);
  return { streams: streamRows, countries: countryRows, projects: projectRows };
}

export type PayPlanView = {
  id: string;
  kind: "monthly" | "project";
  streamId: number;
  countryCode: string;
  project: string | null;
  amountMinor: number;
  currency: string;
  amountBaseMinor: number;
  startMonth: string | null;
  active: boolean;
  /** project pay: due or paid */
  status: "due" | "paid" | null;
  paidDate: string | null;
};

/** One employee's pay arrangements (for their partner or an admin; never for the employee). */
export async function payPlansFor(actor: Actor, employeeId: string): Promise<PayPlanView[]> {
  const db = getDb();
  await payContext(db, actor, employeeId);
  const rows = await db
    .select({ plan: plans, project: projects.name })
    .from(plans)
    .leftJoin(projects, eq(projects.id, plans.projectId))
    .where(eq(plans.employeeUserId, employeeId))
    .orderBy(desc(plans.active), asc(plans.createdAt));
  const recs = rows.length ? await db.select().from(records).where(and(inArray(records.planId, rows.map((r) => r.plan.id)), eq(records.period, "project"))) : [];
  return rows.map(({ plan: p, project }) => {
    const rec = recs.find((r) => r.planId === p.id);
    return {
      id: p.id,
      kind: p.kind,
      streamId: p.streamId,
      countryCode: p.countryCode,
      project,
      amountMinor: p.amountMinor,
      currency: p.currency,
      amountBaseMinor: Number(p.amountBaseMinor ?? 0),
      startMonth: p.startMonth,
      active: p.active,
      status: rec ? rec.status : null,
      paidDate: rec?.paidDate ?? null,
    };
  });
}
