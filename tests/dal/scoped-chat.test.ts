import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * Chat for partners and employees. Partner A has employees eA1 and eA2; partner B has eB1.
 * Allowed: employee-partner, employee-admin, partner-admin. Nothing else. Admins can read (and log) any
 * conversation that includes a partner or employee; admin-to-admin chats stay private.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let sc: typeof import("@/lib/dal/scoped-chat");
let chat: typeof import("@/lib/dal/chat");
let emp: typeof import("@/lib/dal/partner-employees");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "admin2" | "staff" | "a" | "b", string>;
let E: Record<"a1" | "a2" | "b1", string>;
let S: Record<"upwork" | "fiverr", number>;

const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const dmCount = async () => (await t.db.select().from(t.schema.chatChannels).where(eq(t.schema.chatChannels.kind, "dm"))).length;
const names = (cs: Array<{ name: string }>) => cs.map((c) => c.name).sort();

beforeAll(async () => {
  t = await setupTestDatabase();
  sc = await import("@/lib/dal/scoped-chat");
  chat = await import("@/lib/dal/chat");
  emp = await import("@/lib/dal/partner-employees");
  assign = await import("@/lib/dal/assignments");
  const mkAdmin = async (email: string) => (await createPerson(t, { email, preset: "admin", totp: true })).id;
  ids = {
    owner: await mkAdmin("owner@example.test"),
    admin2: await mkAdmin("admin2@example.test"),
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  for (const [k, id] of Object.entries(ids)) await t.db.update(t.schema.users).set({ fullName: k === "owner" ? "Olive Owner" : k === "admin2" ? "Adam Admin" : `Name ${k}` }).where(eq(t.schema.users.id, id));
  const rows = await t.db.select().from(t.schema.streams);
  S = { upwork: rows.find((r) => r.name === "Upwork")!.id, fiverr: rows.find((r) => r.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  const mk = async (who: string, email: string) => {
    const id = (await emp.inviteMyEmployee(await as(who), { email, fullName: `Emp ${email.split("@")[0]}`, jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(ids.a, "ea1@example.test"), a2: await mk(ids.a, "ea2@example.test"), b1: await mk(ids.b, "eb1@example.test") };
});
afterAll(() => t?.cleanup());

describe("who each person may talk to", () => {
  it("an employee can reach their own partner and the admins, nobody else", async () => {
    const c = await sc.scopedContacts(await as(E.a1));
    expect(names(c)).toEqual(["Adam Admin", "Name a", "Olive Owner"]);
    expect(c.find((x) => x.name === "Name a")?.role).toBe("partner");
  });

  it("a partner can reach their own employees and the admins, never another partner or their employees", async () => {
    expect(names(await sc.scopedContacts(await as(ids.a)))).toEqual(["Adam Admin", "Emp ea1", "Emp ea2", "Olive Owner"]);
    expect(names(await sc.scopedContacts(await as(ids.b)))).toEqual(["Adam Admin", "Emp eb1", "Olive Owner"]);
  });

  it("allows the three allowed pairs, in both directions, and an admin starting one", async () => {
    const [a, e1, owner] = [await as(ids.a), await as(E.a1), await as(ids.owner)];
    const one = await sc.startScopedDm(e1, ids.a);
    expect(await sc.startScopedDm(a, E.a1)).toBe(one); // the same conversation from the other side
    await sc.startScopedDm(e1, ids.owner);
    await sc.startScopedDm(a, ids.admin2);
    const withAdmin = await sc.startDmAsAdmin(owner, E.a2);
    expect(withAdmin).toBeTruthy();
    await sc.startDmAsAdmin(owner, ids.b);
  });

  it("refuses every other pair, with the same answer as for someone who doesn't exist, and creates nothing", async () => {
    const [a, e1, owner] = [await as(ids.a), await as(E.a1), await as(ids.owner)];
    const before = await dmCount();
    const missing = await msg(sc.startScopedDm(e1, crypto.randomUUID()));
    expect(missing).toMatch(/no longer exists/);
    for (const other of [E.a2, ids.b, E.b1, ids.staff, e1.userId]) expect(await msg(sc.startScopedDm(e1, other)), other).toBe(missing);
    for (const other of [ids.b, E.b1, ids.staff]) expect(await msg(sc.startScopedDm(a, other)), other).toBe(missing);
    for (const other of [ids.staff, ids.admin2]) expect(await msg(sc.startDmAsAdmin(owner, other)), other).toBe(missing);
    expect(await dmCount()).toBe(before);
  });

  it("is only for partners, employees and (to start) admins", async () => {
    await expect(sc.scopedContacts(await as(ids.staff))).rejects.toThrow(/permission/i);
    await expect(sc.scopedContacts(await as(ids.owner))).rejects.toThrow(/permission/i);
    await expect(sc.startScopedDm(await as(ids.staff), ids.a)).rejects.toThrow(/permission/i);
    await expect(sc.startDmAsAdmin(await as(ids.a), E.a1)).rejects.toThrow(/permission|admins/i);
    await expect(sc.startDmAsAdmin(await as(ids.staff), E.a1)).rejects.toThrow(/permission|admins/i);
  });
});

describe("sending and reading", () => {
  it("an employee and their partner exchange messages, with unread counts", async () => {
    const [a, e1] = [await as(ids.a), await as(E.a1)];
    const id = await sc.startScopedDm(e1, ids.a);
    await sc.sendScopedMessage(e1, id, "  Hello partner  ");
    const list = await sc.scopedConversations(a);
    expect(list.find((c) => c.id === id)).toMatchObject({ with: "Emp ea1", unread: 1 });
    const opened = await sc.openScopedConversation(a, id);
    expect(opened.messages.map((m) => [m.author, m.body, m.mine])).toEqual([["Emp ea1", "Hello partner", false]]);
    expect((await sc.scopedConversations(a)).find((c) => c.id === id)?.unread).toBe(0);
    await sc.sendScopedMessage(a, id, "Hello back");
    expect((await sc.openScopedConversation(e1, id)).messages.map((m) => m.body)).toEqual(["Hello partner", "Hello back"]);
    await expect(sc.sendScopedMessage(e1, id, "   ")).rejects.toThrow(/write a message/i);
    await expect(sc.sendScopedMessage(e1, id, "x".repeat(4001))).rejects.toThrow(/under 4,000/);
  });

  it("nobody else can read or write it: another partner, another employee, or staff", async () => {
    const id = await sc.startScopedDm(await as(E.a1), ids.a);
    const missing = await msg(sc.openScopedConversation(await as(E.a1), crypto.randomUUID()));
    for (const who of [ids.b, E.a2, E.b1]) {
      const actor = await as(who);
      expect(await msg(sc.openScopedConversation(actor, id)), who).toBe(missing);
      expect(await msg(sc.sendScopedMessage(actor, id, "intruder")), who).toBe(missing);
    }
    await expect(sc.openScopedConversation(await as(ids.staff), id)).rejects.toThrow(/permission/i);
    await expect(chat.openConversation(await as(ids.staff), id)).rejects.toThrow(/exist|in it/i); // the older chat refuses a non-member too
    const texts = await t.db.select().from(t.schema.chatMessages).where(eq(t.schema.chatMessages.channelId, id));
    expect(texts.some((m) => m.body === "intruder")).toBe(false);
  });

  it("a conversation with someone they may no longer talk to disappears for both sides", async () => {
    const owner = await as(ids.owner);
    const e2 = await as(E.a2);
    const id = await sc.startScopedDm(e2, ids.a);
    await sc.sendScopedMessage(e2, id, "before the move");
    const emp2 = await import("@/lib/dal/partner-employees");
    await emp2.reassignEmployee(owner, { employeeId: E.a2, partnerUserId: ids.b });
    const moved = await as(E.a2);
    expect((await sc.scopedConversations(moved)).map((c) => c.id)).not.toContain(id);
    expect((await sc.scopedConversations(await as(ids.a))).map((c) => c.id)).not.toContain(id);
    await expect(sc.openScopedConversation(moved, id)).rejects.toThrow(/no longer exists/);
    await expect(sc.sendScopedMessage(await as(ids.a), id, "still there?")).rejects.toThrow(/no longer exists/);
    // but they can reach their new partner, and the admins who could always read it can still read it
    await sc.startScopedDm(moved, ids.b);
    expect((await sc.oversightRead(owner, id)).messages.map((m) => m.body)).toEqual(["before the move"]);
  });
});

describe("never in the company-wide chat", () => {
  it("scoped people are not in #general, not in anyone's people list, and can't be messaged through the older chat", async () => {
    const owner = await as(ids.owner);
    await chat.myConversations(owner); // creates #general and joins the admin
    const general = (await t.db.select().from(t.schema.chatChannels).where(eq(t.schema.chatChannels.isDefault, true)))[0];
    const inGeneral = (await t.db.select().from(t.schema.chatMembers).where(eq(t.schema.chatMembers.channelId, general.id))).map((m) => m.userId);
    for (const scoped of [ids.a, ids.b, E.a1, E.a2, E.b1]) expect(inGeneral).not.toContain(scoped);
    const people = (await chat.chatPeople(owner)).map((p) => p.id);
    for (const scoped of [ids.a, ids.b, E.a1, E.a2, E.b1]) expect(people).not.toContain(scoped);
    await expect(chat.openDirectMessage(owner, E.a1)).rejects.toThrow(/can't use chat/i);
    await expect(chat.myConversations(await as(E.a1))).rejects.toThrow(/permission/i);
    await expect(chat.chatPeople(await as(ids.a))).rejects.toThrow(/permission/i);
    await expect(chat.saveChannel(owner, null, { name: "partners", memberIds: [ids.a] })).rejects.toThrow(/chat access/i);
  });

  it("an admin sees their conversation with a partner in the normal Team chat and can reply there", async () => {
    const owner = await as(ids.owner);
    const id = await sc.startDmAsAdmin(owner, ids.a);
    await chat.sendMessage(owner, id, "From the admin");
    const mine = await chat.myConversations(owner);
    expect(mine.find((c) => c.id === id)?.label).toBe("Name a");
    expect((await sc.openScopedConversation(await as(ids.a), id)).messages.map((m) => m.body)).toContain("From the admin");
  });
});

describe("admin oversight", () => {
  it("lists conversations an admin isn't in that include a partner or employee, and never admin-to-admin chats", async () => {
    const owner = await as(ids.owner);
    const adminDm = await chat.openDirectMessage(owner, ids.admin2);
    await chat.sendMessage(owner, adminDm, "PRIVATE ADMIN TALK");
    const admin2 = await as(ids.admin2);
    const list = await sc.oversightConversations(admin2);
    expect(list.map((r) => r.id)).not.toContain(adminDm);
    expect(list.every((r) => r.people.length === 2)).toBe(true);
    expect(JSON.stringify(list)).not.toContain("PRIVATE ADMIN TALK");
    // admin2 isn't in the A/eA1 conversation, so it is listed for them; the owner's own conversations are not (they're in them)
    const e1a = await sc.startScopedDm(await as(E.a1), ids.a);
    expect((await sc.oversightConversations(admin2)).map((r) => r.id)).toContain(e1a);
    const ownerList = await sc.oversightConversations(owner);
    expect(ownerList.map((r) => r.id)).toContain(e1a);
    expect(ownerList.every((r) => !r.people.every((p) => ["Olive Owner"].includes(p)))).toBe(true);
  });

  it("reading a conversation shows its messages and writes the audit log every time (never the text)", async () => {
    const owner = await as(ids.owner);
    const id = await sc.startScopedDm(await as(E.a1), ids.a);
    await sc.sendScopedMessage(await as(E.a1), id, "Secret project plan");
    const before = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id))).filter((r) => r.action === "read").length;
    const a = await sc.oversightRead(owner, id);
    await sc.oversightRead(owner, id);
    expect(a.messages.map((m) => m.body)).toContain("Secret project plan");
    expect(a.people.sort()).toEqual(["Emp ea1", "Name a"]);
    const rows = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id))).filter((r) => r.action === "read");
    expect(rows).toHaveLength(before + 2);
    expect(rows[rows.length - 1]).toMatchObject({ actorId: ids.owner, entity: "chat_channels" });
    expect(JSON.stringify(rows)).not.toContain("Secret project plan");
  });

  it("can't open admin-to-admin chats, a channel, or a made-up id, and isn't available to anyone but admins", async () => {
    const owner = await as(ids.owner);
    const adminDm = await chat.openDirectMessage(owner, ids.admin2);
    const missing = await msg(sc.oversightRead(owner, crypto.randomUUID()));
    expect(await msg(sc.oversightRead(owner, adminDm))).toBe(missing);
    const general = (await t.db.select().from(t.schema.chatChannels).where(eq(t.schema.chatChannels.isDefault, true)))[0];
    expect(await msg(sc.oversightRead(owner, general.id))).toBe(missing);
    const id = await sc.startScopedDm(await as(E.a1), ids.a);
    for (const who of [ids.a, E.a1, ids.staff, ids.b]) {
      await expect(sc.oversightRead(await as(who), id), who).rejects.toThrow(/permission|admins/i);
      await expect(sc.oversightConversations(await as(who)), who).rejects.toThrow(/permission|admins/i);
    }
  });

  it("a partner can't see another partner's chats, even by listing their own conversations", async () => {
    const b = await as(ids.b);
    const mine = await sc.scopedConversations(b);
    const aChats = await t.db.select().from(t.schema.chatMembers).where(eq(t.schema.chatMembers.userId, ids.a));
    const aIds = aChats.map((m) => m.channelId);
    expect(mine.filter((c) => aIds.includes(c.id)).every((c) => c.withId === ids.owner || c.withId === ids.admin2)).toBe(true);
  });
});
