import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { RuleError, requireAdmin, type Actor } from "./guard";
import { NotFound, notHiddenFrom } from "./scope";

/**
 * Admin "unarchive". Partners can only archive (never delete); this lets an admin bring an archived item back.
 *   - an expense or a task: its archived date is cleared, so it reappears in lists and totals;
 *   - a subscription: a cancelled one becomes active again (its next due date is kept).
 * Admin only (two-factor done). Every restore is written to the audit log with before and after. A task under a
 * project the Owner hid from this admin isn't listed and can't be restored by them (same "not found").
 */
const { expenses, tasks, subscriptions, streams } = schema;

export type ArchivedItems = {
  expenses: Array<{ id: string; label: string; amountMinor: number; currency: string; date: string; stream: string | null; archivedAt: string }>;
  tasks: Array<{ id: string; title: string; stream: string | null; dueDate: string | null; archivedAt: string }>;
  subscriptions: Array<{ id: string; vendor: string; amountMinor: number; currency: string; nextDueDate: string; stream: string | null }>;
};

export async function listArchived(actor: Actor): Promise<ArchivedItems> {
  requireAdmin(actor);
  const db = getDb();
  const [e, t, s] = await Promise.all([
    db
      .select({ id: expenses.id, vendor: expenses.vendor, category: expenses.category, amountMinor: expenses.amountMinor, currency: expenses.currency, date: expenses.expenseDate, stream: streams.name, at: expenses.archivedAt })
      .from(expenses)
      .leftJoin(streams, eq(streams.id, expenses.streamId))
      .where(isNotNull(expenses.archivedAt))
      .orderBy(desc(expenses.archivedAt))
      .limit(200),
    db
      .select({ id: tasks.id, title: tasks.title, stream: streams.name, dueDate: tasks.dueDate, at: tasks.archivedAt })
      .from(tasks)
      .leftJoin(streams, eq(streams.id, tasks.streamId))
      .where(and(isNotNull(tasks.archivedAt), notHiddenFrom(db, actor, tasks.projectId)))
      .orderBy(desc(tasks.archivedAt))
      .limit(200),
    db
      .select({ id: subscriptions.id, vendor: subscriptions.vendor, amountMinor: subscriptions.amountMinor, currency: subscriptions.currency, nextDueDate: subscriptions.nextDueDate, stream: streams.name })
      .from(subscriptions)
      .leftJoin(streams, eq(streams.id, subscriptions.streamId))
      .where(eq(subscriptions.status, "cancelled"))
      .orderBy(desc(subscriptions.updatedAt))
      .limit(200),
  ]);
  return {
    expenses: e.map((x) => ({ id: x.id, label: x.vendor || x.category, amountMinor: x.amountMinor, currency: x.currency, date: x.date, stream: x.stream, archivedAt: x.at!.toISOString() })),
    tasks: t.map((x) => ({ id: x.id, title: x.title, stream: x.stream, dueDate: x.dueDate, archivedAt: x.at!.toISOString() })),
    subscriptions: s,
  };
}

export async function unarchiveExpense(actor: Actor, id: string) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(expenses).where(eq(expenses.id, id)).for("update");
    if (!before) throw new NotFound();
    if (!before.archivedAt) throw new RuleError("That expense isn't archived.");
    await tx.update(expenses).set({ archivedAt: null }).where(eq(expenses.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "expenses", entityId: id, summary: `Restored expense: ${before.vendor || before.category}`, before: { archived: true }, after: { archived: false } });
  });
}

export async function unarchiveTask(actor: Actor, id: string) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(tasks).where(and(eq(tasks.id, id), notHiddenFrom(tx, actor, tasks.projectId))).for("update");
    if (!before) throw new NotFound(); // missing, or under a project hidden from this admin
    if (!before.archivedAt) throw new RuleError("That task isn't archived.");
    await tx.update(tasks).set({ archivedAt: null }).where(eq(tasks.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "tasks", entityId: id, summary: `Restored task: ${before.title}`, before: { archived: true }, after: { archived: false } });
  });
}

export async function unarchiveSubscription(actor: Actor, id: string) {
  requireAdmin(actor);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(subscriptions).where(eq(subscriptions.id, id)).for("update");
    if (!before) throw new NotFound();
    if (before.status !== "cancelled") throw new RuleError("That subscription isn't archived (cancelled).");
    await tx.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "subscriptions", entityId: id, summary: `Restored subscription: ${before.vendor}`, before: { status: "cancelled" }, after: { status: "active" } });
  });
}

