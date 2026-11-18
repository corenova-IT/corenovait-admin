import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * The stream partner dashboard: only rows matching an assigned stream AND country, paid
 * income only, base-currency sums using each row's stored rate, nothing archived, nothing
 * under a project the Owner hid, nothing about other partners or the company.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let dash: typeof import("@/lib/dal/partner-dashboard");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let fin: typeof import("@/lib/dal/finance");
let ids: Record<"owner" | "admin" | "a" | "b" | "none" | "staff" | "emp", string>;
let S: Record<"upwork" | "fiverr" | "pph", number>;
let hiddenProject: string;

const as = (id: string) => actorFor(t, id);
// dates in the company's time zone (Sydney), the same clock the dashboard uses
const today = () => todayIn("Australia/Sydney");
const daysFromNow = (n: number) => addDays(today(), n);

beforeAll(async () => {
  t = await setupTestDatabase();
  dash = await import("@/lib/dal/partner-dashboard");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  fin = await import("@/lib/dal/finance");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    none: (await createPerson(t, { email: "none@example.test", preset: "stream_partner" })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    emp: (await createPerson(t, { email: "emp@example.test", preset: "employee" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where((await import("drizzle-orm")).eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour") };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  await assign.setAssignments(owner, { userId: ids.none, streamIds: [S.pph], countryCodes: [] });

  hiddenProject = await proj.createProject(owner, { streamId: S.upwork, name: "Secret" });
  await proj.setProjectHidden(owner, { projectId: hiddenProject, userId: ids.a, hidden: true });

  const inc = (over: Record<string, unknown>) => ({ entryDate: today(), streamId: S.upwork, countryCode: "GB", client: "C", amount: "100", currency: "AUD", fxRate: "1", status: "paid" as const, ...over });
  await fin.createIncome(owner, inc({ amount: "100" })); //                         A: paid, counts
  await fin.createIncome(owner, inc({ amount: "50", currency: "GBP", fxRate: "2" })); // A: 50 GBP x 2 = 100 AUD, counts
  await fin.createIncome(owner, inc({ amount: "30", status: "pending" })); //       A: pending, separate
  await fin.createIncome(owner, inc({ amount: "7000", projectId: hiddenProject })); // hidden project: never
  await fin.createIncome(owner, inc({ amount: "6000", countryCode: "AU" })); //     A's stream, wrong country: never
  await fin.createIncome(owner, inc({ amount: "5000", streamId: S.fiverr, countryCode: "AU" })); // B's
  await fin.createIncome(owner, inc({ amount: "20", entryDate: "2020-01-15" })); //  A: old month, counts in totals only

  const exp = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), expenseDate: today(), category: "Software", vendor: "V", amountMinor: 1000, currency: "AUD", fxRateToBase: "1", createdBy: ids.owner, streamId: S.upwork, countryCode: "GB", ...over });
  await t.db.insert(t.schema.expenses).values([
    exp({ amountMinor: 4000 }), //                                   A counts
    exp({ amountMinor: 8_000_000, archivedAt: new Date() }), //      archived: never
    exp({ amountMinor: 9_000_000, countryCode: null }), //           no country: never
    exp({ amountMinor: 9_100_000, streamId: null }), //              company-wide: never
    exp({ amountMinor: 3000, streamId: S.fiverr, countryCode: "AU" }), // B's
  ]);

  const sub = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), vendor: "Tool", category: "Software", amountMinor: 2000, currency: "GBP", fxRateToBase: "2", billingCycle: "monthly" as const, nextDueDate: daysFromNow(5), status: "active" as const, createdBy: ids.owner, streamId: S.upwork, countryCode: "GB", ...over });
  await t.db.insert(t.schema.subscriptions).values([
    sub({ vendor: "MineSoon" }),
    sub({ vendor: "MineLater", nextDueDate: daysFromNow(90) }),
    sub({ vendor: "Paused", status: "paused" }),
    sub({ vendor: "TheirsB", streamId: S.fiverr, countryCode: "AU" }),
    sub({ vendor: "CompanyWide", streamId: null }),
  ]);

  const task = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), title: "T", createdBy: ids.owner, streamId: S.upwork, status: "todo" as const, ...over });
  await t.db.insert(t.schema.tasks).values([
    task({ title: "OverdueMine", dueDate: daysFromNow(-3) }),
    task({ title: "SoonMine", dueDate: daysFromNow(2) }),
    task({ title: "DoneMine", status: "done", dueDate: daysFromNow(-9) }),
    task({ title: "ArchivedMine", archivedAt: new Date() }),
    task({ title: "InHiddenProject", projectId: hiddenProject }),
    task({ title: "TheirsB", streamId: S.fiverr }),
    task({ title: "CompanyTask", streamId: null }),
  ]);
});
afterAll(() => t?.cleanup());

describe("My dashboard", () => {
  it("adds up only the partner's own paid income, in base currency using each row's stored rate", async () => {
    const d = await dash.myDashboard(await as(ids.a));
    expect(d.hasData).toBe(true);
    expect(d.perStream.map((s) => s.stream)).toEqual(["Upwork"]);
    const up = d.perStream[0];
    expect(up.revenueMonthBaseMinor).toBe(10_000 + 10_000); // 100 AUD + 50 GBP x 2
    expect(up.revenueTotalBaseMinor).toBe(10_000 + 10_000 + 2_000);
    expect(up.pendingBaseMinor).toBe(3_000);
    expect(d.overall.revenueMonthBaseMinor).toBe(up.revenueMonthBaseMinor);
  });

  it("subtracts costs and gives net per stream and overall", async () => {
    const d = await dash.myDashboard(await as(ids.a));
    expect(d.overall.costsMonthBaseMinor).toBe(4_000);
    expect(d.overall.costsTotalBaseMinor).toBe(4_000);
    expect(d.overall.netMonthBaseMinor).toBe(20_000 - 4_000);
    expect(d.overall.netTotalBaseMinor).toBe(22_000 - 4_000);
    expect(d.perStream[0].netMonthBaseMinor).toBe(d.overall.netMonthBaseMinor);
  });

  it("never shows another partner's money, a hidden project, archived costs, or company-wide rows", async () => {
    const a = JSON.stringify(await dash.myDashboard(await as(ids.a)));
    for (const leak of ["7000", "700000", "600000", "500000", "8000000", "9000000", "9100000", "TheirsB", "CompanyWide", "InHiddenProject", "ArchivedMine", "CompanyTask"]) {
      expect(a, leak).not.toContain(leak);
    }
    const b = await dash.myDashboard(await as(ids.b));
    expect(b.perStream.map((s) => s.stream)).toEqual(["Fiverr"]);
    expect(b.overall.revenueMonthBaseMinor).toBe(500_000);
    expect(b.overall.costsMonthBaseMinor).toBe(3_000);
    expect(JSON.stringify(b)).not.toContain("MineSoon");
    expect(b.upcomingPayments.map((p) => p.vendor)).toEqual(["TheirsB"]);
  });

  it("lists upcoming payments with their own currency and the base value, soonest first, active ones only", async () => {
    const d = await dash.myDashboard(await as(ids.a));
    expect(d.upcomingPayments.map((p) => p.vendor)).toEqual(["MineSoon", "MineLater"]);
    const first = d.upcomingPayments[0];
    expect(first).toMatchObject({ amountMinor: 2000, currency: "GBP", amountBaseMinor: 4000, daysUntilDue: 5 });
    expect(d.dueWithin30DaysBaseMinor).toBe(4000);
  });

  it("counts open and overdue tasks and lists deadlines", async () => {
    const d = await dash.myDashboard(await as(ids.a));
    expect(d.tasks.open).toBe(2);
    expect(d.tasks.overdue).toBe(1);
    expect(d.tasks.upcoming.map((x) => x.title)).toEqual(["OverdueMine", "SoonMine"]);
    expect(d.tasks.upcoming[0].overdue).toBe(true);
  });

  it("shows nothing at all to a partner with a stream but no country", async () => {
    const d = await dash.myDashboard(await as(ids.none));
    expect(d.hasData).toBe(false);
    expect(d.perStream).toEqual([]);
    expect(d.upcomingPayments).toEqual([]);
    expect(d.tasks).toEqual({ open: 0, overdue: 0, upcoming: [] });
    expect(d.overall.revenueTotalBaseMinor).toBe(0);
  });

  it("is refused to everyone who isn't a stream partner", async () => {
    for (const who of [ids.owner, ids.admin, ids.staff, ids.emp]) {
      await expect(dash.myDashboard(await as(who))).rejects.toThrow(/permission/i);
    }
  });

  it("follows an assignment change on the partner's next request", async () => {
    const owner = await as(ids.owner);
    await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["AU"] });
    const d = await dash.myDashboard(await as(ids.a));
    expect(d.overall.revenueTotalBaseMinor).toBe(600_000); // the AU income on their stream now matches
    expect(d.overall.costsTotalBaseMinor).toBe(0);
    await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  });
});
