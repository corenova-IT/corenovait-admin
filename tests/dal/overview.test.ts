import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase, snapshot } from "./db";

/**
 * Phase 3: the Owner overview (revenue across streams, projects and partners, and
 * what the company keeps) and "What would this person see?". Real MySQL.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let fin: typeof import("@/lib/dal/finance");
let rev: typeof import("@/lib/dal/revenue");
let proj: typeof import("@/lib/dal/projects");
let team: typeof import("@/lib/dal/team");
let overview: typeof import("@/lib/dal/overview");
let preview: typeof import("@/lib/dal/preview");
let partners: typeof import("@/lib/dal/partners");
let authDal: typeof import("@/lib/dal/auth");

let ids: { owner: string; admin2: string; viewer: string; staff: string; p1: string; p2: string };
let reps: { p1: string; p2: string; comm: string };
let upwork: number;
let fiverr: number;
let gamma: string;
let delta: string;

const OWNER_ONLY = /owner/i;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const income = (over: Record<string, unknown> = {}) => ({
  entryDate: daysAgo(5),
  streamId: upwork,
  countryCode: "GB",
  client: "Client",
  amount: "100.00",
  currency: "AUD",
  fxRate: "1",
  status: "paid" as const,
  ...over,
});
const as = (id: string) => actorFor(t, id);

beforeAll(async () => {
  t = await setupTestDatabase();
  fin = await import("@/lib/dal/finance");
  rev = await import("@/lib/dal/revenue");
  proj = await import("@/lib/dal/projects");
  team = await import("@/lib/dal/team");
  overview = await import("@/lib/dal/overview");
  preview = await import("@/lib/dal/preview");
  partners = await import("@/lib/dal/partners");
  authDal = await import("@/lib/dal/auth");

  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    viewer: (await createPerson(t, { email: "viewer@example.test" })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    p1: (await createPerson(t, { email: "partner1@example.test", preset: "partner" })).id,
    p2: (await createPerson(t, { email: "partner2@example.test", preset: "partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const owner = await as(ids.owner);
  await team.setPermissions(owner, { userId: ids.viewer, perms: owner.perms }); // finance access like an admin's, but not an admin

  const streams = await t.db.select().from(t.schema.streams);
  upwork = streams.find((s) => s.name === "Upwork")!.id;
  fiverr = streams.find((s) => s.name === "Fiverr")!.id;
  reps = {
    p1: await rev.saveRep(owner, null, { name: "Pat One", commissionPercent: "0", userId: ids.p1 }),
    p2: await rev.saveRep(owner, null, { name: "Quinn Two", commissionPercent: "0", userId: ids.p2 }),
    comm: await rev.saveRep(owner, null, { name: "Cam Commission", commissionPercent: "10" }),
  };
  gamma = await proj.createProject(owner, { streamId: upwork, name: "Gamma" });
  delta = await proj.createProject(owner, { streamId: fiverr, name: "Delta" });
  await proj.setProjectPartners(owner, gamma, [
    { representativeId: reps.p1, percent: "30" },
    { representativeId: reps.p2, percent: "20" },
  ]);
  await proj.setProjectPartners(owner, delta, [{ representativeId: reps.p1, percent: "50" }]);

  await fin.createIncome(owner, income({ client: "GrossClient", amount: "1000.00", projectId: gamma }));
  await fin.createIncome(owner, income({ client: "PendingClient", amount: "500.00", status: "pending", projectId: gamma }));
  await fin.createIncome(owner, income({ client: "DeltaClient", amount: "200.00", streamId: fiverr, projectId: delta }));
  await fin.createIncome(owner, income({ client: "PlainClient", amount: "100.00", representativeId: reps.comm }));
  await fin.createIncome(owner, income({ client: "OldClient", amount: "300.00", entryDate: daysAgo(400), projectId: gamma }));
  await rev.recordPayout(owner, { representativeId: reps.p1, paidDate: daysAgo(1), amount: "100.00", currency: "AUD" });
  await proj.setProjectHiddenFrom(owner, gamma, [ids.viewer]);
});
afterAll(() => t?.cleanup());

const find = (rows: Awaited<ReturnType<typeof overview.ownerOverview>>["rows"], stream: string, project: string | null) => rows.find((r) => r.stream === stream && r.project === project)!;

describe("the Owner overview", () => {
  it("totals revenue, shares and what the company keeps over the last 12 months", async () => {
    const o = await overview.ownerOverview(await as(ids.owner), "12m");
    // paid 1000 + 200 + 100 = 1300 ; outstanding 500 ; the 400-day-old entry is outside the period
    expect([o.paidBaseMinor, o.outstandingBaseMinor]).toEqual([130_000, 50_000]);
    // partner shares: Gamma 30% + 20% of 1000 = 500 ; Delta 50% of 200 = 100
    expect(o.partnerSharesBaseMinor).toBe(60_000);
    // commission: 10% of the PlainClient 100
    expect(o.commissionBaseMinor).toBe(1_000);
    expect(o.companyBaseMinor).toBe(130_000 - 60_000 - 1_000);
    expect(o.baseCurrency).toBe("AUD");
  });

  it("and over all time, which includes older entries", async () => {
    const o = await overview.ownerOverview(await as(ids.owner), "all");
    expect([o.paidBaseMinor, o.outstandingBaseMinor]).toEqual([160_000, 50_000]);
    expect(o.partnerSharesBaseMinor).toBe(60_000 + 15_000); // + 50% of the old Gamma 300
    expect(o.companyBaseMinor).toBe(160_000 - 75_000 - 1_000);
  });

  it("breaks revenue down by stream and project, with the company's part of each", async () => {
    const { rows } = await overview.ownerOverview(await as(ids.owner), "12m");
    expect(find(rows, "Upwork", "Gamma")).toMatchObject({ paidBaseMinor: 100_000, outstandingBaseMinor: 50_000, deals: 2, partnerSharesBaseMinor: 50_000, partnerCount: 2, companyBaseMinor: 50_000 });
    expect(find(rows, "Fiverr", "Delta")).toMatchObject({ paidBaseMinor: 20_000, partnerSharesBaseMinor: 10_000, partnerCount: 1, companyBaseMinor: 10_000 });
    expect(find(rows, "Upwork", null)).toMatchObject({ paidBaseMinor: 10_000, partnerSharesBaseMinor: 0, partnerCount: 0, companyBaseMinor: 10_000 });
    // "no project" comes after the projects of the same stream
    const upworkRows = rows.filter((r) => r.stream === "Upwork").map((r) => r.project);
    expect(upworkRows).toEqual(["Gamma", null]);
    // the rows add up to the headline
    expect(rows.reduce((a, r) => a + r.paidBaseMinor, 0)).toBe(130_000);
  });

  it("lists each partner: earned and still to come in the period, paid out and owed all-time", async () => {
    const { partners: list } = await overview.ownerOverview(await as(ids.owner), "12m");
    const p1 = list.find((p) => p.id === reps.p1)!;
    const p2 = list.find((p) => p.id === reps.p2)!;
    // Pat: Gamma 30% of 1000 + Delta 50% of 200 = 400 ; 30% of the pending 500 = 150 ; all-time shares also include 30% of the old 300 = 90
    expect(p1).toMatchObject({ projects: 2, earnedBaseMinor: 40_000, expectedBaseMinor: 15_000, paidOutBaseMinor: 10_000, owedBaseMinor: 49_000 - 10_000, hasLogin: true });
    expect(p2).toMatchObject({ projects: 1, earnedBaseMinor: 20_000, expectedBaseMinor: 10_000, paidOutBaseMinor: 0, owedBaseMinor: 20_000 + 6_000, hasLogin: true });
    expect(list.map((p) => p.name)).not.toContain("Cam Commission"); // not a project partner
  });

  it("is Owner-only: other admins, finance viewers, staff and partners are refused", async () => {
    for (const who of ["admin2", "viewer", "staff", "p1"] as const) await expect(overview.ownerOverview(await as(ids[who]), "all"), who).rejects.toThrow(OWNER_ONLY);
  });

  it("offers every person for the preview picker", async () => {
    const { people } = await overview.ownerOverview(await as(ids.owner));
    expect(people.map((p) => p.email).sort()).toEqual(["admin2@example.test", "owner@example.test", "partner1@example.test", "partner2@example.test", "staff@example.test", "viewer@example.test"]);
    expect(people.find((p) => p.email === "partner1@example.test")!.role).toBe("Partner");
  });
});

describe("What would this person see?", () => {
  it("shows exactly what the person's own pages show, next to the total the Owner sees", async () => {
    const o = await as(ids.owner);
    const p = await preview.previewAccess(o, ids.viewer);
    expect(p.person).toMatchObject({ email: "viewer@example.test", status: "active", isOwner: false });
    // everything: 5 entries, 1600 paid, 500 outstanding (all time)
    expect(p.everything).toEqual({ entries: 5, paidBaseMinor: 160_000, outstandingBaseMinor: 50_000 });
    // the viewer can't see Gamma (1000 + 300 paid, 500 pending): only Delta and the plain entry are left
    expect(p.ledger).toEqual({ entries: 2, paidBaseMinor: 30_000, outstandingBaseMinor: 0, scope: "all" });
    expect(p.streams).toEqual({ paidBaseMinor: 30_000 });
    expect(p.projects.hidden.map((h) => [h.name, h.stream, h.paidBaseMinor])).toEqual([["Gamma", "Upwork", 130_000]]);
    expect(p.projects.visible.map((v) => v.name)).toEqual(["Delta"]);
    expect(p.hiddenPaidBaseMinor).toBe(130_000);
    expect(p.notes.join(" ")).toMatch(/1 project is hidden from them/);
    // and it matches what the viewer really gets, because it runs the same functions
    const viewer = await as(ids.viewer);
    const real = await fin.listIncome(viewer, {}, 1);
    expect([p.ledger!.entries, p.ledger!.paidBaseMinor, p.ledger!.outstandingBaseMinor]).toEqual([real.total, real.paidBaseMinor, real.outstandingBaseMinor]);
    expect(p.streams!.paidBaseMinor).toBe((await rev.streamSummaries(viewer, "all")).totalBaseMinor);
    expect(p.pages).toEqual(expect.arrayContaining(["Transactions", "Revenue streams"]));
    expect(p.pages).not.toContain("My earnings");
  });

  it("for a partner: only My earnings, with the same figures their page shows", async () => {
    const p = await preview.previewAccess(await as(ids.owner), ids.p1);
    expect(p.pages).toEqual(["My earnings"]);
    expect(p.ledger).toBeNull();
    expect(p.streams).toBeNull();
    const mine = await partners.partnerEarnings(await as(ids.p1));
    expect(p.partner).toEqual({ linked: true, earnedBaseMinor: mine.earnedBaseMinor, expectedBaseMinor: mine.expectedBaseMinor, owedBaseMinor: mine.owedBaseMinor, projects: mine.byProject.map((x) => x.project) });
    expect(p.notes.join(" ")).toMatch(/only ever sees their own share/);
  });

  it("for someone with no finance pages: says so", async () => {
    const p = await preview.previewAccess(await as(ids.owner), ids.staff);
    expect(p.ledger).toBeNull();
    expect(p.streams).toBeNull();
    expect(p.partner).toBeNull();
    expect(p.notes.join(" ")).toMatch(/can't open any page that shows revenue/);
    expect(p.pages).not.toContain("Transactions");
  });

  it("for the Owner: everything, and nothing hidden", async () => {
    const p = await preview.previewAccess(await as(ids.owner), ids.owner);
    expect(p.person.isOwner).toBe(true);
    expect(p.ledger).toMatchObject({ entries: 5, paidBaseMinor: 160_000, outstandingBaseMinor: 50_000 });
    expect(p.projects.hidden).toEqual([]);
    expect(p.notes.join(" ")).toMatch(/owner: they see everything/);
  });

  it("a person who hasn't accepted their invite yet is previewed too, with a note", async () => {
    const invited = await createPerson(t, { email: "invitee@example.test", status: "invited", password: null });
    const p = await preview.previewAccess(await as(ids.owner), invited.id);
    expect(p.person.status).toBe("invited");
    expect(p.notes.join(" ")).toMatch(/haven't accepted their invite/);
  });

  it("only returns summaries: no client names, entry rows or other people's money", async () => {
    const p = JSON.stringify(await preview.previewAccess(await as(ids.owner), ids.viewer));
    for (const secret of ["GrossClient", "PendingClient", "DeltaClient", "PlainClient", "OldClient", "Quinn", "Pat One", "Cam Commission"]) expect(p, secret).not.toContain(secret);
  });

  it("changes nothing", async () => {
    const o = await as(ids.owner); // sign-ins create session rows, so take the snapshot after this
    const before = await snapshot(t);
    for (const id of Object.values(ids)) await preview.previewAccess(o, id);
    await overview.ownerOverview(o, "all");
    expect(await snapshot(t)).toEqual(before);
  });

  it("is Owner-only, and an unknown person is a plain message", async () => {
    for (const who of ["admin2", "viewer", "staff", "p1"] as const) {
      await expect(preview.previewAccess(await as(ids[who]), ids.viewer), who).rejects.toThrow(OWNER_ONLY);
      await expect(authDal.previewActorFor(await as(ids[who]), ids.viewer), `${who} (actor)`).rejects.toThrow(OWNER_ONLY);
    }
    await expect(preview.previewAccess(await as(ids.owner), crypto.randomUUID())).rejects.toThrow(/no longer exists/);
    expect(await authDal.previewActorFor(await as(ids.owner), crypto.randomUUID())).toBeNull();
  });
});
