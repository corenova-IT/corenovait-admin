import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Admins can bring archived items back; everything reappears in lists and totals; nothing else changes. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let arch: typeof import("@/lib/dal/archive");
let fin: typeof import("@/lib/dal/finance");
let tasks: typeof import("@/lib/dal/tasks");
let w: typeof import("@/lib/dal/partner-writes");
let proj: typeof import("@/lib/dal/projects");
let assign: typeof import("@/lib/dal/assignments");
let analytics: typeof import("@/lib/dal/analytics");
let ids: Record<"owner" | "admin2" | "staff" | "a", string>;
let S: number;
let hiddenProject: string;

const as = (id: string) => actorFor(t, id);
const today = () => new Date().toISOString().slice(0, 10);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;

beforeAll(async () => {
  t = await setupTestDatabase();
  arch = await import("@/lib/dal/archive");
  fin = await import("@/lib/dal/finance");
  tasks = await import("@/lib/dal/tasks");
  w = await import("@/lib/dal/partner-writes");
  proj = await import("@/lib/dal/projects");
  assign = await import("@/lib/dal/assignments");
  analytics = await import("@/lib/dal/analytics");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  S = (await t.db.select().from(t.schema.streams)).find((s) => s.name === "Upwork")!.id;
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S], countryCodes: ["GB"] });
  hiddenProject = await proj.createProject(owner, { streamId: S, name: "Hidden from admin2" });
  await proj.setProjectHidden(owner, { projectId: hiddenProject, userId: ids.admin2, hidden: true });
});
afterAll(() => t?.cleanup());

describe("restoring archived items", () => {
  it("a partner's archived expense, task and subscription come back for an admin, and everything reappears", async () => {
    const [a, owner] = [await as(ids.a), await as(ids.owner)];
    const exp = await w.createMyExpense(a, { expenseDate: today(), category: "Software", vendor: "Restore me", amount: "123", currency: "AUD", fxRate: "1", streamId: S, countryCode: "GB" });
    const task = await w.createMyTask(a, { title: "Restore this task", streamId: S });
    const sub = await w.createMySubscription(a, { vendor: "Restore sub", category: "Software", amount: "9", currency: "AUD", fxRate: "1", billingCycle: "monthly", nextDueDate: today(), streamId: S, countryCode: "GB" });
    await w.archiveMyExpense(a, exp);
    await w.archiveMyTask(a, task);
    await w.archiveMySubscription(a, sub);

    const listed = await arch.listArchived(owner);
    expect(listed.expenses.map((x) => x.id)).toContain(exp);
    expect(listed.tasks.map((x) => x.id)).toContain(task);
    expect(listed.subscriptions.map((x) => x.id)).toContain(sub);
    const before = (await analytics.financeSummary(owner)).totals.current.expensesBaseMinor;
    expect((await fin.listExpenses(owner, {})).rows.map((r) => r.id)).not.toContain(exp);

    await arch.unarchiveExpense(owner, exp);
    await arch.unarchiveTask(owner, task);
    await arch.unarchiveSubscription(owner, sub);

    expect((await fin.listExpenses(owner, {})).rows.map((r) => r.id)).toContain(exp);
    expect((await analytics.financeSummary(owner)).totals.current.expensesBaseMinor).toBe(before + 12300);
    expect(JSON.stringify(await tasks.listTasks(owner, {}))).toContain("Restore this task");
    expect((await w.myTasks(a)).map((x) => x.id)).toContain(task);
    expect((await w.mySubscriptions(a)).map((x) => x.id)).toContain(sub);
    expect((await w.myExpenses(a)).map((x) => x.id)).toContain(exp);
    const after = await arch.listArchived(owner);
    expect(after.expenses.map((x) => x.id)).not.toContain(exp);
    expect(after.tasks.map((x) => x.id)).not.toContain(task);
    expect(after.subscriptions.map((x) => x.id)).not.toContain(sub);

    // logged, with before and after
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, exp))).filter((r) => /Restored expense/.test(r.summary ?? ""));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: ids.owner, before: { archived: true }, after: { archived: false } });
    expect((await t.db.select().from(t.schema.subscriptions).where(eq(t.schema.subscriptions.id, sub)))[0].status).toBe("active");
  });

  it("refuses an item that isn't archived, and a made-up id", async () => {
    const owner = await as(ids.owner);
    const live = await fin.createExpense(owner, { expenseDate: today(), category: "Software", vendor: "Live", amount: "1", currency: "AUD", fxRate: "1" });
    await expect(arch.unarchiveExpense(owner, live)).rejects.toThrow(/isn't archived/);
    const missing = await msg(arch.unarchiveExpense(owner, crypto.randomUUID()));
    expect(missing).toMatch(/no longer exists/);
    expect(await msg(arch.unarchiveTask(owner, crypto.randomUUID()))).toBe(missing);
    await expect(arch.unarchiveSubscription(owner, crypto.randomUUID())).rejects.toThrow(/no longer exists/);
  });

  it("is admin only: staff and partners can neither list nor restore", async () => {
    const owner = await as(ids.owner);
    const row = crypto.randomUUID();
    await t.db.insert(t.schema.expenses).values({ id: row, expenseDate: today(), category: "Software", vendor: "Hands off", amountMinor: 500, currency: "AUD", fxRateToBase: "1", createdBy: ids.owner, archivedAt: new Date() });
    for (const who of [ids.staff, ids.a]) {
      const actor = await as(who);
      await expect(arch.listArchived(actor), who).rejects.toThrow(/permission|admins/i);
      await expect(arch.unarchiveExpense(actor, row), who).rejects.toThrow(/permission|admins/i);
    }
    expect((await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, row)))[0].archivedAt).toBeInstanceOf(Date);
    await arch.unarchiveExpense(owner, row);
  });

  it("an archived task under a project the Owner hid from this admin is not listed and can't be restored by them", async () => {
    const [owner, admin2] = [await as(ids.owner), await as(ids.admin2)];
    const id = crypto.randomUUID();
    await t.db.insert(t.schema.tasks).values({ id, title: "Secret archived task", createdBy: ids.owner, streamId: S, projectId: hiddenProject, archivedAt: new Date() });
    expect(JSON.stringify(await arch.listArchived(admin2))).not.toContain("Secret archived task");
    expect(JSON.stringify(await arch.listArchived(owner))).toContain("Secret archived task");
    const missing = await msg(arch.unarchiveTask(admin2, crypto.randomUUID()));
    expect(await msg(arch.unarchiveTask(admin2, id))).toBe(missing);
    expect((await t.db.select().from(t.schema.tasks).where(eq(t.schema.tasks.id, id)))[0].archivedAt).toBeInstanceOf(Date);
    await arch.unarchiveTask(owner, id);
  });
});
