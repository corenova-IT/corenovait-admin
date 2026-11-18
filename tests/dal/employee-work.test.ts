import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * What an employee sees and can do. Partner A (Upwork, GB) has employees eA1 and eA2; partner B
 * (Fiverr, AU) has eB1. Everything not theirs must be invisible, and look like it doesn't exist.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let work: typeof import("@/lib/dal/employee-work");
let w: typeof import("@/lib/dal/partner-writes");
let pp: typeof import("@/lib/dal/partner-projects");
let emp: typeof import("@/lib/dal/partner-employees");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let ids: Record<"owner" | "staff" | "a" | "b" | "orphan", string>;
let E: Record<"a1" | "a2" | "b1", string>;
let S: Record<"upwork" | "fiverr", number>;
let P: Record<"a1" | "a2" | "a3" | "b1", string>;
let T: Record<"t1" | "t2" | "t3" | "t4" | "t5" | "t6" | "t7", string>;

const as = (id: string) => actorFor(t, id);
const TODAY = "2026-06-15";
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const row = async (id: string) => (await t.db.select().from(t.schema.tasks).where(eq(t.schema.tasks.id, id)))[0];
const titles = async (id: string) => (await work.myWork(await as(id), TODAY)).tasks.map((x) => x.title).sort();

beforeAll(async () => {
  t = await setupTestDatabase();
  work = await import("@/lib/dal/employee-work");
  w = await import("@/lib/dal/partner-writes");
  pp = await import("@/lib/dal/partner-projects");
  emp = await import("@/lib/dal/partner-employees");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    orphan: (await createPerson(t, { email: "orphan@example.test", preset: "employee" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  S = { upwork: rows.find((r) => r.name === "Upwork")!.id, fiverr: rows.find((r) => r.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  const [a, b] = [await as(ids.a), await as(ids.b)];
  const mk = async (partner: typeof a, email: string) => {
    const id = (await emp.inviteMyEmployee(partner, { email, fullName: email.split("@")[0], jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(a, "ea1@example.test"), a2: await mk(a, "ea2@example.test"), b1: await mk(b, "eb1@example.test") };
  P = {
    a1: await pp.createMyProject(a, { streamId: S.upwork, name: "A1 private team" }),
    a2: await pp.createMyProject(a, { streamId: S.upwork, name: "A2 shared team" }),
    a3: await pp.createMyProject(a, { streamId: S.upwork, name: "A3 eA1 not on it" }),
    b1: await pp.createMyProject(b, { streamId: S.fiverr, name: "B1" }),
  };
  await pp.setMyProjectMembers(a, P.a1, [E.a1, E.a2]);
  await pp.setMyProjectMembers(a, P.a2, [E.a1, E.a2]);
  await pp.setMyProjectTeamVisible(a, P.a2, true);
  await pp.setMyProjectMembers(a, P.a3, [E.a2]);
  await pp.setMyProjectMembers(b, P.b1, [E.b1]);
  const task = (title: string, over: Record<string, unknown>) => ({ id: crypto.randomUUID(), title, createdBy: ids.a, streamId: S.upwork, ...over });
  const rowsT = {
    t1: task("T1 mine in project", { assigneeId: E.a1, projectId: P.a1, dueDate: "2026-06-10" }),
    t2: task("T2 mine no project", { assigneeId: E.a1 }),
    t3: task("T3 project I'm not on", { assigneeId: E.a1, projectId: P.a3 }),
    t4: task("T4 someone else's", { assigneeId: E.a2, projectId: P.a1 }),
    t5: task("T5 archived", { assigneeId: E.a1, archivedAt: new Date() }),
    t6: task("T6 other stream", { assigneeId: E.a1, streamId: S.fiverr }),
    t7: task("T7 B's employee", { assigneeId: E.b1, streamId: S.fiverr, projectId: P.b1 }),
  };
  await t.db.insert(t.schema.tasks).values(Object.values(rowsT));
  T = Object.fromEntries(Object.entries(rowsT).map(([k, v]) => [k, v.id])) as typeof T;
  await t.db.insert(t.schema.userPresence).values({ userId: E.a2, lastSeenAt: new Date() });
});
afterAll(() => t?.cleanup());

describe("a partner giving an employee a task", () => {
  it("can assign only their own employee, and (with a project) only one who is on it", async () => {
    const a = await as(ids.a);
    const base = { title: "Assigned", streamId: S.upwork };
    const ok = await w.createMyTask(a, { ...base, assigneeId: E.a1, projectId: P.a1 });
    expect((await row(ok)).assigneeId).toBe(E.a1);
    await expect(w.createMyTask(a, { ...base, assigneeId: E.a1, projectId: P.a3 })).rejects.toThrow(/put them on that project/i);
    await expect(w.createMyTask(a, { ...base, assigneeId: E.b1 })).rejects.toThrow(/no longer exists/);
    expect(await msg(w.createMyTask(a, { ...base, assigneeId: E.b1 }))).toBe(await msg(w.createMyTask(a, { ...base, assigneeId: crypto.randomUUID() })));
    await expect(w.createMyTask(a, { ...base, assigneeId: ids.staff })).rejects.toThrow(/no longer exists/);
    expect((await w.myFormChoices(a)).employees.map((e) => e.name).sort()).toEqual(["ea1", "ea2"]);
    await t.db.delete(t.schema.tasks).where(eq(t.schema.tasks.id, ok)); // keep the fixture list clean for the tests below
  });
});

describe("what an employee sees", () => {
  it("only their own tasks, in their partner's streams, on projects they're on", async () => {
    expect(await titles(E.a1)).toEqual(["T1 mine in project", "T2 mine no project"]);
    expect(await titles(E.a2)).toEqual(["T4 someone else's"]);
    expect(await titles(E.b1)).toEqual(["T7 B's employee"]);
    const mine = (await work.myWork(await as(E.a1), TODAY)).tasks.find((x) => x.title.startsWith("T1"))!;
    expect(mine).toMatchObject({ project: "A1 private team", overdue: true, status: "todo" });
  });

  it("only projects they are on, and only the names of others on projects with Team visible switched on", async () => {
    const a1 = await work.myWork(await as(E.a1), TODAY);
    expect(a1.projects.map((p) => p.name)).toEqual(["A1 private team", "A2 shared team"]);
    expect(a1.partnerName).toBe("a");
    const priv = a1.projects.find((p) => p.name === "A1 private team")!;
    expect(priv).toMatchObject({ teamVisible: false, team: [] }); // eA2 is on it too, but Team visible is off
    const shared = a1.projects.find((p) => p.name === "A2 shared team")!;
    expect(shared.team).toEqual([{ name: "ea2", online: true }]);
    // and it flips off the moment the partner switches it off
    await pp.setMyProjectTeamVisible(await as(ids.a), P.a2, false);
    expect((await work.myWork(await as(E.a1), TODAY)).projects.find((p) => p.name === "A2 shared team")!.team).toEqual([]);
    await pp.setMyProjectTeamVisible(await as(ids.a), P.a2, true);
  });

  it("never anything about money, other streams, other partners, other people's tasks, chats or hours", async () => {
    const json = JSON.stringify(await work.myWork(await as(E.a1), TODAY));
    for (const leak of ["Upwork", "Fiverr", "amount", "cost", "pay", "revenue", "income", "fx", "currency", "T3", "T4", "T5", "T6", "T7", "B1", "\"b\"", "eb1", "ea2@", "hours", "chat", "streamId", "partnerUserId"]) {
      expect(json.toLowerCase(), leak).not.toContain(leak.toLowerCase());
    }
  });

  it("nothing at all for an employee who isn't tied to a partner, and nothing when they leave a project", async () => {
    const orphan = await work.myWork(await as(ids.orphan), TODAY);
    expect(orphan).toMatchObject({ partnerName: null, tasks: [], projects: [] });
    await pp.setMyProjectMembers(await as(ids.a), P.a1, [E.a2]); // takes eA1 off project A1
    expect(await titles(E.a1)).toEqual(["T2 mine no project"]);
    expect((await work.myWork(await as(E.a1), TODAY)).projects.map((p) => p.name)).toEqual(["A2 shared team"]);
    await pp.setMyProjectMembers(await as(ids.a), P.a1, [E.a1, E.a2]);
  });

  it("is only for employees", async () => {
    for (const who of [ids.owner, ids.staff, ids.a]) {
      await expect(work.myWork(await as(who), TODAY), who).rejects.toThrow(/permission/i);
    }
  });
});

describe("an employee moving their own tasks along", () => {
  it("changes only the status of their own task, and logs it", async () => {
    const e = await as(E.a1);
    await work.setMyWorkTaskStatus(e, T.t1, "in_progress");
    expect((await row(T.t1)).status).toBe("in_progress");
    await work.setMyWorkTaskStatus(e, T.t1, "done");
    const done = await row(T.t1);
    expect(done.status).toBe("done");
    expect(done.completedAt).toBeInstanceOf(Date);
    expect(done.title).toBe("T1 mine in project"); // nothing else about it changed
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, T.t1))).filter((r) => r.actorId === E.a1);
    expect(log).toHaveLength(2);
    expect(log[1]).toMatchObject({ before: { status: "in_progress" }, after: { status: "done" } });
    await work.setMyWorkTaskStatus(e, T.t1, "todo");
  });

  it("can't touch someone else's task, an archived one, one in a project they're not on, or one in another stream: all 'no longer exists'", async () => {
    const e = await as(E.a1);
    const snapshot = JSON.stringify([await row(T.t3), await row(T.t4), await row(T.t5), await row(T.t6), await row(T.t7)]);
    for (const id of [T.t3, T.t4, T.t5, T.t6, T.t7]) await expect(work.setMyWorkTaskStatus(e, id, "done")).rejects.toThrow(/no longer exists/);
    expect(await msg(work.setMyWorkTaskStatus(e, T.t4, "done"))).toBe(await msg(work.setMyWorkTaskStatus(e, crypto.randomUUID(), "done")));
    expect(JSON.stringify([await row(T.t3), await row(T.t4), await row(T.t5), await row(T.t6), await row(T.t7)])).toBe(snapshot);
    await expect(work.setMyWorkTaskStatus(e, T.t1, "bogus" as never)).rejects.toThrow(/status/i);
  });

  it("only employees can use it", async () => {
    for (const who of [ids.owner, ids.staff, ids.a]) await expect(work.setMyWorkTaskStatus(await as(who), T.t1, "done"), who).rejects.toThrow(/permission/i);
  });
});

describe("an employee is still locked out of everything else", () => {
  it("can't read or change a partner's projects, employees, money or other pages", async () => {
    const e = await as(E.a1);
    await expect(pp.myProjects(e)).rejects.toThrow(/permission/i);
    await expect(pp.setMyProjectMembers(e, P.a1, [])).rejects.toThrow(/permission/i);
    await expect(emp.myEmployees(e, TODAY)).rejects.toThrow(/permission/i);
    await expect(emp.inviteMyEmployee(e, { email: "x@example.test", fullName: "X", jobTitle: "" })).rejects.toThrow(/permission/i);
    await expect(w.myExpenses(e)).rejects.toThrow(/permission/i);
    await expect(w.createMyTask(e, { title: "x", streamId: S.upwork })).rejects.toThrow(/permission/i);
    await expect(proj.ownerProjects(e)).rejects.toThrow(/owner|permission/i);
  });
});
