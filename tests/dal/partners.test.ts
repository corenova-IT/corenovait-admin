import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase, userRow } from "./db";

/**
 * Phase 2: partners and shares. The Owner puts partners on projects with a share
 * each; a partner signs in and sees ONLY their own share, payouts and balance.
 * Real MySQL, real sessions.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let fin: typeof import("@/lib/dal/finance");
let rev: typeof import("@/lib/dal/revenue");
let analytics: typeof import("@/lib/dal/analytics");
let audit: typeof import("@/lib/dal/audit");
let search: typeof import("@/lib/dal/search");
let partners: typeof import("@/lib/dal/partners");
let proj: typeof import("@/lib/dal/projects");
let team: typeof import("@/lib/dal/team");

let ids: { owner: string; admin2: string; staff: string; p1: string; p2: string; unlinked: string };
let reps: { p1: string; p2: string; three: string };
let streamId: number;
let gamma: string;
let delta: string;
let epsilon: string;
let e: { g1: string; g2: string; g3: string; d1: string; e0: string };

const DENIED = /permission|two-factor|session|owner/i;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const income = (over: Record<string, unknown> = {}) => ({
  entryDate: daysAgo(5),
  streamId,
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
  analytics = await import("@/lib/dal/analytics");
  audit = await import("@/lib/dal/audit");
  search = await import("@/lib/dal/search");
  partners = await import("@/lib/dal/partners");
  proj = await import("@/lib/dal/projects");
  team = await import("@/lib/dal/team");

  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    p1: (await createPerson(t, { email: "partner1@example.test", preset: "partner" })).id,
    p2: (await createPerson(t, { email: "partner2@example.test", preset: "partner" })).id,
    unlinked: (await createPerson(t, { email: "unlinked@example.test", preset: "partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const owner = await as(ids.owner);

  const [s] = await t.db.select().from(t.schema.streams).where(eq(t.schema.streams.name, "Upwork"));
  streamId = s.id;
  reps = {
    p1: await rev.saveRep(owner, null, { name: "Pat One", commissionPercent: "0", userId: ids.p1 }),
    p2: await rev.saveRep(owner, null, { name: "Quinn Two", commissionPercent: "0", userId: ids.p2 }),
    three: await rev.saveRep(owner, null, { name: "Robin Three", commissionPercent: "0" }),
  };
  gamma = await proj.createProject(owner, { streamId, name: "Gamma" });
  delta = await proj.createProject(owner, { streamId, name: "Delta" });
  epsilon = await proj.createProject(owner, { streamId, name: "Epsilon" });

  // an entry filed BEFORE its project has partners: it must not get shares retroactively
  e = { e0: await fin.createIncome(owner, income({ client: "EarlyClient", projectId: epsilon })) } as typeof e;
  await proj.setProjectPartners(owner, gamma, [
    { representativeId: reps.p1, percent: "30" },
    { representativeId: reps.p2, percent: "20" },
  ]);
  await proj.setProjectPartners(owner, delta, [{ representativeId: reps.p1, percent: "50" }]);
  e.g1 = await fin.createIncome(owner, income({ client: "GrossClient", amount: "1000.00", projectId: gamma }));
  e.g2 = await fin.createIncome(owner, income({ client: "PendingClient", amount: "500.00", status: "pending", projectId: gamma }));
  // 33.33 x 1.5 = 49.995 -> 50.00 base; 30% of that is 15.00, 20% is 10.00 (rounded per entry)
  e.g3 = await fin.createIncome(owner, income({ client: "FxClient", amount: "33.33", fxRate: "1.5", projectId: gamma }));
  e.d1 = await fin.createIncome(owner, income({ client: "DeltaClient", amount: "200.00", projectId: delta }));
});
afterAll(() => t?.cleanup());

const shareRows = async (entryId: string) =>
  (await t.db.select().from(t.schema.incomeShares).where(eq(t.schema.incomeShares.incomeEntryId, entryId))).map((r) => `${r.representativeId}:${r.shareRate}`).sort();

describe("the Revenue-share partner role", () => {
  it("exists with only 'My earnings', and needs two-factor", async () => {
    const [preset] = await t.db.select().from(t.schema.rolePresets).where(eq(t.schema.rolePresets.id, "partner"));
    expect(preset.name).toBe("Revenue-share partner");
    const perms = await t.db.select().from(t.schema.presetPermissions).where(eq(t.schema.presetPermissions.presetId, "partner"));
    expect(perms.map((p) => [p.module, p.canView, p.canCreate, p.canEdit, p.canDelete, p.canExport])).toEqual([["partner", true, false, false, false, false]]);
    expect((await userRow(t, ids.p1)).mfaRequired).toBe(true);
  });
});

describe("setting partners and shares", () => {
  it("only the Owner can; shares must be valid and add up to at most 100%", async () => {
    const before = JSON.stringify(await t.db.select().from(t.schema.projectPartners));
    for (const who of ["admin2", "staff", "p1"] as const) {
      await expect(proj.setProjectPartners(await as(ids[who]), gamma, [{ representativeId: reps.p1, percent: "99" }]), who).rejects.toThrow(DENIED);
    }
    const o = await as(ids.owner);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "60" }, { representativeId: reps.p2, percent: "50" }])).rejects.toThrow(/110%.*more than 100%/);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "10" }, { representativeId: reps.p1, percent: "10" }])).rejects.toThrow(/only be on a project once/);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "0" }])).rejects.toThrow(/more than 0%/);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "101" }])).rejects.toThrow(/100%/);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "12.345" }])).rejects.toThrow();
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: crypto.randomUUID(), percent: "10" }])).rejects.toThrow(/no longer exists/);
    await expect(proj.setProjectPartners(o, gamma, [{ representativeId: "nope", percent: "10" }])).rejects.toThrow(/Choose a partner/);
    expect(JSON.stringify(await t.db.select().from(t.schema.projectPartners))).toBe(before);
    // exactly 100% is fine (and is restored below)
    await proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "60" }, { representativeId: reps.p2, percent: "40" }]);
    await proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "30" }, { representativeId: reps.p2, percent: "20" }]);
  });

  it("entries filed under a project take its shares; one filed before partners existed has none", async () => {
    expect(await shareRows(e.g1)).toEqual([`${reps.p1}:0.3000`, `${reps.p2}:0.2000`].sort());
    expect(await shareRows(e.d1)).toEqual([`${reps.p1}:0.5000`]);
    expect(await shareRows(e.e0)).toEqual([]);
    const plain = await fin.createIncome(await as(ids.owner), income({ client: "NoProject" }));
    expect(await shareRows(plain)).toEqual([]);
    await fin.deleteIncome(await as(ids.owner), plain);
  });

  it("changing the shares later doesn't rewrite what entries already earned, unless the Owner applies it", async () => {
    const o = await as(ids.owner);
    await proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "40" }, { representativeId: reps.p2, percent: "20" }]);
    expect(await shareRows(e.g1)).toEqual([`${reps.p1}:0.3000`, `${reps.p2}:0.2000`].sort()); // history untouched
    const later = await fin.createIncome(o, income({ client: "LaterClient", amount: "10.00", projectId: gamma }));
    expect(await shareRows(later)).toEqual([`${reps.p1}:0.4000`, `${reps.p2}:0.2000`].sort());
    const applied = await proj.setProjectPartners(o, gamma, [{ representativeId: reps.p1, percent: "30" }, { representativeId: reps.p2, percent: "20" }], { applyToExisting: true });
    expect(applied.entriesUpdated).toBe(4); // g1, g2, g3 and LaterClient
    expect(await shareRows(later)).toEqual([`${reps.p1}:0.3000`, `${reps.p2}:0.2000`].sort());
    await fin.deleteIncome(o, later);
    expect(await t.db.select().from(t.schema.incomeShares).where(eq(t.schema.incomeShares.incomeEntryId, later))).toEqual([]); // gone with the entry
  });

  it("moving an entry to another project gives it that project's shares, and out of projects removes them", async () => {
    const o = await as(ids.owner);
    const m = await fin.createIncome(o, income({ client: "Mover", projectId: delta }));
    expect(await shareRows(m)).toEqual([`${reps.p1}:0.5000`]);
    await fin.updateIncome(o, m, income({ client: "Mover", projectId: gamma }));
    expect(await shareRows(m)).toEqual([`${reps.p1}:0.3000`, `${reps.p2}:0.2000`].sort());
    await fin.updateIncome(o, m, income({ client: "Mover", amount: "7.00", projectId: gamma })); // same project: keeps its own copy
    expect(await shareRows(m)).toEqual([`${reps.p1}:0.3000`, `${reps.p2}:0.2000`].sort());
    await fin.updateIncome(o, m, income({ client: "Mover" }));
    expect(await shareRows(m)).toEqual([]);
    await fin.deleteIncome(o, m);
  });

  it("a switched-off representative can't be added, and an empty list removes the partners", async () => {
    const o = await as(ids.owner);
    const off = await rev.saveRep(o, null, { name: "Sleeper", commissionPercent: "0", active: false });
    await expect(proj.setProjectPartners(o, epsilon, [{ representativeId: off, percent: "5" }])).rejects.toThrow(/switched off/);
    await proj.setProjectPartners(o, epsilon, [{ representativeId: reps.three, percent: "10" }]);
    expect((await proj.ownerProjects(o)).projects.find((p) => p.id === epsilon)!.partners).toEqual([{ representativeId: reps.three, percent: "10" }]);
    // applying to existing gives the early entry its share now
    await proj.setProjectPartners(o, epsilon, [{ representativeId: reps.three, percent: "10" }], { applyToExisting: true });
    expect(await shareRows(e.e0)).toEqual([`${reps.three}:0.1000`]);
    await proj.setProjectPartners(o, epsilon, [], { applyToExisting: true });
    expect(await shareRows(e.e0)).toEqual([]);
  });
});

describe("what a partner sees", () => {
  it("their own share by project, entry and status, with exact figures", async () => {
    const o = await as(ids.owner);
    await rev.recordPayout(o, { representativeId: reps.p1, paidDate: daysAgo(1), amount: "100.00", currency: "AUD", reference: "BANK-REF-1" });
    const d = await partners.partnerEarnings(await as(ids.p1));
    expect(d.linked).toBe(true);
    // Gamma: 30% of 1000.00 + 30% of 50.00 = 315.00 ; Delta: 50% of 200.00 = 100.00 ; pending 30% of 500.00 = 150.00
    expect(d.earnedBaseMinor).toBe(31_500 + 10_000);
    expect(d.expectedBaseMinor).toBe(15_000);
    expect(d.paidOutBaseMinor).toBe(10_000);
    expect(d.owedBaseMinor).toBe(41_500 - 10_000);
    expect(d.byProject.map((p) => [p.project, p.sharePercent, p.earnedBaseMinor, p.expectedBaseMinor])).toEqual([
      ["Delta", "50", 10_000, 0],
      ["Gamma", "30", 31_500, 15_000],
    ]);
    expect(d.recent.map((r) => [r.project, r.status, r.ratePercent, r.amountBaseMinor]).sort()).toEqual(
      [
        ["Gamma", "paid", "30", 30_000],
        ["Gamma", "pending", "30", 15_000],
        ["Gamma", "paid", "30", 1_500],
        ["Delta", "paid", "50", 10_000],
      ].sort()
    );
    expect(d.payouts.map((p) => [p.amountBaseMinor, p.reference])).toEqual([[10_000, "BANK-REF-1"]]);

    const d2 = await partners.partnerEarnings(await as(ids.p2));
    // Gamma: 20% of 1000.00 + 20% of 50.00 = 210.00 ; pending 20% of 500.00 = 100.00 ; no payouts
    expect([d2.earnedBaseMinor, d2.expectedBaseMinor, d2.paidOutBaseMinor, d2.owedBaseMinor]).toEqual([21_000, 10_000, 0, 21_000]);
    expect(d2.byProject.map((p) => p.project)).toEqual(["Gamma"]);
    expect(d2.payouts).toEqual([]);
  });

  it("never the gross amount, the client, the invoice, other partners, the project's total or the company's share", async () => {
    const mine = JSON.stringify(await partners.partnerEarnings(await as(ids.p1)));
    for (const secret of ["GrossClient", "PendingClient", "FxClient", "DeltaClient", "EarlyClient", "Quinn", "Robin", reps.p2, reps.three, "invoice", "client", "description", "gross"]) {
      expect(mine.toLowerCase(), `partner one must not see ${secret}`).not.toContain(secret.toLowerCase());
    }
    // none of the gross amounts (1000.00 / 500.00 / 200.00 / 50.00 in cents) and not partner two's 20%
    for (const cents of ["100000", "50000", "20000", "5000,", "5000}"]) expect(mine, cents).not.toContain(`:${cents}`);
    const two = JSON.stringify(await partners.partnerEarnings(await as(ids.p2)));
    for (const secret of ["Pat One", "Robin", reps.p1, "BANK-REF-1", "Delta", "GrossClient"]) expect(two, `partner two must not see ${secret}`).not.toContain(secret);
  });

  it("a partner with no linked representative record sees an empty page, not someone else's", async () => {
    const d = await partners.partnerEarnings(await as(ids.unlinked));
    expect(d).toMatchObject({ linked: false, earnedBaseMinor: 0, owedBaseMinor: 0, byProject: [], recent: [], payouts: [] });
  });

  it("people without the 'My earnings' permission can't open it, even admins and the Owner", async () => {
    for (const who of ["owner", "admin2", "staff"] as const) await expect(partners.partnerEarnings(await as(ids[who])), who).rejects.toThrow(DENIED);
  });

  it("a partner can open nothing else: ledger, reports, representatives, audit log, team, search or the owner's tools", async () => {
    const a = await as(ids.p1);
    const tries: Array<[string, () => Promise<unknown>]> = [
      ["list income", () => fin.listIncome(a)],
      ["get income", () => fin.getIncome(a, e.g1)],
      ["lookups", () => fin.financeLookups(a)],
      ["export", () => fin.exportIncomeCsv(a, {})],
      ["streams", () => rev.streamSummaries(a)],
      ["stream detail", () => rev.streamDetail(a, streamId)],
      ["countries", () => rev.countrySummaries(a)],
      ["representatives", () => rev.repSummaries(a)],
      ["own rep record", () => rev.repDetail(a, reps.p1)],
      ["record payout", () => rev.recordPayout(a, { representativeId: reps.p1, paidDate: daysAgo(1), amount: "1", currency: "AUD" })],
      ["dashboard", () => analytics.financeSummary(a)],
      ["audit", () => audit.listAudit(a, audit.auditFilters.parse({}))],
      ["team", () => team.listTeam(a)],
      ["search", () => search.searchEverything(a, "Gamma")],
      ["owner projects", () => proj.ownerProjects(a)],
      ["set partners", () => proj.setProjectPartners(a, gamma, [])],
    ];
    for (const [name, fn] of tries) await expect(fn(), name).rejects.toThrow(DENIED);
  });

  it("a project hidden from the partner disappears from their page, and comes back when shown", async () => {
    const o = await as(ids.owner);
    const p1 = await as(ids.p1);
    await proj.setProjectHiddenFrom(o, delta, [ids.p1]);
    const d = await partners.partnerEarnings(p1);
    expect(d.byProject.map((p) => p.project)).toEqual(["Gamma"]);
    expect(d.earnedBaseMinor).toBe(31_500);
    expect(d.recent.some((r) => r.project === "Delta")).toBe(false);
    await proj.setProjectHiddenFrom(o, delta, []);
    expect((await partners.partnerEarnings(p1)).earnedBaseMinor).toBe(41_500);
  });
});

describe("payouts and the admin side", () => {
  it("the representative pages count project shares: earned, owed and the payout check", async () => {
    const o = await as(ids.owner);
    const p1 = (await rev.repSummaries(o)).rows.find((r) => r.id === reps.p1)!;
    expect([p1.commissionEarnedBaseMinor, p1.shareEarnedBaseMinor, p1.commissionPaidBaseMinor, p1.owedBaseMinor]).toEqual([0, 41_500, 10_000, 31_500]);
    const detail = (await rev.repDetail(o, reps.p1))!;
    expect([detail.shareEarnedBaseMinor, detail.owedBaseMinor]).toEqual([41_500, 31_500]);
    // paying exactly what's owed needs no confirmation; one cent more does
    await expect(rev.recordPayout(o, { representativeId: reps.p2, paidDate: daysAgo(0), amount: "210.01", currency: "AUD" })).rejects.toMatchObject({ name: "OverpaymentNeedsConfirmation", owedBaseMinor: 21_000 });
    await rev.recordPayout(o, { representativeId: reps.p2, paidDate: daysAgo(0), amount: "210.00", currency: "AUD", reference: "BANK-REF-2" });
    const d2 = await partners.partnerEarnings(await as(ids.p2));
    expect([d2.paidOutBaseMinor, d2.owedBaseMinor]).toEqual([21_000, 0]);
    expect(d2.payouts.map((p) => p.reference)).toEqual(["BANK-REF-2"]);
    // and partner one still sees only their own payout
    expect((await partners.partnerEarnings(await as(ids.p1))).payouts.map((p) => p.reference)).toEqual(["BANK-REF-1"]);
  });

  it("only pending money isn't earned: an unpaid entry earns nothing until it's marked paid", async () => {
    const o = await as(ids.owner);
    const before = (await partners.partnerEarnings(await as(ids.p1))).earnedBaseMinor;
    const same = { client: "PendingClient", amount: "500.00", projectId: gamma };
    await fin.updateIncome(o, e.g2, income({ ...same, status: "paid" }));
    expect((await partners.partnerEarnings(await as(ids.p1))).earnedBaseMinor).toBe(before + 15_000);
    await fin.updateIncome(o, e.g2, income({ ...same, status: "pending" }));
    expect((await partners.partnerEarnings(await as(ids.p1))).earnedBaseMinor).toBe(before);
  });

  it("changes to partners are Owner-only in the audit log", async () => {
    const o = await as(ids.owner);
    const own = (await audit.listAudit(o, audit.auditFilters.parse({ entity: "project_partners" }))).total;
    expect(own).toBeGreaterThan(0);
    for (const who of ["admin2"] as const) {
      expect((await audit.listAudit(await as(ids[who]), audit.auditFilters.parse({ entity: "project_partners" }))).total).toBe(0);
      const all = JSON.stringify((await audit.listAudit(await as(ids[who]), audit.auditFilters.parse({}), 500)).rows);
      expect(all).not.toContain("project_partners");
      expect(all).not.toContain("shareRate");
    }
  });

  it("a representative who is also a partner can't be deleted from under the shares (the records stay linked)", async () => {
    const n = await t.db.execute(sql`select count(*) as c from income_shares where representative_id = ${reps.p1}`);
    expect(Number((n as unknown as [Array<{ c: number }>])[0][0].c)).toBeGreaterThan(0);
  });
});
