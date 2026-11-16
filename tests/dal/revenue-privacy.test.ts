import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, countRows, setupTestDatabase } from "./db";

/**
 * Revenue privacy: the Owner hides a project's money from named people.
 * A hidden project must be gone from EVERY place its money could show:
 * ledger, single entries, edits, exports, streams/countries/analytics, top
 * clients, representatives, search, invoice downloads and the audit log.
 * Everything runs against real MySQL with real sessions.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let fin: typeof import("@/lib/dal/finance");
let rev: typeof import("@/lib/dal/revenue");
let analytics: typeof import("@/lib/dal/analytics");
let search: typeof import("@/lib/dal/search");
let audit: typeof import("@/lib/dal/audit");
let files: typeof import("@/lib/dal/files");
let proj: typeof import("@/lib/dal/projects");
let team: typeof import("@/lib/dal/team");

let ids: { owner: string; admin2: string; admin3: string; viewer: string; staffOwn: string; partner: string; plain: string };
let streamId: number;
let alpha: string;
let beta: string;
let repA: string;
let e: { alphaPaid: string; alphaLate: string; betaPaid: string; plain: string };

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
const PDF = (label: string) => ({ name: `${label}.pdf`, bytes: Buffer.from(`%PDF-1.4 ${label}`) });
const as = (id: string) => actorFor(t, id);
const everyone = () => ["admin2", "viewer", "partner"] as const;

beforeAll(async () => {
  t = await setupTestDatabase();
  fin = await import("@/lib/dal/finance");
  rev = await import("@/lib/dal/revenue");
  analytics = await import("@/lib/dal/analytics");
  search = await import("@/lib/dal/search");
  audit = await import("@/lib/dal/audit");
  files = await import("@/lib/dal/files");
  proj = await import("@/lib/dal/projects");
  team = await import("@/lib/dal/team");

  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    admin3: (await createPerson(t, { email: "admin3@example.test", preset: "admin", totp: true })).id,
    viewer: (await createPerson(t, { email: "viewer@example.test" })).id,
    staffOwn: (await createPerson(t, { email: "own@example.test" })).id,
    partner: (await createPerson(t, { email: "partner@example.test" })).id,
    plain: (await createPerson(t, { email: "plain@example.test" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));

  const owner = await as(ids.owner);
  const allPerms = owner.perms;
  const perm = (scope: "own" | "assigned" | "all", extra: Record<string, boolean> = {}) => ({ view: true, create: false, edit: false, delete: false, export: false, ...extra, scope }) as never;
  // viewer: finance access like an admin's, but not an admin
  await team.setPermissions(owner, { userId: ids.viewer, perms: allPerms });
  // staffOwn: own entries only
  await team.setPermissions(owner, { userId: ids.staffOwn, perms: { ...(await as(ids.staffOwn)).perms, transactions: perm("own", { create: true, edit: true, delete: true, export: true }), home: perm("all") } });
  // partner: only deals credited to their rep record
  await team.setPermissions(owner, {
    userId: ids.partner,
    perms: { ...(await as(ids.partner)).perms, home: perm("all"), transactions: perm("assigned", { export: true }), streams: perm("assigned"), countries: perm("assigned"), representatives: perm("assigned"), finances: perm("assigned") },
  });

  const [s] = await t.db.select().from(t.schema.streams).where(eq(t.schema.streams.name, "Upwork"));
  streamId = s.id;
  alpha = await proj.createProject(owner, { streamId, name: "Alpha" });
  beta = await proj.createProject(owner, { streamId, name: "Beta" });
  repA = await rev.saveRep(owner, null, { name: "Rep One", commissionPercent: "10", userId: ids.partner });

  e = {
    alphaPaid: await fin.createIncome(owner, income({ client: "AlphaClient", amount: "1000.00", projectId: alpha, representativeId: repA }), PDF("alpha")),
    alphaLate: await fin.createIncome(owner, income({ client: "AlphaLate", amount: "500.00", status: "pending", projectId: alpha })),
    betaPaid: await fin.createIncome(owner, income({ client: "BetaClient", amount: "200.00", projectId: beta }), PDF("beta")),
    plain: await fin.createIncome(owner, income({ client: "PlainClient", amount: "100.00" })),
  };
  // hide Alpha from three people with very different access
  await proj.setProjectHiddenFrom(owner, alpha, [ids.admin2, ids.viewer, ids.partner]);
});
afterAll(() => t?.cleanup());

describe("before anything is hidden from them", () => {
  it("the Owner and a person Alpha isn't hidden from see everything", async () => {
    for (const who of [ids.owner, ids.admin3]) {
      const a = await as(who);
      const list = await fin.listIncome(a, {}, 100);
      expect(list.rows.map((r) => r.client).sort()).toEqual(["AlphaClient", "AlphaLate", "BetaClient", "PlainClient"]);
      expect(list.paidBaseMinor).toBe(130_000); // 1000 + 200 + 100
      expect(list.outstandingBaseMinor).toBe(50_000);
      expect((await rev.streamSummaries(a, "all")).totalBaseMinor).toBe(130_000);
    }
  });
});

describe("a hidden project's money is invisible on every read path", () => {
  it("ledger: rows, counts and totals leave out the hidden project (for admins, finance viewers and partners alike)", async () => {
    for (const who of ["admin2", "viewer"] as const) {
      const a = await as(ids[who]);
      const list = await fin.listIncome(a, {}, 100);
      expect(list.rows.map((r) => r.client).sort(), who).toEqual(["BetaClient", "PlainClient"]);
      expect(list.total).toBe(2);
      expect(list.paidBaseMinor).toBe(30_000);
      expect(list.outstandingBaseMinor).toBe(0);
      // searching for it by name finds nothing, and filtering by its representative shows nothing
      expect((await fin.listIncome(a, { q: "Alpha" })).total).toBe(0);
      expect((await fin.listIncome(a, { rep: repA })).total).toBe(0);
    }
  });

  it("hiding wins over data scope: a partner with 'assigned' scope loses a deal credited to them, and a creator with 'own' scope loses their own entry", async () => {
    const partner = await as(ids.partner);
    expect((await fin.listIncome(partner, {}, 100)).total).toBe(0);
    const own = await as(ids.staffOwn);
    const mine = await fin.createIncome(own, income({ client: "OwnInBeta", projectId: beta }));
    expect((await fin.listIncome(own, {})).rows.map((r) => r.id)).toEqual([mine]);
    await proj.setProjectHiddenFrom(await as(ids.owner), beta, [ids.staffOwn]);
    expect((await fin.listIncome(own, {})).total).toBe(0);
    expect(await fin.getIncome(own, mine)).toBeNull();
    await expect(fin.updateIncome(own, mine, income({ projectId: beta }))).rejects.toThrow(/isn't yours/);
    await expect(fin.deleteIncome(own, mine)).rejects.toThrow(/isn't yours/);
    await proj.setProjectHiddenFrom(await as(ids.owner), beta, []);
    expect((await fin.listIncome(own, {})).total).toBe(1);
    await fin.deleteIncome(own, mine); // leave the shared totals as they were
  });

  it("single entries: reading, editing and deleting a hidden entry fails exactly like one that doesn't exist, and changes nothing", async () => {
    const before = JSON.stringify(await t.db.select().from(t.schema.incomeEntries));
    for (const who of everyone()) {
      const a = await as(ids[who]);
      expect(await fin.getIncome(a, e.alphaPaid), who).toBeNull();
      if (who === "partner") continue; // the partner has no edit rights to begin with
      await expect(fin.updateIncome(a, e.alphaPaid, income({ amount: "1.00", projectId: alpha })), who).rejects.toThrow(/isn't yours|permission/);
      await expect(fin.deleteIncome(a, e.alphaPaid), who).rejects.toThrow(/isn't yours|permission/);
    }
    expect(JSON.stringify(await t.db.select().from(t.schema.incomeEntries))).toBe(before);
  });

  it("nobody can file income under a project hidden from them, and a hidden project looks like one that doesn't exist", async () => {
    const viewer = await as(ids.viewer);
    await expect(fin.createIncome(viewer, income({ projectId: alpha }))).rejects.toThrow(/Choose a project/);
    await expect(fin.createIncome(viewer, income({ projectId: crypto.randomUUID() }))).rejects.toThrow(/Choose a project/);
    // the same message either way, so it can't be used to find out that Alpha exists
    // and a visible project works, but only under its own stream
    const otherStream = (await t.db.select().from(t.schema.streams)).find((s) => s.id !== streamId)!.id;
    await expect(fin.createIncome(viewer, income({ projectId: beta, streamId: otherStream }))).rejects.toThrow(/different revenue stream/);
    const ok = await fin.createIncome(viewer, income({ client: "ViewerBeta", projectId: beta }));
    expect(ok).toMatch(/^[0-9a-f-]{36}$/);
    await fin.deleteIncome(viewer, ok);
  });

  it("form lookups don't contain the project, not even its name", async () => {
    const viewer = await as(ids.viewer);
    const l = await fin.financeLookups(viewer);
    expect(l.projects.map((p) => p.name)).toEqual(["Beta"]);
    expect(JSON.stringify(l)).not.toContain("Alpha");
    expect((await fin.financeLookups(await as(ids.owner))).projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
  });

  it("exports leave it out", async () => {
    const viewer = await as(ids.viewer);
    const out = await fin.exportIncomeCsv(viewer, {});
    expect(out.rows).toBe(2);
    expect(out.csv).not.toMatch(/Alpha/);
    expect(out.csv).not.toContain("1000.00");
    expect((await fin.exportIncomeCsv(await as(ids.owner), {})).rows).toBe(4);
    const finCsv = await analytics.exportFinanceCsv(viewer);
    expect(finCsv.csv).not.toContain("1000.00");
    expect(finCsv.csv).not.toContain("1500.00");
  });

  it("streams, countries and the finance dashboard total only what they may see", async () => {
    for (const who of ["admin2", "viewer"] as const) {
      const a = await as(ids[who]);
      const streams = await rev.streamSummaries(a, "all");
      expect(streams.totalBaseMinor, who).toBe(30_000);
      expect(streams.outstandingBaseMinor).toBe(0);
      const detail = await rev.streamDetail(a, streamId, "all");
      expect(detail!.revenueBaseMinor).toBe(30_000);
      expect(detail!.topClients.map((c) => c.client).sort()).toEqual(["BetaClient", "PlainClient"]);
      expect((await rev.countrySummaries(a, "all")).totalBaseMinor).toBe(30_000);
      expect((await rev.countryDetail(a, "GB", "all"))!.revenueBaseMinor).toBe(30_000);
      const dash = await analytics.financeSummary(a);
      expect(dash.totals.current.revenueBaseMinor).toBe(30_000);
      expect(dash.totals.current.outstandingBaseMinor).toBe(0);
      expect(dash.topClients.map((c) => c.client).sort()).toEqual(["BetaClient", "PlainClient"]);
      expect(JSON.stringify(dash)).not.toContain("Alpha");
    }
    // the Owner still sees all of it
    const o = await as(ids.owner);
    expect((await rev.streamSummaries(o, "all")).totalBaseMinor).toBe(130_000);
    expect((await analytics.financeSummary(o)).totals.current.revenueBaseMinor).toBe(130_000);
  });

  it("representatives: a deal in a hidden project doesn't count towards their deals, revenue or commission", async () => {
    const viewer = await as(ids.viewer);
    const row = (await rev.repSummaries(viewer)).rows.find((r) => r.id === repA)!;
    expect([row.deals, row.revenueBaseMinor, row.commissionEarnedBaseMinor, row.outstandingBaseMinor]).toEqual([0, 0, 0, 0]);
    const detail = (await rev.repDetail(viewer, repA))!;
    expect(detail.deals).toHaveLength(0);
    expect(detail.revenueBaseMinor).toBe(0);
    expect(JSON.stringify(detail)).not.toContain("AlphaClient");
    // the owner sees the deal and its 10% commission
    const o = (await rev.repSummaries(await as(ids.owner))).rows.find((r) => r.id === repA)!;
    expect([o.deals, o.revenueBaseMinor, o.commissionEarnedBaseMinor]).toEqual([1, 100_000, 10_000]);
  });

  it("search finds nothing about it", async () => {
    const viewer = await as(ids.viewer);
    for (const term of ["AlphaClient", "AlphaLate", "Alpha"]) {
      const groups = (await search.searchEverything(viewer, term)).groups;
      expect(JSON.stringify(groups), term).not.toMatch(/Alpha/);
    }
    const ownerGroups = (await search.searchEverything(await as(ids.owner), "AlphaClient")).groups.map((g) => g.id);
    expect(ownerGroups).toContain("income");
  });

  it("invoice downloads: the file of a hidden entry is gone, even for someone with all-scope access; others still work", async () => {
    const owner = await as(ids.owner);
    const alphaFile = (await fin.getIncome(owner, e.alphaPaid))!.invoiceFileId!;
    const betaFile = (await fin.getIncome(owner, e.betaPaid))!.invoiceFileId!;
    expect(await files.getFileForDownload(owner, alphaFile)).not.toBeNull();
    for (const who of everyone()) {
      const a = await as(ids[who]);
      expect(await files.getFileForDownload(a, alphaFile), who).toBeNull();
    }
    expect(await files.getFileForDownload(await as(ids.viewer), betaFile)).not.toBeNull();
    expect(await files.getFileForDownload(await as(ids.admin3), alphaFile)).not.toBeNull();
  });

  it("the audit log: no income history, project changes or who-sees-what for people it's hidden from", async () => {
    const owner = await as(ids.owner);
    // history that crosses the boundary: moved INTO the hidden project, created there then deleted, moved OUT of it
    const intoAlpha = await fin.createIncome(owner, income({ client: "MovedIn", amount: "11.00" }));
    await fin.updateIncome(owner, intoAlpha, income({ client: "MovedIn", amount: "11.00", projectId: alpha }));
    const gone = await fin.createIncome(owner, income({ client: "CreatedThenDeleted", amount: "22.00", projectId: alpha }));
    await fin.deleteIncome(owner, gone);
    const outOfAlpha = await fin.createIncome(owner, income({ client: "MovedOut", amount: "33.00", projectId: alpha }));
    await fin.updateIncome(owner, outOfAlpha, income({ client: "MovedOut", amount: "33.00", projectId: beta }));

    const everything = JSON.stringify((await audit.listAudit(owner, audit.auditFilters.parse({}), 500)).rows);
    for (const needle of ["AlphaClient", "MovedIn", "CreatedThenDeleted", "MovedOut", "alpha.pdf"]) expect(everything, `owner sees ${needle}`).toContain(needle);

    for (const who of ["admin2", "viewer"] as const) {
      const a = await as(ids[who]);
      const rows = (await audit.listAudit(a, audit.auditFilters.parse({}), 500)).rows;
      const text = JSON.stringify(rows);
      // (the invoice file name "alpha.pdf" is in the audit log as "Uploaded alpha.pdf")
      for (const needle of ["AlphaClient", "AlphaLate", "MovedIn", "CreatedThenDeleted", "MovedOut", "alpha.pdf"]) expect(text, `${who} must not see ${needle}`).not.toContain(needle);
      expect(rows.filter((r) => ["projects", "project_hidden_from"].includes(r.entity)), who).toEqual([]);
      // history of entries they may see is still there
      expect(text).toContain("BetaClient");
      expect(text).toContain("PlainClient");
      expect(text).toContain("beta.pdf"); // an invoice of a project they CAN see is still logged
    }
    // searching the audit log by an entry's id finds nothing either
    const viewer = await as(ids.viewer);
    expect((await audit.listAudit(viewer, audit.auditFilters.parse({ q: e.alphaPaid }))).total).toBe(0);
    expect((await audit.listAudit(owner, audit.auditFilters.parse({ q: e.alphaPaid }))).total).toBeGreaterThan(0);
    // admin3 (Alpha isn't hidden from them) still sees the income history, but not the owner-only visibility changes
    const a3 = JSON.stringify((await audit.listAudit(await as(ids.admin3), audit.auditFilters.parse({}), 500)).rows);
    expect(a3).toContain("AlphaClient");
    expect((await audit.listAudit(await as(ids.admin3), audit.auditFilters.parse({ entity: "project_hidden_from" }))).total).toBe(0);
    // tidy up so later totals stay predictable
    await fin.deleteIncome(owner, intoAlpha);
    await fin.deleteIncome(owner, outOfAlpha);
  });
});

describe("it takes effect immediately and can be undone", () => {
  it("un-hiding shows the money again on the very next request, hiding hides it again", async () => {
    const owner = await as(ids.owner);
    const viewer = await as(ids.viewer); // the same session throughout: nothing is cached
    expect((await fin.listIncome(viewer, {}, 100)).total).toBe(2 + 0);
    await proj.setProjectHidden(owner, { projectId: alpha, userId: ids.viewer, hidden: false });
    const shown = await fin.listIncome(viewer, {}, 100);
    expect(shown.rows.map((r) => r.client)).toEqual(expect.arrayContaining(["AlphaClient", "AlphaLate", "BetaClient", "PlainClient"]));
    expect((await rev.streamSummaries(viewer, "all")).totalBaseMinor).toBeGreaterThanOrEqual(130_000);
    await proj.setProjectHidden(owner, { projectId: alpha, userId: ids.viewer, hidden: true });
    expect((await fin.listIncome(viewer, {}, 100)).rows.map((r) => r.client)).not.toContain("AlphaClient");
  });

  it("an entry moved out of a hidden project becomes visible; one moved into it disappears", async () => {
    const owner = await as(ids.owner);
    const viewer = await as(ids.viewer);
    const moved = await fin.createIncome(owner, income({ client: "Mover", amount: "7.00", projectId: beta }));
    expect((await fin.listIncome(viewer, { q: "Mover" })).total).toBe(1);
    await fin.updateIncome(owner, moved, income({ client: "Mover", amount: "7.00", projectId: alpha }));
    expect((await fin.listIncome(viewer, { q: "Mover" })).total).toBe(0);
    await fin.updateIncome(owner, moved, income({ client: "Mover", amount: "7.00", projectId: beta }));
    expect((await fin.listIncome(viewer, { q: "Mover" })).total).toBe(1);
    await fin.deleteIncome(owner, moved);
  });
});

describe("only the Owner decides who sees what", () => {
  it("other admins, finance viewers, staff and partners can't create projects, hide anything or open the owner's list", async () => {
    const before = { hidden: await countRows(t, "project_hidden_from"), projects: await countRows(t, "projects") };
    for (const who of ["admin2", "admin3", "viewer", "staffOwn", "partner", "plain"] as const) {
      const a = await as(ids[who]);
      const tries: Array<[string, () => Promise<unknown>]> = [
        ["owner list", () => proj.ownerProjects(a)],
        ["create", () => proj.createProject(a, { streamId, name: `Sneaky ${who}` })],
        ["rename", () => proj.renameProject(a, alpha, "Renamed")],
        ["switch off", () => proj.setProjectActive(a, alpha, false)],
        ["delete", () => proj.deleteProject(a, beta)],
        ["hide one", () => proj.setProjectHidden(a, { projectId: beta, userId: ids.plain, hidden: true })],
        ["show one", () => proj.setProjectHidden(a, { projectId: alpha, userId: ids.viewer, hidden: false })],
        ["set the list", () => proj.setProjectHiddenFrom(a, alpha, [])],
      ];
      for (const [name, fn] of tries) await expect(fn(), `${who}: ${name}`).rejects.toThrow(DENIED);
    }
    expect({ hidden: await countRows(t, "project_hidden_from"), projects: await countRows(t, "projects") }).toEqual(before);
    const [row] = await t.db.select().from(t.schema.projects).where(eq(t.schema.projects.id, alpha));
    expect([row.name, row.active]).toEqual(["Alpha", true]);
  });

  it("the Owner can't be hidden from anything, and the Actor only says 'owner' for an admin", async () => {
    const owner = await as(ids.owner);
    await expect(proj.setProjectHidden(owner, { projectId: alpha, userId: ids.owner, hidden: true })).rejects.toThrow(/always sees everything/);
    await expect(proj.setProjectHiddenFrom(owner, alpha, [ids.owner])).rejects.toThrow(/always sees everything/);
    expect(owner.isOwner).toBe(true);
    expect((await as(ids.admin2)).isOwner).toBe(false);
    // an owner flag on someone who isn't an admin counts for nothing
    await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.plain));
    expect((await as(ids.plain)).isOwner).toBe(false);
    await t.db.update(t.schema.users).set({ isOwner: false }).where(eq(t.schema.users.id, ids.plain));
  });

  it("a project with income can't be deleted, only switched off; switched-off projects can't take new income", async () => {
    const owner = await as(ids.owner);
    await expect(proj.deleteProject(owner, alpha)).rejects.toThrow(/Switch it off/);
    const spare = await proj.createProject(owner, { streamId, name: "Spare" });
    await expect(proj.createProject(owner, { streamId, name: "Spare" })).rejects.toThrow(/already has a project/);
    await proj.setProjectActive(owner, spare, false);
    await expect(fin.createIncome(owner, income({ projectId: spare }))).rejects.toThrow(/switched off/);
    await proj.deleteProject(owner, spare);
    expect((await proj.ownerProjects(owner)).projects.map((p) => p.name)).toEqual(["Alpha", "Beta"]);
    const a = (await proj.ownerProjects(owner)).projects.find((p) => p.name === "Alpha")!;
    expect(a.hiddenFrom.sort()).toEqual([ids.admin2, ids.partner, ids.viewer].sort());
  });

  it("the other admins can't touch the Owner's account, and the Owner can't demote or deactivate themselves", async () => {
    const a2 = await as(ids.admin2);
    const mfaBefore = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.id, ids.owner)))[0];
    const tries: Array<[string, () => Promise<unknown>]> = [
      ["role", () => team.applyPreset(a2, { userId: ids.owner, presetId: "staff" })],
      ["permissions", () => team.setPermissions(a2, { userId: ids.owner, perms: a2.perms })],
      ["deactivate", () => team.setActive(a2, { userId: ids.owner, active: false })],
      ["end sessions", () => team.resetSessions(a2, ids.owner)],
      ["reset two-factor", () => team.resetTwoFactor(a2, ids.owner)],
      ["rename", () => team.setDetails(a2, { userId: ids.owner, fullName: "Hacked", jobTitle: "x" })],
    ];
    for (const [name, fn] of tries) await expect(fn(), name).rejects.toThrow(/Only the owner/);
    const o = await as(ids.owner);
    await expect(team.applyPreset(o, { userId: ids.owner, presetId: "staff" })).rejects.toThrow(/stay an admin/);
    await expect(team.setPermissions(o, { userId: ids.owner, perms: (await as(ids.plain)).perms })).rejects.toThrow(/stay an admin/);
    const mfaAfter = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.id, ids.owner)))[0];
    expect(mfaAfter.totpSecretEnc).toBe(mfaBefore.totpSecretEnc);
    expect(mfaAfter.presetId).toBe("admin");
    expect(mfaAfter.status).toBe("active");
    // the team list marks who the owner is
    expect((await team.listTeam(o)).members.filter((m) => m.isOwner).map((m) => m.email)).toEqual(["owner@example.test"]);
  });
});

describe("how the Owner is created", () => {
  it("the first-admin SQL file makes the first admin the Owner", async () => {
    const { buildFirstAdminSql } = await import("../../scripts/lib/first-admin-sql");
    const sqlText = buildFirstAdminSql({ id: crypto.randomUUID(), email: "first@corenovait.test", fullName: "First", passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$abc$def", now: new Date() });
    expect(sqlText).toContain("`is_owner`");
    expect(sqlText).toMatch(/1, 1, 0,/); // mfa_required, is_owner, failed_logins
  });

  it("the migration makes the oldest active admin of an existing portal the Owner, and only one", async () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, "../../drizzle/0011_revenue_privacy.sql"), "utf8");
    const update = migration.split("--> statement-breakpoint").map((s) => s.trim()).find((s) => /UPDATE `users` SET `is_owner` = 1/.test(s))!;
    expect(update).toBeTruthy();
    // an existing portal: nobody is an owner yet, the oldest admin signed up first
    await t.db.update(t.schema.users).set({ isOwner: false });
    await t.db.update(t.schema.users).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(t.schema.users.id, ids.admin3));
    await t.db.execute(sql.raw(update));
    const owners = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.isOwner, true))).map((u) => u.id);
    expect(owners).toEqual([ids.admin3]);
    // put the test setup back
    await t.db.update(t.schema.users).set({ isOwner: false });
    await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  });
});
