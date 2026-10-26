import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, addMonths, dueDatesUntil, monthsBetween, nextCycleDate, todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Phase 2B: payments, analytics, Home figures, paid-vs-outstanding, overpayment and Settings lists. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let pay: typeof import("@/lib/dal/payments");
let ana: typeof import("@/lib/dal/analytics");
let fin: typeof import("@/lib/dal/finance");
let rev: typeof import("@/lib/dal/revenue");
let lists: typeof import("@/lib/dal/lists");
let ids: { admin: string; staff: string; manager: string; owner: string };
let streamId: number;
let today: string;
const DENIED = /permission|two-factor|session|admins/i;

beforeAll(async () => {
  t = await setupTestDatabase();
  [pay, ana, fin, rev, lists] = await Promise.all([
    import("@/lib/dal/payments"),
    import("@/lib/dal/analytics"),
    import("@/lib/dal/finance"),
    import("@/lib/dal/revenue"),
    import("@/lib/dal/lists"),
  ]);
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true })).id,
    owner: (await createPerson(t, { email: "owner@example.test" })).id,
  };
  streamId = (await t.db.select().from(t.schema.streams))[0].id;
  today = todayIn("Australia/Sydney");
});
afterAll(() => t?.cleanup());

const admin = () => actorFor(t, ids.admin);
const sub = (over: Record<string, unknown> = {}) => ({
  vendor: "Example Hosting",
  category: "Hosting",
  amount: "119.00",
  currency: "AUD",
  billingCycle: "monthly" as const,
  nextDueDate: addDays(today, 3),
  reminderDays: 5,
  ...over,
});

describe("calendar maths", () => {
  it("steps months from the original day and handles month ends", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(dueDatesUntil("2026-01-31", "monthly", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
    expect(dueDatesUntil("2026-10-01", "weekly", "2026-10-22")).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
    expect(dueDatesUntil("2026-10-01", "once", "2027-01-01")).toEqual(["2026-10-01"]);
    expect(nextCycleDate("2026-11-30", "quarterly")).toBe("2027-02-28");
    expect(nextCycleDate("2026-02-28", "yearly")).toBe("2027-02-28");
    expect(nextCycleDate("2026-02-28", "once")).toBeNull();
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("works out the monthly cost of each billing cycle in whole cents", () => {
    expect(pay.monthlyEquivalent(1000, "weekly")).toBe(4333); // 10.00 x 52 / 12 = 43.333…
    expect(pay.monthlyEquivalent(100, "quarterly")).toBe(33);
    expect(pay.monthlyEquivalent(1000, "yearly")).toBe(83); // 83.33…
    expect(pay.monthlyEquivalent(1800, "yearly")).toBe(150);
    expect(pay.monthlyEquivalent(1050, "quarterly")).toBe(350);
    expect(pay.monthlyEquivalent(999, "once")).toBe(0);
  });

  it("percent change and margin", () => {
    expect(ana.pctChange(118, 100)).toBe(18);
    expect(ana.pctChange(50, 0)).toBeNull();
    expect(ana.pctChange(-50, -100)).toBe(50);
    expect(ana.marginPct(348, 694)).toBe(50.1);
    expect(ana.marginPct(5, 0)).toBeNull();
  });
});

describe("staff without finance or payments access", () => {
  it("can't read or change payments, finances, analytics exports or settings lists", async () => {
    const a = await admin();
    const subId = await pay.saveSubscription(a, null, sub());
    const staff = await actorFor(t, ids.staff);
    const tries: Array<[string, () => Promise<unknown>]> = [
      ["payments overview", () => pay.paymentsOverview(staff)],
      ["create", () => pay.saveSubscription(staff, null, sub())],
      ["edit", () => pay.saveSubscription(staff, subId, sub())],
      ["pause", () => pay.setSubscriptionStatus(staff, subId, "paused")],
      ["mark paid", () => pay.markSubscriptionPaid(staff, subId)],
      ["delete", () => pay.deleteSubscription(staff, subId)],
      ["people", () => pay.responsibleCandidates(staff)],
      ["finance summary", () => ana.financeSummary(staff)],
      ["finance summary UK", () => ana.financeSummary(staff, { country: "GB" })],
      ["finance export", () => ana.exportFinanceCsv(staff)],
      ["settings lists", () => lists.settingsLists(staff)],
      ["add stream", () => lists.saveStream(staff, { name: "Hack" })],
      ["archive stream", () => lists.setStreamActive(staff, streamId, false)],
      ["add country", () => lists.saveCountry(staff, { code: "NZ", name: "NZ", isNew: true })],
      ["add category", () => lists.saveCategory(staff, { name: "Hack" })],
    ];
    for (const [name, fn] of tries) await expect(fn(), name).rejects.toThrow(DENIED);
    expect((await t.db.select().from(t.schema.subscriptions)).length).toBe(1);
  });

  it("a manager can see finances and payments but not change Settings lists", async () => {
    const m = await actorFor(t, ids.manager);
    await expect(ana.financeSummary(m)).resolves.toBeTruthy();
    await expect(pay.paymentsOverview(m)).resolves.toBeTruthy();
    await expect(lists.settingsLists(m)).rejects.toThrow(DENIED);
    await expect(lists.saveCategory(m, { name: "Nope" })).rejects.toThrow(DENIED);
  });

  it("someone with Settings access who isn't an admin still can't change the lists", async () => {
    const a = await admin();
    const team = await import("@/lib/dal/team");
    const p = await createPerson(t, { email: "settings-only@example.test" });
    const perms = (await actorFor(t, p.id)).perms;
    await team.setPermissions(a, { userId: p.id, perms: { ...perms, settings: { view: true, create: true, edit: true, delete: true, export: false, scope: "all" } } });
    const s = await actorFor(t, p.id);
    await expect(lists.saveStream(s, { name: "Nope" })).rejects.toThrow(/Only admins/);
  });
});

describe("payments and subscriptions", () => {
  it("lists the 30/60/90 day timeline, due-soon and overdue, and the monthly recurring total", async () => {
    const a = await admin();
    await t.db.delete(t.schema.subscriptions);
    await pay.saveSubscription(a, null, sub({ vendor: "Monthly Co", amount: "100", nextDueDate: addDays(today, 3), reminderDays: 5 }));
    await pay.saveSubscription(a, null, sub({ vendor: "Weekly Co", amount: "10", billingCycle: "weekly", nextDueDate: addDays(today, 1), reminderDays: 0 }));
    await pay.saveSubscription(a, null, sub({ vendor: "Yearly Co", amount: "1200", billingCycle: "yearly", nextDueDate: addDays(today, 75) }));
    await pay.saveSubscription(a, null, sub({ vendor: "Late Co", amount: "50", nextDueDate: addDays(today, -2) }));
    const pausedId = await pay.saveSubscription(a, null, sub({ vendor: "Paused Co", amount: "999", nextDueDate: addDays(today, 5) }));
    await pay.setSubscriptionStatus(a, pausedId, "paused");

    const o = await pay.paymentsOverview(a);
    expect(o.timeline.some((x) => x.vendor === "Paused Co")).toBe(false);
    const late = o.timeline.find((x) => x.vendor === "Late Co")!;
    expect(late.overdue).toBe(true);
    expect(o.timeline.find((x) => x.vendor === "Monthly Co")!.dueSoon).toBe(true);
    expect(o.timeline.find((x) => x.vendor === "Weekly Co")!.dueSoon).toBe(false); // reminder 0 days, due tomorrow
    expect(o.due30.count).toBeGreaterThan(o.timeline.filter((x) => x.vendor === "Monthly Co").length);
    expect(o.due90.totalBaseMinor).toBeGreaterThan(o.due60.totalBaseMinor);
    expect(o.timeline.filter((x) => x.vendor === "Yearly Co")).toHaveLength(1);
    expect(o.due60.count).toBe(o.timeline.filter((x) => x.daysUntil <= 60).length);
    // 100 + 10x52/12 (43.33) + 1200/12 (100) + 50 = 293.33 ; paused excluded
    expect(o.monthlyRecurringBaseMinor).toBe(10000 + 4333 + 10000 + 5000);
    expect(o.overdue.count).toBe(1);
  });

  it("mark as paid records the expense and moves the due date on from the due date", async () => {
    const a = await admin();
    const due = "2026-01-31";
    const id = await pay.saveSubscription(a, null, sub({ vendor: "Paid Co", amount: "33.33", currency: "GBP", fxRate: "1.95", nextDueDate: due, countryCode: "GB", paidFrom: "Company Visa" }));
    const r = await pay.markSubscriptionPaid(a, id, { paidDate: "2026-02-03" });
    expect(r.nextDueDate).toBe("2026-02-28");
    const [e] = await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, r.expenseId));
    expect(e).toMatchObject({ vendor: "Paid Co", amountMinor: 3333, currency: "GBP", fxRateToBase: "1.95000000", amountBaseMinor: 6499, countryCode: "GB", subscriptionId: id, isRecurring: true, expenseDate: "2026-02-03" });
    expect(e.notes).toBe("Paid from Company Visa");

    const once = await pay.saveSubscription(a, null, sub({ vendor: "Once Co", billingCycle: "once" }));
    expect((await pay.markSubscriptionPaid(a, once)).nextDueDate).toBeNull();
    const [done] = await t.db.select().from(t.schema.subscriptions).where(eq(t.schema.subscriptions.id, once));
    expect(done.status).toBe("completed");
    await expect(pay.markSubscriptionPaid(a, once)).rejects.toThrow(/Only an active payment/);
    await expect(pay.setSubscriptionStatus(a, once, "active")).rejects.toThrow(/paused payment can be resumed/);

    const audit = await import("@/lib/dal/audit");
    const log = await audit.listAudit(a, { entity: "subscriptions" });
    expect(log.rows.some((x) => x.summary === "Paid Co: marked paid")).toBe(true);
  });

  it("validates category, country, reminder days and people", async () => {
    const a = await admin();
    await expect(pay.saveSubscription(a, null, sub({ category: "Not A Category" }))).rejects.toThrow(/isn't an expense category/);
    await expect(pay.saveSubscription(a, null, sub({ countryCode: "ZZ" }))).rejects.toThrow(/country/);
    await expect(pay.saveSubscription(a, null, sub({ reminderDays: 120 }))).rejects.toThrow(/0 to 90/);
    await expect(pay.saveSubscription(a, null, sub({ amount: "1.234" }))).rejects.toThrow(/amount like/);
  });

  it("scope: own sees what they added; assigned also sees what they're responsible for", async () => {
    const a = await admin();
    const team = await import("@/lib/dal/team");
    const base = (await actorFor(t, ids.owner)).perms;
    await team.setPermissions(a, { userId: ids.owner, perms: { ...base, payments: { view: true, create: true, edit: true, delete: false, export: false, scope: "assigned" } } });
    const theirs = await pay.saveSubscription(a, null, sub({ vendor: "Scope Responsible", responsibleUserId: ids.owner }));
    await pay.saveSubscription(a, null, sub({ vendor: "Scope Not Theirs" }));
    const o = await actorFor(t, ids.owner);
    const mine = await pay.saveSubscription(o, null, sub({ vendor: "Scope Mine" }));
    const seen = (await pay.paymentsOverview(o)).subscriptions.map((s) => s.id).sort();
    expect(seen).toEqual([theirs, mine].sort());
    const notTheirs = (await pay.paymentsOverview(a)).subscriptions.find((s) => s.vendor === "Scope Not Theirs")!;
    await expect(pay.setSubscriptionStatus(o, notTheirs.id, "paused")).rejects.toThrow(/isn't yours/);
    await expect(pay.markSubscriptionPaid(o, notTheirs.id)).rejects.toThrow(/isn't yours/);
  });
});

describe("revenue counts paid invoices; outstanding is separate", () => {
  it("streams, countries and the finance summary", async () => {
    const a = await admin();
    await t.db.delete(t.schema.incomeEntries);
    await t.db.delete(t.schema.expenses);
    const d = addDays(today, -1);
    const inc = (amount: string, status: "paid" | "pending" | "overdue", countryCode: string, currency = "AUD", fxRate = "1") =>
      fin.createIncome(a, { entryDate: d, streamId, countryCode, amount, currency, fxRate, status });
    await inc("1000", "paid", "AU");
    await inc("500", "pending", "AU");
    await inc("250", "overdue", "AU");
    await inc("100", "paid", "GB", "GBP", "2");
    const exp = (amount: string, countryCode: string | null) => fin.createExpense(a, { expenseDate: d, category: "Software", amount, currency: "AUD", countryCode });
    await exp("300", "AU");
    await exp("50", "GB");
    await exp("80", null); // shared

    const s = await rev.streamSummaries(a);
    const row = s.rows.find((r) => r.id === streamId)!;
    expect(row.revenueBaseMinor).toBe(100000 + 20000);
    expect(row.outstandingBaseMinor).toBe(75000);
    expect(row.deals).toBe(2);
    expect(row.outstandingCount).toBe(2);

    const all = await ana.financeSummary(a);
    expect(all.totals.current).toMatchObject({ revenueBaseMinor: 120000, outstandingBaseMinor: 75000, expensesBaseMinor: 43000, profitBaseMinor: 77000 });
    expect(all.marginPct).toBe(64.2);
    expect(all.sharedExpensesExcludedBaseMinor).toBe(0);
    expect(all.byCountry.map((c) => [c.code, c.totalBaseMinor])).toEqual([
      ["GB", 20000],
      ["AU", 100000],
    ]);

    // the country switch changes every figure: revenue, outstanding, expenses, profit
    const au = await ana.financeSummary(a, { country: "AU" });
    expect(au.totals.current).toMatchObject({ revenueBaseMinor: 100000, outstandingBaseMinor: 75000, expensesBaseMinor: 30000, profitBaseMinor: 70000 });
    expect(au.sharedExpensesExcludedBaseMinor).toBe(8000);
    expect(au.byCountry.map((c) => c.code)).toEqual(["AU"]);
    const uk = await ana.financeSummary(a, { country: "GB" });
    expect(uk.totals.current).toMatchObject({ revenueBaseMinor: 20000, outstandingBaseMinor: 0, expensesBaseMinor: 5000, profitBaseMinor: 15000 });
    expect(uk.monthly.reduce((x, m) => x + m.revenueBaseMinor, 0)).toBe(20000);
    expect(uk.byStream[0].totalBaseMinor).toBe(20000);

    // upcoming payments follow the country too
    await t.db.delete(t.schema.subscriptions);
    await pay.saveSubscription(a, null, sub({ vendor: "UK Tool", countryCode: "GB" }));
    await pay.saveSubscription(a, null, sub({ vendor: "Shared Tool" }));
    expect((await pay.paymentsOverview(a, { country: "GB" })).subscriptions.map((x) => x.vendor)).toEqual(["UK Tool"]);
    expect((await pay.paymentsOverview(a)).subscriptions).toHaveLength(2);
  });

  it("compares with the previous 12 months", async () => {
    const a = await admin();
    await fin.createIncome(a, { entryDate: addMonths(today, -13), streamId, countryCode: "AU", amount: "600", currency: "AUD", status: "paid" });
    const s = await ana.financeSummary(a, { country: "AU" });
    expect(s.totals.previous.revenueBaseMinor).toBe(60000);
    expect(s.totals.change.revenue).toBe(66.7); // 1000 vs 600
  });

  it("exports the monthly figures as CSV and logs it", async () => {
    const a = await admin();
    const out = await ana.exportFinanceCsv(a, { country: "AU" });
    expect(out.filename).toMatch(/^finances-AU-/);
    expect(out.csv).toContain("revenue_paid_aud");
    expect(out.csv).toContain("1000.00");
    const audit = await import("@/lib/dal/audit");
    expect((await audit.listAudit(a, { action: "export", entity: "finances" })).rows).toHaveLength(1);
  });
});

describe("payouts above what's owed", () => {
  it("need confirmation, and the confirmation is in the audit log", async () => {
    const a = await admin();
    const repId = await rev.saveRep(a, null, { name: "Over Rep", commissionPercent: "10" });
    await fin.createIncome(a, { entryDate: today, streamId, countryCode: "AU", amount: "1000", currency: "AUD", status: "paid", representativeId: repId });
    // owed 100.00
    const payout = (amount: string) => ({ representativeId: repId, paidDate: today, amount, currency: "AUD" });
    await expect(rev.recordPayout(a, payout("150"))).rejects.toBeInstanceOf(rev.OverpaymentNeedsConfirmation);
    expect((await rev.repDetail(a, repId))!.payouts).toHaveLength(0);
    await rev.recordPayout(a, payout("100")); // exactly owed: fine
    await rev.recordPayout(a, payout("50"), { confirmOverpayment: true });
    const d = (await rev.repDetail(a, repId))!;
    expect(d.commissionOwedBaseMinor).toBe(-5000);
    const audit = await import("@/lib/dal/audit");
    const rows = (await audit.listAudit(a, { entity: "rep_payouts" })).rows;
    const confirmed = rows.find((r) => r.summary?.includes("confirmed by admin@example.test"));
    expect(confirmed).toBeTruthy();
    expect((confirmed!.after as Record<string, unknown>).overpaymentConfirmed).toBe(true);
    expect((confirmed!.after as Record<string, unknown>).owedBeforeBaseMinor).toBe(0);
  });
});

describe("Settings lists", () => {
  it("add, rename, archive and delete, with audit, and nothing in use can be deleted", async () => {
    const a = await admin();
    await lists.saveStream(a, { name: "Toptal", sort: 60 });
    await expect(lists.saveStream(a, { name: "Toptal" })).rejects.toThrow(/already a stream/);
    const toptal = (await lists.settingsLists(a)).streams.find((s) => s.name === "Toptal")!;
    await lists.saveStream(a, { id: toptal.id, name: "Toptal (agency)", sort: 60 });
    await lists.setStreamActive(a, toptal.id, false);
    expect((await fin.financeLookups(a)).streams.find((s) => s.id === toptal.id)?.active).toBe(false);
    await lists.deleteStream(a, toptal.id);
    await expect(lists.deleteStream(a, streamId)).rejects.toThrow(/Archive it instead/);

    await lists.saveCountry(a, { code: "nz", name: "New Zealand", isNew: true });
    await expect(lists.saveCountry(a, { code: "NZ", name: "Again", isNew: true })).rejects.toThrow(/already a country/);
    await expect(lists.saveCountry(a, { code: "N1", name: "Bad", isNew: true })).rejects.toThrow(/2 to 8 letters/);
    await lists.saveCountry(a, { code: "NZ", name: "Aotearoa New Zealand", isNew: false });
    await expect(lists.deleteCountry(a, "AU")).rejects.toThrow(/can't be deleted/);
    await lists.deleteCountry(a, "NZ");

    const audit = await import("@/lib/dal/audit");
    const log = await audit.listAudit(a, { entity: "streams" });
    expect(log.rows.map((r) => r.action)).toEqual(expect.arrayContaining(["create", "update", "delete"]));
    const rename = log.rows.find((r) => r.action === "update" && (r.after as Record<string, unknown>)?.name === "Toptal (agency)");
    expect((rename!.before as Record<string, unknown>).name).toBe("Toptal");
  });

  it("renaming a category carries over to expenses and payments; archived ones can't be newly chosen", async () => {
    const a = await admin();
    await lists.saveCategory(a, { name: "Cloud" });
    const cloud = (await lists.settingsLists(a)).categories.find((c) => c.name === "Cloud")!;
    const exp = await fin.createExpense(a, { expenseDate: today, category: "cloud", amount: "5", currency: "AUD" });
    expect((await fin.getExpense(a, exp))!.category).toBe("Cloud"); // matched case-insensitively
    const s = await pay.saveSubscription(a, null, sub({ vendor: "Cloud Co", category: "Cloud" }));
    await lists.saveCategory(a, { id: cloud.id, name: "Cloud services" });
    expect((await fin.getExpense(a, exp))!.category).toBe("Cloud services");
    const [subRow] = await t.db.select().from(t.schema.subscriptions).where(eq(t.schema.subscriptions.id, s));
    expect(subRow.category).toBe("Cloud services");

    await lists.setCategoryActive(a, cloud.id, false);
    expect((await fin.financeLookups(a)).categories).not.toContain("Cloud services");
    await expect(fin.createExpense(a, { expenseDate: today, category: "Cloud services", amount: "5", currency: "AUD" })).rejects.toThrow(/isn't an expense category/);
    // an older expense keeps its archived category when edited
    await fin.updateExpense(a, exp, { expenseDate: today, category: "Cloud services", amount: "6", currency: "AUD" });
    await expect(lists.deleteCategory(a, cloud.id)).rejects.toThrow(/Archive it instead/);
    const audit = await import("@/lib/dal/audit");
    const r = (await audit.listAudit(a, { entity: "expense_categories" })).rows.find((x) => x.summary?.startsWith("Renamed"));
    expect(r?.summary).toBe("Renamed; 2 expenses and payments updated");
  });
});
