import "server-only";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { TASK_STATUSES, type TaskStatus } from "@/lib/work";
import { actorRef, writeAudit } from "./audit";
import { ONLINE_SECONDS } from "./chat";
import { AccessDenied, RuleError, requirePerm, type Actor } from "./guard";
import { NotFound, employeeProjectsWhere } from "./scope";

/**
 * An Employee's own page. They see only:
 *   - tasks assigned to them (in their partner's streams, and, when a task has a project, only projects they are on),
 *   - the projects they are on (just the name),
 *   - on a project the partner switched "Team visible" on: the NAME and ONLINE STATUS of the others on it,
 *   - the name of the partner they work for.
 * They never see any cost, income, subscription, pay, other partners, other streams, other projects,
 * other people's tasks, chats or hours. Nothing in this file reads a money table.
 */
const { tasks, projects, projectMembers, users, userPresence, streamPartnerStreams } = schema;

function ensure(actor: Actor, action: "view" | "edit") {
  requirePerm(actor, "employee", action);
  const s = actor.scoped;
  if (actor.presetId !== "employee" || !s || s.kind !== "employee") throw new AccessDenied();
  return s;
}

export type MyWork = {
  partnerName: string | null;
  tasks: Array<{ id: string; title: string; description: string | null; status: TaskStatus; priority: string; dueDate: string | null; project: string | null; overdue: boolean }>;
  projects: Array<{ id: string; name: string; teamVisible: boolean; team: Array<{ name: string; online: boolean }> }>;
  openTasks: number;
  overdueTasks: number;
};

/** The tasks this employee may see, as one WHERE condition. */
function taskWhere(actor: Actor, partnerUserId: string | null) {
  if (!partnerUserId) return sql`false`;
  const db = getDb();
  return and(
    eq(tasks.assigneeId, actor.userId),
    isNull(tasks.archivedAt),
    // a task with a project only counts while they are on that project
    or(isNull(tasks.projectId), employeeProjectsWhere(actor, tasks.projectId)),
    // and only inside the streams of the partner they work for
    inArray(tasks.streamId, db.select({ id: streamPartnerStreams.streamId }).from(streamPartnerStreams).where(eq(streamPartnerStreams.userId, partnerUserId)))
  );
}

export async function myWork(actor: Actor, today: string): Promise<MyWork> {
  const scope = ensure(actor, "view");
  const db = getDb();
  const [partner] = scope.partnerUserId ? await db.select({ name: users.fullName, email: users.email }).from(users).where(eq(users.id, scope.partnerUserId)) : [];
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, description: tasks.description, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, project: projects.name })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .where(taskWhere(actor, scope.partnerUserId))
    .orderBy(sql`${tasks.status} = 'done'`, sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id))
    .limit(300);

  const mine = scope.projectIds.length ? await db.select({ id: projects.id, name: projects.name, teamVisible: projects.teamVisible }).from(projects).where(and(inArray(projects.id, scope.projectIds), eq(projects.active, true))).orderBy(asc(projects.name)) : [];
  // Team visible: only NAME and ONLINE for the others on a project that has it switched on, never ids, tasks, chats, hours or costs
  const visibleIds = mine.filter((p) => p.teamVisible).map((p) => p.id);
  const others = visibleIds.length
    ? await db
        .select({ projectId: projectMembers.projectId, name: users.fullName, email: users.email, seen: userPresence.lastSeenAt })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .leftJoin(userPresence, eq(userPresence.userId, users.id))
        .where(and(inArray(projectMembers.projectId, visibleIds), ne(projectMembers.userId, actor.userId), eq(users.status, "active")))
        .orderBy(asc(users.fullName))
    : [];
  const now = Date.now();
  const list: MyWork["tasks"] = rows.map((r) => ({ ...r, overdue: r.status !== "done" && !!r.dueDate && r.dueDate < today }));
  return {
    partnerName: partner ? partner.name || partner.email : null,
    tasks: list,
    projects: mine.map((p) => ({
      id: p.id,
      name: p.name,
      teamVisible: p.teamVisible,
      team: others.filter((o) => o.projectId === p.id).map((o) => ({ name: o.name || o.email, online: !!o.seen && now - o.seen.getTime() < ONLINE_SECONDS * 1000 })),
    })),
    openTasks: list.filter((t) => t.status !== "done").length,
    overdueTasks: list.filter((t) => t.overdue).length,
  };
}

/** An employee moves one of THEIR tasks along (to do, in progress, review, done). Nothing else about it can change. */
export async function setMyWorkTaskStatus(actor: Actor, id: string, status: TaskStatus) {
  const scope = ensure(actor, "edit");
  if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new RuleError("Choose a status from the list.");
  await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), taskWhere(actor, scope.partnerUserId)))
      .for("update");
    if (!before) throw new NotFound();
    if (before.status === status) return;
    await tx.update(tasks).set({ status, completedAt: status === "done" ? new Date() : null }).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, summary: `Task status: ${before.title} is now ${status.replace("_", " ")}`, before: { status: before.status }, after: { status } });
  });
}
