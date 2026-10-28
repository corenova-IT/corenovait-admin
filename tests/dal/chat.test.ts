import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, countRows, createPerson, setupTestDatabase, snapshot } from "./db";

/** Phase 5: chat. Membership is the only way in; DMs are private even from admins. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let chat: typeof import("@/lib/dal/chat");
let ids: { admin: string; a: string; b: string; c: string; nochat: string };
const DENIED = /permission|not in it|own messages|Only admins|session/i;
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");

const as = (id: string) => actorFor(t, id);

beforeAll(async () => {
  t = await setupTestDatabase();
  chat = await import("@/lib/dal/chat");
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    a: (await createPerson(t, { email: "ann@example.test" })).id, // staff: chat view/create/edit
    b: (await createPerson(t, { email: "bob@example.test" })).id,
    c: (await createPerson(t, { email: "cara@example.test" })).id,
    nochat: (await createPerson(t, { email: "nochat@example.test" })).id,
  };
  const { emptyPermMap } = await import("@/lib/permissions");
  const { writeUserPerms } = await import("@/lib/dal/internal");
  const map = emptyPermMap();
  map.home = { view: true, create: false, edit: false, delete: false, export: false, scope: "own" };
  await t.db.transaction((tx) => writeUserPerms(tx, ids.nochat, map));
});
afterAll(() => t?.cleanup());

describe("#general and channels", () => {
  it("everyone with chat access is in #general automatically", async () => {
    for (const id of [ids.a, ids.b, ids.admin]) expect((await chat.myConversations(await as(id))).map((c) => c.label)).toContain("#general");
  });

  it("someone without chat access can't read or post anything", async () => {
    const general = (await chat.myConversations(await as(ids.a))).find((c) => c.label === "#general")!.id;
    const none = await as(ids.nochat);
    const before = { ...(await snapshot(t)), msgs: await countRows(t, "chat_messages") };
    for (const attempt of [
      () => chat.myConversations(none),
      () => chat.openConversation(none, general),
      () => chat.sendMessage(none, general, "hi"),
      () => chat.chatSync(none, { channelId: general }),
      () => chat.openDirectMessage(none, ids.a),
      () => chat.chatPeople(none),
    ])
      await expect(attempt()).rejects.toThrow(DENIED);
    expect({ ...(await snapshot(t)), msgs: await countRows(t, "chat_messages") }).toEqual(before);
    expect(await chat.unreadChatTotal(none)).toBe(0);
  });

  it("a private channel can't be read, posted to or synced by people who aren't in it, admins included", async () => {
    const admin = await as(ids.admin);
    // the admin creates it for Ann and Bob, then leaves it
    const id = await chat.saveChannel(admin, null, { name: "Projects", topic: "Client work", memberIds: [ids.a, ids.b] });
    await chat.saveChannel(admin, id, { name: "projects", memberIds: [ids.a, ids.b] });
    await chat.sendMessage(await as(ids.a), id, "Secret project plan");

    const cara = await as(ids.c);
    await expect(chat.openConversation(cara, id)).rejects.toThrow(/not in it/);
    await expect(chat.sendMessage(cara, id, "let me in")).rejects.toThrow(/not in it/);
    const synced = await chat.chatSync(cara, { channelId: id });
    expect(synced.changes).toEqual([]);
    expect(synced.typing).toEqual([]);
    expect((await chat.myConversations(cara)).map((c) => c.id)).not.toContain(id);

    // not even the admin who manages it can read it without being a member
    await expect(chat.openConversation(admin, id)).rejects.toThrow(/not in it/);
    // the admin's management view has names and counts, never messages
    const managed = (await chat.channelsForAdmin(admin)).find((c) => c.id === id)!;
    expect(managed).toMatchObject({ name: "projects", memberCount: 2 });
    expect(JSON.stringify(managed)).not.toContain("Secret");
  });

  it("an admin who adds themselves can read it, and that is in the audit log", async () => {
    const admin = await as(ids.admin);
    const id = (await chat.channelsForAdmin(admin)).find((c) => c.name === "projects")!.id;
    await chat.saveChannel(admin, id, { name: "projects", memberIds: [ids.a, ids.b, ids.admin] });
    expect((await chat.openConversation(admin, id)).messages.map((m) => m.body)).toEqual(["Secret project plan"]);
    const log = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));
    expect(log.map((l) => l.summary)).toContain("#projects (added themselves)");
    // and the message text isn't in the audit log
    expect(JSON.stringify(await t.db.select().from(t.schema.auditLog))).not.toContain("Secret project plan");
  });

  it("only admins manage channels; #general can't be archived; archived channels are read-only", async () => {
    const a = await as(ids.a);
    await expect(chat.saveChannel(a, null, { name: "mine", memberIds: [] })).rejects.toThrow(/Only admins/);
    await expect(chat.channelsForAdmin(a)).rejects.toThrow(/Only admins/);
    const admin = await as(ids.admin);
    const general = (await chat.channelsForAdmin(admin)).find((c) => c.isDefault)!.id;
    await expect(chat.setChannelArchived(admin, general, true)).rejects.toThrow(/can't be archived/);
    const id = (await chat.channelsForAdmin(admin)).find((c) => c.name === "projects")!.id;
    await chat.setChannelArchived(admin, id, true);
    await expect(chat.sendMessage(a, id, "still here?")).rejects.toThrow(/archived/);
    expect((await chat.openConversation(a, id)).channel.archived).toBe(true);
    await chat.setChannelArchived(admin, id, false);
  });
});

describe("direct messages are private", () => {
  let dm: string;
  let fileId: string;

  beforeAll(async () => {
    const a = await as(ids.a);
    dm = await chat.openDirectMessage(a, ids.b);
    const sent = await chat.sendMessage(a, dm, "Just between us", { name: "private.png", bytes: PNG });
    fileId = sent.file!.id;
  });

  it("there's exactly one DM per pair, from either side", async () => {
    expect(await chat.openDirectMessage(await as(ids.b), ids.a)).toBe(dm);
  });

  it("the two people can read it", async () => {
    expect((await chat.openConversation(await as(ids.b), dm)).messages.map((m) => m.body)).toEqual(["Just between us"]);
  });

  it("nobody else can, not even an admin: not the messages, the attachment, the list or the sync", async () => {
    for (const id of [ids.c, ids.admin]) {
      const who = await as(id);
      await expect(chat.openConversation(who, dm)).rejects.toThrow(/not in it/);
      await expect(chat.sendMessage(who, dm, "hello")).rejects.toThrow(/not in it/);
      expect((await chat.chatSync(who, { channelId: dm })).changes).toEqual([]);
      expect((await chat.myConversations(who)).map((c) => c.id)).not.toContain(dm);
      const { getFileForDownload } = await import("@/lib/dal/files");
      expect(await getFileForDownload(who, fileId)).toBeNull();
    }
    // admins manage channels, never DMs
    expect((await chat.channelsForAdmin(await as(ids.admin))).map((c) => c.id)).not.toContain(dm);
    await expect(chat.saveChannel(await as(ids.admin), dm, { name: "hijack", memberIds: [ids.admin] })).rejects.toThrow(/no longer exists/);
  });

  it("the attachment downloads for the two people only, and its name isn't in the audit log", async () => {
    const { getFileForDownload } = await import("@/lib/dal/files");
    expect((await getFileForDownload(await as(ids.b), fileId))?.mimeType).toBe("image/png");
    expect(JSON.stringify(await t.db.select().from(t.schema.auditLog))).not.toContain("private.png");
  });
});

describe("messages", () => {
  let general: string;
  beforeAll(async () => {
    general = (await chat.myConversations(await as(ids.a))).find((c) => c.label === "#general")!.id;
  });

  it("you can edit and delete your own messages, not anyone else's", async () => {
    const a = await as(ids.a);
    const mine = await chat.sendMessage(a, general, "Typo here");
    const edited = await chat.editMessage(a, mine.id, "Fixed");
    expect(edited).toMatchObject({ body: "Fixed" });
    expect(edited.editedAt).not.toBeNull();
    await expect(chat.editMessage(await as(ids.b), mine.id, "Not yours")).rejects.toThrow(/own messages/);
    await expect(chat.deleteMessage(await as(ids.admin), mine.id)).rejects.toThrow(/own messages/);
    // staff can delete their own (the Staff preset has chat edit)
    await chat.deleteMessage(a, mine.id);
    const after = (await chat.openConversation(a, general)).messages.find((m) => m.id === mine.id)!;
    expect(after).toMatchObject({ deleted: true, body: "" });
  });

  it("unread counts go up for others and clear when read", async () => {
    const b = await as(ids.b);
    await chat.markRead(b, general);
    await chat.sendMessage(await as(ids.a), general, "One");
    await chat.sendMessage(await as(ids.a), general, "Two");
    expect((await chat.myConversations(b)).find((c) => c.id === general)?.unread).toBe(2);
    expect(await chat.unreadChatTotal(b)).toBeGreaterThanOrEqual(2);
    await chat.chatSync(b, { channelId: general, read: true });
    expect((await chat.myConversations(b)).find((c) => c.id === general)?.unread).toBe(0);
    // your own messages never count as unread
    expect((await chat.myConversations(await as(ids.a))).find((c) => c.id === general)?.unread).toBe(0);
  });

  it("sync returns new, edited and deleted messages since a moment, and who is typing", async () => {
    const b = await as(ids.b);
    const first = await chat.chatSync(b, { channelId: general });
    const a = await as(ids.a);
    const m = await chat.sendMessage(a, general, "Live one");
    await chat.setTyping(a, general);
    const next = await chat.chatSync(b, { channelId: general, since: first.now });
    expect(next.changes.map((x) => x.body)).toContain("Live one");
    expect(next.typing).toEqual(["ann"]);
    await chat.editMessage(a, m.id, "Live one, edited");
    const edits = await chat.chatSync(b, { channelId: general, since: next.now });
    expect(edits.changes.find((x) => x.id === m.id)?.body).toBe("Live one, edited");
    // the author never sees their own typing indicator
    expect((await chat.chatSync(a, { channelId: general })).typing).toEqual([]);
  });

  it("@mentions notify members who are mentioned, nobody else", async () => {
    const id = await chat.saveChannel(await as(ids.admin), null, { name: "mentions", memberIds: [ids.a, ids.b] });
    await chat.sendMessage(await as(ids.a), id, "@bob can you check this? @cara too");
    const notes = await t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.type, "chat_mention"));
    expect(notes.map((n) => n.userId)).toEqual([ids.b]); // Cara isn't in the channel
    expect(notes[0]).toMatchObject({ href: `/chat?c=${id}` });
  });

  it("refuses empty and over-long messages", async () => {
    const a = await as(ids.a);
    await expect(chat.sendMessage(a, general, "   ")).rejects.toThrow(/Write a message/);
    await expect(chat.sendMessage(a, general, "x".repeat(chat.MAX_MESSAGE + 1))).rejects.toThrow(/under/);
  });
});

describe("admins removing messages (channels only)", () => {
  it("an admin in a channel can remove someone else's message; it shows as removed, audited without the text", async () => {
    const admin = await as(ids.admin);
    const general = (await chat.myConversations(admin)).find((c) => c.label === "#general")!.id;
    const m = await chat.sendMessage(await as(ids.a), general, "Something to moderate");
    await chat.removeMessageAsAdmin(admin, m.id);
    const seen = (await chat.openConversation(await as(ids.b), general)).messages.find((x) => x.id === m.id)!;
    expect(seen).toMatchObject({ deleted: true, removedByAdmin: true, body: "" });
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, m.id));
    expect(log).toMatchObject({ action: "delete", summary: "Removed a message in #general (moderation)" });
    expect(JSON.stringify(log)).not.toContain("Something to moderate");
  });

  it("never in a direct message, and not by staff", async () => {
    const dm = await chat.openDirectMessage(await as(ids.a), ids.admin);
    const m = await chat.sendMessage(await as(ids.a), dm, "DM text");
    // even though the admin is in this DM, admins can't moderate DMs
    await expect(chat.removeMessageAsAdmin(await as(ids.admin), m.id)).rejects.toThrow(/direct message/);
    const general = (await chat.myConversations(await as(ids.a))).find((c) => c.label === "#general")!.id;
    const other = await chat.sendMessage(await as(ids.b), general, "Bob's");
    await expect(chat.removeMessageAsAdmin(await as(ids.a), other.id)).rejects.toThrow(/Only admins/);
    expect((await chat.openConversation(await as(ids.a), dm)).messages.find((x) => x.id === m.id)?.deleted).toBe(false);
  });
});

describe("attachment clean-up (run by the cron job)", () => {
  it("removes files no message uses any more, from disk and the database, and leaves files in use alone", async () => {
    const { existsSync } = await import("node:fs");
    const path = await import("node:path");
    const { cleanupOrphanedChatFiles, uploadDir } = await import("@/lib/dal/files");
    const a = await as(ids.a);
    const general = (await chat.myConversations(a)).find((c) => c.label === "#general")!.id;
    const kept = await chat.sendMessage(a, general, "keep", { name: "keep.png", bytes: PNG });
    const gone = await chat.sendMessage(a, general, "gone", { name: "gone.png", bytes: PNG });
    await chat.deleteMessage(a, gone.id);
    const fileRow = async (id: string) => (await t.db.select().from(t.schema.files).where(eq(t.schema.files.id, id)))[0];
    const goneFile = await fileRow(gone.file!.id);
    const onDisk = (key: string) => existsSync(path.join(uploadDir(), key));
    expect(onDisk(goneFile.storageKey)).toBe(true);

    // within the hour's grace nothing goes
    expect(await cleanupOrphanedChatFiles(new Date())).toBe(0);
    // later, the deleted message's file goes; the one still attached stays
    const removed = await cleanupOrphanedChatFiles(new Date(Date.now() + 2 * 3600_000));
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await fileRow(gone.file!.id)).toBeUndefined();
    expect(onDisk(goneFile.storageKey)).toBe(false);
    const keptFile = await fileRow(kept.file!.id);
    expect(keptFile).toBeDefined();
    expect(onDisk(keptFile.storageKey)).toBe(true);
    // running it again is harmless
    expect(await cleanupOrphanedChatFiles(new Date(Date.now() + 2 * 3600_000))).toBe(0);
  });
});
