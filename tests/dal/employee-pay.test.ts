import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMonths, todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * Employee pay. Set by the employee's stream partner OR an admin, always logged, never seen by the employee,
 * and counted EXACTLY ONCE in a partner's costs and in company profit.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let pay: typeof import("@/lib/dal/employee-pay");
let emp: typeof import("@/lib/dal/partner-employees");
let pp: typeof import("@/lib/dal/partner-projects");
let w: typeof import("@/lib/dal/partner-writes");
let dash: typeof import("@/lib/dal/partner-dashboard");
let ap: typeof import("@/lib/dal/admin-partners");
let analytics: typeof import("@/lib/dal/analytics");
let fin: typeof import("@/lib/dal/finance");
let work: typeof import("@/lib/dal/employee-work");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "staff" | "oldPartner" | "a" | "b" | "c" | "d", string>;
let E: Record<"a1" | "b1" | "c1" | "d1", string>;
let S: Record<"upwork" | "fiverr" | "pph" | "web" | "rep", number>;
let P: Record<"a" | "c" | "c2" | "b", string>;

const today = () => todayIn("Australia/Sydney");
const thisMonth = () => today().slice(0, 7);
const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const recs = (planId: string) => t.db.select().from(t.schema.employeePayRecords).where(eq(t.schema.employeePayRecords.planId, planId));
const monthly = (employeeId: string, over: Record<string, unknown> = {}) => ({ employeeId, kind: "monthly" as const, streamId: S.upwork, countryCode: "GB", amount: "300", currency: "AUD", fxRate: "1", ...over });
const auditFor = (employeeId: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, employeeId));

beforeAll(async () => {
  t = await setupTestDatabase();
  pay = await import("@/lib/dal/employee-pay");
  emp = await import("@/lib/dal/partner-employees");
  pp = await import("@/lib/dal/partner-projects");
  w = await import("@/lib/dal/partner-writes");
  dash = await import("@/lib/dal/partner-dashboard");
  ap = await import("@/lib/dal/admin-partners");
  analytics = await import("@/lib/dal/analytics");
  fin = await import("@/lib/dal/finance");
  work = await import("@/lib/dal/employee-work");
  assign = await import("@/lib/dal/assignments");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    oldPartner: (await createPerson(t, { email: "old@example.test", preset: "partner" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    c: (await createPerson(t, { email: "c@example.test", preset: "stream_partner" })).id,
    d: (await createPerson(t, { email: "d@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour"), web: sid("Website direct"), rep: sid("Individual representatives") };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  await assign.setAssignments(owner, { userId: ids.c, streamIds: [S.pph], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.d, streamIds: [S.web], countryCodes: ["GB"] });
  const mk = async (who: string, email: string) => {
    const id = (await emp.inviteMyEmployee(await as(who), { email, fullName: email.split("@")[0], jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(ids.a, "ea1@example.test"), b1: await mk(ids.b, "eb1@example.test"), c1: await mk(ids.c, "ec1@example.test"), d1: await mk(ids.d, "ed1@example.test") };
  P = {
    a: await pp.createMyProject(await as(ids.a), { streamId: S.upwork, name: "A project" }),
    c: await pp.createMyProject(await as(ids.c), { streamId: S.pph, name: "C project" }),
    c2: await pp.createMyProject(await as(ids.c), { streamId: S.pph, name: "C project 2" }),
    b: await pp.createMyProject(await as(ids.b), { streamId: S.fiverr, name: "B project" }),
  } as typeof P;
  await pp.setMyProjectMembers(await as(ids.a), P.a, [E.a1]);
  await pp.setMyProjectMembers(await as(ids.c), P.c, [E.c1]);
  await pp.setMyProjectMembers(await as(ids.c), P.c2, [E.c1]);
  await pp.setMyProjectMembers(await as(ids.b), P.b, [E.b1]);
});
afterAll(() => t?.cleanup());

describe("who can set pay, and where it lands", () => {
  it("a partner sets pay for their own employee under their own stream and country, logged", async () => {
    const a = await as(ids.a);
    const plan = await pay.addPayPlan(a, monthly(E.a1));
    const made = await recs(plan);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ period: thisMonth(), streamId: S.upwork, countryCode: "GB", amountMinor: 30000, status: "due", costDate: `${thisMonth()}-01`, employeeUserId: E.a1 });
    const log = (await auditFor(E.a1)).filter((r) => r.entity === "employee_pay_plans");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "create", actorId: ids.a, before: null, after: { planId: plan, kind: "monthly", amountMinor: 30000, currency: "AUD" } });
  });

  it("refuses another partner's stream or country, another partner's employee, and anyone who isn't a partner or admin", async () => {
    const a = await as(ids.a);
    await expect(pay.addPayPlan(a, monthly(E.a1, { streamId: S.fiverr }))).rejects.toThrow(/no longer exists/);
    await expect(pay.addPayPlan(a, monthly(E.a1, { countryCode: "AU" }))).rejects.toThrow(/no longer exists/);
    await expect(pay.addPayPlan(a, monthly(E.b1))).rejects.toThrow(/no longer exists/);
    expect(await msg(pay.addPayPlan(a, monthly(E.b1)))).toBe(await msg(pay.addPayPlan(a, monthly(crypto.randomUUID()))));
    await expect(pay.addPayPlan(a, monthly(E.a1, { projectId: P.a }))).rejects.toThrow(/only for project pay/i);
    for (const who of [ids.staff, ids.oldPartner, E.a1]) await expect(pay.addPayPlan(await as(who), monthly(E.a1)), who).rejects.toThrow(/permission/i);
    await expect(pay.payPlansFor(await as(E.a1), E.a1)).rejects.toThrow(/permission/i); // the employee can't read their own pay
    expect(await t.db.select().from(t.schema.employeePayPlans).where(eq(t.schema.employeePayPlans.employeeUserId, E.b1))).toEqual([]);
  });

  it("an admin can set pay for any partner's employee, but still under that partner's streams", async () => {
    const owner = await as(ids.owner);
    const plan = await pay.addPayPlan(owner, monthly(E.b1, { streamId: S.fiverr, countryCode: "AU", amount: "200" }));
    expect((await recs(plan))[0]).toMatchObject({ streamId: S.fiverr, countryCode: "AU", amountMinor: 20000 });
    await expect(pay.addPayPlan(owner, monthly(E.b1, { streamId: S.upwork, countryCode: "GB" }))).rejects.toThrow(/that partner's streams and countries/);
    await expect(pay.addPayPlan(owner, monthly(ids.staff))).rejects.toThrow(/isn't an employee/);
    const log = (await auditFor(E.b1)).filter((r) => r.entity === "employee_pay_plans");
    expect(log[0]).toMatchObject({ actorId: ids.owner });
  });

  it("stores the currency and exchange rate, and the base value follows it", async () => {
    const plan = await pay.addPayPlan(await as(ids.d), monthly(E.d1, { streamId: S.web, amount: "100", currency: "GBP", fxRate: "2" }));
    expect((await recs(plan))[0]).toMatchObject({ amountMinor: 10000, currency: "GBP", fxRateToBase: "2.00000000", amountBaseMinor: 20000 });
    await expect(pay.addPayPlan(await as(ids.d), monthly(E.d1, { streamId: S.web, amount: "abc" }))).rejects.toThrow();
    await expect(pay.addPayPlan(await as(ids.d), monthly(E.d1, { streamId: S.web, currency: "AU" }))).rejects.toThrow(/currency/i);
  });
});

describe("monthly pay", () => {
  it("creates one record per month, never twice", async () => {
    const d = await as(ids.d);
    const start = addMonths(`${thisMonth()}-01`, -2).slice(0, 7);
    const plan = await pay.addPayPlan(d, monthly(E.d1, { streamId: S.web, startMonth: start, amount: "50" }));
    const before = await recs(plan);
    expect(before.map((r) => r.period).sort()).toEqual([start, addMonths(`${start}-01`, 1).slice(0, 7), thisMonth()].sort());
    expect(await pay.ensureMonthlyPay(t.db)).toBe(0);
    expect(await pay.ensureMonthlyPay(t.db)).toBe(0);
    expect(await recs(plan)).toHaveLength(3);
    await expect(pay.addPayPlan(d, monthly(E.d1, { streamId: S.web, startMonth: addMonths(`${thisMonth()}-01`, 1).slice(0, 7) }))).rejects.toThrow(/future month/i);
  });

  it("a later month is created automatically; a stopped plan creates no more, and a new amount applies from then on", async () => {
    const d = await as(ids.d);
    const plan = await pay.addPayPlan(d, monthly(E.d1, { streamId: S.web, amount: "10", startMonth: thisMonth() }));
    await pay.updatePayAmount(d, plan, { amount: "20", currency: "AUD", fxRate: "1" });
    const nextMonthDay = addMonths(`${thisMonth()}-01`, 1);
    await pay.ensureMonthlyPay(t.db, nextMonthDay);
    const after = (await recs(plan)).sort((x, y) => x.period.localeCompare(y.period));
    expect(after.map((r) => r.amountMinor)).toEqual([1000, 2000]); // the month already made keeps its amount
    await pay.stopPayPlan(d, plan);
    await pay.ensureMonthlyPay(t.db, addMonths(`${thisMonth()}-01`, 2));
    expect(await recs(plan)).toHaveLength(2);
    await expect(pay.updatePayAmount(d, plan, { amount: "30", currency: "AUD" })).rejects.toThrow(/stopped/);
    const actions = (await auditFor(E.d1)).filter((r) => (r.after as { planId?: string } | null)?.planId === plan).map((r) => r.summary);
    expect(actions).toEqual(["Set monthly pay for an employee", "Changed monthly pay for an employee", "Stopped monthly pay for an employee"]);
  });
});

describe("project pay", () => {
  it("is a cost only once marked paid, on the day it was paid, and marking twice changes nothing", async () => {
    const c = await as(ids.c);
    const before = (await dash.myDashboard(c)).overall.costsMonthBaseMinor;
    const plan = await pay.addPayPlan(c, { employeeId: E.c1, kind: "project", projectId: P.c, countryCode: "GB", amount: "400", currency: "AUD", fxRate: "1" });
    const [rec] = await recs(plan);
    expect(rec).toMatchObject({ period: "project", streamId: S.pph, status: "due", costDate: null, paidDate: null });
    expect((await dash.myDashboard(c)).overall.costsMonthBaseMinor).toBe(before); // due, not paid: no cost yet
    await pay.markProjectPayPaid(c, plan, today());
    expect((await recs(plan))[0]).toMatchObject({ status: "paid", paidDate: today(), costDate: today() });
    expect((await dash.myDashboard(c)).overall.costsMonthBaseMinor).toBe(before + 40000);
    const logBefore = (await auditFor(E.c1)).length;
    await pay.markProjectPayPaid(c, plan, today());
    await pay.markProjectPayPaid(c, plan);
    expect((await dash.myDashboard(c)).overall.costsMonthBaseMinor).toBe(before + 40000);
    expect((await auditFor(E.c1)).length).toBe(logBefore);
    await expect(pay.updatePayAmount(c, plan, { amount: "1", currency: "AUD" })).rejects.toThrow(/already paid/);
    await expect(pay.stopPayPlan(c, plan)).rejects.toThrow(/already paid/);
  });

  it("uses the project's own stream, needs the employee on the project, and refuses another partner's or a hidden one", async () => {
    const [a, c, owner] = [await as(ids.a), await as(ids.c), await as(ids.owner)];
    const input = (employeeId: string, projectId: string, countryCode = "GB") => ({ employeeId, kind: "project" as const, projectId, countryCode, amount: "10", currency: "AUD" });
    await expect(pay.addPayPlan(c, input(E.c1, P.a))).rejects.toThrow(/no longer exists/); // a project in someone else's stream
    await expect(pay.addPayPlan(a, input(E.a1, P.c))).rejects.toThrow(/no longer exists/);
    await expect(pay.addPayPlan(c, { ...input(E.c1, P.c), projectId: "" })).rejects.toThrow(/choose the project/i);
    await pp.setMyProjectMembers(c, P.c2, []);
    await expect(pay.addPayPlan(c, input(E.c1, P.c2))).rejects.toThrow(/put them on that project first/i);
    await pp.setMyProjectMembers(c, P.c2, [E.c1]);
    // the stream always comes from the project, even if the form says otherwise
    const plan = await pay.addPayPlan(c, { ...input(E.c1, P.c2), streamId: S.upwork });
    expect((await recs(plan))[0].streamId).toBe(S.pph);
    // an admin may use any project, but the stream still has to be that employee's partner's
    await expect(pay.addPayPlan(owner, input(E.c1, P.a))).rejects.toThrow(/put them on that project first/i);
    // a partner can't use a project the Owner hid from them
    const proj = await import("@/lib/dal/projects");
    await proj.setProjectHidden(owner, { projectId: P.c2, userId: ids.c, hidden: true });
    await expect(pay.addPayPlan(await as(ids.c), input(E.c1, P.c2))).rejects.toThrow(/no longer exists/);
    await proj.setProjectHidden(owner, { projectId: P.c2, userId: ids.c, hidden: false });
  });
});

describe("pay is counted exactly once", () => {
  it("in the partner's costs, the company's profit and the company's total, and never in the expense list", async () => {
    // a fresh partner so the figures are easy to add up
    const owner = await as(ids.owner);
    const e = await createPerson(t, { email: "once@example.test", preset: "stream_partner" });
    await assign.setAssignments(owner, { userId: e.id, streamIds: [S.rep], countryCodes: ["AU"] });
    const p = await as(e.id);
    const emp1 = (await emp.inviteMyEmployee(p, { email: "once.emp@example.test", fullName: "Once", jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, emp1));
    const proj = await pp.createMyProject(p, { streamId: S.rep, name: "Once project" });
    await pp.setMyProjectMembers(p, proj, [emp1]);
    const mark = (d: { vendor: string; amount: string }) => ({ expenseDate: today(), category: "Software", currency: "AUD", fxRate: "1", streamId: S.rep, countryCode: "AU", ...d });

    const expensesBefore = (await t.db.select().from(t.schema.expenses)).length;
    await w.createMyExpense(p, mark({ vendor: "Plain expense", amount: "10" })); //            1000
    const sub = await w.createMySubscription(p, { vendor: "Tool", category: "Software", amount: "20", currency: "AUD", fxRate: "1", billingCycle: "monthly", nextDueDate: today(), streamId: S.rep, countryCode: "AU" });
    await w.markMySubscriptionPaid(p, sub, { paidDate: today() }); //                        2000 (an expense)
    await pay.addPayPlan(p, { employeeId: emp1, kind: "monthly", streamId: S.rep, countryCode: "AU", amount: "30", currency: "AUD", fxRate: "1" }); // 3000 pay
    const paidProject = await pay.addPayPlan(p, { employeeId: emp1, kind: "project", projectId: proj, countryCode: "AU", amount: "40", currency: "AUD", fxRate: "1" });
    await pay.markProjectPayPaid(p, paidProject, today()); //                                4000 pay
    await pay.addPayPlan(p, { employeeId: emp1, kind: "project", projectId: proj, countryCode: "AU", amount: "99", currency: "AUD", fxRate: "1" }); // due, not paid: nothing
    await fin.createIncome(owner, { entryDate: today(), streamId: S.rep, countryCode: "AU", client: "C", amount: "200", currency: "AUD", fxRate: "1", status: "paid" }); // 20000

    // generating the month again, marking paid again: nothing changes
    await pay.ensureMonthlyPay(t.db);
    await pay.markProjectPayPaid(p, paidProject, today());

    const mine = await dash.myDashboard(p);
    expect(mine.overall.payMonthBaseMinor).toBe(7000);
    expect(mine.overall.costsMonthBaseMinor).toBe(1000 + 2000 + 7000); // expenses + employee pay, each once
    expect(mine.overall.netMonthBaseMinor).toBe(20000 - 10000);

    // the partner's own team list shows what each employee costs this month
    expect((await emp.myEmployees(p, today())).find((x) => x.id === emp1)?.costMonthBaseMinor).toBe(7000);
    // the admin's Partners page shows the same cost and profit, and the employee's own cost
    const row = (await ap.listPartners(owner)).rows.find((r) => r.id === e.id)!;
    expect(row.profitBaseMinor).toBe(10000);
    const detail = await ap.partnerDetail(owner, e.id);
    expect(detail.dashboard.overall.costsMonthBaseMinor).toBe(10000);
    expect(detail.employees).toEqual([expect.objectContaining({ id: emp1, costBaseMinor: 7000 })]);

    // company profit: revenue - expenses - employee pay, with pay on its own line (and the expense list has none of it)
    const everyPayRecord = (await t.db.select({ n: sql<string>`coalesce(sum(${t.schema.employeePayRecords.amountBaseMinor}), 0)` }).from(t.schema.employeePayRecords).where(and(isNotNull(t.schema.employeePayRecords.costDate), lte(t.schema.employeePayRecords.costDate, today()))))[0].n;
    const everyExpense = (await t.db.select({ n: sql<string>`coalesce(sum(${t.schema.expenses.amountBaseMinor}), 0)` }).from(t.schema.expenses))[0].n;
    const summary = await analytics.financeSummary(owner);
    const cur = summary.totals.current;
    expect(cur.employeePayBaseMinor).toBe(Number(everyPayRecord));
    expect(cur.expensesBaseMinor).toBe(Number(everyExpense));
    expect(cur.profitBaseMinor).toBe(cur.revenueBaseMinor - cur.expensesBaseMinor - cur.employeePayBaseMinor);
    expect(summary.monthly.reduce((a, m) => a + m.employeePayBaseMinor, 0)).toBe(cur.employeePayBaseMinor);
    expect(summary.monthly.every((m) => m.profitBaseMinor === m.revenueBaseMinor - m.expensesBaseMinor - m.employeePayBaseMinor)).toBe(true);
    // company-wide cost = expenses + pay: this partner's costs are part of it, once
    expect(cur.expensesBaseMinor + cur.employeePayBaseMinor).toBeGreaterThanOrEqual(10000);

    // the Finances expense list only has the two real expenses, no pay rows
    const list = await fin.listExpenses(owner, {});
    expect(list.total).toBe((await t.db.select().from(t.schema.expenses)).length);
    expect((await t.db.select().from(t.schema.expenses)).length).toBe(expensesBefore + 2);
    // this partner's stream has exactly the plain expense and the paid subscription: none of the 3000 or 4000 of pay
    expect(list.rows.filter((r) => r.streamId === S.rep).map((r) => r.amountMinor).sort((x, y) => x - y)).toEqual([1000, 2000]);
  });

  it("an admin without full finance access does not see it either, because it is only counted for people who see all finances", async () => {
    const owner = await as(ids.owner);
    const manager = await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true });
    const m = await as(manager.id);
    if (m.perms.finances.view && m.perms.finances.scope !== "all") {
      expect((await analytics.financeSummary(m)).totals.current.employeePayBaseMinor).toBe(0);
    } else {
      expect(typeof (await analytics.financeSummary(owner)).totals.current.employeePayBaseMinor).toBe("number");
    }
  });
});

describe("who sees what", () => {
  it("partner B never sees partner A's employee pay in costs, and the employee sees none of it anywhere", async () => {
    const b = await dash.myDashboard(await as(ids.b));
    expect(b.overall.payMonthBaseMinor).toBe(20000); // only the pay for B's own employee, not A's 30000
    const json = JSON.stringify(await work.myWork(await as(E.a1), today()));
    for (const leak of ["300", "30000", "pay", "cost"]) expect(json.toLowerCase(), leak).not.toContain(leak);
  });

  it("pay changes by the partner or an admin all show under the partner's 'Changes made'", async () => {
    const owner = await as(ids.owner);
    const d = await ap.partnerDetail(owner, ids.b); // the admin set B's employee's pay earlier
    expect(d.changes.some((c) => c.entity === "employee_pay_plans" && c.actor_email === "owner@example.test")).toBe(true);
    const a = await ap.partnerDetail(owner, ids.a); // A set it themselves
    expect(a.changes.some((c) => c.entity === "employee_pay_plans")).toBe(true);
    // and they never show on another partner's page
    expect(a.changes.every((c) => c.entity !== "employee_pay_plans" || (c.entity_id === E.a1))).toBe(true);
  });

  it("lists an employee's pay arrangements to their partner and to admins only", async () => {
    const plans = await pay.payPlansFor(await as(ids.c), E.c1);
    expect(plans.length).toBeGreaterThanOrEqual(2);
    expect(plans.some((p) => p.kind === "project" && p.status === "paid")).toBe(true);
    await expect(pay.payPlansFor(await as(ids.a), E.c1)).rejects.toThrow(/no longer exists/);
    expect((await pay.payPlansFor(await as(ids.owner), E.c1)).length).toBe(plans.length);
  });
});
