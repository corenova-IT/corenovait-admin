import "server-only";
import { assertRealEmailInProduction } from "@/lib/sample-guard";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { addDays, addMonths } from "@/lib/dates";
import { getDb, schema, type Tx } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { createInviteToken } from "./auth";
import { ONLINE_SECONDS } from "./chat";
import { RuleError, requireAdmin, requirePerm, type Actor } from "./guard";
import { copyPresetToUser } from "./internal";
import { NotFound, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * Employees: hired people who log in. Each works for exactly ONE stream partner (the primary key on
 * employee_assignments.employee_user_id is what enforces that).
 *
 * - A stream partner can invite employees only as the Employee preset, only for themselves, and can
 *   see and manage only their own employees. They can never give anyone more than Employee.
 * - An admin can also invite an employee and assign them to any stream partner.
 * - Every invite and assignment is written to the audit log.
 * - Someone else's employee, and someone who doesn't exist, look exactly the same ("That no longer exists.").
 */
const { users, rolePresets, employeeAssignments, projectMembers, projects, tasks, userPresence, employeePayPlans, employeePayRecords } = schema;

export type NewEmployee = { email: string; fullName: string; jobTitle: string };

/** Creates the Employee account and ties it to the partner, inside the caller's transaction. */
export async function createEmployee(tx: Tx, actor: Actor, input: NewEmployee & { partnerUserId: string }): Promise<{ userId: string; email: string; name: string; token: string }> {
  const email = input.email.trim().toLowerCase();
  try {
    assertRealEmailInProduction(email);
  } catch (e) {
    throw new RuleError((e as Error).message);
  }
  const [partner] = await tx.select({ id: users.id, presetId: users.presetId, status: users.status }).from(users).where(eq(users.id, input.partnerUserId)).for("update");
  if (!partner || partner.presetId !== "stream_partner" || partner.status === "deactivated") throw new RuleError("Choose a stream partner for this employee.");
  const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (clash) throw new RuleError("That email already has an account.");
  const userId = crypto.randomUUID();
  await tx.insert(users).values({ id: userId, email, fullName: input.fullName, jobTitle: input.jobTitle, status: "invited", invitedBy: actor.userId });
  await copyPresetToUser(tx, userId, "employee"); // always the Employee preset, never anything higher
  await tx.insert(employeeAssignments).values({ employeeUserId: userId, partnerUserId: input.partnerUserId, createdBy: actor.userId });
  const token = await createInviteToken(tx, userId);
  const [preset] = await tx.select({ name: rolePresets.name }).from(rolePresets).where(eq(rolePresets.id, "employee"));
  await writeAudit(tx, actorRef(actor), {
    action: "invite",
    entity: "users",
    entityId: userId,
    summary: `Invited ${email} as ${preset?.name ?? "Employee"}`,
    after: { email, fullName: input.fullName, jobTitle: input.jobTitle, preset: "employee", partnerUserId: input.partnerUserId },
  });
  await writeAudit(tx, actorRef(actor), { action: "assign", entity: "employee_assignments", entityId: userId, summary: `${email} now works for this partner`, before: { partnerUserId: null }, after: { partnerUserId: input.partnerUserId } });
  return { userId, email, name: input.fullName, token };
}

/** A stream partner invites an employee of their own. */
export async function inviteMyEmployee(actor: Actor, input: NewEmployee) {
  requirePerm(actor, "stream_partner", "create");
  const scope = partnerScope(actor);
  if (!scope.hasData) throw new NotFound(); // no stream or no country yet: nothing to employ anyone on
  return getDb().transaction((tx) => createEmployee(tx, actor, { ...input, partnerUserId: actor.userId }));
}

/** An admin invites an employee and chooses which stream partner they work for. */
export async function inviteEmployeeAsAdmin(actor: Actor, input: NewEmployee & { partnerUserId: string }) {
  requireAdmin(actor);
  return getDb().transaction((tx) => createEmployee(tx, actor, input));
}

/**
 * Loads one of THIS partner's employees (locking the row for a change). Not theirs, or not an employee,
 * or no such person: all the same NotFound.
 */
export async function ownEmployee(tx: Tx | ReturnType<typeof getDb>, actor: Actor, employeeId: string, lock = false) {
  const q = tx
    .select({ id: users.id, email: users.email, fullName: users.fullName, status: users.status })
    .from(employeeAssignments)
    .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
    .where(and(eq(employeeAssignments.employeeUserId, employeeId), eq(employeeAssignments.partnerUserId, actor.userId), eq(users.presetId, "employee")));
  const [row] = lock ? await q.for("update") : await q;
  if (!row) throw new NotFound();
  return row;
}

/** Someone stops being an Employee: they leave their partner and every project, and their pay plans stop (history stays). */
export async function releaseEmployee(tx: Tx, actor: Actor, target: { id: string; email: string }) {
  const [a] = await tx.select({ partner: employeeAssignments.partnerUserId }).from(employeeAssignments).where(eq(employeeAssignments.employeeUserId, target.id)).for("update");
  const memberships = await tx.select({ id: projectMembers.projectId }).from(projectMembers).where(eq(projectMembers.userId, target.id));
  if (memberships.length) await tx.delete(projectMembers).where(eq(projectMembers.userId, target.id));
  if (a) {
    await tx.delete(employeeAssignments).where(eq(employeeAssignments.employeeUserId, target.id));
    await writeAudit(tx, actorRef(actor), { action: "assign", entity: "employee_assignments", entityId: target.id, summary: `${target.email} no longer works for this partner`, before: { partnerUserId: a.partner }, after: { partnerUserId: null } });
  }
  await tx.update(employeePayPlans).set({ active: false }).where(and(eq(employeePayPlans.employeeUserId, target.id), eq(employeePayPlans.active, true)));
}

/** Admin: move an employee to another stream partner (they leave their projects, which belong to the old partner's streams). */
export async function reassignEmployee(actor: Actor, input: { employeeId: string; partnerUserId: string }) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [emp] = await tx.select({ id: users.id, email: users.email, presetId: users.presetId }).from(users).where(eq(users.id, input.employeeId)).for("update");
    if (!emp || emp.presetId !== "employee") throw new RuleError("That person isn't an employee.");
    const [partner] = await tx.select({ id: users.id, presetId: users.presetId }).from(users).where(eq(users.id, input.partnerUserId));
    if (!partner || partner.presetId !== "stream_partner") throw new RuleError("Choose a stream partner for this employee.");
    const [current] = await tx.select({ partner: employeeAssignments.partnerUserId }).from(employeeAssignments).where(eq(employeeAssignments.employeeUserId, emp.id)).for("update");
    if (current?.partner === partner.id) return;
    await tx.delete(projectMembers).where(eq(projectMembers.userId, emp.id));
    await tx.delete(employeeAssignments).where(eq(employeeAssignments.employeeUserId, emp.id));
    await tx.insert(employeeAssignments).values({ employeeUserId: emp.id, partnerUserId: partner.id, createdBy: actor.userId });
    await tx.update(employeePayPlans).set({ active: false }).where(and(eq(employeePayPlans.employeeUserId, emp.id), eq(employeePayPlans.active, true)));
    await writeAudit(tx, actorRef(actor), { action: "assign", entity: "employee_assignments", entityId: emp.id, summary: `${emp.email} moved to another partner`, before: { partnerUserId: current?.partner ?? null }, after: { partnerUserId: partner.id } });
  });
}

export type MyEmployee = {
  id: string;
  name: string;
  email: string;
  jobTitle: string;
  status: "invited" | "active" | "deactivated";
  online: boolean;
  lastSeen: string | null;
  projects: Array<{ id: string; name: string }>;
  openTasks: number;
  overdueTasks: number;
  /** what this employee costs this month (employee pay, base currency); only their partner and admins ever see it */
  costMonthBaseMinor: number;
};

/** The signed-in partner's own employees, with their projects, task progress and online status. */
export async function myEmployees(actor: Actor, today: string): Promise<MyEmployee[]> {
  requirePerm(actor, "stream_partner", "view");
  partnerScope(actor);
  const db = getDb();
  const people = await db
    .select({ id: users.id, name: users.fullName, email: users.email, jobTitle: users.jobTitle, status: users.status, seen: userPresence.lastSeenAt })
    .from(employeeAssignments)
    .innerJoin(users, eq(users.id, employeeAssignments.employeeUserId))
    .leftJoin(userPresence, eq(userPresence.userId, users.id))
    .where(and(eq(employeeAssignments.partnerUserId, actor.userId), eq(users.presetId, "employee")))
    .orderBy(asc(users.fullName), asc(users.email));
  if (!people.length) return [];
  const ids = people.map((p) => p.id);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const [members, counts, costs] = await Promise.all([
    db.select({ userId: projectMembers.userId, id: projects.id, name: projects.name }).from(projectMembers).innerJoin(projects, eq(projects.id, projectMembers.projectId)).where(and(inArray(projectMembers.userId, ids), eq(projects.active, true))).orderBy(asc(projects.name)),
    db
      .select({
        userId: tasks.assigneeId,
        open: sql<string>`coalesce(sum(${tasks.status} <> 'done'), 0)`,
        overdue: sql<string>`coalesce(sum(${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}), 0)`,
      })
      .from(tasks)
      // only tasks inside this partner's own streams (and not under a project hidden from them)
      .where(and(inArray(tasks.assigneeId, ids), streamRowsWhere(actor, { streamId: tasks.streamId }), notHiddenFrom(db, actor, tasks.projectId), isNull(tasks.archivedAt), ne(tasks.status, "done")))
      .groupBy(tasks.assigneeId),
    db
      .select({ userId: employeePayRecords.employeeUserId, total: sql<string>`coalesce(sum(${employeePayRecords.amountBaseMinor}), 0)` })
      .from(employeePayRecords)
      .where(and(inArray(employeePayRecords.employeeUserId, ids), isNotNull(employeePayRecords.costDate), gte(employeePayRecords.costDate, monthStart), lte(employeePayRecords.costDate, monthEnd)))
      .groupBy(employeePayRecords.employeeUserId),
  ]);
  const now = Date.now();
  return people.map((p) => ({
    id: p.id,
    name: p.name || p.email,
    email: p.email,
    jobTitle: p.jobTitle,
    status: p.status,
    online: !!p.seen && now - p.seen.getTime() < ONLINE_SECONDS * 1000,
    lastSeen: p.seen?.toISOString() ?? null,
    projects: members.filter((m) => m.userId === p.id).map((m) => ({ id: m.id, name: m.name })),
    openTasks: Number(counts.find((c) => c.userId === p.id)?.open ?? 0),
    overdueTasks: Number(counts.find((c) => c.userId === p.id)?.overdue ?? 0),
    costMonthBaseMinor: Number(costs.find((c) => c.userId === p.id)?.total ?? 0),
  }));
}

/** Admin: who works for which partner (for the Team page's "Employee" invite and the Partners pages). */
export async function partnerChoices(actor: Actor) {
  requireAdmin(actor);
  return getDb()
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(and(eq(users.presetId, "stream_partner"), ne(users.status, "deactivated")))
    .orderBy(asc(users.fullName), asc(users.email));
}
