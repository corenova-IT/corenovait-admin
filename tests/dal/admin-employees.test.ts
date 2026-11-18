import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { zonedToUtc } from "@/lib/zoned";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** The admin Employees pages: admin only, filters, Owner-hidden items respected, hours and cost, corrections shown. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let ae: typeof import("@/lib/dal/admin-employees");
let emp: typeof import("@/lib/dal/partner-employees");
let pp: typeof import("@/lib/dal/partner-projects");
let pay: typeof import("@/lib/dal/employee-pay");
let sh: typeof import("@/lib/dal/shifts");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let ids: Record<"owner" | "admin2" | "staff" | "a" | "b", string>;
let E: Record<"a1" | "a2" | "b1", string>;
let S: Record<"upwork" | "fiverr", number>;
let hidden: string;

const TZ = "Australia/Sydney";
const today = () => todayIn(TZ);
const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const find = async (actor: Awaited<ReturnType<typeof as>>, id: string, f = {}) => (await ae.listEmployees(actor, f)).rows.find((r) => r.id === id);

beforeAll(async () => {
  t = await setupTestDatabase();
  ae = await import("@/lib/dal/admin-employees");
  emp = await import("@/lib/dal/partner-employees");
  pp = await import("@/lib/dal/partner-projects");
  pay = await import("@/lib/dal/employee-pay");
  sh = await import("@/lib/dal/shifts");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  S = { upwork: rows.find((r) => r.name === "Upwork")!.id, fiverr: rows.find((r) => r.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  const mk = async (who: string, email: string) => {
    const id = (await emp.inviteMyEmployee(await as(who), { email, fullName: `Emp ${email.split("@")[0]}`, jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(ids.a, "ea1@example.test"), a2: await mk(ids.a, "ea2@example.test"), b1: await mk(ids.b, "eb1@example.test") };

  const a = await as(ids.a);
  const visible = await pp.createMyProject(a, { streamId: S.upwork, name: "Visible project" });
  hidden = await proj.createProject(owner, { streamId: S.upwork, name: "Hidden from admin2" });
  await proj.setProjectHidden(owner, { projectId: hidden, userId: ids.admin2, hidden: true });
  await pp.setProjectMembersAsAdmin(owner, visible, [E.a1]);
  await pp.setProjectMembersAsAdmin(owner, hidden, [E.a1, E.a2]);

  const task = (title: string, over: Record<string, unknown>) => ({ id: crypto.randomUUID(), title, createdBy: ids.a, streamId: S.upwork, assigneeId: E.a1, ...over });
  await t.db.insert(t.schema.tasks).values([
    task("Open overdue", { dueDate: addDays(today(), -2), projectId: visible }),
    task("Open soon", { dueDate: addDays(today(), 3) }),
    task("Finished", { status: "done" as const }),
    task("In hidden project", { projectId: hidden, dueDate: addDays(today(), 1) }),
    task("Archived", { archivedAt: new Date() }),
    task("Someone else's", { assigneeId: E.a2 }),
  ]);
  const d = today();
  await t.db.insert(t.schema.shifts).values([
    { id: crypto.randomUUID(), userId: E.a1, clockInAt: zonedToUtc(`${d}T08:00`, TZ), clockOutAt: zonedToUtc(`${d}T10:00`, TZ) },
    { id: crypto.randomUUID(), userId: E.b1, clockInAt: new Date(Date.now() - 20 * 3_600_000) }, // forgotten
  ]);
  await pay.addPayPlan(owner, { employeeId: E.a1, kind: "monthly", streamId: S.upwork, countryCode: "GB", amount: "100", currency: "AUD", fxRate: "1" });
  await pay.addPayPlan(await as(ids.b), { employeeId: E.b1, kind: "monthly", streamId: S.fiverr, countryCode: "AU", amount: "40", currency: "AUD", fxRate: "1" });
});
afterAll(() => t?.cleanup());

describe("who can open the Employees pages", () => {
  it("only admins: staff, partners and employees are refused", async () => {
    for (const who of [ids.staff, ids.a, E.a1]) {
      const actor = await as(who);
      await expect(ae.listEmployees(actor), who).rejects.toThrow(/permission|admins/i);
      await expect(ae.employeeDetail(actor, E.a1), who).rejects.toThrow(/permission|admins/i);
    }
  });
});

describe("the Employees list", () => {
  it("shows partner, streams, countries, projects, tasks, hours, cost, online status and flagged shifts", async () => {
    const owner = await as(ids.owner);
    const { rows, baseCurrency } = await ae.listEmployees(owner);
    expect(baseCurrency).toBe("AUD");
    expect(rows.map((r) => r.email)).toEqual(["ea1@example.test", "ea2@example.test", "eb1@example.test"]);
    const a1 = rows[0];
    expect(a1).toMatchObject({ partnerName: "a", streams: ["Upwork"], hoursMinutes: 120, costBaseMinor: 10000, flaggedShifts: 0, status: "active" });
    expect(a1.countries).toEqual(["United Kingdom"]);
    expect(a1.projects.sort()).toEqual(["Hidden from admin2", "Visible project"]);
    expect(a1.openTasks).toBe(3); // overdue, soon, and the one in the hidden project (the Owner sees everything)
    expect(a1.overdueTasks).toBe(1);
    expect(rows[2]).toMatchObject({ partnerName: "b", costBaseMinor: 4000, flaggedShifts: 1, hoursMinutes: 0 });
  });

  it("leaves out tasks in a project the Owner hid from this admin", async () => {
    const admin2 = await as(ids.admin2);
    const a1 = await find(admin2, E.a1);
    expect(a1?.openTasks).toBe(2);
    expect(JSON.stringify(await ae.employeeDetail(admin2, E.a1))).not.toContain("In hidden project");
    expect(JSON.stringify(await ae.employeeDetail(await as(ids.owner), E.a1))).toContain("In hidden project");
  });

  it("filters by stream, country, partner and date range", async () => {
    const owner = await as(ids.owner);
    expect((await ae.listEmployees(owner, { stream: S.fiverr })).rows.map((r) => r.email)).toEqual(["eb1@example.test"]);
    expect((await ae.listEmployees(owner, { country: "GB" })).rows.map((r) => r.email)).toEqual(["ea1@example.test", "ea2@example.test"]);
    expect((await ae.listEmployees(owner, { partner: ids.b })).rows.map((r) => r.email)).toEqual(["eb1@example.test"]);
    expect((await ae.listEmployees(owner, { stream: S.upwork, country: "AU" })).rows).toEqual([]);
    const before = await ae.listEmployees(owner, { from: addDays(today(), -400), to: addDays(today(), -300) });
    expect(before.rows.find((r) => r.id === E.a1)).toMatchObject({ hoursMinutes: 0, costBaseMinor: 0 });
  });
});

describe("an employee's page", () => {
  it("shows partner, projects, task progress and deadlines, shifts and hours, online status and cost", async () => {
    const d = await ae.employeeDetail(await as(ids.owner), E.a1);
    expect(d.partner?.name).toBe("a");
    expect(d.streams).toEqual(["Upwork"]);
    expect(d.projects.map((p) => p.name).sort()).toEqual(["Hidden from admin2", "Visible project"]);
    expect(d.tasks).toMatchObject({ open: 3, overdue: 1, done: 1 });
    expect(d.tasks.upcoming[0]).toMatchObject({ title: "Open overdue", overdue: true, project: "Visible project" });
    expect(d.shifts.totalMinutes).toBe(120);
    expect(d.costBaseMinor).toBe(10000);
    expect(JSON.stringify(d)).not.toContain("Someone else's");
    expect(JSON.stringify(d)).not.toContain("Archived");
    expect(d.person.online).toBe(false);
  });

  it("gives the same answer for someone who isn't an employee as for someone who doesn't exist", async () => {
    const owner = await as(ids.owner);
    const missing = await msg(ae.employeeDetail(owner, crypto.randomUUID()));
    expect(missing).toMatch(/no longer exists/);
    expect(await msg(ae.employeeDetail(owner, ids.a))).toBe(missing);
    expect(await msg(ae.employeeDetail(owner, ids.staff))).toBe(missing);
  });

  it("lists shift corrections, pay changes and assignments for this employee only, whoever made them", async () => {
    const owner = await as(ids.owner);
    const open = (await t.db.select().from(t.schema.shifts).where(eq(t.schema.shifts.userId, E.b1))).find((s) => !s.clockOutAt)!;
    const day = addDays(today(), -1);
    await sh.correctShift(await as(ids.b), open.id, { clockIn: `${day}T09:00`, clockOut: `${day}T15:00`, note: "Forgot to clock out" });
    const d = await ae.employeeDetail(owner, E.b1);
    const kinds = d.changes.map((c) => c.entity);
    expect(kinds).toEqual(expect.arrayContaining(["shifts", "employee_pay_plans", "employee_assignments"]));
    expect(d.changes.find((c) => c.entity === "shifts")).toMatchObject({ actor_email: "b@example.test", before: { clockOutAt: null } });
    expect(d.changes.every((c) => c.entity_id === E.b1)).toBe(true);
    expect(d.shifts.totalMinutes).toBe(360);
    expect((await find(owner, E.b1))?.flaggedShifts).toBe(0); // the forgotten one is corrected now
    const other = await ae.employeeDetail(owner, E.a1);
    expect(JSON.stringify(other.changes)).not.toContain("Forgot to clock out");
  });
});
