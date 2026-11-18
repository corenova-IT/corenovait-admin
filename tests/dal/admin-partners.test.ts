import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** The admin Partners pages: admin only, same rules as the partner's own view, Owner-hidden items respected. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let ap: typeof import("@/lib/dal/admin-partners");
let dash: typeof import("@/lib/dal/partner-dashboard");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let fin: typeof import("@/lib/dal/finance");
let ids: Record<"owner" | "admin2" | "staff" | "oldPartner" | "emp" | "a" | "b" | "empty", string>;
let S: Record<"upwork" | "fiverr" | "pph", number>;
let hiddenProject: string;

const as = (id: string) => actorFor(t, id);
const today = () => todayIn("Australia/Sydney");

beforeAll(async () => {
  t = await setupTestDatabase();
  ap = await import("@/lib/dal/admin-partners");
  dash = await import("@/lib/dal/partner-dashboard");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  fin = await import("@/lib/dal/finance");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    oldPartner: (await createPerson(t, { email: "old@example.test", preset: "partner" })).id,
    emp: (await createPerson(t, { email: "emp@example.test", preset: "employee" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    empty: (await createPerson(t, { email: "empty@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour") };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB", "AU"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  hiddenProject = await proj.createProject(owner, { streamId: S.upwork, name: "Secret" });
  await proj.setProjectHidden(owner, { projectId: hiddenProject, userId: ids.admin2, hidden: true });

  const inc = (over: Record<string, unknown>) => ({ entryDate: today(), streamId: S.upwork, countryCode: "GB", client: "C", amount: "100", currency: "AUD", fxRate: "1", status: "paid" as const, ...over });
  await fin.createIncome(owner, inc({ amount: "100" }));
  await fin.createIncome(owner, inc({ amount: "40", countryCode: "AU" }));
  await fin.createIncome(owner, inc({ amount: "900", projectId: hiddenProject })); // hidden from admin2 only
  await fin.createIncome(owner, inc({ amount: "70", streamId: S.fiverr, countryCode: "AU" }));
  await fin.createIncome(owner, inc({ amount: "5000", entryDate: addDays(today(), -400) })); // outside the period
  await t.db.insert(t.schema.expenses).values([
    { id: crypto.randomUUID(), expenseDate: today(), category: "Software", vendor: "V", amountMinor: 2500, currency: "AUD", fxRateToBase: "1", createdBy: ids.owner, streamId: S.upwork, countryCode: "GB" },
    { id: crypto.randomUUID(), expenseDate: today(), category: "Software", vendor: "V", amountMinor: 9_999_000, currency: "AUD", fxRateToBase: "1", createdBy: ids.owner, streamId: S.upwork, countryCode: "GB", archivedAt: new Date() },
  ]);
  await t.db.insert(t.schema.tasks).values([
    { id: crypto.randomUUID(), title: "Open1", createdBy: ids.owner, streamId: S.upwork, dueDate: addDays(today(), -2) },
    { id: crypto.randomUUID(), title: "Done1", createdBy: ids.owner, streamId: S.upwork, status: "done" as const },
    { id: crypto.randomUUID(), title: "HiddenTask", createdBy: ids.owner, streamId: S.upwork, projectId: hiddenProject },
  ]);
});
afterAll(() => t?.cleanup());

describe("who can open the Partners pages", () => {
  it("only admins: staff, partners and employees are refused, and so is a partner looking at their own page", async () => {
    for (const who of [ids.staff, ids.oldPartner, ids.emp, ids.a, ids.b]) {
      const actor = await as(who);
      await expect(ap.listPartners(actor)).rejects.toThrow(/permission|admins/i);
      await expect(ap.partnerDetail(actor, ids.a)).rejects.toThrow(/permission|admins/i);
    }
  });
});

describe("the Partners list", () => {
  it("shows each partner's streams, countries and the period's revenue and profit (paid only, nothing archived)", async () => {
    const owner = await as(ids.owner);
    const { rows, baseCurrency } = await ap.listPartners(owner);
    expect(baseCurrency).toBe("AUD");
    expect(rows.map((r) => r.email)).toEqual(["a@example.test", "b@example.test", "empty@example.test"]);
    const a = rows[0];
    expect(a.streams).toEqual(["Upwork"]);
    expect(a.countries.sort()).toEqual(["Australia", "United Kingdom"]);
    // 100 + 40 + 900 (the Owner sees the secret project too); the 400-day-old 5000 is outside the period
    expect(a.revenueBaseMinor).toBe(10_000 + 4_000 + 90_000);
    expect(a.profitBaseMinor).toBe(a.revenueBaseMinor - 2_500);
    expect(a.openTasks).toBe(2);
    expect(rows[1].revenueBaseMinor).toBe(7_000);
    expect(rows[2]).toMatchObject({ streams: [], countries: [], revenueBaseMinor: 0, openTasks: 0 });
  });

  it("matches what the partner sees, apart from what the Owner hid from this admin", async () => {
    const mine = await dash.myDashboard(await as(ids.a));
    const asOwner = (await ap.listPartners(await as(ids.owner))).rows[0];
    expect(asOwner.revenueBaseMinor).toBe(mine.overall.revenueMonthBaseMinor);
  });

  it("removes what the Owner hid from the admin: the project's income and its tasks", async () => {
    const admin2 = await as(ids.admin2);
    const a = (await ap.listPartners(admin2)).rows[0];
    expect(a.revenueBaseMinor).toBe(10_000 + 4_000);
    expect(a.openTasks).toBe(1);
    const detail = await ap.partnerDetail(admin2, ids.a);
    expect(JSON.stringify(detail)).not.toContain("HiddenTask");
    expect(detail.dashboard.overall.revenueMonthBaseMinor).toBe(14_000);
  });

  it("filters by stream, country and date range", async () => {
    const owner = await as(ids.owner);
    const byStream = await ap.listPartners(owner, { stream: S.fiverr });
    expect(byStream.rows.map((r) => r.email)).toEqual(["b@example.test"]);
    const byCountry = await ap.listPartners(owner, { country: "GB" });
    expect(byCountry.rows.map((r) => r.email)).toEqual(["a@example.test"]);
    expect(byCountry.rows[0].revenueBaseMinor).toBe(10_000 + 90_000); // GB only: the AU 40 drops out
    const wide = await ap.listPartners(owner, { from: addDays(today(), -500), to: today() });
    expect(wide.rows[0].revenueBaseMinor).toBe(10_000 + 4_000 + 90_000 + 500_000);
    const none = await ap.listPartners(owner, { stream: S.pph });
    expect(none.rows).toEqual([]);
  });
});

describe("a partner's page", () => {
  it("shows streams, countries, figures, deadlines and task progress", async () => {
    const d = await ap.partnerDetail(await as(ids.owner), ids.a);
    expect(d.person.email).toBe("a@example.test");
    expect(d.streams.map((s) => s.name)).toEqual(["Upwork"]);
    expect(d.taskProgress).toMatchObject({ open: 2, overdue: 1, done: 1 });
    expect(d.dashboard.tasks.upcoming.map((x) => x.title)).toContain("Open1");
    expect(d.employees).toEqual([]);
  });

  it("gives the same answer for someone who isn't a stream partner as for someone who doesn't exist", async () => {
    const owner = await as(ids.owner);
    const outcome = async (id: string) => ap.partnerDetail(owner, id).catch((e: Error) => e);
    const staff = await outcome(ids.staff);
    const missing = await outcome(crypto.randomUUID());
    expect(staff).toBeInstanceOf(Error);
    expect((staff as Error).message).toBe((missing as Error).message);
  });

  it("lists what the partner changed, and never anything about hiding or shares", async () => {
    const owner = await as(ids.owner);
    const log = (entity: string, summary: string, actorId = ids.a) => ({ actorId, actorEmail: "a@example.test", action: "update", entity, entityId: "x", summary });
    await t.db.insert(t.schema.auditLog).values([
      log("expenses", "Edited an expense"),
      log("tasks", "Archived a task"),
      log("partner_projects", "Renamed a project"),
      log("project_hidden_from", "SECRET hiding row"),
      log("project_partners", "SECRET share row"),
      log("income_entries", "SECRET income row"),
      log("expenses", "Edited by someone else", ids.b),
    ]);
    const d = await ap.partnerDetail(owner, ids.a);
    const summaries = d.changes.map((c) => c.summary);
    expect(summaries).toEqual(expect.arrayContaining(["Edited an expense", "Archived a task", "Renamed a project"]));
    expect(JSON.stringify(d.changes)).not.toContain("SECRET");
    expect(summaries).not.toContain("Edited by someone else");
  });
});
