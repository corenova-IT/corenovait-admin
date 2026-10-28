import "server-only";
import { and, asc, count, desc, eq, gte, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import type { ChecklistItem } from "@/lib/db/schema";
import { addDays } from "@/lib/dates";
import { TASK_PRIORITIES, TASK_STATUSES, cleanLabels, type TaskStatus } from "@/lib/work";
import { localParts } from "@/lib/zoned";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, hasPerm, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";
import { companyTimezone } from "./marketing";
import { notify } from "./notifications";

/**
 * Tasks (module "tasks"): the board, the list, "My tasks", checklists and
 * comments.
 *
 * Scope: own = tasks you created; assigned = also tasks assigned to you;
 * all = everything. Below "all" you can only assign a task to yourself (or
 * leave it unassigned). Every change is audited with before and after.
 */
const { tasks, taskComments, users } = schema;

const taskScope = (actor: Actor): SQL | undefined => scopeWhere(actor, "tasks", { owner: tasks.createdBy, assignedTo: (uid) => eq(tasks.assigneeId, uid) });
const taskAllowed = (actor: Actor, row: { createdBy: string; assigneeId: string | null }) => rowAllowed(actor, "tasks", { ownerId: row.createdBy, assigneeId: row.assigneeId });

/** Today and this week (Monday to Sunday) in the company time zone. */
export async function workDates(db: Db | Tx = getDb()) {
  const tz = await companyTimezone(db);
  const now = localParts(new Date(), tz);
  const weekStart = addDays(now.date, -now.weekday);
  return { timezone: tz, today: now.date, weekStart, weekEnd: addDays(weekStart, 6) };
}

// ---------------------------------------------------------------- reading
export const taskFilters = z.object({
  /** "me", "none" (unassigned) or a person's id */
  assignee: z.union([z.literal("me"), z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  status: z.enum(TASK_STATUSES).optional().catch(undefined),
  priority: z.enum(TASK_PRIORITIES).optional().catch(undefined),
  label: z.string().trim().max(30).optional().catch(undefined),
  due: z.enum(["overdue", "week"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});
export type TaskFilters = z.infer<typeof taskFilters>;

const likeTerm = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function taskQuery(db: Db | Tx) {
  const commentCount = db.select({ taskId: taskComments.taskId, n: count().as("n") }).from(taskComments).groupBy(taskComments.taskId).as("cc");
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      status: tasks.status,
      priority: tasks.priority,
      assigneeId: tasks.assigneeId,
      assigneeName: users.fullName,
      dueDate: tasks.dueDate,
      labels: tasks.labels,
      checklist: tasks.checklist,
      completedAt: tasks.completedAt,
      createdBy: tasks.createdBy,
      createdAt: tasks.createdAt,
      comments: sql<number>`coalesce(${commentCount.n}, 0)`,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.assigneeId))
    .leftJoin(commentCount, eq(commentCount.taskId, tasks.id));
}

const PRIORITY_ORDER = sql`field(${tasks.priority}, 'urgent', 'high', 'medium', 'low')`;

/** The board shows every open task (up to this many) and only the most recently finished ones; the list view pages through everything. */
export const BOARD_OPEN_LIMIT = 500;
export const BOARD_DONE_LIMIT = 50;

export async function listTasks(actor: Actor, f: TaskFilters = {}, opts: { page?: number; pageSize?: number } = {}) {
  requirePerm(actor, "tasks", "view");
  const db = getDb();
  const d = await workDates(db);
  const conds: Array<SQL | undefined> = [taskScope(actor)];
  if (f.assignee === "me") conds.push(eq(tasks.assigneeId, actor.userId));
  else if (f.assignee === "none") conds.push(isNull(tasks.assigneeId));
  else if (f.assignee) conds.push(eq(tasks.assigneeId, f.assignee));
  if (f.status) conds.push(eq(tasks.status, f.status));
  if (f.priority) conds.push(eq(tasks.priority, f.priority));
  if (f.label) conds.push(sql`json_contains(${tasks.labels}, json_quote(${f.label}))`);
  if (f.due === "overdue") conds.push(and(lt(tasks.dueDate, d.today), ne(tasks.status, "done")));
  if (f.due === "week") conds.push(and(gte(tasks.dueDate, d.weekStart), lte(tasks.dueDate, d.weekEnd)));
  if (f.q) conds.push(or(sql`${tasks.title} like ${likeTerm(f.q)}`, sql`${tasks.description} like ${likeTerm(f.q)}`));
  const where = and(...conds);
  // undated tasks last, then by due date, then most urgent
  const soonest = [sql`${tasks.dueDate} is null`, asc(tasks.dueDate), PRIORITY_ORDER, asc(tasks.createdAt), asc(tasks.id)] as const;
  if (opts.pageSize) {
    const page = Math.max(1, opts.page ?? 1);
    const [rows, [agg]] = await Promise.all([
      taskQuery(db).where(where).orderBy(...soonest).limit(opts.pageSize).offset((page - 1) * opts.pageSize),
      db.select({ n: count() }).from(tasks).where(where),
    ]);
    return { ...d, tasks: rows.map((r) => decorate(actor, r, d.today)), total: agg.n, page, pageSize: opts.pageSize, doneCapped: false };
  }
  // the board: every open task (up to a safety cap), and only the most recently finished ones
  const [open, done] = await Promise.all([
    f.status === "done" ? [] : taskQuery(db).where(and(where, ne(tasks.status, "done"))).orderBy(...soonest).limit(BOARD_OPEN_LIMIT),
    f.status && f.status !== "done" ? [] : taskQuery(db).where(and(where, eq(tasks.status, "done"))).orderBy(desc(tasks.completedAt), asc(tasks.id)).limit(BOARD_DONE_LIMIT + 1),
  ]);
  const rows = [...open, ...done.slice(0, BOARD_DONE_LIMIT)];
  return { ...d, tasks: rows.map((r) => decorate(actor, r, d.today)), total: rows.length, page: 1, pageSize: rows.length, doneCapped: done.length > BOARD_DONE_LIMIT };
}

function decorate<T extends { status: TaskStatus; dueDate: string | null; checklist: ChecklistItem[] | null; labels: string[] | null; createdBy: string; assigneeId: string | null; comments: unknown }>(actor: Actor, r: T, today: string) {
  const checklist = r.checklist ?? [];
  return {
    ...r,
    labels: r.labels ?? [],
    checklist,
    comments: Number(r.comments ?? 0),
    checklistDone: checklist.filter((c) => c.done).length,
    overdue: r.status !== "done" && !!r.dueDate && r.dueDate < today,
    canEdit: hasPerm(actor, "tasks", "edit") && taskAllowed(actor, r),
    canDelete: hasPerm(actor, "tasks", "delete") && taskAllowed(actor, r),
  };
}
export type TaskRow = ReturnType<typeof decorate<Awaited<ReturnType<ReturnType<typeof taskQuery>["execute"]>>[number]>>;

/** One task with its comments, or null when it doesn't exist or is outside the caller's scope. */
export async function getTask(actor: Actor, id: string) {
  requirePerm(actor, "tasks", "view");
  const db = getDb();
  const d = await workDates(db);
  const [row] = await taskQuery(db).where(and(eq(tasks.id, id), taskScope(actor)));
  if (!row) return null;
  const comments = await db
    .select({ id: taskComments.id, body: taskComments.body, createdAt: taskComments.createdAt, authorId: taskComments.authorId, authorName: users.fullName })
    .from(taskComments)
    .leftJoin(users, eq(users.id, taskComments.authorId))
    .where(eq(taskComments.taskId, id))
    .orderBy(asc(taskComments.createdAt));
  return { ...decorate(actor, row, d.today), commentList: comments.map((c) => ({ ...c, mine: c.authorId === actor.userId })) };
}

/** Assigned to the caller and not done: overdue, due this week, or undated. For "My tasks" and My Day. */
export async function myOpenTasks(actor: Actor, limit = 8) {
  requirePerm(actor, "tasks", "view");
  const db = getDb();
  const d = await workDates(db);
  const rows = await taskQuery(db)
    .where(and(taskScope(actor), eq(tasks.assigneeId, actor.userId), ne(tasks.status, "done"), or(isNull(tasks.dueDate), lte(tasks.dueDate, d.weekEnd))))
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), PRIORITY_ORDER)
    .limit(limit);
  const [{ n }] = await db.select({ n: count() }).from(tasks).where(and(taskScope(actor), eq(tasks.assigneeId, actor.userId), ne(tasks.status, "done")));
  return { ...d, tasks: rows.map((r) => decorate(actor, r, d.today)), openTotal: n };
}

/**
 * Progress per person for people who see all tasks: open, overdue, and how
 * many of the tasks due this week are done.
 */
export async function teamProgress(actor: Actor) {
  requirePerm(actor, "tasks", "view");
  if (actor.perms.tasks.scope !== "all") throw new AccessDenied("Team progress needs access to everyone's tasks.");
  const db = getDb();
  const d = await workDates(db);
  const rows = await db
    .select({
      userId: users.id,
      name: users.fullName,
      email: users.email,
      open: sql<string>`coalesce(sum(${tasks.status} <> 'done'), 0)`,
      overdue: sql<string>`coalesce(sum(${tasks.status} <> 'done' and ${tasks.dueDate} < ${d.today}), 0)`,
      weekTotal: sql<string>`coalesce(sum(${tasks.dueDate} between ${d.weekStart} and ${d.weekEnd}), 0)`,
      weekDone: sql<string>`coalesce(sum(${tasks.dueDate} between ${d.weekStart} and ${d.weekEnd} and ${tasks.status} = 'done'), 0)`,
    })
    .from(users)
    .leftJoin(tasks, eq(tasks.assigneeId, users.id))
    .where(eq(users.status, "active"))
    .groupBy(users.id, users.fullName, users.email)
    .orderBy(asc(users.fullName));
  return {
    ...d,
    people: rows
      .map((r) => ({ userId: r.userId, name: r.name || r.email, open: Number(r.open), overdue: Number(r.overdue), weekTotal: Number(r.weekTotal), weekDone: Number(r.weekDone) }))
      .filter((p) => p.open + p.weekTotal > 0),
  };
}

/** People a task can be assigned to: everyone active for the "all" scope, otherwise just you. */
export async function assignees(actor: Actor) {
  requirePerm(actor, "tasks", "view");
  if (actor.perms.tasks.scope !== "all") return [{ id: actor.userId, name: actor.fullName || actor.email }];
  const rows = await getDb().select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.status, "active")).orderBy(asc(users.fullName));
  return rows.map((r) => ({ id: r.id, name: r.name || r.email }));
}

/** Labels in use on tasks the caller can see, for the filter. */
export async function taskLabels(actor: Actor): Promise<string[]> {
  requirePerm(actor, "tasks", "view");
  const rows = await getDb().select({ labels: tasks.labels }).from(tasks).where(taskScope(actor));
  return [...new Set(rows.flatMap((r) => r.labels ?? []))].sort();
}

// ---------------------------------------------------------------- writing
export const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  description: z.string().trim().max(10_000).optional(),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("medium"),
  assigneeId: z.string().uuid().nullable().optional(),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  labels: z.union([z.string(), z.array(z.string())]).optional(),
  /** one checklist item per line; existing items keep their ticks when the text is unchanged */
  checklist: z.string().max(10_000).optional(),
});
export type TaskInput = z.input<typeof taskInput>;

async function checkAssignee(db: Db | Tx, actor: Actor, assigneeId: string | null) {
  if (!assigneeId) return;
  if (assigneeId !== actor.userId && actor.perms.tasks.scope !== "all") throw new AccessDenied("You can only assign tasks to yourself.");
  const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, assigneeId));
  if (!u || u.status !== "active") throw new RuleError("Choose an active team member to assign it to.");
}

function checklistFrom(text: string | undefined, previous: ChecklistItem[] | null): ChecklistItem[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 50)
    .map((l) => l.slice(0, 200));
  return lines.map((t) => previous?.find((p) => p.text === t) ?? { id: crypto.randomUUID().slice(0, 8), text: t, done: false });
}

function taskValues(input: TaskInput, previous: ChecklistItem[] | null) {
  const parsed = taskInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the task and try again.");
  const v = parsed.data;
  return {
    title: v.title,
    description: v.description || null,
    status: v.status,
    priority: v.priority,
    assigneeId: v.assigneeId || null,
    dueDate: v.dueDate ?? null,
    labels: cleanLabels(v.labels),
    checklist: checklistFrom(v.checklist, previous),
  };
}

export async function createTask(actor: Actor, input: TaskInput): Promise<string> {
  requirePerm(actor, "tasks", "create");
  const db = getDb();
  const values = taskValues(input, null);
  await checkAssignee(db, actor, values.assigneeId);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(tasks).values({ id, ...values, completedAt: values.status === "done" ? new Date() : null, createdBy: actor.userId });
    const [after] = await tx.select().from(tasks).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "tasks", entityId: id, after });
    await notifyAssigned(tx, actor, id, values.title, values.assigneeId);
  });
  return id;
}

/** Tells the new assignee (unless they assigned it to themselves). */
async function notifyAssigned(tx: Tx, actor: Actor, taskId: string, title: string, assigneeId: string | null) {
  if (!assigneeId || assigneeId === actor.userId) return;
  await notify(tx, {
    userId: assigneeId,
    type: "task_assigned",
    title: `New task for you: ${title}`,
    body: `${actor.fullName || actor.email} assigned it to you.`,
    href: `/tasks?task=${taskId}`,
    dedupeKey: `assigned:${taskId}:${assigneeId}:${Date.now()}`,
  });
}

/** Loads a task for a change, checking edit permission and scope. */
async function lockForChange(tx: Tx, actor: Actor, id: string, action: "edit" | "delete") {
  const [before] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
  if (!before || !taskAllowed(actor, before)) throw new AccessDenied(`That task doesn't exist or isn't yours to ${action === "delete" ? "delete" : "change"}.`);
  return before;
}

export async function updateTask(actor: Actor, id: string, input: TaskInput) {
  requirePerm(actor, "tasks", "edit");
  const db = getDb();
  await db.transaction(async (tx) => {
    const before = await lockForChange(tx, actor, id, "edit");
    const values = taskValues(input, before.checklist);
    // below "all", the assignee can stay as it was or be you, nobody else
    if (values.assigneeId !== before.assigneeId) await checkAssignee(tx, actor, values.assigneeId);
    const completedAt = values.status === "done" ? (before.completedAt ?? new Date()) : null;
    await tx.update(tasks).set({ ...values, completedAt }).where(eq(tasks.id, id));
    const [after] = await tx.select().from(tasks).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, before, after });
    if (values.assigneeId !== before.assigneeId) await notifyAssigned(tx, actor, id, values.title, values.assigneeId);
  });
}

/** Moving a card on the board (or the status menu in the list). */
export async function setTaskStatus(actor: Actor, id: string, status: TaskStatus) {
  requirePerm(actor, "tasks", "edit");
  if (!TASK_STATUSES.includes(status)) throw new RuleError("Choose a column.");
  await getDb().transaction(async (tx) => {
    const before = await lockForChange(tx, actor, id, "edit");
    if (before.status === status) return;
    await tx.update(tasks).set({ status, completedAt: status === "done" ? new Date() : null }).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, summary: `Status: ${before.status} → ${status}`, before: { status: before.status }, after: { status } });
  });
}

export async function toggleChecklistItem(actor: Actor, id: string, itemId: string, done: boolean) {
  requirePerm(actor, "tasks", "edit");
  await getDb().transaction(async (tx) => {
    const before = await lockForChange(tx, actor, id, "edit");
    const list = before.checklist ?? [];
    const item = list.find((c) => c.id === itemId);
    if (!item) throw new RuleError("That checklist item no longer exists. Refresh and try again.");
    if (item.done === done) return;
    const checklist = list.map((c) => (c.id === itemId ? { ...c, done } : c));
    await tx.update(tasks).set({ checklist }).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, summary: `Checklist: "${item.text}" ${done ? "ticked" : "unticked"}`, before: { checklist: list }, after: { checklist } });
  });
}

export async function deleteTask(actor: Actor, id: string) {
  requirePerm(actor, "tasks", "delete");
  await getDb().transaction(async (tx) => {
    const before = await lockForChange(tx, actor, id, "delete");
    const comments = await tx.select().from(taskComments).where(eq(taskComments.taskId, id));
    await tx.delete(tasks).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "tasks", entityId: id, before: { ...before, comments } });
  });
}

// ---------------------------------------------------------------- comments
const commentBody = z.string().trim().min(1, "Write a comment first.").max(5000, "Keep comments under 5,000 characters.");

/** Anyone who can see a task can comment on it (no create permission needed). */
export async function addComment(actor: Actor, taskId: string, body: string): Promise<string> {
  requirePerm(actor, "tasks", "view");
  const parsed = commentBody.safeParse(body);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0].message);
  const db = getDb();
  const [task] = await db.select({ createdBy: tasks.createdBy, assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.id, taskId));
  if (!task || !taskAllowed(actor, task)) throw new AccessDenied("That task doesn't exist or you can't see it.");
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(taskComments).values({ id, taskId, authorId: actor.userId, body: parsed.data });
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "task_comments", entityId: id, summary: `Comment on task ${taskId.slice(0, 8)}`, after: { taskId, body: parsed.data } });
  });
  return id;
}

/** Your own comments, or anyone's for people who can delete tasks across the team. */
export async function deleteComment(actor: Actor, commentId: string) {
  requirePerm(actor, "tasks", "view");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(taskComments).where(eq(taskComments.id, commentId)).for("update");
    const moderator = hasPerm(actor, "tasks", "delete") && actor.perms.tasks.scope === "all";
    if (!before || (before.authorId !== actor.userId && !moderator)) throw new AccessDenied("You can only delete your own comments.");
    await tx.delete(taskComments).where(eq(taskComments.id, commentId));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "task_comments", entityId: commentId, before });
  });
}

/** Tasks with a due date in a range, for the calendar (in the caller's task scope). */
export async function taskDeadlines(actor: Actor, from: string, to: string) {
  requirePerm(actor, "tasks", "view");
  const db = getDb();
  const d = await workDates(db);
  const rows = await taskQuery(db)
    .where(and(taskScope(actor), gte(tasks.dueDate, from), lte(tasks.dueDate, to)))
    .orderBy(asc(tasks.dueDate), PRIORITY_ORDER);
  return rows.map((r) => decorate(actor, r, d.today));
}


