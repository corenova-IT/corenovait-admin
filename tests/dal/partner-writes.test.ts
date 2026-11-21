import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * What a partner may add, edit and archive. Partner A runs Upwork in GB; partner B runs
 * Fiverr in AU; partner C has a stream but no country.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let w: typeof import("@/lib/dal/partner-writes");
let dash: typeof import("@/lib/dal/partner-dashboard");
let ap: typeof import("@/lib/dal/admin-partners");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let fin: typeof import("@/lib/dal/finance");
let ids: Record<"owner" | "staff" | "oldPartner" | "emp" | "a" | "b" | "c", string>;
let S: Record<"upwork" | "fiverr" | "pph", number>;
let okProject: string;
let hiddenProject: string;
let otherStreamProject: string;

const as = (id: string) => actorFor(t, id);
const today = () => todayIn("Australia/Sydney");
const exp = (over: Record<string, unknown> = {}) => ({ expenseDate: today(), category: "Software", vendor: "Tool", amount: "10", currency: "AUD", fxRate: "1", streamId: S.upwork, countryCode: "GB", ...over });
const sub = (over: Record<string, unknown> = {}) => ({ vendor: "Sub", category: "Software", amount: "20", currency: "AUD", fxRate: "1", billingCycle: "monthly" as const, nextDueDate: addDays(today(), 5), streamId: S.upwork, countryCode: "GB", ...over });
const task = (over: Record<string, unknown> = {}) => ({ title: "Do it", streamId: S.upwork, ...over });
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const row = async <T extends "expenses" | "subscriptions" | "tasks">(table: T, id: string) => (await t.db.select().from(t.schema[table]).where(eq(t.schema[table].id, id)))[0];
const auditFor = (entityId: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, entityId));

beforeAll(async () => {
  t = await setupTestDatabase();
  w = await import("@/lib/dal/partner-writes");
  dash = await import("@/lib/dal/partner-dashboard");
  ap = await import("@/lib/dal/admin-partners");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  fin = await import("@/lib/dal/finance");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    oldPartner: (await createPerson(t, { email: "old@example.test", preset: "partner" })).id,
    emp: (await createPerson(t, { email: "emp@example.test", preset: "employee" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    c: (await createPerson(t, { email: "c@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour") };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  await assign.setAssignments(owner, { userId: ids.c, streamIds: [S.pph], countryCodes: [] });
  okProject = await proj.createProject(owner, { streamId: S.upwork, name: "Visible" });
  hiddenProject = await proj.createProject(owner, { streamId: S.upwork, name: "Hidden from A" });
  await proj.setProjectHidden(owner, { projectId: hiddenProject, userId: ids.a, hidden: true });
  otherStreamProject = await proj.createProject(owner, { streamId: S.fiverr, name: "Fiverr project" });
});
afterAll(() => t?.cleanup());

describe("expenses", () => {
  it("a partner adds one in their own stream and country; it is logged and counts everywhere it should", async () => {
    const a = await as(ids.a);
    const id = await w.createMyExpense(a, exp({ vendor: "AWS", amount: "40" }));
    const saved = await row("expenses", id);
    expect(saved).toMatchObject({ streamId: S.upwork, countryCode: "GB", createdBy: ids.a, amountMinor: 4000, archivedAt: null });
    const log = (await auditFor(id)).filter((r) => r.action === "create");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: ids.a, entity: "expenses" });
    expect((await w.myExpenses(a)).map((e) => e.id)).toContain(id);
    expect((await dash.myDashboard(a)).overall.costsMonthBaseMinor).toBe(4000);
    // the admin sees it in the normal Transactions list
    expect((await fin.listExpenses(await as(ids.owner), {})).rows.map((e) => e.id)).toContain(id);
  });

  it("refuses another partner's stream, a wrong country, or a missing stream or country", async () => {
    const a = await as(ids.a);
    const before = (await t.db.select().from(t.schema.expenses)).length;
    await expect(w.createMyExpense(a, exp({ streamId: S.fiverr }))).rejects.toThrow(/no longer exists/);
    await expect(w.createMyExpense(a, exp({ countryCode: "AU" }))).rejects.toThrow(/no longer exists/);
    await expect(w.createMyExpense(a, exp({ streamId: "" }))).rejects.toThrow(/choose a stream/i);
    await expect(w.createMyExpense(a, exp({ countryCode: "" }))).rejects.toThrow(/choose a country/i);
    await expect(w.createMyExpense(a, exp({ category: "Not a category" }))).rejects.toThrow(/category/i);
    // a stream that doesn't exist looks exactly like another partner's stream
    expect(await msg(w.createMyExpense(a, exp({ streamId: 987654 })))).toBe(await msg(w.createMyExpense(a, exp({ streamId: S.fiverr }))));
    expect((await t.db.select().from(t.schema.expenses)).length).toBe(before);
  });

  it("can't edit or archive another partner's expense, and can't move their own into someone else's stream", async () => {
    const [a, b] = [await as(ids.a), await as(ids.b)];
    const mine = await w.createMyExpense(a, exp({ vendor: "Mine" }));
    const theirs = await w.createMyExpense(b, exp({ vendor: "Theirs", streamId: S.fiverr, countryCode: "AU" }));
    const snapshot = JSON.stringify(await row("expenses", theirs));
    const missing = crypto.randomUUID();
    await expect(w.updateMyExpense(a, theirs, exp({ vendor: "Hacked" }))).rejects.toThrow(/no longer exists/);
    await expect(w.archiveMyExpense(a, theirs)).rejects.toThrow(/no longer exists/);
    expect(await msg(w.archiveMyExpense(a, theirs))).toBe(await msg(w.archiveMyExpense(a, missing)));
    expect(JSON.stringify(await row("expenses", theirs))).toBe(snapshot);
    await expect(w.updateMyExpense(a, mine, exp({ streamId: S.fiverr, countryCode: "AU" }))).rejects.toThrow(/no longer exists/);
    expect((await row("expenses", mine)).streamId).toBe(S.upwork);
  });

  it("edits are logged with before and after, and an archive hides the row everywhere but keeps it", async () => {
    const [a, owner] = [await as(ids.a), await as(ids.owner)];
    const id = await w.createMyExpense(a, exp({ vendor: "Before", amount: "99" }));
    await w.updateMyExpense(a, id, exp({ vendor: "After", amount: "99" }));
    const update = (await auditFor(id)).find((r) => r.action === "update")!;
    expect((update.before as { vendor: string }).vendor).toBe("Before");
    expect((update.after as { vendor: string }).vendor).toBe("After");
    const costsBefore = (await dash.myDashboard(a)).overall.costsMonthBaseMinor;
    await w.archiveMyExpense(a, id);
    expect((await row("expenses", id)).archivedAt).toBeInstanceOf(Date);
    expect((await auditFor(id)).some((r) => r.action === "archive")).toBe(true);
    expect((await w.myExpenses(a)).map((e) => e.id)).not.toContain(id);
    expect((await dash.myDashboard(a)).overall.costsMonthBaseMinor).toBe(costsBefore - 9900);
    expect((await fin.listExpenses(owner, {})).rows.map((e) => e.id)).not.toContain(id);
    await expect(w.updateMyExpense(a, id, exp())).rejects.toThrow(/no longer exists/); // archived = gone
  });

  it("a partner with no country can't add anything", async () => {
    const c = await as(ids.c);
    await expect(w.createMyExpense(c, exp({ streamId: S.pph, countryCode: "GB" }))).rejects.toThrow(/no longer exists/);
    expect(await w.myExpenses(c)).toEqual([]);
  });
});

describe("subscriptions", () => {
  it("are added, edited and archived (cancelled) in the partner's own stream and country, and logged", async () => {
    const a = await as(ids.a);
    const id = await w.createMySubscription(a, sub({ vendor: "Figma" }));
    expect(await row("subscriptions", id)).toMatchObject({ streamId: S.upwork, countryCode: "GB", createdBy: ids.a, status: "active", responsibleUserId: null });
    await w.updateMySubscription(a, id, sub({ vendor: "Figma Pro", amount: "25" }));
    expect((await row("subscriptions", id)).vendor).toBe("Figma Pro");
    expect((await dash.myDashboard(a)).upcomingPayments.map((p) => p.vendor)).toContain("Figma Pro");
    await w.archiveMySubscription(a, id);
    expect((await row("subscriptions", id)).status).toBe("cancelled");
    expect((await w.mySubscriptions(a)).map((s) => s.id)).not.toContain(id);
    expect((await dash.myDashboard(a)).upcomingPayments.map((p) => p.vendor)).not.toContain("Figma Pro");
    const actions = (await auditFor(id)).map((r) => r.action).sort();
    expect(actions).toEqual(["archive", "create", "update"]);
  });

  it("refuse another partner's stream or country, and can't touch another partner's", async () => {
    const [a, b] = [await as(ids.a), await as(ids.b)];
    await expect(w.createMySubscription(a, sub({ streamId: S.fiverr }))).rejects.toThrow(/no longer exists/);
    await expect(w.createMySubscription(a, sub({ countryCode: "AU" }))).rejects.toThrow(/no longer exists/);
    const theirs = await w.createMySubscription(b, sub({ streamId: S.fiverr, countryCode: "AU" }));
    await expect(w.updateMySubscription(a, theirs, sub())).rejects.toThrow(/no longer exists/);
    await expect(w.archiveMySubscription(a, theirs)).rejects.toThrow(/no longer exists/);
    expect((await row("subscriptions", theirs)).status).toBe("active");
  });
});

describe("tasks", () => {
  it("are added, edited and archived in the partner's own stream, and logged", async () => {
    const a = await as(ids.a);
    const id = await w.createMyTask(a, task({ title: "Write brief", dueDate: addDays(today(), 3), projectId: okProject }));
    expect(await row("tasks", id)).toMatchObject({ streamId: S.upwork, projectId: okProject, createdBy: ids.a, assigneeId: null });
    await w.updateMyTask(a, id, task({ title: "Write brief v2", status: "done", projectId: okProject }));
    const done = await row("tasks", id);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeInstanceOf(Date);
    await w.archiveMyTask(a, id);
    expect((await row("tasks", id)).archivedAt).toBeInstanceOf(Date);
    expect((await w.myTasks(a)).map((x) => x.id)).not.toContain(id);
    expect((await auditFor(id)).map((r) => r.action).sort()).toEqual(["archive", "create", "update"]);
  });

  it("refuse another partner's stream, a project in another stream, and a project the Owner hid from them", async () => {
    const a = await as(ids.a);
    await expect(w.createMyTask(a, task({ streamId: S.fiverr }))).rejects.toThrow(/no longer exists/);
    await expect(w.createMyTask(a, task({ projectId: otherStreamProject }))).rejects.toThrow(/no longer exists/);
    await expect(w.createMyTask(a, task({ projectId: hiddenProject }))).rejects.toThrow(/no longer exists/);
    expect(await msg(w.createMyTask(a, task({ projectId: hiddenProject })))).toBe(await msg(w.createMyTask(a, task({ projectId: crypto.randomUUID() }))));
  });

  it("can't touch another partner's task, and a task in a hidden project can't be reached by guessing its id", async () => {
    const [a, b, owner] = [await as(ids.a), await as(ids.b), await as(ids.owner)];
    const theirs = await w.createMyTask(b, task({ streamId: S.fiverr }));
    await expect(w.updateMyTask(a, theirs, task())).rejects.toThrow(/no longer exists/);
    await expect(w.archiveMyTask(a, theirs)).rejects.toThrow(/no longer exists/);
    const secret = crypto.randomUUID();
    await t.db.insert(t.schema.tasks).values({ id: secret, title: "Secret", createdBy: ids.owner, streamId: S.upwork, projectId: hiddenProject });
    await expect(w.updateMyTask(a, secret, task({ title: "Hijack" }))).rejects.toThrow(/no longer exists/);
    await expect(w.archiveMyTask(a, secret)).rejects.toThrow(/no longer exists/);
    expect((await row("tasks", secret)).title).toBe("Secret");
    void owner;
  });
});

describe("marking a subscription paid", () => {
  it("records the cost under the same stream and country, moves the due date on, shows on the dashboard, and is logged", async () => {
    const a = await as(ids.a);
    const due = addDays(today(), 4);
    const id = await w.createMySubscription(a, sub({ vendor: "PaidTool", amount: "25", nextDueDate: due }));
    const costsBefore = (await dash.myDashboard(a)).overall.costsMonthBaseMinor;
    const r = await w.markMySubscriptionPaid(a, id);
    expect(r.nextDueDate).toBeTruthy();
    const paid = await row("expenses", r.expenseId);
    expect(paid).toMatchObject({ vendor: "PaidTool", amountMinor: 2500, streamId: S.upwork, countryCode: "GB", createdBy: ids.a, subscriptionId: id, archivedAt: null });
    expect((await row("subscriptions", id)).nextDueDate).toBe(r.nextDueDate);
    expect((await row("subscriptions", id)).nextDueDate > due).toBe(true);
    expect((await dash.myDashboard(a)).overall.costsMonthBaseMinor).toBe(costsBefore + 2500);
    expect((await auditFor(r.expenseId)).map((x) => x.action)).toEqual(["create"]);
    expect((await auditFor(id)).some((x) => x.action === "update" && /marked paid/.test(x.summary ?? ""))).toBe(true);
    // the admin's own Transactions list shows it too
    expect((await fin.listExpenses(await as(ids.owner), {})).rows.map((e) => e.id)).toContain(r.expenseId);
  });

  it("completes a one-off subscription, and refuses a paused or cancelled one", async () => {
    const a = await as(ids.a);
    const once = await w.createMySubscription(a, sub({ billingCycle: "once" }));
    const r = await w.markMySubscriptionPaid(a, once);
    expect(r.nextDueDate).toBeNull();
    expect((await row("subscriptions", once)).status).toBe("completed");
    await expect(w.markMySubscriptionPaid(a, once)).rejects.toThrow(/active/i);
    const gone = await w.createMySubscription(a, sub());
    await w.archiveMySubscription(a, gone);
    await expect(w.markMySubscriptionPaid(a, gone)).rejects.toThrow(/no longer exists/);
    await expect(w.markMySubscriptionPaid(a, (await w.createMySubscription(a, sub())), { paidDate: "tomorrow" })).rejects.toThrow(/date/i);
  });

  it("can't be used on another partner's or a company-wide subscription, and changes nothing when refused", async () => {
    const [a, b] = [await as(ids.a), await as(ids.b)];
    const theirs = await w.createMySubscription(b, sub({ streamId: S.fiverr, countryCode: "AU" }));
    const companyWide = crypto.randomUUID();
    await t.db.insert(t.schema.subscriptions).values({ id: companyWide, vendor: "Company", category: "Software", amountMinor: 100, currency: "AUD", fxRateToBase: "1", nextDueDate: today(), createdBy: ids.owner });
    const expensesBefore = (await t.db.select().from(t.schema.expenses)).length;
    const snapshot = JSON.stringify(await row("subscriptions", theirs));
    await expect(w.markMySubscriptionPaid(a, theirs)).rejects.toThrow(/no longer exists/);
    await expect(w.markMySubscriptionPaid(a, companyWide)).rejects.toThrow(/no longer exists/);
    expect(await msg(w.markMySubscriptionPaid(a, theirs))).toBe(await msg(w.markMySubscriptionPaid(a, crypto.randomUUID())));
    expect((await t.db.select().from(t.schema.expenses)).length).toBe(expensesBefore);
    expect(JSON.stringify(await row("subscriptions", theirs))).toBe(snapshot);
  });

  it("is only for partners", async () => {
    const a = await as(ids.a);
    const id = await w.createMySubscription(a, sub());
    for (const who of [ids.owner, ids.staff, ids.oldPartner, ids.emp]) {
      await expect(w.markMySubscriptionPaid(await as(who), id), who).rejects.toThrow(/permission/i);
    }
  });
});

describe("what a partner still can't do", () => {
  it("nobody but a partner can use these functions", async () => {
    for (const who of [ids.owner, ids.staff, ids.oldPartner, ids.emp]) {
      const actor = await as(who);
      await expect(w.createMyExpense(actor, exp()), who).rejects.toThrow(/permission/i);
      await expect(w.createMySubscription(actor, sub()), who).rejects.toThrow(/permission/i);
      await expect(w.createMyTask(actor, task()), who).rejects.toThrow(/permission/i);
      await expect(w.myExpenses(actor), who).rejects.toThrow(/permission/i);
    }
  });

  it("can't enter income, change shares or hiding, or delete (only archive)", async () => {
    const a = await as(ids.a);
    await expect(fin.createIncome(a, { entryDate: today(), streamId: S.upwork, countryCode: "GB", client: "X", amount: "1", currency: "AUD", fxRate: "1", status: "paid" })).rejects.toThrow(/permission/i);
    await expect(proj.setProjectPartners(a, okProject, [])).rejects.toThrow(/owner|permission/i);
    await expect(proj.setProjectHidden(a, { projectId: okProject, userId: ids.b, hidden: true })).rejects.toThrow(/owner|permission/i);
    const mine = await w.createMyExpense(a, exp({ vendor: "KeepMe" }));
    await expect(fin.deleteExpense(a, mine)).rejects.toThrow(/permission/i);
    expect(await row("expenses", mine)).toBeTruthy();
  });

  it("everything a partner did shows to the admin under 'Changes made'", async () => {
    const d = await ap.partnerDetail(await as(ids.owner), ids.a);
    const summaries = d.changes.map((c) => c.summary ?? "");
    expect(summaries.some((s) => s.startsWith("Added expense"))).toBe(true);
    expect(summaries.some((s) => s.startsWith("Archived expense"))).toBe(true);
    expect(summaries.some((s) => s.startsWith("Added subscription"))).toBe(true);
    expect(summaries.some((s) => s.startsWith("Added task"))).toBe(true);
    expect(d.changes.every((c) => ["expenses", "subscriptions", "tasks"].includes(c.entity))).toBe(true);
  });
});

