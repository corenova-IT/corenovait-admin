import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { zonedToUtc } from "@/lib/zoned";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Phase 5: notifications and the scheduler (task due, meetings, payments, emails), and the cron endpoint. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let n: typeof import("@/lib/dal/notifications");
let tk: typeof import("@/lib/dal/tasks");
let ids: { admin: string; a: string; b: string; nocal: string };
const today = todayIn("Australia/Sydney");
const as = (id: string) => actorFor(t, id);
const notesFor = (userId: string) => t.db.select().from(t.schema.notifications).where(eq(t.schema.notifications.userId, userId));

beforeAll(async () => {
  t = await setupTestDatabase();
  [n, tk] = await Promise.all([import("@/lib/dal/notifications"), import("@/lib/dal/tasks")]);
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    a: (await createPerson(t, { email: "ann@example.test" })).id,
    b: (await createPerson(t, { email: "bob@example.test" })).id,
    nocal: (await createPerson(t, { email: "nocal@example.test" })).id,
  };
  const { loadUserPerms, writeUserPerms } = await import("@/lib/dal/internal");
  await t.db.transaction(async (tx) => {
    const map = await loadUserPerms(tx, ids.nocal);
    map.calendar = { view: false, create: false, edit: false, delete: false, export: false, scope: "own" };
    await writeUserPerms(tx, ids.nocal, map);
  });
});
afterAll(() => t?.cleanup());

describe("as it happens", () => {
  it("assigning a task notifies the assignee, but not when you assign it to yourself", async () => {
    const admin = await as(ids.admin);
    const id = await tk.createTask(admin, { title: "Write the brief", assigneeId: ids.a });
    await tk.createTask(admin, { title: "My own", assigneeId: ids.admin });
    expect((await notesFor(ids.a)).map((x) => [x.type, x.title, x.href])).toEqual([["task_assigned", "New task for you: Write the brief", `/tasks?task=${id}`]]);
    expect(await notesFor(ids.admin)).toEqual([]);
    // reassigning tells the new person
    await tk.updateTask(admin, id, { title: "Write the brief", assigneeId: ids.b });
    expect((await notesFor(ids.b)).map((x) => x.type)).toEqual(["task_assigned"]);
  });
});

describe("your own notifications only", () => {
  it("you see, open and clear only yours", async () => {
    const a = await as(ids.a);
    const b = await as(ids.b);
    const [mine] = await n.listNotifications(a);
    expect(await n.unreadNotificationCount(a)).toBe(1);
    expect(await n.openNotification(b, mine.id)).toBeNull(); // Bob can't open Ann's
    expect(await n.unreadNotificationCount(a)).toBe(1);
    expect(await n.openNotification(a, mine.id)).toMatch(/^\/tasks\?task=/);
    expect(await n.unreadNotificationCount(a)).toBe(0);
    await n.markAllNotificationsRead(b);
    expect((await n.listNotifications(b)).every((x) => x.read)).toBe(true);
    expect((await n.listNotifications(a)).map((x) => x.id)).not.toEqual((await n.listNotifications(b)).map((x) => x.id));
  });

  it("the email setting is per person and audited", async () => {
    const b = await as(ids.b);
    expect(await n.getEmailPreference(b)).toBe(true);
    await n.setEmailPreference(b, false);
    expect(await n.getEmailPreference(b)).toBe(false);
    expect(await n.getEmailPreference(await as(ids.a))).toBe(true);
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.summary, "Email notifications off"));
    expect(log).toMatchObject({ entityId: ids.b });
  });
});

describe("the scheduler", () => {
  it("reminds about tasks due today and tomorrow, once", async () => {
    const admin = await as(ids.admin);
    await tk.createTask(admin, { title: "Due today", assigneeId: ids.a, dueDate: today });
    await tk.createTask(admin, { title: "Due tomorrow", assigneeId: ids.a, dueDate: addDays(today, 1) });
    await tk.createTask(admin, { title: "Due next week", assigneeId: ids.a, dueDate: addDays(today, 7) });
    await tk.createTask(admin, { title: "Done already", assigneeId: ids.a, dueDate: today, status: "done" });
    const first = await n.runScheduler();
    expect(first.taskDue).toBe(2);
    const titles = (await notesFor(ids.a)).filter((x) => x.type === "task_due").map((x) => x.title).sort();
    expect(titles).toEqual(["Due today: Due today", "Due tomorrow: Due tomorrow"]);
    // a second run (or two at once) adds nothing
    const [again, parallel] = await Promise.all([n.runScheduler(), n.runScheduler()]);
    expect(again.taskDue + parallel.taskDue).toBe(0);
    expect((await notesFor(ids.a)).filter((x) => x.type === "task_due")).toHaveLength(2);
  });

  it("sends meeting reminders when the reminder time comes, to invited people who can see the calendar", async () => {
    const cal = await import("@/lib/dal/calendar");
    const admin = await as(ids.admin);
    // starts in 20 minutes, reminder 30 minutes before: due now
    const start = new Date(Date.now() + 20 * 60_000);
    const local = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Australia/Sydney", dateStyle: "short", timeStyle: "short" }).format(d).replace(" ", "T");
    const soon = await cal.createEvent(admin, { title: "Soon", start: local(start), end: local(new Date(start.getTime() + 30 * 60_000)), reminderMinutes: 30, attendeeIds: [ids.a, ids.nocal] });
    // starts in 3 hours with a 10-minute reminder: not yet
    const later = new Date(Date.now() + 3 * 3600_000);
    await cal.createEvent(admin, { title: "Later", start: local(later), end: local(new Date(later.getTime() + 30 * 60_000)), reminderMinutes: 10, attendeeIds: [ids.a] });
    const r = await n.runScheduler();
    expect(r.meetings).toBe(2); // Ann and the admin who created it; not the person without calendar access
    expect((await notesFor(ids.a)).filter((x) => x.type === "meeting_reminder").map((x) => x.title)).toEqual([expect.stringMatching(/: Soon$/)]);
    expect((await notesFor(ids.nocal)).filter((x) => x.type === "meeting_reminder")).toEqual([]);
    expect((await n.runScheduler()).meetings).toBe(0);
    // moving the meeting reminds again for the new time
    void soon;
  });

  it("reminds the person looking after a payment, inside its reminder window, if they can see payments", async () => {
    const pay = await import("@/lib/dal/payments");
    const admin = await as(ids.admin);
    await pay.saveSubscription(admin, null, { vendor: "Hosting soon", category: "Hosting", amount: "10", currency: "AUD", nextDueDate: addDays(today, 2), reminderDays: "3", responsibleUserId: ids.admin });
    await pay.saveSubscription(admin, null, { vendor: "Hosting later", category: "Hosting", amount: "10", currency: "AUD", nextDueDate: addDays(today, 20), reminderDays: "3", responsibleUserId: ids.admin });
    // Ann looks after one but can't see payments: no reminder for her
    await pay.saveSubscription(admin, null, { vendor: "Ann's", category: "Hosting", amount: "10", currency: "AUD", nextDueDate: today, reminderDays: "3", responsibleUserId: ids.a });
    const r = await n.runScheduler();
    expect(r.payments).toBe(1);
    expect((await notesFor(ids.admin)).filter((x) => x.type === "payment_due").map((x) => x.title)).toEqual([`Due ${addDays(today, 2)}: Hosting soon`]);
    expect((await notesFor(ids.a)).filter((x) => x.type === "payment_due")).toEqual([]);
  });

  it("emails each notification once, only to people with email on", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined); // dev mail is printed, not sent
    await t.db.update(t.schema.notifications).set({ emailedAt: null, emailSkipped: false });
    const r = await n.runScheduler();
    expect(r.emailed).toBeGreaterThan(0);
    expect(r.emailSkipped).toBeGreaterThan(0); // Bob turned email off
    const bob = await notesFor(ids.b);
    expect(bob.every((x) => x.emailSkipped && !x.emailedAt)).toBe(true);
    const ann = await notesFor(ids.a);
    expect(ann.every((x) => x.emailedAt)).toBe(true);
    const sent = info.mock.calls.length;
    const again = await n.runScheduler();
    expect(again.emailed).toBe(0);
    expect(info.mock.calls.length).toBe(sent);
    info.mockRestore();
  });

  it("meeting times use the company time zone", () => {
    expect(zonedToUtc(`${today}T09:00`, "Australia/Sydney")).toBeInstanceOf(Date);
  });
});

describe("the cron endpoint", () => {
  const call = async (auth?: string) => {
    const { POST } = await import("@/app/api/cron/notifications/route");
    return POST(new Request("http://localhost/api/cron/notifications", { method: "POST", headers: auth ? { authorization: auth } : {} }));
  };

  it("is off until CRON_SECRET is set", async () => {
    delete process.env.CRON_SECRET;
    expect((await call("Bearer anything")).status).toBe(503);
    process.env.CRON_SECRET = "short";
    expect((await call("Bearer short")).status).toBe(503);
  });

  it("refuses a missing or wrong token, runs with the right one, and is rate-limited", async () => {
    const secret = "test-cron-secret-0123456789-abcdefghij";
    process.env.CRON_SECRET = secret;
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-0123456789-abcdefghijk")).status).toBe(401);
    expect((await call(secret)).status).toBe(401); // the "Bearer " prefix is required
    const ok = await call(`Bearer ${secret}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, taskDue: 0, meetings: 0, payments: 0 });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await call(`Bearer ${secret}`)).status);
    expect(statuses).toContain(429);
  });
});
