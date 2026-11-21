import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Kinds of work (niche and sub-category), custom sub-categories, project lead, and the Partner rename. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let nich: typeof import("@/lib/dal/niches");
let pp: typeof import("@/lib/dal/partner-projects");
let emp: typeof import("@/lib/dal/partner-employees");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "staff" | "a" | "b", string>;
let E: Record<"a1" | "b1", string>;
let S: Record<"upwork" | "fiverr", number>;

const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const project = async (id: string) => (await t.db.select().from(t.schema.projects).where(eq(t.schema.projects.id, id)))[0];
const members = async (id: string) => (await t.db.select().from(t.schema.projectMembers).where(eq(t.schema.projectMembers.projectId, id))).map((m) => m.userId);
const auditFor = (id: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));
let N: Record<string, { id: number; subs: Record<string, number> }>;

beforeAll(async () => {
  t = await setupTestDatabase();
  nich = await import("@/lib/dal/niches");
  pp = await import("@/lib/dal/partner-projects");
  emp = await import("@/lib/dal/partner-employees");
  assign = await import("@/lib/dal/assignments");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const streams = await t.db.select().from(t.schema.streams);
  S = { upwork: streams.find((s) => s.name === "Upwork")!.id, fiverr: streams.find((s) => s.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  const mk = async (who: string, email: string) => {
    const id = (await emp.inviteMyEmployee(await as(who), { email, fullName: email.split("@")[0], jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(ids.a, "ea1@example.test"), b1: await mk(ids.b, "eb1@example.test") };
  N = Object.fromEntries((await nich.listNiches(await as(ids.a))).map((n) => [n.name, { id: n.id, subs: Object.fromEntries(n.subs.map((s) => [s.name, s.id])) }]));
});
afterAll(() => t?.cleanup());

describe("the starting lists", () => {
  it("has the four niches and the sub-categories asked for, in order", async () => {
    const list = await nich.listNiches(await as(ids.a));
    expect(list.map((n) => n.name)).toEqual(["Motion graphics", "Web development", "App development", "3D"]);
    expect(list.find((n) => n.name === "Web development")!.subs.map((s) => s.name)).toEqual(["WordPress", "Shopify", "Wix", "Square", "Other"]);
    expect(list.find((n) => n.name === "App development")!.subs.map((s) => s.name)).toEqual(["CRM", "SaaS", "Mobile app", "Other"]);
    expect(list.every((n) => n.subs.every((s) => !s.isCustom))).toBe(true);
  });

  it("is readable by partners and admins only", async () => {
    await expect(nich.listNiches(await as(ids.owner))).resolves.toBeTruthy();
    await expect(nich.listNiches(await as(ids.staff))).rejects.toThrow(/permission/i);
    await expect(nich.listNiches(await as(E.a1))).rejects.toThrow(/permission/i);
  });
});

describe("a partner adding a project with a kind of work", () => {
  it("picks a niche and sub-category, and is the lead by default", async () => {
    const a = await as(ids.a);
    const id = await pp.createMyProject(a, { streamId: S.upwork, name: "45 sec video", nicheId: N["Motion graphics"].id, subNicheId: N["Motion graphics"].subs["Explainer video"] });
    expect(await project(id)).toMatchObject({ nicheId: N["Motion graphics"].id, subNicheId: N["Motion graphics"].subs["Explainer video"], leadUserId: ids.a });
    const mine = (await pp.myProjects(a)).find((p) => p.id === id)!;
    expect(mine).toMatchObject({ niche: "Motion graphics", subNiche: "Explainer video", leadName: "a" });
    expect((await auditFor(id))[0]).toMatchObject({ action: "create", after: { nicheId: N["Motion graphics"].id, leadUserId: ids.a } });
  });

  it("can add their own sub-category, which is saved, shared, and never duplicated (any capitals)", async () => {
    const [a, b] = [await as(ids.a), await as(ids.b)];
    const web = N["Web development"].id;
    const p1 = await pp.createMyProject(a, { streamId: S.upwork, name: "Webflow site", nicheId: web, newSubNiche: "  Webflow  " });
    const sub = (await project(p1)).subNicheId!;
    const row = (await t.db.select().from(t.schema.subNiches).where(eq(t.schema.subNiches.id, sub)))[0];
    expect(row).toMatchObject({ name: "Webflow", isCustom: true, nicheId: web, createdBy: ids.a, active: true });
    expect((await auditFor(String(sub)))[0]).toMatchObject({ action: "create", entity: "sub_niches" });
    // another partner sees it next time, and typing it in a different case reuses it
    expect((await nich.listNiches(b)).find((n) => n.id === web)!.subs.map((s) => s.name)).toContain("Webflow");
    const p2 = await pp.createMyProject(b, { streamId: S.fiverr, name: "Another webflow site", nicheId: web, newSubNiche: "WEBFLOW" });
    expect((await project(p2)).subNicheId).toBe(sub);
    // typing an existing starting one reuses it instead of making a custom copy
    const p3 = await pp.createMyProject(b, { streamId: S.fiverr, name: "WP site", nicheId: web, newSubNiche: "wordpress" });
    expect((await project(p3)).subNicheId).toBe(N["Web development"].subs["WordPress"]);
    expect((await t.db.select().from(t.schema.subNiches).where(eq(t.schema.subNiches.nicheId, web))).filter((s) => /webflow/i.test(s.name))).toHaveLength(1);
  });

  it("refuses a sub-category from another niche, a sub-category with no niche, a made-up niche, and a bad custom name", async () => {
    const a = await as(ids.a);
    const base = { streamId: S.upwork };
    await expect(pp.createMyProject(a, { ...base, name: "X1", nicheId: N["3D"].id, subNicheId: N["Web development"].subs["Wix"] })).rejects.toThrow(/belongs to that niche/i);
    await expect(pp.createMyProject(a, { ...base, name: "X2", subNicheId: N["Web development"].subs["Wix"] })).rejects.toThrow(/choose a niche first/i);
    await expect(pp.createMyProject(a, { ...base, name: "X3", nicheId: 99999 })).rejects.toThrow(/niche from the list/i);
    await expect(pp.createMyProject(a, { ...base, name: "X4", newSubNiche: "Typed with no niche" })).rejects.toThrow(/choose a niche before/i);
    await expect(pp.createMyProject(a, { ...base, name: "X5", nicheId: N["3D"].id, newSubNiche: "x".repeat(81) })).rejects.toThrow(/80 characters/);
    expect((await t.db.select().from(t.schema.projects)).some((p) => /^X\d$/.test(p.name))).toBe(false);
  });

  it("only partners and admins can add or read them, and an employee can't", async () => {
    await expect(pp.createMyProject(await as(E.a1), { streamId: S.upwork, name: "No", nicheId: N["3D"].id })).rejects.toThrow(/permission/i);
    await expect(pp.createMyProject(await as(ids.staff), { streamId: S.upwork, name: "No" })).rejects.toThrow(/permission/i);
  });
});

describe("who leads a project", () => {
  it("can be the partner or one of their own employees, who is then on the project", async () => {
    const a = await as(ids.a);
    const id = await pp.createMyProject(a, { streamId: S.upwork, name: "Led by an employee", leadUserId: E.a1 });
    expect((await project(id)).leadUserId).toBe(E.a1);
    expect(await members(id)).toContain(E.a1);
    expect((await pp.myProjects(a)).find((p) => p.id === id)).toMatchObject({ leadId: E.a1, leadName: "ea1" });
  });

  it("can't be another partner's employee or a stranger (all look like someone who doesn't exist)", async () => {
    const a = await as(ids.a);
    const missing = await msg(pp.createMyProject(a, { streamId: S.upwork, name: "L1", leadUserId: crypto.randomUUID() }));
    expect(missing).toMatch(/no longer exists/);
    expect(await msg(pp.createMyProject(a, { streamId: S.upwork, name: "L2", leadUserId: E.b1 }))).toBe(missing);
    expect(await msg(pp.createMyProject(a, { streamId: S.upwork, name: "L3", leadUserId: ids.b }))).toBe(missing);
    expect((await t.db.select().from(t.schema.projects)).some((p) => /^L\d$/.test(p.name))).toBe(false);
  });

  it("can be changed later along with the kind of work, logged with before and after, and unchanged saves log nothing", async () => {
    const a = await as(ids.a);
    const id = await pp.createMyProject(a, { streamId: S.upwork, name: "Change me", nicheId: N["App development"].id, subNicheId: N["App development"].subs["CRM"] });
    const logBefore = (await auditFor(id)).length;
    await pp.setMyProjectDetails(a, id, { nicheId: N["App development"].id, subNicheId: N["App development"].subs["CRM"], leadUserId: ids.a });
    expect((await auditFor(id)).length).toBe(logBefore);
    await pp.setMyProjectDetails(a, id, { nicheId: N["App development"].id, subNicheId: N["App development"].subs["SaaS"], leadUserId: E.a1 });
    const log = (await auditFor(id)).find((r) => /kind of work or lead changed/.test(r.summary ?? ""))!;
    expect(log).toMatchObject({ before: { subNicheId: N["App development"].subs["CRM"], leadUserId: ids.a }, after: { subNicheId: N["App development"].subs["SaaS"], leadUserId: E.a1 } });
    await expect(pp.setMyProjectDetails(await as(ids.b), id, { leadUserId: E.b1 })).rejects.toThrow(/no longer exists/); // not their project
  });
});

describe("admins keeping the lists tidy", () => {
  it("add, rename and archive niches and sub-categories; projects keep an archived one; partners can't", async () => {
    const [owner, a] = [await as(ids.owner), await as(ids.a)];
    await nich.saveNiche(owner, { id: null, name: "Video editing" });
    const added = (await nich.nichesForAdmin(owner)).find((n) => n.name === "Video editing")!;
    await nich.saveSubNiche(owner, { id: null, nicheId: added.id, name: "Wedding films" });
    await expect(nich.saveNiche(owner, { id: null, name: "Video editing" })).rejects.toThrow(/already a niche/i);
    const sub = (await nich.nichesForAdmin(owner)).find((n) => n.id === added.id)!.subs[0];
    await nich.saveSubNiche(owner, { id: sub.id, nicheId: added.id, name: "Wedding and events" });
    expect((await nich.listNiches(a)).find((n) => n.id === added.id)!.subs.map((s) => s.name)).toEqual(["Wedding and events"]);
    const project = await pp.createMyProject(a, { streamId: S.upwork, name: "Wedding film", nicheId: added.id, subNicheId: sub.id });
    await nich.setNicheActive(owner, { kind: "sub", id: sub.id, active: false });
    expect((await nich.listNiches(a)).find((n) => n.id === added.id)!.subs).toEqual([]);
    expect((await pp.myProjects(a)).find((p) => p.id === project)).toMatchObject({ subNiche: "Wedding and events" }); // kept
    await expect(pp.createMyProject(a, { streamId: S.upwork, name: "Not allowed now", nicheId: added.id, subNicheId: sub.id })).rejects.toThrow(/belongs to that niche/i);
    await nich.setNicheActive(owner, { kind: "niche", id: added.id, active: false });
    expect((await nich.listNiches(a)).some((n) => n.id === added.id)).toBe(false);
    for (const who of [ids.a, E.a1, ids.staff]) {
      await expect(nich.saveNiche(await as(who), { id: null, name: "Hacked" }), who).rejects.toThrow(/permission|admins/i);
      await expect(nich.setNicheActive(await as(who), { kind: "niche", id: added.id, active: true }), who).rejects.toThrow(/permission|admins/i);
    }
    expect((await nich.nichesForAdmin(owner)).some((n) => n.name === "Hacked")).toBe(false);
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, "sub_niches"))).filter((r) => r.action === "archive");
    expect(log).toHaveLength(1);
  });
});

describe("the rename", () => {
  it("shows the new role as Partner, and the older revenue-share role as Revenue-share partner (same id, permissions and order)", async () => {
    const [sp] = await t.db.select().from(t.schema.rolePresets).where(eq(t.schema.rolePresets.id, "stream_partner"));
    expect(sp.name).toBe("Partner");
    const [old] = await t.db.select().from(t.schema.rolePresets).where(eq(t.schema.rolePresets.id, "partner"));
    expect(old).toMatchObject({ id: "partner", name: "Revenue-share partner", sort: 36 });
    expect(old.description).toMatch(/their own share/i);
    const [emp1] = await t.db.select().from(t.schema.rolePresets).where(eq(t.schema.rolePresets.id, "employee"));
    expect(emp1.description).toMatch(/Works for one partner/);
  });
});
