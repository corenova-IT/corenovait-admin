import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * Archived expenses and tasks stay in the database but must drop out of every list,
 * total, lookup, export, calendar entry and reminder. This walks each reader.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let admin: Awaited<ReturnType<typeof actorFor>>;
let adminId: string;
const ARCHIVED_MINOR = 987_654_321; // a sentinel amount that must appear nowhere
let ids: { liveExpense: string; archivedExpense: string; liveTask: string; archivedTask: string };

const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  t = await setupTestDatabase();
  adminId = (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id;
  admin = await actorFor(t, adminId);
  const exp = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), expenseDate: today(), category: "Software", vendor: "V", amountMinor: 1000, currency: "AUD", fxRateToBase: "1", createdBy: adminId, ...over });
  const task = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), title: "T", createdBy: adminId, assigneeId: adminId, dueDate: today(), ...over });
  const live = exp({ vendor: "LiveVendor" });
  const gone = exp({ vendor: "ArchivedVendor", amountMinor: ARCHIVED_MINOR, archivedAt: new Date() });
  const lt = task({ title: "LiveTask" });
  const at = task({ title: "ArchivedTask", archivedAt: new Date() });
  await t.db.insert(t.schema.expenses).values([live, gone]);
  await t.db.insert(t.schema.tasks).values([lt, at]);
  ids = { liveExpense: live.id, archivedExpense: gone.id, liveTask: lt.id, archivedTask: at.id };
});
afterAll(() => t?.cleanup());

describe("archived expenses", () => {
  it("are missing from lists, search, lookups and exports", async () => {
    const fin = await import("@/lib/dal/finance");
    const list = await fin.listExpenses(admin, {});
    expect(list.rows.map((r) => r.id)).toEqual([ids.liveExpense]);
    expect(list.total).toBe(1);
    expect(await fin.getExpense(admin, ids.archivedExpense)).toBeNull();
    expect(await fin.getExpense(admin, ids.liveExpense)).toBeTruthy();
    const csv = await fin.exportExpensesCsv(admin, {});
    expect(csv.csv).toContain("LiveVendor");
    expect(csv.csv).not.toContain("ArchivedVendor");
  });

  it("never count towards a total", async () => {
    const analytics = await import("@/lib/dal/analytics");
    const all = JSON.stringify(await analytics.financeSummary(admin));
    expect(all).not.toContain(String(ARCHIVED_MINOR));
    expect(all).toContain("1000");
  });

  it("stay in the database", async () => {
    const [row] = await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, ids.archivedExpense));
    expect(row.archivedAt).toBeInstanceOf(Date);
  });
});

describe("archived tasks", () => {
  it("are missing from lists, lookups, my tasks, team progress and the calendar", async () => {
    const tasks = await import("@/lib/dal/tasks");
    const calendar = await import("@/lib/dal/calendar");
    const listed = JSON.stringify(await tasks.listTasks(admin, {}));
    expect(listed).toContain("LiveTask");
    expect(listed).not.toContain("ArchivedTask");
    expect(await tasks.getTask(admin, ids.archivedTask)).toBeNull();
    expect(await tasks.getTask(admin, ids.liveTask)).toBeTruthy();
    const mine = await tasks.myOpenTasks(admin);
    expect(JSON.stringify(mine)).not.toContain("ArchivedTask");
    expect(JSON.stringify(mine)).toContain("LiveTask");
    const progress = await tasks.teamProgress(admin);
    expect(progress.people.find((p) => p.userId === adminId)?.open).toBe(1);
    expect(JSON.stringify(await tasks.taskDeadlines(admin, today(), today()))).not.toContain("ArchivedTask");
    expect(JSON.stringify(await calendar.calendarItems(admin, today(), today()))).not.toContain("ArchivedTask");
  });

  it("never trigger a reminder", async () => {
    const notifications = await import("@/lib/dal/notifications");
    // due tomorrow (UTC) falls inside the scheduler's "today or tomorrow" window whatever the company time zone is
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const reminder = (title: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), title, createdBy: adminId, assigneeId: adminId, dueDate: tomorrow, ...extra });
    await t.db.insert(t.schema.tasks).values([reminder("RemindLive"), reminder("RemindArchived", { archivedAt: new Date() })]);
    await notifications.runScheduler();
    const rows = await t.db.select().from(t.schema.notifications);
    const text = JSON.stringify(rows);
    expect(text).toContain("RemindLive");
    expect(text).not.toContain("RemindArchived");
  });
});
