import "server-only";
import { and, asc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/dates";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { formatMoney } from "@/lib/money";
import { EVENT_TYPES, type CalendarItem, type EventDetail } from "@/lib/work";
export type { CalendarItem, EventDetail };
import { localParts, toLocalInput, zonedToUtc } from "@/lib/zoned";
import { actorRef, writeAudit } from "./audit";
import { baseCurrency } from "./finance";
import { AccessDenied, RuleError, hasPerm, requirePerm, scopeWhere, type Actor } from "./guard";
import { companyTimezone } from "./marketing";
import { paymentDueDates } from "./payments";
import { taskDeadlines } from "./tasks";

/**
 * Calendar (module "calendar"): events with attendees, plus task deadlines
 * and payment due dates drawn from their own pages (each only for people who
 * may see them).
 *
 * Scope: own = events you created; assigned = also events you're invited to
 * (the Staff default); all = every event. Only the creator, or someone with
 * the "all" scope, can change or delete an event. Every change is audited.
 * Times are UTC; days and times on screen are in the company time zone.
 */
const { events, eventAttendees, users } = schema;

const invitedTo = (db: Db | Tx, uid: string) => db.select({ id: eventAttendees.eventId }).from(eventAttendees).where(eq(eventAttendees.userId, uid));
const eventScope = (db: Db | Tx, actor: Actor): SQL | undefined =>
  scopeWhere(actor, "calendar", { owner: events.createdBy, assignedTo: (uid) => inArray(events.id, invitedTo(db, uid)) });
const canChange = (actor: Actor, row: { createdBy: string }) => row.createdBy === actor.userId || actor.perms.calendar.scope === "all";

// ---------------------------------------------------------------- reading
const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

async function loadEvents(db: Db | Tx, actor: Actor, where: SQL | undefined, tz: string, limit = 1000) {
  const rows = await db
    .select({ e: events, createdByName: users.fullName })
    .from(events)
    .leftJoin(users, eq(users.id, events.createdBy))
    .where(and(eventScope(db, actor), where))
    .orderBy(asc(events.startsAt), asc(events.title))
    .limit(limit);
  const ids = rows.map((r) => r.e.id);
  const att = ids.length
    ? await db.select({ eventId: eventAttendees.eventId, id: users.id, name: users.fullName, email: users.email }).from(eventAttendees).innerJoin(users, eq(users.id, eventAttendees.userId)).where(inArray(eventAttendees.eventId, ids))
    : [];
  return rows.map(({ e, createdByName }) => {
    const start = localParts(e.startsAt, tz);
    // an all-day event ends at local midnight, so its last day is the day before
    const endInstant = e.allDay ? new Date(e.endsAt.getTime() - 1) : e.endsAt;
    const end = localParts(endInstant, tz);
    const detail: EventDetail = {
      id: e.id,
      title: e.title,
      type: e.type,
      allDay: e.allDay,
      startLocal: e.allDay ? start.date : toLocalInput(e.startsAt, tz),
      endLocal: e.allDay ? end.date : toLocalInput(e.endsAt, tz),
      location: e.location,
      videoUrl: e.videoUrl,
      description: e.description,
      reminderMinutes: e.reminderMinutes,
      attendees: att.filter((a) => a.eventId === e.id).map((a) => ({ id: a.id, name: a.name || a.email })),
      createdByName: createdByName ?? "",
      mine: e.createdBy === actor.userId,
    };
    const item: CalendarItem = {
      key: `event-${e.id}`,
      kind: e.type === "payment" ? "payment" : e.type,
      id: e.id,
      title: e.title,
      date: start.date,
      endDate: end.date < start.date ? start.date : end.date,
      time: e.allDay ? null : hhmm(start),
      endTime: e.allDay ? null : hhmm(localParts(e.endsAt, tz)),
      editable: hasPerm(actor, "calendar", "edit") && canChange(actor, e),
      event: detail,
    };
    return { row: e, item };
  });
}

/**
 * Everything on the calendar between two local dates (inclusive): events in
 * the caller's calendar scope, plus task deadlines and payment due dates when
 * they may see tasks or payments.
 */
export async function calendarItems(actor: Actor, from: string, to: string) {
  requirePerm(actor, "calendar", "view");
  if (daysBetween(from, to) > 62 || to < from) throw new RuleError("Choose a shorter date range.");
  const db = getDb();
  const tz = await companyTimezone(db);
  const fromUtc = zonedToUtc(from, tz);
  const toUtc = zonedToUtc(addDays(to, 1), tz);
  const [evs, deadlines, payments, base] = await Promise.all([
    loadEvents(db, actor, and(lt(events.startsAt, toUtc), gte(events.endsAt, fromUtc)), tz),
    hasPerm(actor, "tasks", "view") ? taskDeadlines(actor, from, to) : Promise.resolve([]),
    hasPerm(actor, "payments", "view") ? paymentDueDates(actor, from, to) : Promise.resolve([]),
    baseCurrency(db),
  ]);
  const items: CalendarItem[] = [
    ...evs.map((e) => e.item),
    ...deadlines.map(
      (t): CalendarItem => ({
        key: `task-${t.id}`,
        kind: "task",
        id: t.id,
        title: t.title,
        date: t.dueDate!,
        endDate: t.dueDate!,
        time: null,
        endTime: null,
        editable: false,
        href: `/tasks?task=${t.id}`,
        meta: [t.assigneeName, t.status === "done" ? "done" : t.overdue ? "overdue" : null].filter(Boolean).join(" · "),
        overdue: t.overdue,
      })
    ),
    ...payments.map(
      (p): CalendarItem => ({
        key: `payment-${p.subscriptionId}-${p.dueDate}`,
        kind: "payment",
        id: p.subscriptionId,
        title: p.vendor,
        date: p.dueDate,
        endDate: p.dueDate,
        time: null,
        endTime: null,
        editable: false,
        href: "/payments",
        meta: `${formatMoney(p.amountBaseMinor, base, { cents: false })}${p.overdue ? " · overdue" : ""}`,
        overdue: p.overdue,
      })
    ),
  ];
  return { timezone: tz, today: localParts(new Date(), tz).date, items };
}

/** Upcoming events (and today's, still running) for Home and My Day. */
export async function upcomingEvents(actor: Actor, opts: { days?: number; limit?: number; todayOnly?: boolean } = {}) {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const tz = await companyTimezone(db);
  const today = localParts(new Date(), tz).date;
  const now = new Date();
  const until = zonedToUtc(addDays(today, opts.todayOnly ? 1 : (opts.days ?? 14)), tz);
  const startOfToday = zonedToUtc(today, tz);
  const evs = await loadEvents(db, actor, and(lt(events.startsAt, until), gte(events.endsAt, opts.todayOnly ? startOfToday : now)), tz, opts.limit ?? 6);
  return { timezone: tz, today, events: evs.map((e) => e.item) };
}

export async function getEvent(actor: Actor, id: string): Promise<CalendarItem | null> {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const [e] = await loadEvents(db, actor, eq(events.id, id), await companyTimezone(db), 1);
  return e?.item ?? null;
}

/** Active people who can be invited. */
export async function invitees(actor: Actor) {
  requirePerm(actor, "calendar", "view");
  const rows = await getDb().select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.status, "active")).orderBy(asc(users.fullName));
  return rows.map((r) => ({ id: r.id, name: r.name || r.email }));
}

// ---------------------------------------------------------------- writing
const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const localDate = /^\d{4}-\d{2}-\d{2}$/;
export const eventInput = z.object({
  title: z.string().trim().min(1, "Give the event a title.").max(200),
  type: z.enum(EVENT_TYPES).default("meeting"),
  allDay: z.boolean().default(false),
  start: z.string().trim().min(1, "Choose when it starts."),
  end: z.string().trim().min(1, "Choose when it ends."),
  location: z.string().trim().max(300).default(""),
  videoUrl: z
    .string()
    .trim()
    .max(500)
    .default("")
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use a full https:// link for the video call."),
  description: z.string().trim().max(10_000).optional(),
  reminderMinutes: z.coerce.number().int().min(0).max(10080).nullable().optional(),
  attendeeIds: z.array(z.string().uuid()).max(50, "Invite up to 50 people.").default([]),
});
export type EventInput = z.input<typeof eventInput>;

async function eventValues(db: Db | Tx, input: EventInput) {
  const parsed = eventInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the event and try again.");
  const v = parsed.data;
  const tz = await companyTimezone(db);
  let startsAt: Date;
  let endsAt: Date;
  if (v.allDay) {
    const s = v.start.slice(0, 10);
    const e = v.end.slice(0, 10);
    if (!localDate.test(s) || !localDate.test(e)) throw new RuleError("Choose the first and last day.");
    if (e < s) throw new RuleError("The last day is before the first day.");
    startsAt = zonedToUtc(s, tz);
    endsAt = zonedToUtc(addDays(e, 1), tz);
  } else {
    if (!localDateTime.test(v.start) || !localDateTime.test(v.end)) throw new RuleError("Choose the start and end date and time.");
    startsAt = zonedToUtc(v.start, tz);
    endsAt = zonedToUtc(v.end, tz);
    if (endsAt < startsAt) throw new RuleError("The event ends before it starts.");
  }
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86_400_000) throw new RuleError("Events can last up to 31 days.");
  const attendeeIds = [...new Set(v.attendeeIds)];
  if (attendeeIds.length) {
    const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, attendeeIds), eq(users.status, "active")));
    if (found.length !== attendeeIds.length) throw new RuleError("Only active team members can be invited.");
  }
  return {
    values: {
      title: v.title,
      type: v.type,
      allDay: v.allDay,
      startsAt,
      endsAt,
      location: v.location,
      videoUrl: v.videoUrl,
      description: v.description || null,
      reminderMinutes: v.reminderMinutes ?? null,
    },
    attendeeIds,
  };
}

const snapshotOf = async (tx: Tx, id: string) => {
  const [row] = await tx.select().from(events).where(eq(events.id, id));
  const att = await tx.select({ userId: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, id));
  return row ? { ...row, attendees: att.map((a) => a.userId).sort() } : null;
};

export async function createEvent(actor: Actor, input: EventInput): Promise<string> {
  requirePerm(actor, "calendar", "create");
  const db = getDb();
  const { values, attendeeIds } = await eventValues(db, input);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(events).values({ id, ...values, createdBy: actor.userId });
    if (attendeeIds.length) await tx.insert(eventAttendees).values(attendeeIds.map((userId) => ({ eventId: id, userId })));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "events", entityId: id, after: await snapshotOf(tx, id) });
  });
  return id;
}

async function lockForChange(tx: Tx, actor: Actor, id: string, verb: string) {
  const [row] = await tx.select().from(events).where(eq(events.id, id)).for("update");
  if (!row) throw new AccessDenied(`That event doesn't exist or isn't yours to ${verb}.`);
  if (!canChange(actor, row)) {
    // people who can see it (invited) get a clear reason; others learn nothing
    const visible = (await tx.select({ id: events.id }).from(events).where(and(eq(events.id, id), eventScope(tx, actor)))).length > 0;
    throw new AccessDenied(visible ? "Only the person who created this event can change it." : `That event doesn't exist or isn't yours to ${verb}.`);
  }
  return row;
}

export async function updateEvent(actor: Actor, id: string, input: EventInput) {
  requirePerm(actor, "calendar", "edit");
  const db = getDb();
  const { values, attendeeIds } = await eventValues(db, input);
  await db.transaction(async (tx) => {
    await lockForChange(tx, actor, id, "change");
    const before = await snapshotOf(tx, id);
    await tx.update(events).set(values).where(eq(events.id, id));
    await tx.delete(eventAttendees).where(eq(eventAttendees.eventId, id));
    if (attendeeIds.length) await tx.insert(eventAttendees).values(attendeeIds.map((userId) => ({ eventId: id, userId })));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "events", entityId: id, before, after: await snapshotOf(tx, id) });
  });
}

/** Drag to reschedule: moves the event to another day, keeping its local time and length. */
export async function moveEvent(actor: Actor, id: string, toDate: string) {
  requirePerm(actor, "calendar", "edit");
  if (!localDate.test(toDate)) throw new RuleError("Drop it on a day.");
  const db = getDb();
  const tz = await companyTimezone(db);
  await db.transaction(async (tx) => {
    const row = await lockForChange(tx, actor, id, "move");
    const start = localParts(row.startsAt, tz);
    if (start.date === toDate) return;
    const length = row.endsAt.getTime() - row.startsAt.getTime();
    const startsAt = row.allDay ? zonedToUtc(toDate, tz) : zonedToUtc(`${toDate}T${hhmm(start)}`, tz);
    // all-day: keep the number of days, from local midnight to local midnight
    const endsAt = row.allDay ? zonedToUtc(addDays(toDate, Math.max(1, Math.round(length / 86_400_000))), tz) : new Date(startsAt.getTime() + length);
    const before = await snapshotOf(tx, id);
    await tx.update(events).set({ startsAt, endsAt }).where(eq(events.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "events", entityId: id, summary: `Moved from ${start.date} to ${toDate}`, before, after: await snapshotOf(tx, id) });
  });
}

export async function deleteEvent(actor: Actor, id: string) {
  requirePerm(actor, "calendar", "delete");
  await getDb().transaction(async (tx) => {
    await lockForChange(tx, actor, id, "delete");
    const before = await snapshotOf(tx, id);
    await tx.delete(events).where(eq(events.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "events", entityId: id, before });
  });
}

// ---------------------------------------------------------------- .ics export
function toIcs(rows: Array<typeof events.$inferSelect>, tz: string): IcsEvent[] {
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    startDate: localParts(e.startsAt, tz).date,
    endDateExclusive: localParts(e.endsAt, tz).date,
    location: e.location,
    description: e.description,
    videoUrl: e.videoUrl,
    reminderMinutes: e.reminderMinutes,
    updatedAt: e.updatedAt,
  }));
}

/** One event you can see, as a file to add to your own calendar app. */
export async function eventIcs(actor: Actor, id: string): Promise<{ filename: string; ics: string } | null> {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const [row] = await db.select().from(events).where(and(eq(events.id, id), eventScope(db, actor)));
  if (!row) return null;
  const tz = await companyTimezone(db);
  const safe = row.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
  return { filename: `${safe}.ics`, ics: buildIcs(toIcs([row], tz), { calendarName: "CoreNovaIT" }) };
}

/** Every event in the caller's scope from 30 days ago to a year ahead. Needs calendar export; audited. */
export async function exportCalendarIcs(actor: Actor): Promise<{ filename: string; ics: string; count: number }> {
  requirePerm(actor, "calendar", "export");
  const db = getDb();
  const tz = await companyTimezone(db);
  const today = localParts(new Date(), tz).date;
  const rows = await db
    .select()
    .from(events)
    .where(and(eventScope(db, actor), gte(events.endsAt, zonedToUtc(addDays(today, -30), tz)), lt(events.startsAt, zonedToUtc(addDays(today, 366), tz))))
    .orderBy(asc(events.startsAt))
    .limit(5000);
  const filename = `corenovait-calendar-${today}.ics`;
  await writeAudit(db, actorRef(actor), { action: "export", entity: "calendar", summary: `${filename}: ${rows.length} events` });
  return { filename, ics: buildIcs(toIcs(rows, tz), { calendarName: "CoreNovaIT" }), count: rows.length };
}
