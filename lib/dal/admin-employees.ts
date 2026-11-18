import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { assignmentOverview, type AssignmentOptions } from "./assignments";
import { ONLINE_SECONDS } from "./chat";
import { requireAdmin, type Actor } from "./guard";
import { companyToday } from "./payments";
import { employeeShifts, flaggedCounts, minutesByEmployee, type EmployeeShifts } from "./shifts";
import { NotFound, notHiddenFrom } from "./scope";
import { auditVisible } from "./visibility";
import type { ChangeRow } from "./admin-partners";

/**
 * The admin's "Employees" pages: every employee, and one page per employee. Admin only (two-factor done).
 * Respects what the Owner hid from the admin: tasks filed under a project hidden from this admin are left
 * out, and so are the audit rows the admin may not see. Cost is employee pay (counted once), only ever
 * shown to admins and the employee's partner, never to the employee.
 */
const { users, projects, projectMembers, tasks, userPresence, sessions, employeeAssignments, employeePayRecords, auditLog, streamPartnerStreams, streamPartnerCountries, streams, countries } = schema;

export const employeeFilters = z.object({
  stream: z.coerce.number().int().positive().optional().catch(undefined),
  country: z.string().regex(/^[A-Z]{2,8}$/).optional().catch(undefined),
  partner: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});
export type EmployeeFilters = z.infer<typeof employeeFilters>;

async function period(db: Db | Tx, f: EmployeeFilters) {
  const today = await companyToday(db);
  const from = f.from ?? `${today.slice(0, 7)}-01`;
  const to = f.to ?? today;
  return { today, from, to: to < from ? from : to };
}

export type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  status: "invited" | "active" | "deactivated";
  partnerId: string | null;
  partnerName: string | null;
  streams: string[];
  countries: string[];
  projects: string[];
  openTasks: number;
  overdueTasks: number;
  hoursMinutes: number;
  costBaseMinor: number;
  online: boolean;
  lastActive: string | null;
  flaggedShifts: number;
};

export async function listEmployees(
  actor: Actor,
  raw: EmployeeFilters = {}
): Promise<{ baseCurrency: string; from: string; to: string; rows: EmployeeRow[]; options: AssignmentOptions; partners: Array<{ id: string; name: string }> }> {
  requireAdmin(actor);
  const f = employeeFilters.parse(raw);
  const db = getDb();
  const { today, from, to } = await period(db, f);
  const [people, assignments, partnerStreams, partnerCountries, streamRows, countryRows, memberRows, { options }, partnerRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.fullName, email: users.email, status: users.status, lastSignInAt: users.lastSignInAt, seen: userPresence.lastSeenAt })
      .from(users)
      .leftJoin(userPresence, eq(userPresence.userId, users.id))
      .where(eq(users.presetId, "employee"))
      .orderBy(asc(users.fullName), asc(users.email)),
    db.select({ employeeId: employeeAssignments.employeeUserId, partnerId: employeeAssignments.partnerUserId }).from(employeeAssignments),
    db.select({ userId: streamPartnerStreams.userId, streamId: streamPartnerStreams.streamId }).from(streamPartnerStreams),
    db.select({ userId: streamPartnerCountries.userId, code: streamPartnerCountries.countryCode }).from(streamPartnerCountries),
    db.select({ id: streams.id, name: streams.name }).from(streams),
    db.select({ code: countries.code, name: countries.name }).from(countries),
    db.select({ userId: projectMembers.userId, name: projects.name }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId)).where(eq(projects.active, true)).orderBy(asc(projects.name)),
    assignmentOverview(actor),
    db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.presetId, "stream_partner")).orderBy(asc(users.fullName)),
  ]);
  const sessionSeen = await db.select({ userId: sessions.userId, at: max(sessions.lastSeenAt) }).from(sessions).groupBy(sessions.userId);
  const partnerName = new Map(partnerRows.map((p) => [p.id, p.name || p.email]));
  const streamName = new Map(streamRows.map((s) => [s.id, s.name]));
  const countryName = new Map(countryRows.map((c) => [c.code, c.name]));

  // keep only employees whose partner has the chosen stream / country / is the chosen partner
  const keep = people.filter((p) => {
    const partnerId = assignments.find((a) => a.employeeId === p.id)?.partnerId ?? null;
    if (f.partner && partnerId !== f.partner) return false;
    if (f.stream && !partnerStreams.some((s) => s.userId === partnerId && s.streamId === f.stream)) return false;
    if (f.country && !partnerCountries.some((c) => c.userId === partnerId && c.code === f.country)) return false;
    return true;
  });
  const ids = keep.map((p) => p.id);
  const [openCounts, hours, flagged, costs] = ids.length
    ? await Promise.all([
        db
          .select({
            userId: tasks.assigneeId,
            open: sql<string>`coalesce(sum(${tasks.status} <> 'done'), 0)`,
            overdue: sql<string>`coalesce(sum(${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}), 0)`,
          })
          .from(tasks)
          .where(and(inArray(tasks.assigneeId, ids), isNull(tasks.archivedAt), notHiddenFrom(db, actor, tasks.projectId)))
          .groupBy(tasks.assigneeId),
        minutesByEmployee(db, ids, from, to),
        flaggedCounts(db, ids),
        db
          .select({ userId: employeePayRecords.employeeUserId, total: sql<string>`coalesce(sum(${employeePayRecords.amountBaseMinor}), 0)` })
          .from(employeePayRecords)
          .where(and(inArray(employeePayRecords.employeeUserId, ids), isNotNull(employeePayRecords.costDate), gte(employeePayRecords.costDate, from), lte(employeePayRecords.costDate, to)))
          .groupBy(employeePayRecords.employeeUserId),
      ])
    : [[], new Map<string, number>(), new Map<string, number>(), []];
  const now = Date.now();
  const rows: EmployeeRow[] = keep.map((p) => {
    const partnerId = assignments.find((a) => a.employeeId === p.id)?.partnerId ?? null;
    const lastSeen = sessionSeen.find((s) => s.userId === p.id)?.at ?? null;
    const last = [p.lastSignInAt, lastSeen].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const counts = (openCounts as Array<{ userId: string | null; open: string; overdue: string }>).find((c) => c.userId === p.id);
    return {
      id: p.id,
      name: p.name || p.email,
      email: p.email,
      status: p.status,
      partnerId,
      partnerName: partnerId ? partnerName.get(partnerId) ?? null : null,
      streams: partnerStreams.filter((s) => s.userId === partnerId).map((s) => streamName.get(s.streamId) ?? "").filter(Boolean),
      countries: partnerCountries.filter((c) => c.userId === partnerId).map((c) => countryName.get(c.code) ?? c.code),
      projects: memberRows.filter((m) => m.userId === p.id).map((m) => m.name),
      openTasks: Number(counts?.open ?? 0),
      overdueTasks: Number(counts?.overdue ?? 0),
      hoursMinutes: (hours as Map<string, number>).get(p.id) ?? 0,
      costBaseMinor: Number((costs as Array<{ userId: string; total: string }>).find((c) => c.userId === p.id)?.total ?? 0),
      online: !!p.seen && now - p.seen.getTime() < ONLINE_SECONDS * 1000,
      lastActive: last?.toISOString() ?? null,
      flaggedShifts: (flagged as Map<string, number>).get(p.id) ?? 0,
    };
  });
  const [base] = await db.select({ c: schema.settings.baseCurrency }).from(schema.settings).where(eq(schema.settings.id, 1));
  return { baseCurrency: base?.c ?? "AUD", from, to, rows, options, partners: partnerRows.map((p) => ({ id: p.id, name: p.name || p.email })) };
}

export type EmployeeDetail = {
  person: { id: string; name: string; email: string; status: "invited" | "active" | "deactivated"; online: boolean; lastActive: string | null };
  partner: { id: string; name: string } | null;
  streams: string[];
  countries: string[];
  projects: Array<{ id: string; name: string; teamVisible: boolean }>;
  from: string;
  to: string;
  baseCurrency: string;
  tasks: { open: number; overdue: number; done: number; upcoming: Array<{ id: string; title: string; dueDate: string | null; status: string; overdue: boolean; project: string | null }> };
  costBaseMinor: number;
  shifts: EmployeeShifts;
  changes: ChangeRow[];
};

/** Entities an admin sees about an employee: their shift corrections, pay and who they work for (whoever made the change). */
const EMPLOYEE_CHANGE_ENTITIES = ["shifts", "employee_pay_plans", "employee_pay_records", "employee_assignments"] as const;

export async function employeeDetail(actor: Actor, employeeId: string, raw: EmployeeFilters = {}): Promise<EmployeeDetail> {
  requireAdmin(actor);
  const f = employeeFilters.parse(raw);
  const db = getDb();
  const [{ today, from, to }] = [await period(db, f)];
  const [u] = await db
    .select({ id: users.id, name: users.fullName, email: users.email, status: users.status, lastSignInAt: users.lastSignInAt, seen: userPresence.lastSeenAt })
    .from(users)
    .leftJoin(userPresence, eq(userPresence.userId, users.id))
    .where(and(eq(users.id, employeeId), eq(users.presetId, "employee")));
  if (!u) throw new NotFound(); // not an employee, or no such person: the same answer
  const [assignment] = await db.select({ partnerId: employeeAssignments.partnerUserId }).from(employeeAssignments).where(eq(employeeAssignments.employeeUserId, employeeId));
  const [partner] = assignment ? await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.id, assignment.partnerId)) : [];
  const taskWhere = and(eq(tasks.assigneeId, employeeId), isNull(tasks.archivedAt), notHiddenFrom(db, actor, tasks.projectId));
  const [streamRows, countryRows, projectRows, [counts], upcoming, [cost], shiftData, changes, [seenSession], [base]] = await Promise.all([
    assignment ? db.select({ name: streams.name }).from(streamPartnerStreams).innerJoin(streams, eq(streams.id, streamPartnerStreams.streamId)).where(eq(streamPartnerStreams.userId, assignment.partnerId)) : [],
    assignment ? db.select({ name: countries.name }).from(streamPartnerCountries).innerJoin(countries, eq(countries.code, streamPartnerCountries.countryCode)).where(eq(streamPartnerCountries.userId, assignment.partnerId)) : [],
    db
      .select({ id: projects.id, name: projects.name, teamVisible: projects.teamVisible })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projectMembers.userId, employeeId), eq(projects.active, true)))
      .orderBy(asc(projects.name)),
    db
      .select({
        open: sql<string>`coalesce(sum(${tasks.status} <> 'done'), 0)`,
        overdue: sql<string>`coalesce(sum(${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}), 0)`,
        done: sql<string>`coalesce(sum(${tasks.status} = 'done'), 0)`,
      })
      .from(tasks)
      .where(taskWhere),
    db
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, status: tasks.status, project: projects.name })
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(taskWhere, ne(tasks.status, "done")))
      .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id))
      .limit(15),
    db
      .select({ total: sql<string>`coalesce(sum(${employeePayRecords.amountBaseMinor}), 0)` })
      .from(employeePayRecords)
      .where(and(eq(employeePayRecords.employeeUserId, employeeId), isNotNull(employeePayRecords.costDate), gte(employeePayRecords.costDate, from), lte(employeePayRecords.costDate, to))),
    employeeShifts(actor, employeeId, { from, to }),
    db
      .select({ id: auditLog.id, at: auditLog.at, actorEmail: auditLog.actorEmail, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, summary: auditLog.summary, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, employeeId), inArray(auditLog.entity, [...EMPLOYEE_CHANGE_ENTITIES]), auditVisible(db, actor)))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(100),
    db.select({ at: max(sessions.lastSeenAt) }).from(sessions).where(eq(sessions.userId, employeeId)),
    db.select({ c: schema.settings.baseCurrency }).from(schema.settings).where(eq(schema.settings.id, 1)),
  ]);
  const last = [u.lastSignInAt, seenSession?.at ?? null].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return {
    person: { id: u.id, name: u.name || u.email, email: u.email, status: u.status, online: !!u.seen && Date.now() - u.seen.getTime() < ONLINE_SECONDS * 1000, lastActive: last?.toISOString() ?? null },
    partner: partner ? { id: partner.id, name: partner.name || partner.email } : null,
    streams: streamRows.map((s) => s.name),
    countries: countryRows.map((c) => c.name),
    projects: projectRows,
    from,
    to,
    baseCurrency: base?.c ?? "AUD",
    tasks: {
      open: Number(counts?.open ?? 0),
      overdue: Number(counts?.overdue ?? 0),
      done: Number(counts?.done ?? 0),
      upcoming: upcoming.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, status: t.status, overdue: !!t.dueDate && t.dueDate < today, project: t.project })),
    },
    costBaseMinor: Number(cost?.total ?? 0),
    shifts: shiftData,
    changes: changes.map(({ actorEmail, entityId, at, before, after, ...c }) => ({ ...c, at: at.toISOString(), actor_email: actorEmail, entity_id: entityId, before: before as ChangeRow["before"], after: after as ChangeRow["after"] })),
  };
}
