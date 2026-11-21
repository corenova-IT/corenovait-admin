import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase, userRow } from "./db";

/** Employees: invited by a partner or an admin, each tied to exactly one partner, never above the Employee role. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let emp: typeof import("@/lib/dal/partner-employees");
let team: typeof import("@/lib/dal/team");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "staff" | "oldPartner" | "a" | "b" | "bare", string>;
let S: Record<"upwork" | "fiverr", number>;

const as = (id: string) => actorFor(t, id);
const auditFor = (entity: string, entityId: string) =>
  t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, entityId)).then((r) => r.filter((x) => x.entity === entity));
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const person = (email: string, over: Record<string, unknown> = {}) => ({ email, fullName: "New Person", jobTitle: "Designer", ...over });
const partnerOf = async (id: string) => (await t.db.select().from(t.schema.employeeAssignments).where(eq(t.schema.employeeAssignments.employeeUserId, id)))[0]?.partnerUserId ?? null;

beforeAll(async () => {
  t = await setupTestDatabase();
  emp = await import("@/lib/dal/partner-employees");
  team = await import("@/lib/dal/team");
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
  S = { upwork: rows.find((r) => r.name === "Upwork")!.id, fiverr: rows.find((r) => r.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  await assign.setAssignments(owner, { userId: ids.bare, streamIds: [], countryCodes: [] });
});
afterAll(() => t?.cleanup());

describe("a partner inviting an employee", () => {
  it("creates an Employee for that partner only, logged, with an invite link", async () => {
    const a = await as(ids.a);
    const inv = await emp.inviteMyEmployee(a, person("e1@example.test"));
    expect(inv.token.length).toBeGreaterThan(20);
    const u = await userRow(t, inv.userId);
    expect(u).toMatchObject({ presetId: "employee", status: "invited", mfaRequired: false, invitedBy: ids.a });
    expect(await partnerOf(inv.userId)).toBe(ids.a);
    expect((await auditFor("users", inv.userId))[0]).toMatchObject({ action: "invite", actorId: ids.a });
    expect((await auditFor("employee_assignments", inv.userId))[0]).toMatchObject({ action: "assign", after: { partnerUserId: ids.a } });
  });

  it("can only ever give the Employee role, whatever the request says", async () => {
    const a = await as(ids.a);
    const inv = await emp.inviteMyEmployee(a, person("e2@example.test", { presetId: "admin", partnerUserId: ids.b, isOwner: true }) as never);
    expect((await userRow(t, inv.userId)).presetId).toBe("employee");
    expect((await userRow(t, inv.userId)).isOwner).toBe(false);
    expect(await partnerOf(inv.userId)).toBe(ids.a); // not partner B, whatever the form claimed
    const granted = Object.entries((await as(inv.userId).catch(() => null))?.perms ?? {}).filter(([, p]) => p.view).map(([m]) => m);
    expect(granted.filter((m) => m !== "employee")).toEqual([]);
  });

  it("refuses a duplicate email without leaving anything behind, and a partner with no country", async () => {
    const a = await as(ids.a);
    const before = (await t.db.select().from(t.schema.users)).length;
    await expect(emp.inviteMyEmployee(a, person("e1@example.test"))).rejects.toThrow(/already has an account/);
    expect((await t.db.select().from(t.schema.users)).length).toBe(before);
    await expect(emp.inviteMyEmployee(await as(ids.bare), person("e3@example.test"))).rejects.toThrow(/no longer exists/);
  });

  it("is only for partners", async () => {
    for (const who of [ids.owner, ids.staff, ids.oldPartner]) {
      await expect(emp.inviteMyEmployee(await as(who), person(`x-${who.slice(0, 4)}@example.test`)), who).rejects.toThrow(/permission/i);
    }
  });
});

describe("an admin inviting an employee", () => {
  it("must choose a partner, and can choose any", async () => {
    const owner = await as(ids.owner);
    await expect(team.inviteUser(owner, { ...person("a1@example.test"), presetId: "employee" })).rejects.toThrow(/choose which partner/i);
    await expect(team.inviteUser(owner, { ...person("a2@example.test"), presetId: "employee", partnerUserId: ids.staff })).rejects.toThrow(/choose a partner/i);
    await expect(team.inviteUser(owner, { ...person("a3@example.test"), presetId: "staff", partnerUserId: ids.a })).rejects.toThrow(/only be chosen for employees/i);
    const inv = await team.inviteUser(owner, { ...person("a4@example.test"), presetId: "employee", partnerUserId: ids.b });
    expect(await partnerOf(inv.userId)).toBe(ids.b);
    expect((await auditFor("users", inv.userId))[0]).toMatchObject({ actorId: ids.owner });
  });

  it("can't use 'apply a role' to make an existing person an employee, and a non-admin can't invite", async () => {
    const owner = await as(ids.owner);
    await expect(team.applyPreset(owner, { userId: ids.staff, presetId: "employee" })).rejects.toThrow(/invite them as an employee/i);
    await expect(team.inviteUser(await as(ids.a), { ...person("zz@example.test"), presetId: "employee", partnerUserId: ids.a })).rejects.toThrow(/permission|admins/i);
  });
});

describe("whose employee is whose", () => {
  it("a partner sees only their own employees; another partner's look the same as ones that don't exist", async () => {
    const [a, b] = [await as(ids.a), await as(ids.b)];
    const mineA = (await emp.myEmployees(a, "2026-01-01")).map((e) => e.email).sort();
    expect(mineA).toEqual(["e1@example.test", "e2@example.test"]);
    const mineB = (await emp.myEmployees(b, "2026-01-01")).map((e) => e.email);
    expect(mineB).toEqual(["a4@example.test"]);
    const theirs = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "a4@example.test")))[0].id;
    const staffId = ids.staff;
    expect(await msg(emp.ownEmployee(t.db, a, theirs))).toBe(await msg(emp.ownEmployee(t.db, a, crypto.randomUUID())));
    expect(await msg(emp.ownEmployee(t.db, a, staffId))).toBe(await msg(emp.ownEmployee(t.db, a, crypto.randomUUID())));
    await expect(emp.myEmployees(await as(ids.staff), "2026-01-01")).rejects.toThrow(/permission/i);
  });

  it("an employee's scope names their partner; they have no projects until added", async () => {
    const e = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "e1@example.test")))[0];
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, e.id));
    const actor = await as(e.id);
    expect(actor.scoped).toEqual({ kind: "employee", partnerUserId: ids.a, projectIds: [] });
  });

  it("an admin can move an employee to another partner (logged), and then the old partner loses sight of them", async () => {
    const owner = await as(ids.owner);
    const e = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "e2@example.test")))[0];
    await emp.reassignEmployee(owner, { employeeId: e.id, partnerUserId: ids.b });
    expect(await partnerOf(e.id)).toBe(ids.b);
    expect((await emp.myEmployees(await as(ids.a), "2026-01-01")).map((x) => x.email)).not.toContain("e2@example.test");
    expect((await auditFor("employee_assignments", e.id)).some((r) => (r.after as { partnerUserId: string }).partnerUserId === ids.b)).toBe(true);
    await expect(emp.reassignEmployee(await as(ids.a), { employeeId: e.id, partnerUserId: ids.a })).rejects.toThrow(/permission|admins/i);
    await expect(emp.reassignEmployee(owner, { employeeId: ids.staff, partnerUserId: ids.a })).rejects.toThrow(/isn't an employee/);
  });

  it("someone who stops being an employee leaves their partner (logged)", async () => {
    const owner = await as(ids.owner);
    const e = (await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "a4@example.test")))[0];
    await team.applyPreset(owner, { userId: e.id, presetId: "staff" });
    expect(await partnerOf(e.id)).toBeNull();
    const log = await auditFor("employee_assignments", e.id);
    expect(log[log.length - 1]).toMatchObject({ after: { partnerUserId: null } });
  });
});
