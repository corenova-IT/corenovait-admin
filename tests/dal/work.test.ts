import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { actorFor, countRows, createPerson, setupTestDatabase, snapshot } from "./db";

/** Phase 4: calendar and tasks. Scope on every action, audit, drag to reschedule, .ics, My tasks and team progress. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let cal: typeof import("@/lib/dal/calendar");
let tk: typeof import("@/lib/dal/tasks");
let ids: { admin: string; manager: string; a: string; b: string; none: string; gone: string };
const DENIED = /permission|isn't yours|only the person|only assign|can't see it|own comments|everyone's tasks|session/i;
const today = todayIn("Australia/Sydney");

const as = (id: string) => actorFor(t, id);
const ev = (over: Record<string, unknown> = {}) => ({ title: "Client call", type: "meeting" as const, start: "2026-10-02T10:00", end: "2026-10-02T11:00", ...over });

beforeAll(async () => {
  t = await setupTestDatabase();
  [cal, tk] = await Promise.all([import("@/lib/dal/calendar"), import("@/lib/dal/tasks")]);
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true })).id,
    a: (await createPerson(t, { email: "a@example.test" })).id, // staff: calendar + tasks, scope "assigned"
    b: (await createPerson(t, { email: "b@example.test" })).id,
    none: (await createPerson(t, { email: "none@example.test" })).id,
    gone: (await createPerson(t, { email: "gone@example.test", status: "deactivated" })).id,
  };
  // someone with no calendar or task access at all
  const { emptyPermMap } = await import("@/lib/permissions");
  const { writeUserPerms } = await import("@/lib/dal/internal");
  const map = emptyPermMap();
  map.home = { view: true, create: false, edit: false, delete: false, export: false, scope: "own" };
  await t.db.transaction((tx) => writeUserPerms(tx, ids.none, map));
});
afterAll(() => t?.cleanup());

// ---------------------------------------------------------------- calendar
describe("calendar scope", () => {
  let invited: string;
  let notInvited: string;

  beforeAll(async () => {
    const admin = await as(ids.admin);
    invited = await cal.createEvent(admin, ev({ title: "Team stand-up", attendeeIds: [ids.a, ids.admin] }));
    notInvited = await cal.createEvent(admin, ev({ title: "Founders only", start: "2026-10-03T14:00", end: "2026-10-03T15:00" }));
  });

  const titles = async (id: string) => (await cal.calendarItems(await as(id), "2026-10-01", "2026-10-31")).items.filter((i) => i.event).map((i) => i.title).sort();

  it("staff see only events they're invited to or created; a manager sees all", async () => {
    expect(await titles(ids.a)).toEqual(["Team stand-up"]);
    expect(await titles(ids.b)).toEqual([]);
    expect(await titles(ids.manager)).toEqual(["Founders only", "Team stand-up"]);
  });

  it("someone without calendar access can't read or change anything", async () => {
    const none = await as(ids.none);
    const before = { ...(await snapshot(t)), ev: await countRows(t, "events") };
    for (const attempt of [
      () => cal.calendarItems(none, "2026-10-01", "2026-10-31"),
      () => cal.upcomingEvents(none),
      () => cal.getEvent(none, invited),
      () => cal.createEvent(none, ev()),
      () => cal.updateEvent(none, invited, ev({ title: "x" })),
      () => cal.moveEvent(none, invited, "2026-10-09"),
      () => cal.deleteEvent(none, invited),
      () => cal.eventIcs(none, invited),
      () => cal.exportCalendarIcs(none),
    ])
      await expect(attempt()).rejects.toThrow(DENIED);
    expect({ ...(await snapshot(t)), ev: await countRows(t, "events") }).toEqual(before);
  });

  it("an attendee can't change, move or delete someone else's event; an outsider learns nothing", async () => {
    const a = await as(ids.a);
    await expect(cal.updateEvent(a, invited, ev({ title: "Renamed" }))).rejects.toThrow(/Only the person who created/);
    await expect(cal.moveEvent(a, invited, "2026-10-09")).rejects.toThrow(/Only the person who created/);
    await expect(cal.deleteEvent(a, invited)).rejects.toThrow(DENIED); // staff can't delete events at all
    await expect(cal.updateEvent(await as(ids.b), notInvited, ev())).rejects.toThrow(/doesn't exist or isn't yours/);
    expect(await cal.getEvent(await as(ids.b), notInvited)).toBeNull();
  });

  it("staff can create their own events and invite others, who then see them", async () => {
    const id = await cal.createEvent(await as(ids.a), ev({ title: "Design review", attendeeIds: [ids.b], start: "2026-10-06T09:00", end: "2026-10-06T09:30" }));
    expect(await titles(ids.b)).toEqual(["Design review"]);
    const item = await cal.getEvent(await as(ids.b), id);
    expect(item?.editable).toBe(false);
    expect((await cal.getEvent(await as(ids.a), id))?.editable).toBe(true);
  });

  it("refuses bad input: end before start, a non-https video link, inviting someone deactivated", async () => {
    const admin = await as(ids.admin);
    await expect(cal.createEvent(admin, ev({ end: "2026-10-02T09:00" }))).rejects.toThrow(/ends before it starts/);
    await expect(cal.createEvent(admin, ev({ videoUrl: "javascript:alert(1)" }))).rejects.toThrow(/https/);
    await expect(cal.createEvent(admin, ev({ attendeeIds: [ids.gone] }))).rejects.toThrow(/active team members/);
  });
});

describe("drag to reschedule", () => {
  it("keeps the local time and length, across the daylight-saving change", async () => {
    const admin = await as(ids.admin);
    // Fri 2 Oct 10:00–11:30 (UTC+10) moved to Mon 5 Oct, after the clocks went forward (UTC+11)
    const id = await cal.createEvent(admin, ev({ title: "Move me", start: "2026-10-02T10:00", end: "2026-10-02T11:30" }));
    await cal.moveEvent(admin, id, "2026-10-05");
    const moved = await cal.getEvent(admin, id);
    expect(moved?.event).toMatchObject({ startLocal: "2026-10-05T10:00", endLocal: "2026-10-05T11:30" });
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.summary, "Moved from 2026-10-02 to 2026-10-05"));
    expect(log).toMatchObject({ action: "update", entity: "events", entityId: id });
  });

  it("moves an all-day event by whole days", async () => {
    const admin = await as(ids.admin);
    const id = await cal.createEvent(admin, ev({ title: "Offsite", allDay: true, start: "2026-11-10", end: "2026-11-11" }));
    expect((await cal.getEvent(admin, id))).toMatchObject({ date: "2026-11-10", endDate: "2026-11-11", time: null });
    await cal.moveEvent(admin, id, "2026-11-20");
    expect((await cal.getEvent(admin, id))).toMatchObject({ date: "2026-11-20", endDate: "2026-11-21" });
  });

  it("is audited with the attendees before and after an edit", async () => {
    const admin = await as(ids.admin);
    const id = await cal.createEvent(admin, ev({ title: "Audit me", attendeeIds: [ids.a] }));
    await cal.updateEvent(admin, id, ev({ title: "Audit me", attendeeIds: [ids.a, ids.b] }));
    const [u] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id)).then((r) => r.filter((x) => x.action === "update"));
    expect((u.before as { attendees: string[] }).attendees).toEqual([ids.a]);
    expect((u.after as { attendees: string[] }).attendees).toEqual([ids.a, ids.b].sort());
  });
});

describe(".ics", () => {
  it("an invited person can download one event; the full export needs export permission and is logged", async () => {
    const admin = await as(ids.admin);
    const id = await cal.createEvent(admin, ev({ title: "Kick-off, phase 4; launch", videoUrl: "https://meet.example.test/abc", reminderMinutes: 30, attendeeIds: [ids.a] }));
    const one = await cal.eventIcs(await as(ids.a), id);
    expect(one?.ics).toContain("SUMMARY:Kick-off\\, phase 4\\; launch");
    expect(one?.ics).toContain("DTSTART:20261002T000000Z"); // 2 Oct 10:00 Sydney is still +10 (clocks change on 4 Oct)
    expect(one?.ics).toContain("TRIGGER:-PT30M");
    expect(await cal.eventIcs(await as(ids.b), id)).toBeNull();
    await expect(cal.exportCalendarIcs(await as(ids.a))).rejects.toThrow(DENIED);
    const all = await cal.exportCalendarIcs(admin);
    expect(all.ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, "calendar"));
    expect(log).toMatchObject({ action: "export" });
  });
});

describe("repeating events", () => {
  // every Monday 09:30 Sydney, March to April 2027: the clocks go back on 4 April
  const series = (over: Record<string, unknown> = {}) => ev({ title: "Weekly stand-up", start: "2027-03-01T09:30", end: "2027-03-01T10:00", recurrence: "weekly", recurrenceUntil: "2027-04-26", reminderMinutes: 10, attendeeIds: [ids.a], ...over });
  const inSpring = async (id: string) => (await cal.calendarItems(await as(id), "2027-03-01", "2027-04-30")).items.filter((i) => i.event);
  let id: string;

  beforeAll(async () => {
    id = await cal.createEvent(await as(ids.manager), series());
  });

  it("shows one item per occurrence, at the same local time through the daylight-saving change, only to people who may see it", async () => {
    const mine = (await inSpring(ids.a)).filter((i) => i.id === id);
    expect(mine.map((i) => i.date)).toEqual(["2027-03-01", "2027-03-08", "2027-03-15", "2027-03-22", "2027-03-29", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"]);
    expect(new Set(mine.map((i) => i.time))).toEqual(new Set(["09:30"]));
    expect(new Set(mine.map((i) => i.key)).size).toBe(9);
    expect(mine[0].event).toMatchObject({ recurrence: "weekly", recurrenceUntil: "2027-04-26", occurrenceDate: "2027-03-01" });
    expect((await inSpring(ids.b)).filter((i) => i.id === id)).toEqual([]);
  });

  it("changing just one occurrence makes it a separate event; the series skips that day; both are audited", async () => {
    const mgr = await as(ids.manager);
    await cal.updateEvent(mgr, id, series({ title: "Stand-up (moved)", start: "2027-03-16T11:00", end: "2027-03-16T11:30", recurrence: "weekly" }), { scope: "one", occurrence: "2027-03-15" });
    const items = await inSpring(ids.a);
    expect(items.filter((i) => i.id === id).map((i) => i.date)).not.toContain("2027-03-15");
    const copy = items.find((i) => i.title === "Stand-up (moved)")!;
    expect(copy).toMatchObject({ date: "2027-03-16", time: "11:00" });
    expect(copy.event).toMatchObject({ recurrence: "none", occurrenceDate: null });
    const logs = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));
    expect(logs.some((l) => /Changed one occurrence \(2027-03-15\)/.test(l.summary ?? ""))).toBe(true);
  });

  it("dragging one occurrence moves only that one; deleting one skips it", async () => {
    const mgr = await as(ids.manager);
    await cal.moveEvent(mgr, id, "2027-03-23", { occurrence: "2027-03-22" });
    await cal.deleteEvent(mgr, id, { scope: "one", occurrence: "2027-03-29" });
    const items = await inSpring(ids.a);
    expect(items.filter((i) => i.id === id).map((i) => i.date)).toEqual(["2027-03-01", "2027-03-08", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"]);
    expect(items.find((i) => i.id !== id && i.date === "2027-03-23")).toMatchObject({ title: "Weekly stand-up", time: "09:30", endTime: "10:00" });
  });

  it("editing the whole series from a later occurrence keeps its first date and skipped days", async () => {
    const mgr = await as(ids.manager);
    await cal.updateEvent(mgr, id, series({ start: "2027-04-12T11:00", end: "2027-04-12T12:00" }), { scope: "all", occurrence: "2027-04-12" });
    const mine = (await inSpring(ids.a)).filter((i) => i.id === id);
    expect(mine.map((i) => i.date)).toEqual(["2027-03-01", "2027-03-08", "2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"]);
    expect(new Set(mine.map((i) => `${i.time}-${i.endTime}`))).toEqual(new Set(["11:00-12:00"]));
  });

  it("refuses an occurrence that isn't in the series, a daily event longer than a day, an end date before the start, and other people", async () => {
    const mgr = await as(ids.manager);
    await expect(cal.deleteEvent(mgr, id, { scope: "one", occurrence: "2027-03-02" })).rejects.toThrow(/no longer exists/);
    await expect(cal.deleteEvent(mgr, id, { scope: "one", occurrence: "2027-03-29" })).rejects.toThrow(/no longer exists/);
    await expect(cal.createEvent(mgr, series({ recurrence: "daily", end: "2027-03-02T10:00" }))).rejects.toThrow(/every day can't last longer than a day/);
    await expect(cal.createEvent(mgr, series({ recurrenceUntil: "2027-02-01" }))).rejects.toThrow(/before the first date/);
    const before = await countRows(t, "event_exceptions");
    await expect(cal.deleteEvent(await as(ids.a), id, { scope: "one", occurrence: "2027-04-05" })).rejects.toThrow(DENIED);
    await expect(cal.moveEvent(await as(ids.b), id, "2027-04-06", { occurrence: "2027-04-05" })).rejects.toThrow(DENIED);
    expect(await countRows(t, "event_exceptions")).toBe(before);
  });

  it("the .ics carries the repeat rule and the skipped days", async () => {
    const one = await cal.eventIcs(await as(ids.a), id);
    expect(one?.ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20270426T135959Z"); // end of 26 April in Sydney (+10)
    // the series now starts at 11:00; 15, 22 and 29 March at 11:00 Sydney (+11) are skipped
    for (const d of ["15", "22", "29"]) expect(one?.ics).toContain(`EXDATE:202703${d}T000000Z`);
  });

  it("meeting reminders go out for each occurrence", async () => {
    const { runScheduler } = await import("@/lib/dal/notifications");
    const at = (iso: string) => runScheduler(new Date(iso));
    // 19 April 11:00 Sydney (+10) = 01:00Z; reminder 10 minutes before
    expect((await at("2027-04-19T00:52:00Z")).meetings).toBe(2); // the manager and Alex
    expect((await at("2027-04-19T00:55:00Z")).meetings).toBe(0); // already sent
    expect((await at("2027-04-25T00:52:00Z")).meetings).toBe(0); // no occurrence on Sunday
  });

  it("deleting the whole series leaves the occurrences that became separate events", async () => {
    await cal.deleteEvent(await as(ids.manager), id, { scope: "all", occurrence: "2027-04-05" });
    const items = await inSpring(ids.a);
    expect(items.filter((i) => i.id === id)).toEqual([]);
    expect(items.map((i) => i.title).sort()).toEqual(["Stand-up (moved)", "Weekly stand-up"]);
  });
});

// ---------------------------------------------------------------- tasks
describe("tasks scope", () => {
  let adminsTask: string;
  let forA: string;

  beforeAll(async () => {
    const admin = await as(ids.admin);
    adminsTask = await tk.createTask(admin, { title: "Admin's task" });
    forA = await tk.createTask(admin, { title: "For A", assigneeId: ids.a, dueDate: addDays(today, -2), labels: "Website, client", checklist: "Draft\nReview" });
  });

  it("staff see tasks they created or that are assigned to them; admins see all", async () => {
    const a = await as(ids.a);
    const own = await tk.createTask(a, { title: "A's own" });
    expect((await tk.listTasks(a)).tasks.map((x) => x.title).sort()).toEqual(["A's own", "For A"]);
    expect((await tk.listTasks(await as(ids.b))).tasks).toEqual([]);
    expect((await tk.listTasks(await as(ids.admin))).tasks.map((x) => x.title)).toEqual(expect.arrayContaining(["Admin's task", "For A", "A's own"]));
    await tk.deleteTask(await as(ids.admin), own);
  });

  it("staff can only assign to themselves, and can't touch tasks that aren't theirs", async () => {
    const a = await as(ids.a);
    await expect(tk.createTask(a, { title: "Delegate", assigneeId: ids.b })).rejects.toThrow(/only assign tasks to yourself/);
    await expect(tk.updateTask(a, adminsTask, { title: "Hijack" })).rejects.toThrow(DENIED);
    await expect(tk.setTaskStatus(a, adminsTask, "done")).rejects.toThrow(DENIED);
    await expect(tk.updateTask(a, forA, { title: "For A", assigneeId: ids.b })).rejects.toThrow(/only assign tasks to yourself/);
    await expect(tk.deleteTask(a, forA)).rejects.toThrow(DENIED); // the Staff preset can't delete tasks
    expect(await tk.getTask(await as(ids.b), forA)).toBeNull();
  });

  it("someone without task access can't read or change anything", async () => {
    const none = await as(ids.none);
    for (const attempt of [
      () => tk.listTasks(none),
      () => tk.getTask(none, forA),
      () => tk.myOpenTasks(none),
      () => tk.createTask(none, { title: "x" }),
      () => tk.setTaskStatus(none, forA, "done"),
      () => tk.addComment(none, forA, "hi"),
      () => tk.teamProgress(none),
    ])
      await expect(attempt()).rejects.toThrow(DENIED);
  });

  it("the assignee moves it on the board; done records when, and moving back clears it", async () => {
    const a = await as(ids.a);
    await tk.setTaskStatus(a, forA, "done");
    expect((await tk.getTask(a, forA))?.completedAt).toBeInstanceOf(Date);
    await tk.setTaskStatus(a, forA, "in_progress");
    const task = await tk.getTask(a, forA);
    expect(task).toMatchObject({ status: "in_progress", completedAt: null, overdue: true, labels: ["website", "client"] });
    const log = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, forA));
    expect(log.map((l) => l.summary)).toEqual(expect.arrayContaining(["Status: todo → done", "Status: done → in_progress"]));
  });

  it("checklist ticks are kept when the list is edited, and each tick is audited", async () => {
    const a = await as(ids.a);
    const draft = (await tk.getTask(a, forA))!.checklist.find((c) => c.text === "Draft")!;
    await tk.toggleChecklistItem(a, forA, draft.id, true);
    // the form sends every field; an update replaces them all
    await tk.updateTask(a, forA, { title: "For A", assigneeId: ids.a, status: "in_progress", dueDate: addDays(today, -2), labels: "website, client", checklist: "Draft\nReview\nSend" });
    const task = await tk.getTask(a, forA);
    expect(task?.checklist.map((c) => [c.text, c.done])).toEqual([["Draft", true], ["Review", false], ["Send", false]]);
    expect(task).toMatchObject({ checklistDone: 1 });
  });

  it("comments: anyone who can see the task comments, even without create permission", async () => {
    const { loadUserPerms, writeUserPerms } = await import("@/lib/dal/internal");
    const viewer = (await createPerson(t, { email: "viewer@example.test" })).id;
    await t.db.transaction(async (tx) => {
      const map = await loadUserPerms(tx, viewer);
      map.tasks = { view: true, create: false, edit: false, delete: false, export: false, scope: "all" };
      await writeUserPerms(tx, viewer, map);
    });
    const v = await as(viewer);
    await expect(tk.createTask(v, { title: "Not allowed" })).rejects.toThrow(DENIED);
    const id = await tk.addComment(v, forA, "Seen it");
    await tk.deleteComment(v, id);
  });

  it("comments: people who can see the task comment; you delete your own, an admin can moderate", async () => {
    const a = await as(ids.a);
    const c1 = await tk.addComment(a, forA, "Started on this");
    await expect(tk.addComment(await as(ids.b), forA, "Sneaky")).rejects.toThrow(/can't see it/);
    await expect(tk.addComment(a, forA, "   ")).rejects.toThrow(/Write a comment/);
    const c2 = await tk.addComment(await as(ids.admin), forA, "Thanks");
    await expect(tk.deleteComment(a, c2)).rejects.toThrow(/own comments/);
    await tk.deleteComment(a, c1);
    await tk.deleteComment(await as(ids.admin), c2);
    expect((await tk.getTask(a, forA))?.commentList).toEqual([]);
  });

  it("My tasks: open tasks assigned to you, overdue or due this week or undated", async () => {
    const admin = await as(ids.admin);
    await tk.createTask(admin, { title: "Next month", assigneeId: ids.a, dueDate: addDays(today, 40) });
    await tk.createTask(admin, { title: "Undated", assigneeId: ids.a });
    const done = await tk.createTask(admin, { title: "Finished", assigneeId: ids.a, dueDate: today, status: "done" });
    const mine = await tk.myOpenTasks(await as(ids.a));
    const titles = mine.tasks.map((x) => x.title);
    expect(titles).toEqual(expect.arrayContaining(["For A", "Undated"]));
    expect(titles).not.toContain("Next month");
    expect(titles).not.toContain("Finished");
    expect((await tk.getTask(admin, done))?.completedAt).toBeInstanceOf(Date);
  });

  it("filters: overdue, label and 'me'", async () => {
    const a = await as(ids.a);
    expect((await tk.listTasks(a, { due: "overdue" })).tasks.map((x) => x.title)).toEqual(["For A"]);
    expect((await tk.listTasks(a, { label: "website" })).tasks.map((x) => x.title)).toEqual(["For A"]);
    expect((await tk.listTasks(await as(ids.admin), { assignee: "me" })).tasks).toEqual([]);
  });

  it("team progress is for people who see all tasks", async () => {
    await expect(tk.teamProgress(await as(ids.a))).rejects.toThrow(/everyone's tasks/);
    const p = await tk.teamProgress(await as(ids.manager));
    expect(p.people.find((x) => x.userId === ids.a)).toMatchObject({ overdue: 1 });
  });

  it("deleting a task removes its comments and keeps them in the audit log", async () => {
    const admin = await as(ids.admin);
    const id = await tk.createTask(admin, { title: "Throwaway" });
    await tk.addComment(admin, id, "note");
    await tk.deleteTask(admin, id);
    expect(await countRows(t, "task_comments")).toBe(0);
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id)).then((r) => r.filter((x) => x.action === "delete"));
    expect((log.before as { comments: unknown[] }).comments).toHaveLength(1);
  });
});

describe("the calendar shows deadlines and payments only to people who may see them", () => {
  it("task due dates for task users, payment due dates for payment users", async () => {
    const admin = await as(ids.admin);
    const due = addDays(today, 3);
    await tk.createTask(admin, { title: "Deadline for A", assigneeId: ids.a, dueDate: due });
    const pay = await import("@/lib/dal/payments");
    await pay.saveSubscription(admin, null, { vendor: "Calendar Hosting", category: "Hosting", amount: "50", currency: "AUD", billingCycle: "monthly", nextDueDate: due });
    const kinds = async (id: string) => (await cal.calendarItems(await as(id), today, addDays(today, 10))).items.map((i) => `${i.kind}:${i.title}`);
    expect(await kinds(ids.a)).toEqual(expect.arrayContaining(["task:Deadline for A"]));
    expect((await kinds(ids.a)).some((k) => k.startsWith("payment:"))).toBe(false);
    expect(await kinds(ids.admin)).toEqual(expect.arrayContaining(["task:Deadline for A", "payment:Calendar Hosting"]));
  });
});
