import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase, userRow } from "./db";

/**
 * Phase 1 of partners: the two new roles, the streams and countries an admin
 * gives a partner, and the shared scoped-query helper (lib/dal/scope.ts) that
 * decides which ROWS they may touch. Real MySQL, real sessions.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let team: typeof import("@/lib/dal/team");
let assign: typeof import("@/lib/dal/assignments");
let scope: typeof import("@/lib/dal/scope");
let mine: typeof import("@/lib/dal/stream-partners");
let proj: typeof import("@/lib/dal/projects");
let fin: typeof import("@/lib/dal/finance");
let analytics: typeof import("@/lib/dal/analytics");
let payments: typeof import("@/lib/dal/payments");
let tasks: typeof import("@/lib/dal/tasks");
let partners: typeof import("@/lib/dal/partners");
let preview: typeof import("@/lib/dal/preview");
let authMod: typeof import("@/lib/dal/auth");

const DENIED = /permission|two-factor|session|owner|admins|no longer exists/i;
const as = (id: string) => actorFor(t, id);

let ids: Record<"owner" | "admin2" | "staff" | "oldPartner" | "sp1" | "sp2" | "sp3" | "emp", string>;
let S: Record<"upwork" | "fiverr" | "pph" | "web", number>;

const auditRows = (entity: string, entityId?: string) =>
  t.db
    .select()
    .from(t.schema.auditLog)
    .where(entityId ? and(eq(t.schema.auditLog.entity, entity), eq(t.schema.auditLog.entityId, entityId)) : eq(t.schema.auditLog.entity, entity));

async function streamIdsOf(userId: string) {
  return (await t.db.select({ id: t.schema.streamPartnerStreams.streamId }).from(t.schema.streamPartnerStreams).where(eq(t.schema.streamPartnerStreams.userId, userId))).map((r) => r.id).sort();
}
async function countriesOf(userId: string) {
  return (await t.db.select({ c: t.schema.streamPartnerCountries.countryCode }).from(t.schema.streamPartnerCountries).where(eq(t.schema.streamPartnerCountries.userId, userId))).map((r) => r.c).sort();
}

beforeAll(async () => {
  t = await setupTestDatabase();
  team = await import("@/lib/dal/team");
  assign = await import("@/lib/dal/assignments");
  scope = await import("@/lib/dal/scope");
  mine = await import("@/lib/dal/stream-partners");
  proj = await import("@/lib/dal/projects");
  fin = await import("@/lib/dal/finance");
  analytics = await import("@/lib/dal/analytics");
  payments = await import("@/lib/dal/payments");
  tasks = await import("@/lib/dal/tasks");
  partners = await import("@/lib/dal/partners");
  preview = await import("@/lib/dal/preview");
  authMod = await import("@/lib/dal/auth");

  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin2: (await createPerson(t, { email: "admin2@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    oldPartner: (await createPerson(t, { email: "oldpartner@example.test", preset: "partner" })).id,
    sp1: (await createPerson(t, { email: "sp1@example.test", preset: "stream_partner" })).id,
    sp2: (await createPerson(t, { email: "sp2@example.test", preset: "stream_partner" })).id,
    sp3: (await createPerson(t, { email: "sp3@example.test", preset: "stream_partner" })).id,
    emp: (await createPerson(t, { email: "emp@example.test", preset: "employee" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour"), web: sid("Website direct") };
});
afterAll(() => t?.cleanup());

describe("the roles", () => {
  it("leaves the old Partner preset exactly as it was", async () => {
    const [preset] = await t.db.select().from(t.schema.rolePresets).where(eq(t.schema.rolePresets.id, "partner"));
    expect(preset).toMatchObject({ id: "partner", name: "Partner", sort: 36 });
    const perms = await t.db.select().from(t.schema.presetPermissions).where(eq(t.schema.presetPermissions.presetId, "partner"));
    expect(perms).toEqual([{ presetId: "partner", module: "partner", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: false, scope: "own" }]);
    const person = await as(ids.oldPartner);
    expect(person.scoped).toBeNull();
    expect((await userRow(t, ids.oldPartner)).mfaRequired).toBe(true);
  });

  it("adds the Partner and Employee presets, each with only its own module", async () => {
    for (const [id, module] of [["stream_partner", "stream_partner"], ["employee", "employee"]] as const) {
      const perms = await t.db.select().from(t.schema.presetPermissions).where(eq(t.schema.presetPermissions.presetId, id));
      expect(perms).toEqual([{ presetId: id, module, canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false, scope: "own" }]);
    }
    const sp = await as(ids.sp1);
    const emp = await as(ids.emp);
    for (const actor of [sp, emp]) {
      const granted = Object.entries(actor.perms).filter(([, p]) => p.view || p.create || p.edit || p.delete || p.export).map(([m]) => m);
      expect(granted).toEqual([actor === sp ? "stream_partner" : "employee"]);
    }
  });

  it("requires two-factor for partners (not for employees)", async () => {
    expect((await userRow(t, ids.sp1)).mfaRequired).toBe(true);
    expect((await userRow(t, ids.emp)).mfaRequired).toBe(false);
  });

  it("is not a way to get company data: every older page and query refuses both roles", async () => {
    for (const who of [ids.sp1, ids.emp]) {
      const a = await as(who);
      await expect(fin.listIncome(a, {}, 1)).rejects.toThrow(DENIED);
      await expect(analytics.financeSummary(a)).rejects.toThrow(DENIED);
      await expect(payments.paymentsOverview(a)).rejects.toThrow(DENIED);
      await expect(tasks.listTasks(a)).rejects.toThrow(DENIED);
      await expect(tasks.myOpenTasks(a)).rejects.toThrow(DENIED);
      await expect(team.listTeam(a)).rejects.toThrow(DENIED);
      await expect(partners.partnerEarnings(a)).rejects.toThrow(DENIED);
      await expect(proj.createProject(a, { streamId: S.upwork, name: "Nope" })).rejects.toThrow(DENIED);
    }
  });

  it("can't be handed company-wide permissions by hand, and the presets can't be edited", async () => {
    const owner = await as(ids.owner);
    const sp = await as(ids.sp1);
    const perms = { ...sp.perms, transactions: { view: true, create: true, edit: true, delete: true, export: true, scope: "all" as const } };
    await expect(team.setPermissions(owner, { userId: ids.sp1, perms })).rejects.toThrow(/fixed/i);
    await expect(team.setPermissions(owner, { userId: ids.emp, perms })).rejects.toThrow(/fixed/i);
    await expect(team.updatePreset(owner, { presetId: "stream_partner", perms })).rejects.toThrow(/can't be edited/i);
    await expect(team.updatePreset(owner, { presetId: "employee", perms })).rejects.toThrow(/can't be edited/i);
    // a staff member can't be made into a "custom partner" either
    const staff = await as(ids.staff);
    const viaCustom = { ...staff.perms, stream_partner: { view: true, create: true, edit: true, delete: false, export: false, scope: "own" as const } };
    await expect(team.setPermissions(owner, { userId: ids.staff, perms: viaCustom })).rejects.toThrow(/only come from those roles/i);
    expect((await userRow(t, ids.sp1)).presetId).toBe("stream_partner");
    const list = await team.listTeam(owner);
    expect(list.presets.find((p) => p.id === "stream_partner")?.editable).toBe(false);
    expect(list.presets.find((p) => p.id === "employee")?.editable).toBe(false);
  });
});

describe("the Employee role", () => {
  it("is only given by inviting someone as an employee of a partner", async () => {
    const owner = await as(ids.owner);
    await expect(team.inviteUser(owner, { email: "early.emp@example.test", fullName: "E", jobTitle: "", presetId: "employee" })).rejects.toThrow(/choose which partner/i);
    await expect(team.applyPreset(owner, { userId: ids.staff, presetId: "employee" })).rejects.toThrow(/invite them as an employee/i);
    expect((await userRow(t, ids.staff)).presetId).toBe("staff");
  });
});

describe("giving a partner streams and countries", () => {
  it("only an admin can do it; a partner can't change their own", async () => {
    for (const who of [ids.staff, ids.sp1, ids.emp, ids.oldPartner]) {
      const a = await as(who);
      await expect(assign.setAssignments(a, { userId: ids.sp1, streamIds: [S.upwork, S.fiverr], countryCodes: ["GB", "AU"] })).rejects.toThrow(DENIED);
    }
    await expect(assign.assignmentOverview(await as(ids.sp1))).rejects.toThrow(DENIED);
    expect(await streamIdsOf(ids.sp1)).toEqual([]);
  });

  it("assigns streams and countries, and logs before and after", async () => {
    const owner = await as(ids.owner);
    await assign.setAssignments(owner, { userId: ids.sp1, streamIds: [S.upwork, S.fiverr], countryCodes: ["GB"] });
    expect(await streamIdsOf(ids.sp1)).toEqual([S.upwork, S.fiverr].sort());
    expect(await countriesOf(ids.sp1)).toEqual(["GB"]);
    const streamsLog = await auditRows("stream_partner_streams", ids.sp1);
    expect(streamsLog).toHaveLength(1);
    expect(streamsLog[0]).toMatchObject({ action: "assign", actorId: ids.owner, before: { streamIds: [], streams: [] }, after: { streams: ["Fiverr", "Upwork"] } });
    const countriesLog = await auditRows("stream_partner_countries", ids.sp1);
    expect(countriesLog[0]).toMatchObject({ before: { countryCodes: [] }, after: { countryCodes: ["GB"] } });

    // the change shows on the person's very next request
    const sp = await as(ids.sp1);
    expect(sp.scoped).toEqual({ kind: "stream_partner", streamIds: [S.upwork, S.fiverr].sort(), countryCodes: ["GB"] });
    // saving the same thing again writes nothing more
    await assign.setAssignments(owner, { userId: ids.sp1, streamIds: [S.upwork, S.fiverr], countryCodes: ["GB"] });
    expect(await auditRows("stream_partner_streams", ids.sp1)).toHaveLength(1);
  });

  it("allows only one partner per stream, and says whose it is", async () => {
    const owner = await as(ids.owner);
    await expect(assign.setAssignments(owner, { userId: ids.sp2, streamIds: [S.fiverr], countryCodes: ["AU"] })).rejects.toThrow(/Fiverr already belongs to sp1.*only one partner/i);
    expect(await streamIdsOf(ids.sp2)).toEqual([]);
    expect(await countriesOf(ids.sp2)).toEqual([]);
    // the database says the same, whatever the app does
    await expect(t.db.insert(t.schema.streamPartnerStreams).values({ streamId: S.fiverr, userId: ids.sp2 })).rejects.toThrow();
  });

  it("handles two admins claiming the same free stream at the same moment: exactly one wins", async () => {
    const [a1, a2] = [await as(ids.owner), await as(ids.admin2)];
    const results = await Promise.allSettled([
      assign.setAssignments(a1, { userId: ids.sp2, streamIds: [S.pph], countryCodes: ["AU"] }),
      assign.setAssignments(a2, { userId: ids.sp3, streamIds: [S.pph], countryCodes: ["AU"] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ name: "RuleError" });
    const holders = await t.db.select().from(t.schema.streamPartnerStreams).where(eq(t.schema.streamPartnerStreams.streamId, S.pph));
    expect(holders).toHaveLength(1);
    // put things back for the tests below
    const owner = await as(ids.owner);
    await assign.setAssignments(owner, { userId: ids.sp2, streamIds: [], countryCodes: [] });
    await assign.setAssignments(owner, { userId: ids.sp3, streamIds: [], countryCodes: [] });
    expect(await streamIdsOf(ids.sp2)).toEqual([]);
    expect(await streamIdsOf(ids.sp3)).toEqual([]);
  });

  it("refuses streams or countries that don't exist, and people who aren't partners", async () => {
    const owner = await as(ids.owner);
    await expect(assign.setAssignments(owner, { userId: ids.sp2, streamIds: [99999], countryCodes: ["AU"] })).rejects.toThrow(/choose streams from the list/i);
    await expect(assign.setAssignments(owner, { userId: ids.sp2, streamIds: [S.pph], countryCodes: ["ZZ"] })).rejects.toThrow(/choose countries from the list/i);
    await expect(assign.setAssignments(owner, { userId: ids.staff, streamIds: [S.pph], countryCodes: ["GB"] })).rejects.toThrow(/only partners/i);
    await expect(assign.setAssignments(owner, { userId: ids.emp, streamIds: [S.pph], countryCodes: ["GB"] })).rejects.toThrow(/only partners/i);
    expect(await streamIdsOf(ids.sp2)).toEqual([]);
  });

  it("changes are logged too, and moving a stream to another partner works once it is free", async () => {
    const owner = await as(ids.owner);
    await assign.setAssignments(owner, { userId: ids.sp1, streamIds: [S.upwork], countryCodes: ["GB", "AU"] });
    const log = await auditRows("stream_partner_streams", ids.sp1);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ before: { streams: ["Fiverr", "Upwork"] }, after: { streams: ["Upwork"] } });
    await assign.setAssignments(owner, { userId: ids.sp2, streamIds: [S.fiverr], countryCodes: ["AU"] });
    expect(await streamIdsOf(ids.sp2)).toEqual([S.fiverr]);
  });

  it("can set streams and countries when inviting, all or nothing", async () => {
    const owner = await as(ids.owner);
    const inv = await team.inviteUser(owner, { email: "new.partner@example.test", fullName: "New Partner", jobTitle: "", presetId: "stream_partner", streamIds: [S.web], countryCodes: ["OTHER"] });
    expect(await streamIdsOf(inv.userId)).toEqual([S.web]);
    expect(await countriesOf(inv.userId)).toEqual(["OTHER"]);
    expect((await userRow(t, inv.userId)).mfaRequired).toBe(true);

    // a taken stream refuses the whole invite: no half-created account is left behind
    await expect(
      team.inviteUser(owner, { email: "second.partner@example.test", fullName: "Second", jobTitle: "", presetId: "stream_partner", streamIds: [S.web], countryCodes: ["GB"] })
    ).rejects.toThrow(/already belongs to/i);
    const [ghost] = await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "second.partner@example.test"));
    expect(ghost).toBeUndefined();

    // streams and countries belong to partners only
    await expect(team.inviteUser(owner, { email: "x@example.test", fullName: "X", jobTitle: "", presetId: "staff", streamIds: [S.pph], countryCodes: [] })).rejects.toThrow(/only for partners/i);
    // a partner invited with nothing assigned simply sees nothing until an admin assigns something
    const blank = await team.inviteUser(owner, { email: "blank.partner@example.test", fullName: "Blank", jobTitle: "", presetId: "stream_partner" });
    expect(await streamIdsOf(blank.userId)).toEqual([]);
  });

  it("frees the streams when someone stops being a partner (and says so in the log)", async () => {
    const owner = await as(ids.owner);
    const inv = await team.inviteUser(owner, { email: "leaving@example.test", fullName: "Leaving", jobTitle: "", presetId: "stream_partner", streamIds: [S.pph], countryCodes: ["GB"] });
    await team.applyPreset(owner, { userId: inv.userId, presetId: "staff" });
    expect(await streamIdsOf(inv.userId)).toEqual([]);
    expect(await countriesOf(inv.userId)).toEqual([]);
    const log = await auditRows("stream_partner_streams", inv.userId);
    expect(log.map((r) => r.after)).toEqual([{ streamIds: [S.pph], streams: ["PeoplePerHour"] }, { streamIds: [], streams: [] }]);
    // the stream can be given to someone else straight away
    await assign.setAssignments(owner, { userId: ids.sp3, streamIds: [S.pph], countryCodes: ["GB"] });
    expect(await streamIdsOf(ids.sp3)).toEqual([S.pph]);
  });

  it("works with 'What would this person see?' for the new roles", async () => {
    const owner = await as(ids.owner);
    const actor = await authMod.previewActorFor(owner, ids.sp1);
    expect(actor?.scoped).toEqual({ kind: "stream_partner", streamIds: [S.upwork], countryCodes: ["AU", "GB"] });
    const emp = await authMod.previewActorFor(owner, ids.emp);
    expect(emp?.scoped).toEqual({ kind: "employee", partnerUserId: null, projectIds: [] });
    await expect(authMod.previewActorFor(await as(ids.admin2), ids.sp1)).rejects.toThrow(DENIED);
    const summary = await preview.previewAccess(owner, ids.sp1);
    expect(summary.notes.join(" ")).toMatch(/BOTH an assigned stream and an assigned country/);
  });
});

describe("the shared scoped-query helper", () => {
  // partner A: Upwork + GB.  partner B: Fiverr + AU.  partner C: streams but no country.  partner D: a country but no streams.
  let a: Awaited<ReturnType<typeof as>>;
  let b: Awaited<ReturnType<typeof as>>;
  let c: Awaited<ReturnType<typeof as>>;
  let d: Awaited<ReturnType<typeof as>>;
  let row: Record<string, string>;
  let proj1: string;
  let proj2: string;
  let task: Record<string, string>;

  const expenseRow = (over: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    expenseDate: "2026-10-01",
    category: "Software",
    amountMinor: 1000,
    currency: "AUD",
    fxRateToBase: "1",
    createdBy: ids.owner,
    ...over,
  });
  const visibleExpenses = async (actor: typeof a) =>
    (await t.db.select({ id: t.schema.expenses.id }).from(t.schema.expenses).where(scope.moneyRowsWhere(actor, { streamId: t.schema.expenses.streamId, countryCode: t.schema.expenses.countryCode }))).map((r) => r.id).sort();
  const visibleTasks = async (actor: typeof a) =>
    (
      await t.db
        .select({ id: t.schema.tasks.id })
        .from(t.schema.tasks)
        .where(and(scope.streamRowsWhere(actor, { streamId: t.schema.tasks.streamId }), scope.notHiddenFrom(t.db, actor, t.schema.tasks.projectId)))
    )
      .map((r) => r.id)
      .sort();

  beforeAll(async () => {
    const owner = await as(ids.owner);
    // reset everything the earlier describe left behind, then build the four partners
    for (const u of [ids.sp1, ids.sp2, ids.sp3]) await assign.setAssignments(owner, { userId: u, streamIds: [], countryCodes: [] });
    const sp4 = (await createPerson(t, { email: "sp4@example.test", preset: "stream_partner" })).id;
    await assign.setAssignments(owner, { userId: ids.sp1, streamIds: [S.upwork], countryCodes: ["GB"] });
    await assign.setAssignments(owner, { userId: ids.sp2, streamIds: [S.fiverr], countryCodes: ["AU"] });
    await assign.setAssignments(owner, { userId: ids.sp3, streamIds: [S.pph], countryCodes: [] });
    await assign.setAssignments(owner, { userId: sp4, streamIds: [], countryCodes: ["GB"] });
    [a, b, c, d] = [await as(ids.sp1), await as(ids.sp2), await as(ids.sp3), await as(sp4)];

    // money rows
    const rows = {
      aMatch: expenseRow({ streamId: S.upwork, countryCode: "GB" }),
      aWrongCountry: expenseRow({ streamId: S.upwork, countryCode: "AU" }),
      aNoCountry: expenseRow({ streamId: S.upwork, countryCode: null }),
      bMatch: expenseRow({ streamId: S.fiverr, countryCode: "AU" }),
      bWrongStream: expenseRow({ streamId: S.upwork, countryCode: "AU" }),
      noStream: expenseRow({ streamId: null, countryCode: "GB" }),
      cStreamOnly: expenseRow({ streamId: S.pph, countryCode: "GB" }),
    };
    await t.db.insert(t.schema.expenses).values(Object.values(rows));
    row = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.id]));

    // projects and tasks (stream only)
    proj1 = await proj.createProject(owner, { streamId: S.upwork, name: "Visible project" });
    proj2 = await proj.createProject(owner, { streamId: S.upwork, name: "Hidden from A" });
    await proj.setProjectHidden(owner, { projectId: proj2, userId: ids.sp1, hidden: true });
    const task1 = (over: Record<string, unknown>) => ({ id: crypto.randomUUID(), title: "T", createdBy: ids.owner, ...over });
    const trows = {
      aTask: task1({ streamId: S.upwork }),
      aTaskInProject: task1({ streamId: S.upwork, projectId: proj1 }),
      aTaskInHiddenProject: task1({ streamId: S.upwork, projectId: proj2 }),
      bTask: task1({ streamId: S.fiverr }),
      cTask: task1({ streamId: S.pph }),
      companyTask: task1({}),
    };
    await t.db.insert(t.schema.tasks).values(Object.values(trows));
    task = Object.fromEntries(Object.entries(trows).map(([k, v]) => [k, v.id]));
  });

  it("money rows need the stream AND the country; nothing else matches", async () => {
    expect(await visibleExpenses(a)).toEqual([row.aMatch]);
    expect(await visibleExpenses(b)).toEqual([row.bMatch]);
  });

  it("no countries = nothing, and no streams = nothing", async () => {
    expect(await visibleExpenses(c)).toEqual([]);
    expect(await visibleExpenses(d)).toEqual([]);
    expect(scope.partnerScope(c).hasData).toBe(false);
    expect(scope.partnerScope(d).hasData).toBe(false);
    expect(await visibleTasks(c)).toEqual([]);
    expect(await visibleTasks(d)).toEqual([]);
  });

  it("projects and tasks need the stream only (and a country), and hidden projects take their tasks with them", async () => {
    expect(await visibleTasks(a)).toEqual([task.aTask, task.aTaskInProject].sort());
    expect(await visibleTasks(b)).toEqual([task.bTask]);
    const projectsOfA = await t.db
      .select({ id: t.schema.projects.id })
      .from(t.schema.projects)
      .where(and(scope.streamRowsWhere(a, { streamId: t.schema.projects.streamId }), scope.notHiddenFrom(t.db, a, t.schema.projects.id)));
    expect(projectsOfA.map((p) => p.id)).toEqual([proj1]);
    // the Owner hiding it from A does not hide it from B, who has no access to Upwork anyway
    const hiddenForB = await t.db.select({ id: t.schema.projects.id }).from(t.schema.projects).where(and(scope.streamRowsWhere(b, { streamId: t.schema.projects.streamId }), scope.notHiddenFrom(t.db, b, t.schema.projects.id)));
    expect(hiddenForB).toEqual([]);
  });

  it("hidden-project filtering also covers income rows", async () => {
    const owner = await as(ids.owner);
    const ok = await fin.createIncome(owner, { entryDate: "2026-10-02", streamId: S.upwork, countryCode: "GB", client: "Visible", amount: "10", currency: "AUD", fxRate: "1", status: "paid", projectId: proj1 });
    const secret = await fin.createIncome(owner, { entryDate: "2026-10-02", streamId: S.upwork, countryCode: "GB", client: "Hidden", amount: "99", currency: "AUD", fxRate: "1", status: "paid", projectId: proj2 });
    const plain = await fin.createIncome(owner, { entryDate: "2026-10-02", streamId: S.upwork, countryCode: "GB", client: "NoProject", amount: "5", currency: "AUD", fxRate: "1", status: "paid" });
    const seen = await t.db
      .select({ id: t.schema.incomeEntries.id })
      .from(t.schema.incomeEntries)
      .where(and(scope.moneyRowsWhere(a, { streamId: t.schema.incomeEntries.streamId, countryCode: t.schema.incomeEntries.countryCode }), scope.notHiddenFrom(t.db, a, t.schema.incomeEntries.projectId)));
    expect(seen.map((r) => r.id).sort()).toEqual([ok, plain].sort());
    expect(seen.map((r) => r.id)).not.toContain(secret);
    expect(scope.notHiddenFrom(t.db, owner, t.schema.incomeEntries.projectId)).toBeUndefined();
  });

  it("one partner can't read or write another's stream: the answer is the same as for a stream that doesn't exist", async () => {
    expect(() => scope.assertStreamAllowed(a, S.upwork)).not.toThrow();
    const other = (() => {
      try {
        scope.assertStreamAllowed(a, S.fiverr);
      } catch (e) {
        return e as Error;
      }
    })();
    const missing = (() => {
      try {
        scope.assertStreamAllowed(a, 987654);
      } catch (e) {
        return e as Error;
      }
    })();
    expect(other).toBeInstanceOf(scope.NotFound);
    expect(other?.message).toBe(missing?.message);
    expect(() => scope.assertCountryAllowed(a, "GB")).not.toThrow();
    expect(() => scope.assertCountryAllowed(a, "AU")).toThrow(scope.NotFound);
    expect(() => scope.assertCountryAllowed(a, null)).toThrow(scope.NotFound);
    // without a country nothing can be written, even to their own stream
    expect(() => scope.assertStreamAllowed(c, S.pph)).toThrow(scope.NotFound);
    expect(() => scope.assertStreamAllowed(d, S.upwork)).toThrow(scope.NotFound);
  });

  it("is only for partners (and employees for their own helper)", async () => {
    const cols = { streamId: t.schema.expenses.streamId, countryCode: t.schema.expenses.countryCode };
    for (const who of [ids.owner, ids.admin2, ids.staff, ids.oldPartner, ids.emp]) {
      const actor = await as(who);
      expect(() => scope.partnerScope(actor), who).toThrow(DENIED);
      expect(() => scope.moneyRowsWhere(actor, cols), who).toThrow(DENIED);
    }
    for (const who of [ids.owner, ids.staff, ids.oldPartner, ids.sp1]) {
      const actor = await as(who);
      expect(() => scope.employeeProjectsWhere(actor, t.schema.tasks.projectId), who).toThrow(DENIED);
    }
    const emp = await as(ids.emp);
    // an employee with no projects matches nothing at all
    const none = await t.db.select({ id: t.schema.tasks.id }).from(t.schema.tasks).where(scope.employeeProjectsWhere(emp, t.schema.tasks.projectId));
    expect(none).toEqual([]);
  });

  it("shows a partner only their own assignment on their page", async () => {
    expect(await mine.myAssignments(a)).toEqual({ streams: [{ id: S.upwork, name: "Upwork" }], countries: [{ code: "GB", name: "United Kingdom" }], hasData: true });
    expect(await mine.myAssignments(c)).toMatchObject({ hasData: false, countries: [] });
    expect(await mine.myAssignments(d)).toMatchObject({ hasData: false, streams: [] });
    await expect(mine.myAssignments(await as(ids.staff))).rejects.toThrow(DENIED);
    await expect(mine.myAssignments(await as(ids.emp))).rejects.toThrow(DENIED);
    await expect(mine.myAssignments(await as(ids.owner))).rejects.toThrow(DENIED);
  });

  it("a partner who is deactivated or loses the role sees nothing on their next request", async () => {
    const owner = await as(ids.owner);
    await team.applyPreset(owner, { userId: ids.sp3, presetId: "staff" });
    const stale = await as(ids.sp3);
    expect(stale.scoped).toBeNull();
    expect(() => scope.partnerScope(stale)).toThrow(DENIED);
  });
});

describe("the code", () => {
  const read = (rel: string) => readFileSync(path.resolve(import.meta.dirname, "../..", rel), "utf8");

  it("reads a partner's data only through the shared helper", () => {
    const src = read("lib/dal/stream-partners.ts");
    expect(src).toMatch(/from "\.\/scope"/);
    // it never touches a company table itself
    expect(src).not.toMatch(/incomeEntries|expenses\b|subscriptions|tasks\b|projects\b|incomePayments/);
  });

  it("every data file written for partners and employees goes through the shared helper", () => {
    const dir = path.resolve(import.meta.dirname, "../../lib/dal");
    const scoped = readdirSync(dir).filter((f) => /^(stream-partners|partner-|employee-)/.test(f));
    expect(scoped).toEqual(expect.arrayContaining(["stream-partners.ts", "partner-dashboard.ts"]));
    for (const f of scoped) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).toMatch(/from "\.\/scope"/);
      // company tables are only ever filtered through the helper's conditions
      if (/schema\.(incomeEntries|expenses|subscriptions|tasks|projects)|(incomeEntries|expenses|subscriptions|tasks|projects).*from\(/.test(src) || /\.from\((incomeEntries|expenses|subscriptions|tasks|projects)\)/.test(src)) {
        expect(src, f).toMatch(/moneyRowsWhere|streamRowsWhere|employeeProjectsWhere/);
      }
    }
  });

  it("keeps the Actor's scope out of the database layer's reach", () => {
    const guard = read("lib/dal/guard.ts");
    expect(guard).toMatch(/scoped: ActorScope \| null/);
    // only auth.ts builds actors, and it fills the scope from the assignment tables
    expect(read("lib/dal/auth.ts")).toMatch(/loadActorScope/);
  });
});
