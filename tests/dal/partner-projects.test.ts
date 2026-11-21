import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Partners manage projects in their own streams only; employees are put on them; Owner-only things stay Owner-only. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let pp: typeof import("@/lib/dal/partner-projects");
let emp: typeof import("@/lib/dal/partner-employees");
let ap: typeof import("@/lib/dal/admin-partners");
let proj: typeof import("@/lib/dal/projects");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "staff" | "oldPartner" | "a" | "b" | "bare", string>;
let S: Record<"upwork" | "fiverr" | "pph", number>;
let eA1: string;
let eA2: string;
let eB1: string;
let ownerMade: string;
let ownerHidden: string;

const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const person = (email: string) => ({ email, fullName: email.split("@")[0], jobTitle: "" });
const project = async (id: string) => (await t.db.select().from(t.schema.projects).where(eq(t.schema.projects.id, id)))[0];
const members = async (id: string) => (await t.db.select().from(t.schema.projectMembers).where(eq(t.schema.projectMembers.projectId, id))).map((m) => m.userId).sort();
const auditFor = (id: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));

beforeAll(async () => {
  t = await setupTestDatabase();
  pp = await import("@/lib/dal/partner-projects");
  emp = await import("@/lib/dal/partner-employees");
  ap = await import("@/lib/dal/admin-partners");
  proj = await import("@/lib/dal/projects");
  assign = await import("@/lib/dal/assignments");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    oldPartner: (await createPerson(t, { email: "old@example.test", preset: "partner" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    bare: (await createPerson(t, { email: "bare@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  const sid = (n: string) => rows.find((r) => r.name === n)!.id;
  S = { upwork: sid("Upwork"), fiverr: sid("Fiverr"), pph: sid("PeoplePerHour") };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  await assign.setAssignments(owner, { userId: ids.bare, streamIds: [S.pph], countryCodes: [] });
  eA1 = (await emp.inviteMyEmployee(await as(ids.a), person("ea1@example.test"))).userId;
  eA2 = (await emp.inviteMyEmployee(await as(ids.a), person("ea2@example.test"))).userId;
  eB1 = (await emp.inviteMyEmployee(await as(ids.b), person("eb1@example.test"))).userId;
  ownerMade = await proj.createProject(owner, { streamId: S.upwork, name: "Owner made" });
  ownerHidden = await proj.createProject(owner, { streamId: S.upwork, name: "Owner hid this" });
  await proj.setProjectHidden(owner, { projectId: ownerHidden, userId: ids.a, hidden: true });
});
afterAll(() => t?.cleanup());

describe("seeing and creating projects", () => {
  it("a partner sees projects in their own streams, but not other streams' or ones the Owner hid from them", async () => {
    const a = await as(ids.a);
    await pp.createMyProject(await as(ids.b), { streamId: S.fiverr, name: "B's project" });
    const names = (await pp.myProjects(a)).map((p) => p.name);
    expect(names).toEqual(["Owner made"]);
    expect(JSON.stringify(await pp.myProjects(a))).not.toMatch(/share|hidden|rate|percent/i);
  });

  it("creates in their own stream, logged under partner_projects; refuses other streams and a partner with no country", async () => {
    const a = await as(ids.a);
    const id = await pp.createMyProject(a, { streamId: S.upwork, name: "  New   brand site " });
    expect(await project(id)).toMatchObject({ name: "New brand site", streamId: S.upwork, active: true, teamVisible: false, createdBy: ids.a });
    const log = await auditFor(id);
    expect(log[0]).toMatchObject({ action: "create", entity: "partner_projects", actorId: ids.a });
    await expect(pp.createMyProject(a, { streamId: S.fiverr, name: "Sneaky" })).rejects.toThrow(/no longer exists/);
    expect(await msg(pp.createMyProject(a, { streamId: S.fiverr, name: "Sneaky" }))).toBe(await msg(pp.createMyProject(a, { streamId: 987654, name: "Sneaky" })));
    await expect(pp.createMyProject(await as(ids.bare), { streamId: S.pph, name: "Nope" })).rejects.toThrow(/no longer exists/);
    await expect(pp.createMyProject(a, { streamId: S.upwork, name: "   " })).rejects.toThrow(/name/i);
  });

  it("gives the same 'can't be used' answer for a name that's taken openly and one taken by a project hidden from them", async () => {
    const a = await as(ids.a);
    const visibleClash = await msg(pp.createMyProject(a, { streamId: S.upwork, name: "Owner made" }));
    const hiddenClash = await msg(pp.createMyProject(a, { streamId: S.upwork, name: "Owner hid this" }));
    expect(visibleClash).toMatch(/can't be used/);
    expect(hiddenClash).toBe(visibleClash);
  });

  it("only partners can use these", async () => {
    for (const who of [ids.owner, ids.staff, ids.oldPartner]) {
      await expect(pp.myProjects(await as(who)), who).rejects.toThrow(/permission/i);
      await expect(pp.createMyProject(await as(who), { streamId: S.upwork, name: "X" }), who).rejects.toThrow(/permission/i);
    }
  });
});

describe("renaming, archiving and Team visible", () => {
  it("work on their own projects and are logged with before and after", async () => {
    const a = await as(ids.a);
    await pp.renameMyProject(a, ownerMade, "Owner made (renamed)");
    expect((await project(ownerMade)).name).toBe("Owner made (renamed)");
    await pp.setMyProjectTeamVisible(a, ownerMade, true);
    expect((await project(ownerMade)).teamVisible).toBe(true);
    await pp.setMyProjectActive(a, ownerMade, false);
    expect((await project(ownerMade)).active).toBe(false);
    expect((await pp.myProjects(a)).find((p) => p.id === ownerMade)?.active).toBe(false);
    await pp.setMyProjectActive(a, ownerMade, true);
    const actions = (await auditFor(ownerMade)).filter((r) => r.entity === "partner_projects").map((r) => r.action);
    expect(actions).toEqual(["update", "update", "archive", "update"]);
    const teamVisibleRow = (await auditFor(ownerMade)).find((r) => /team visible on/.test(r.summary ?? ""))!;
    expect(teamVisibleRow).toMatchObject({ before: { teamVisible: false }, after: { teamVisible: true } });
  });

  it("can't touch another partner's project, or one hidden from them: all look like a project that doesn't exist", async () => {
    const a = await as(ids.a);
    const theirs = (await pp.myProjects(await as(ids.b)))[0].id;
    const missing = crypto.randomUUID();
    for (const target of [theirs, ownerHidden]) {
      await expect(pp.renameMyProject(a, target, "Hijack")).rejects.toThrow(/no longer exists/);
      await expect(pp.setMyProjectActive(a, target, false)).rejects.toThrow(/no longer exists/);
      await expect(pp.setMyProjectTeamVisible(a, target, true)).rejects.toThrow(/no longer exists/);
      await expect(pp.setMyProjectMembers(a, target, [])).rejects.toThrow(/no longer exists/);
    }
    expect(await msg(pp.renameMyProject(a, theirs, "x"))).toBe(await msg(pp.renameMyProject(a, missing, "x")));
    expect((await project(ownerHidden)).name).toBe("Owner hid this");
    expect((await project(theirs)).teamVisible).toBe(false);
  });

  it("leave Owner-only things Owner-only", async () => {
    const a = await as(ids.a);
    await expect(proj.setProjectHidden(a, { projectId: ownerMade, userId: ids.b, hidden: true })).rejects.toThrow(/owner|permission/i);
    await expect(proj.setProjectHiddenFrom(a, ownerMade, [ids.b])).rejects.toThrow(/owner|permission/i);
    await expect(proj.setProjectPartners(a, ownerMade, [])).rejects.toThrow(/owner|permission/i);
    await expect(proj.deleteProject(a, ownerMade)).rejects.toThrow(/owner|permission/i);
    await expect(proj.ownerProjects(a)).rejects.toThrow(/owner|permission/i);
  });
});

describe("putting employees on projects", () => {
  it("a partner puts their own employees on a project, and the employee's scope follows", async () => {
    const a = await as(ids.a);
    await pp.setMyProjectMembers(a, ownerMade, [eA1, eA2]);
    expect(await members(ownerMade)).toEqual([eA1, eA2].sort());
    const list = (await pp.myProjects(a)).find((p) => p.id === ownerMade)!;
    expect(list.members.map((m) => m.name).sort()).toEqual(["ea1", "ea2"]);
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, eA1));
    expect((await as(eA1)).scoped).toEqual({ kind: "employee", partnerUserId: ids.a, projectIds: [ownerMade] });
    await pp.setMyProjectMembers(a, ownerMade, [eA2]);
    expect((await as(eA1)).scoped).toEqual({ kind: "employee", partnerUserId: ids.a, projectIds: [] });
    const log = (await auditFor(ownerMade)).filter((r) => r.action === "assign");
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ before: { memberIds: [eA1, eA2].sort() }, after: { memberIds: [eA2] } });
  });

  it("refuses someone else's employee, a stranger, or an archived project, and changes nothing", async () => {
    const a = await as(ids.a);
    const before = await members(ownerMade);
    await expect(pp.setMyProjectMembers(a, ownerMade, [eB1])).rejects.toThrow(/no longer exists/);
    await expect(pp.setMyProjectMembers(a, ownerMade, [ids.staff])).rejects.toThrow(/no longer exists/);
    expect(await msg(pp.setMyProjectMembers(a, ownerMade, [eB1]))).toBe(await msg(pp.setMyProjectMembers(a, ownerMade, [crypto.randomUUID()])));
    expect(await members(ownerMade)).toEqual(before);
    await pp.setMyProjectActive(a, ownerMade, false);
    await expect(pp.setMyProjectMembers(a, ownerMade, [eA1])).rejects.toThrow(/restore the project/i);
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, eA2));
    // an archived project drops out of the employee scope
    expect((await as(eA2)).scoped).toMatchObject({ projectIds: [] });
    await pp.setMyProjectActive(a, ownerMade, true);
    expect((await as(eA2)).scoped).toMatchObject({ projectIds: [ownerMade] });
  });

  it("an admin can do it for any project in a partner's stream, but only with that partner's employees", async () => {
    const owner = await as(ids.owner);
    await pp.setProjectMembersAsAdmin(owner, ownerMade, [eA1, eA2]);
    expect(await members(ownerMade)).toEqual([eA1, eA2].sort());
    await expect(pp.setProjectMembersAsAdmin(owner, ownerMade, [eB1])).rejects.toThrow(/no longer exists/);
    const orphanStream = await proj.createProject(owner, { streamId: (await t.db.select().from(t.schema.streams)).find((s) => s.name === "Website direct")!.id, name: "Nobody's" });
    await expect(pp.setProjectMembersAsAdmin(owner, orphanStream, [])).rejects.toThrow(/no partner/i);
    await expect(pp.setProjectMembersAsAdmin(await as(ids.a), ownerMade, [])).rejects.toThrow(/permission|admins/i);
  });
});

describe("what the admin sees", () => {
  it("every project change by the partner is under 'Changes made' on their page", async () => {
    const d = await ap.partnerDetail(await as(ids.owner), ids.a);
    const summaries = d.changes.map((c) => c.summary ?? "");
    expect(summaries.some((s) => s.startsWith("Added project"))).toBe(true);
    expect(summaries.some((s) => /team visible on/.test(s))).toBe(true);
    expect(summaries.some((s) => /Archived project/.test(s))).toBe(true);
    expect(summaries.some((s) => /people on .* changed/.test(s))).toBe(true);
    expect(d.changes.every((c) => c.entity !== "projects" && c.entity !== "project_hidden_from")).toBe(true);
  });
});
