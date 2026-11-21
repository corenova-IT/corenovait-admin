import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { assignmentOverview, type AssignmentOptions, type PartnerAssignment } from "./assignments";
import { requireAdmin, type Actor } from "./guard";
import { computeDashboard, type DashboardConds, type DashboardData } from "./partner-dashboard";
import { companyToday } from "./payments";
import { NotFound, moneyRowsFor, notHiddenFrom, streamRowsFor, type Assignment } from "./scope";
import { auditVisible } from "./visibility";

/**
 * The admin's "Partners" pages: every partner, and one page per partner.
 *
 * What a partner's assignment covers is decided by the SAME rules the partner's own dashboard
 * uses (moneyRowsFor / streamRowsFor in lib/dal/scope.ts). On top of that, the admin's own
 * Owner-hidden items are removed (an admin never sees a project's money or tasks that the Owner
 * hid from them), exactly like everywhere else in the portal. Revenue is paid income only.
 * Admin only (an admin with two-factor done).
 */
const { users, streams, countries, auditLog, sessions, tasks, streamPartnerStreams, streamPartnerCountries, employeeAssignments, employeePayRecords } = schema;

export const partnerFilters = z.object({
  stream: z.coerce.number().int().positive().optional().catch(undefined),
  country: z.string().regex(/^[A-Z]{2,8}$/).optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});
export type PartnerFilters = z.infer<typeof partnerFilters>;

export type PartnerRow = {
  id: string;
  name: string;
  email: string;
  status: "active" | "invited" | "deactivated";
  streams: string[];
  countries: string[];
  revenueBaseMinor: number;
  profitBaseMinor: number;
  openTasks: number;
  upcomingPayments: number;
  lastActive: string | null;
};

function adminConds(db: Db | Tx, actor: Actor, a: Assignment): DashboardConds {
  const { incomeEntries, expenses, subscriptions, employeePayRecords: pay } = schema;
  return {
    income: and(moneyRowsFor(a, { streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(db, actor, incomeEntries.projectId)),
    expense: and(moneyRowsFor(a, { streamId: expenses.streamId, countryCode: expenses.countryCode }), isNull(expenses.archivedAt)),
    subscription: and(moneyRowsFor(a, { streamId: subscriptions.streamId, countryCode: subscriptions.countryCode }), eq(subscriptions.status, "active")),
    task: and(streamRowsFor(a, { streamId: tasks.streamId }), notHiddenFrom(db, actor, tasks.projectId), isNull(tasks.archivedAt)),
    pay: and(moneyRowsFor(a, { streamId: pay.streamId, countryCode: pay.countryCode }), isNotNull(pay.costDate)),
  };
}

async function period(db: Db | Tx, f: PartnerFilters) {
  const today = await companyToday(db);
  const from = f.from ?? `${today.slice(0, 7)}-01`;
  const to = f.to ?? today;
  return { today, from, to: to < from ? from : to };
}

async function loadPartners(db: Db | Tx) {
  const [people, ownedStreams, ownedCountries, streamRows, countryRows, seen] = await Promise.all([
    db.select({ id: users.id, name: users.fullName, email: users.email, status: users.status, lastSignInAt: users.lastSignInAt }).from(users).where(eq(users.presetId, "stream_partner")).orderBy(asc(users.fullName), asc(users.email)),
    db.select({ streamId: streamPartnerStreams.streamId, userId: streamPartnerStreams.userId }).from(streamPartnerStreams),
    db.select({ userId: streamPartnerCountries.userId, code: streamPartnerCountries.countryCode }).from(streamPartnerCountries),
    db.select({ id: streams.id, name: streams.name }).from(streams),
    db.select({ code: countries.code, name: countries.name }).from(countries),
    db.select({ userId: sessions.userId, at: max(sessions.lastSeenAt) }).from(sessions).groupBy(sessions.userId),
  ]);
  const streamName = new Map(streamRows.map((s) => [s.id, s.name]));
  const countryName = new Map(countryRows.map((c) => [c.code, c.name]));
  return people.map((p) => {
    const lastSeen = seen.find((s) => s.userId === p.id)?.at ?? null;
    const last = [p.lastSignInAt, lastSeen].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      ...p,
      assignment: { streamIds: ownedStreams.filter((o) => o.userId === p.id).map((o) => o.streamId).sort((a, b) => a - b), countryCodes: ownedCountries.filter((o) => o.userId === p.id).map((o) => o.code).sort() } as PartnerAssignment,
      streamName,
      countryName,
      lastActive: last?.toISOString() ?? null,
    };
  });
}

/** Narrows an assignment to the chosen stream and/or country; null when the partner doesn't have it. */
function narrow(a: PartnerAssignment, f: PartnerFilters): PartnerAssignment | null {
  if (f.stream && !a.streamIds.includes(f.stream)) return null;
  if (f.country && !a.countryCodes.includes(f.country)) return null;
  return { streamIds: f.stream ? [f.stream] : a.streamIds, countryCodes: f.country ? [f.country] : a.countryCodes };
}

export async function listPartners(actor: Actor, raw: PartnerFilters = {}): Promise<{ baseCurrency: string; from: string; to: string; rows: PartnerRow[]; options: AssignmentOptions }> {
  requireAdmin(actor);
  const f = partnerFilters.parse(raw);
  const db = getDb();
  const [{ from, to }, partners, { options }] = await Promise.all([period(db, f), loadPartners(db), assignmentOverview(actor)]);
  let baseCurrency = "AUD";
  const rows: PartnerRow[] = [];
  for (const p of partners) {
    const a = narrow(p.assignment, f);
    if (!a) continue;
    const scope = { ...a, hasData: a.streamIds.length > 0 && a.countryCodes.length > 0 };
    const d = await computeDashboard(db, scope, adminConds(db, actor, a), { from, to });
    baseCurrency = d.baseCurrency;
    rows.push({
      id: p.id,
      name: p.name || p.email,
      email: p.email,
      status: p.status,
      streams: p.assignment.streamIds.map((id) => p.streamName.get(id) ?? "").filter(Boolean),
      countries: p.assignment.countryCodes.map((c) => p.countryName.get(c) ?? c),
      revenueBaseMinor: d.overall.revenueMonthBaseMinor,
      profitBaseMinor: d.overall.netMonthBaseMinor,
      openTasks: d.tasks.open,
      upcomingPayments: d.upcomingPayments.filter((x) => x.daysUntilDue <= 30).length,
      lastActive: p.lastActive,
    });
  }
  return { baseCurrency, from, to, rows, options };
}

export type ChangeRow = {
  id: number;
  at: string;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string | null;
  before: Record<string, unknown> | unknown[] | null;
  after: Record<string, unknown> | unknown[] | null;
};

/** The kinds of record a partner can change themselves. Nothing about hiding or shares can ever appear here. */
export const PARTNER_CHANGE_ENTITIES = ["expenses", "subscriptions", "tasks", "partner_projects", "users", "employee_assignments"] as const;
/** Pay changes and shift corrections are shown whoever made them (the partner or an admin), because both may. */
const PAY_CHANGE_ENTITIES = ["employee_pay_plans", "employee_pay_records", "shifts"] as const;

export type PartnerDetail = {
  person: { id: string; name: string; email: string; status: "active" | "invited" | "deactivated"; lastActive: string | null };
  streams: Array<{ id: number; name: string }>;
  countries: Array<{ code: string; name: string }>;
  from: string;
  to: string;
  timeZone: string;
  dashboard: DashboardData;
  taskProgress: { open: number; overdue: number; done: number };
  /** this partner's employees and what they cost in the period (employee pay, counted once) */
  employees: Array<{ id: string; name: string; email: string; status: "invited" | "active" | "deactivated"; costBaseMinor: number }>;
  changes: ChangeRow[];
};

export async function partnerDetail(actor: Actor, userId: string, raw: PartnerFilters = {}): Promise<PartnerDetail> {
  requireAdmin(actor);
  const f = partnerFilters.parse(raw);
  const db = getDb();
  const [{ from, to }, partners] = await Promise.all([period(db, f), loadPartners(db)]);
  const p = partners.find((x) => x.id === userId);
  if (!p) throw new NotFound(); // not a partner, or no such person: the same answer
  const a: PartnerAssignment = p.assignment;
  const scope = { ...a, hasData: a.streamIds.length > 0 && a.countryCodes.length > 0 };
  const conds = adminConds(db, actor, a);
  const dashboard = await computeDashboard(db, scope, conds, { from, to });
  const [done] = await db.select({ n: count() }).from(tasks).where(and(conds.task, eq(tasks.status, "done")));
  const staff = await db
    .select({ id: users.id, name: users.fullName, email: users.email, status: users.status })
    .from(employeeAssignments)
    .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
    .where(eq(employeeAssignments.partnerUserId, userId))
    .orderBy(asc(users.fullName), asc(users.email));
  const staffIds = staff.map((s) => s.id);
  const costs = staffIds.length
    ? await db
        .select({ employeeId: employeePayRecords.employeeUserId, total: sql<string>`coalesce(sum(${employeePayRecords.amountBaseMinor}), 0)` })
        .from(employeePayRecords)
        .where(and(inArray(employeePayRecords.employeeUserId, staffIds), isNotNull(employeePayRecords.costDate), gte(employeePayRecords.costDate, from), lte(employeePayRecords.costDate, to)))
        .groupBy(employeePayRecords.employeeUserId)
    : [];
  const changes = await db
    .select({ id: auditLog.id, at: auditLog.at, actorEmail: auditLog.actorEmail, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, summary: auditLog.summary, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(
      and(
        or(
          and(eq(auditLog.actorId, userId), inArray(auditLog.entity, [...PARTNER_CHANGE_ENTITIES])),
          staffIds.length ? and(inArray(auditLog.entity, [...PAY_CHANGE_ENTITIES]), inArray(auditLog.entityId, staffIds)) : undefined
        ),
        auditVisible(db, actor)
      )
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(100);
  return {
    person: { id: p.id, name: p.name || p.email, email: p.email, status: p.status, lastActive: p.lastActive },
    streams: a.streamIds.map((id) => ({ id, name: p.streamName.get(id) ?? "" })),
    countries: a.countryCodes.map((code) => ({ code, name: p.countryName.get(code) ?? code })),
    from,
    to,
    timeZone: (await db.select({ tz: schema.settings.timezone }).from(schema.settings).where(eq(schema.settings.id, 1)))[0]?.tz ?? "Australia/Sydney",
    dashboard,
    taskProgress: { open: dashboard.tasks.open, overdue: dashboard.tasks.overdue, done: done?.n ?? 0 },
    employees: staff.map((s) => ({ id: s.id, name: s.name || s.email, email: s.email, status: s.status, costBaseMinor: Number(costs.find((c) => c.employeeId === s.id)?.total ?? 0) })),
    changes: changes.map(({ actorEmail, entityId, at, before, after, ...c }) => ({ ...c, at: at.toISOString(), actor_email: actorEmail, entity_id: entityId, before: before as ChangeRow["before"], after: after as ChangeRow["after"] })),
  };
}

