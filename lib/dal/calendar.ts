import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, like, lt, ne, or, type SQL } from "drizzle-orm";
import { likeTerm } from "@/lib/search";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/dates";
import { buildIcs, type IcsEvent } from "@/lib/ics";
import { MAX_SPAN_DAYS, occurrenceDates, toRRule, type Recurrence } from "@/lib/recurrence";
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
import { avatarUrl } from "@/lib/avatar";

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
const { events, eventAttendees, eventExceptions, users } = schema;

const invitedTo = (db: Db | Tx, uid: string) => db.select({ id: eventAttendees.eventId }).from(eventAttendees).where(eq(eventAttendees.userId, uid));
const eventScope = (db: Db | Tx, actor: Actor): SQL | undefined =>
  scopeWhere(actor, "calendar", { owner: events.createdBy, assignedTo: (uid) => inArray(events.id, invitedTo(db, uid)) });
const canChange = (actor: Actor, row: { createdBy: string }) => row.createdBy === actor.userId || actor.perms.calendar.scope === "all";

// ---------------------------------------------------------------- reading
const hhmm = (p: { hour: number; minute: number }) => `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;

type EventRow = typeof events.$inferSelect;

/** Where a range query finds events: one-offs that overlap it, and every series that could have an occurrence in it. */
const overlapping = (fromUtc: Date, toUtc: Date, fromDate: string): SQL =>
  or(
    and(eq(events.recurrence, "none"), lt(events.startsAt, toUtc), gte(events.endsAt, fromUtc)),
    and(ne(events.recurrence, "none"), lt(events.startsAt, toUtc), or(isNull(events.recurrenceUntil), gte(events.recurrenceUntil, addDays(fromDate, -31))))
  )!;

/** An event's span in whole local days (an all-day event on one day = 0 extra days). */
const spanDays = (e: EventRow, tz: string) => {
  const s = localParts(e.startsAt, tz).date;
  const end = localParts(e.allDay ? new Date(e.endsAt.getTime() - 1) : e.endsAt, tz).date;
  return Math.max(0, daysBetween(s, end));
};

/** One occurrence of an event: its own start and end, keeping the local time and length of the original. */
function occurrence(e: EventRow, date: string, tz: string): { startsAt: Date; endsAt: Date } {
  if (e.allDay) {
    const days = Math.max(1, Math.round((e.endsAt.getTime() - e.startsAt.getTime()) / 86_400_000));
    return { startsAt: zonedToUtc(date, tz), endsAt: zonedToUtc(addDays(date, days), tz) };
  }
  const startsAt = zonedToUtc(`${date}T${hhmm(localParts(e.startsAt, tz))}`, tz);
  return { startsAt, endsAt: new Date(startsAt.getTime() + (e.endsAt.getTime() - e.startsAt.getTime())) };
}

/**
 * Events as calendar items. A repeating event becomes one item per occurrence
 * inside `range` (local dates); without a range it is returned once, as the series.
 */
async function loadEvents(db: Db | Tx, actor: Actor, where: SQL | undefined, tz: string, opts: { range?: { from: string; to: string; fromUtc: Date; toUtc: Date }; limit?: number } = {}) {
  const rows = await db
    .select({ e: events, createdByName: users.fullName })
    .from(events)
    .leftJoin(users, eq(users.id, events.createdBy))
    .where(and(eventScope(db, actor), where))
    .orderBy(asc(events.startsAt), asc(events.title))
    .limit(opts.range ? 2000 : (opts.limit ?? 1000));
  const ids = rows.map((r) => r.e.id);
  const repeating = rows.filter((r) => r.e.recurrence !== "none").map((r) => r.e.id);
  const [att, exc] = await Promise.all([
    ids.length
      ? db.select({ eventId: eventAttendees.eventId, id: users.id, name: users.fullName, email: users.email, avatarKey: users.avatarKey, avatarAt: users.avatarUpdatedAt }).from(eventAttendees).innerJoin(users, eq(users.id, eventAttendees.userId)).where(inArray(eventAttendees.eventId, ids))
      : Promise.resolve([]),
    repeating.length ? db.select().from(eventExceptions).where(inArray(eventExceptions.eventId, repeating)) : Promise.resolve([]),
  ]);

  const toItem = (e: EventRow, createdByName: string | null, at: { startsAt: Date; endsAt: Date }, occurrenceDate: string | null) => {
    const start = localParts(at.startsAt, tz);
    // an all-day event ends at local midnight, so its last day is the day before
    const end = localParts(e.allDay ? new Date(at.endsAt.getTime() - 1) : at.endsAt, tz);
    const detail: EventDetail = {
      id: e.id,
      title: e.title,
      type: e.type,
      allDay: e.allDay,
      startLocal: e.allDay ? start.date : toLocalInput(at.startsAt, tz),
      endLocal: e.allDay ? end.date : toLocalInput(at.endsAt, tz),
      location: e.location,
      videoUrl: e.videoUrl,
      description: e.description,
      reminderMinutes: e.reminderMinutes,
      attendees: att.filter((a) => a.eventId === e.id).map((a) => ({ id: a.id, name: a.name || a.email, avatar: avatarUrl(a.id, a.avatarKey ? a.avatarAt : null) })),
      createdByName: createdByName ?? "",
      mine: e.createdBy === actor.userId,
      recurrence: e.recurrence,
      recurrenceUntil: e.recurrenceUntil,
      occurrenceDate,
    };
    const item: CalendarItem = {
      key: occurrenceDate ? `event-${e.id}-${occurrenceDate}` : `event-${e.id}`,
      kind: e.type === "payment" ? "payment" : e.type,
      id: e.id,
      title: e.title,
      date: start.date,
      endDate: end.date < start.date ? start.date : end.date,
      time: e.allDay ? null : hhmm(start),
      endTime: e.allDay ? null : hhmm(localParts(at.endsAt, tz)),
      editable: hasPerm(actor, "calendar", "edit") && canChange(actor, e),
      event: detail,
    };
    return { row: e, item, startsAt: at.startsAt };
  };

  const out: Array<ReturnType<typeof toItem>> = [];
  for (const { e, createdByName } of rows) {
    if (e.recurrence === "none" || !opts.range) {
      out.push(toItem(e, createdByName, e, null));
      continue;
    }
    const r = opts.range;
    const dates = occurrenceDates(localParts(e.startsAt, tz).date, e.recurrence, { from: r.from, to: r.to }, { until: e.recurrenceUntil, spanDays: spanDays(e, tz), exceptions: exc.filter((x) => x.eventId === e.id).map((x) => x.occurrenceDate) });
    for (const d of dates) {
      const at = occurrence(e, d, tz);
      if (at.startsAt < r.toUtc && at.endsAt >= r.fromUtc) out.push(toItem(e, createdByName, at, d));
    }
  }
  return out.sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime() || x.item.title.localeCompare(y.item.title));
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
    loadEvents(db, actor, overlapping(fromUtc, toUtc, from), tz, { range: { from, to, fromUtc, toUtc } }),
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
  const fromUtc = opts.todayOnly ? startOfToday : now;
  const evs = await loadEvents(db, actor, overlapping(fromUtc, until, today), tz, { range: { from: today, to: localParts(new Date(until.getTime() - 1), tz).date, fromUtc, toUtc: until } });
  return { timezone: tz, today, events: evs.slice(0, opts.limit ?? 6).map((e) => e.item) };
}

export async function getEvent(actor: Actor, id: string): Promise<CalendarItem | null> {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const [e] = await loadEvents(db, actor, eq(events.id, id), await companyTimezone(db), { limit: 1 });
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
  recurrence: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
  recurrenceUntil: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the last date it repeats on.")
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
});
export type EventInput = z.input<typeof eventInput>;
/** For a repeating event: change or delete just one occurrence, or the whole series. */
export type SeriesChoice = { scope?: "one" | "all"; occurrence?: string | null };

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
  const recurrence = v.recurrence as Recurrence;
  const firstDate = localParts(startsAt, tz).date;
  if (recurrence !== "none") {
    const days = Math.max(0, daysBetween(firstDate, localParts(new Date(endsAt.getTime() - (v.allDay ? 1 : 0)), tz).date)) + 1;
    if (days > MAX_SPAN_DAYS[recurrence]) throw new RuleError(`An event that repeats ${recurrence === "daily" ? "every day" : recurrence === "weekly" ? "every week" : "every month"} can't last longer than ${MAX_SPAN_DAYS[recurrence] === 1 ? "a day" : `${MAX_SPAN_DAYS[recurrence]} days`}.`);
    if (v.recurrenceUntil && v.recurrenceUntil < firstDate) throw new RuleError("The repeat end date is before the first date.");
  }
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
      recurrence,
      recurrenceUntil: recurrence === "none" ? null : (v.recurrenceUntil ?? null),
    },
    attendeeIds,
  };
}

const snapshotOf = async (tx: Tx, id: string) => {
  const [row] = await tx.select().from(events).where(eq(events.id, id));
  const att = await tx.select({ userId: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, id));
  const exc = row && row.recurrence !== "none" ? await tx.select({ d: eventExceptions.occurrenceDate }).from(eventExceptions).where(eq(eventExceptions.eventId, id)) : [];
  return row ? { ...row, attendees: att.map((a) => a.userId).sort(), ...(exc.length ? { skipped: exc.map((x) => x.d).sort() } : {}) } : null;
};

/** A repeating event's occurrence on `date` really exists (inside the series, not already skipped). */
async function checkOccurrence(tx: Tx, row: EventRow, date: string | null | undefined, tz: string): Promise<string> {
  if (!date || !localDate.test(date)) throw new RuleError("Choose which occurrence to change.");
  const skipped = (await tx.select({ d: eventExceptions.occurrenceDate }).from(eventExceptions).where(eq(eventExceptions.eventId, row.id))).map((x) => x.d);
  const ok = occurrenceDates(localParts(row.startsAt, tz).date, row.recurrence as Exclude<Recurrence, "none">, { from: date, to: date }, { until: row.recurrenceUntil, exceptions: skipped }).includes(date);
  if (!ok) throw new RuleError("That occurrence no longer exists. Refresh and try again.");
  return date;
}

/** Copies one occurrence out of a series as its own event (the series skips that date from now on). */
async function detachOccurrence(tx: Tx, actor: Actor, row: EventRow, date: string, values: Partial<typeof events.$inferInsert>, attendeeIds: string[] | null, summary: string) {
  const before = await snapshotOf(tx, row.id);
  await tx.insert(eventExceptions).values({ eventId: row.id, occurrenceDate: date });
  const id = crypto.randomUUID();
  const { id: _id, createdAt: _c, updatedAt: _u, ...base } = row;
  await tx.insert(events).values({ ...base, ...values, id, recurrence: "none", recurrenceUntil: null, createdBy: row.createdBy });
  const people = attendeeIds ?? (await tx.select({ userId: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, row.id))).map((a) => a.userId);
  if (people.length) await tx.insert(eventAttendees).values(people.map((userId) => ({ eventId: id, userId })));
  await writeAudit(tx, actorRef(actor), { action: "update", entity: "events", entityId: row.id, summary: `${summary} (${date}): now a separate event`, before, after: await snapshotOf(tx, row.id) });
  await writeAudit(tx, actorRef(actor), { action: "create", entity: "events", entityId: id, summary: `From the series ${row.id.slice(0, 8)} (${date})`, after: await snapshotOf(tx, id) });
  return id;
}

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

export async function updateEvent(actor: Actor, id: string, input: EventInput, choice: SeriesChoice = {}) {
  requirePerm(actor, "calendar", "edit");
  const db = getDb();
  const tz = await companyTimezone(db);
  await db.transaction(async (tx) => {
    const row = await lockForChange(tx, actor, id, "change");
    if (row.recurrence !== "none" && choice.scope === "one") {
      // just this occurrence: it becomes its own event, the series skips that date
      const date = await checkOccurrence(tx, row, choice.occurrence, tz);
      const { values, attendeeIds } = await eventValues(tx, { ...input, recurrence: "none", recurrenceUntil: null });
      await detachOccurrence(tx, actor, row, date, values, attendeeIds, "Changed one occurrence");
      return;
    }
    let edited = input;
    if (row.recurrence !== "none" && choice.occurrence) {
      // the whole series, edited from one occurrence: keep the series' first date, take the new time and length
      const shift = daysBetween(choice.occurrence, localParts(row.startsAt, tz).date);
      const move = (v: string) => (v.length >= 10 ? `${addDays(v.slice(0, 10), shift)}${v.slice(10)}` : v);
      edited = { ...input, start: move(input.start), end: move(input.end) };
    }
    const { values, attendeeIds } = await eventValues(tx, edited);
    const before = await snapshotOf(tx, id);
    await tx.update(events).set(values).where(eq(events.id, id));
    // a series that stops repeating forgets its skipped dates
    if (values.recurrence === "none") await tx.delete(eventExceptions).where(eq(eventExceptions.eventId, id));
    await tx.delete(eventAttendees).where(eq(eventAttendees.eventId, id));
    if (attendeeIds.length) await tx.insert(eventAttendees).values(attendeeIds.map((userId) => ({ eventId: id, userId })));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "events", entityId: id, summary: row.recurrence !== "none" ? "Changed the whole series" : null, before, after: await snapshotOf(tx, id) });
  });
}

/** Drag to reschedule: moves the event to another day, keeping its local time and length. */
export async function moveEvent(actor: Actor, id: string, toDate: string, opts: { occurrence?: string | null } = {}) {
  requirePerm(actor, "calendar", "edit");
  if (!localDate.test(toDate)) throw new RuleError("Drop it on a day.");
  const db = getDb();
  const tz = await companyTimezone(db);
  await db.transaction(async (tx) => {
    const row = await lockForChange(tx, actor, id, "move");
    if (row.recurrence !== "none") {
      // dragging one occurrence of a series moves just that one
      const date = await checkOccurrence(tx, row, opts.occurrence, tz);
      if (date === toDate) return;
      const at = occurrence(row, toDate, tz);
      await detachOccurrence(tx, actor, row, date, at, null, `Moved one occurrence to ${toDate}`);
      return;
    }
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

export async function deleteEvent(actor: Actor, id: string, choice: SeriesChoice = {}) {
  requirePerm(actor, "calendar", "delete");
  const db = getDb();
  const tz = await companyTimezone(db);
  await db.transaction(async (tx) => {
    const row = await lockForChange(tx, actor, id, "delete");
    const before = await snapshotOf(tx, id);
    if (row.recurrence !== "none" && choice.scope === "one") {
      const date = await checkOccurrence(tx, row, choice.occurrence, tz);
      await tx.insert(eventExceptions).values({ eventId: id, occurrenceDate: date });
      await writeAudit(tx, actorRef(actor), { action: "update", entity: "events", entityId: id, summary: `Deleted one occurrence (${date})`, before, after: await snapshotOf(tx, id) });
      return;
    }
    await tx.delete(events).where(eq(events.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "events", entityId: id, before });
  });
}

// ---------------------------------------------------------------- .ics export
async function toIcs(db: Db | Tx, rows: EventRow[], tz: string): Promise<IcsEvent[]> {
  const repeating = rows.filter((r) => r.recurrence !== "none").map((r) => r.id);
  const exc = repeating.length ? await db.select().from(eventExceptions).where(inArray(eventExceptions.eventId, repeating)) : [];
  const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return rows.map((e) => {
    const rule = e.recurrence === "none" ? null : (e.recurrence as Exclude<Recurrence, "none">);
    // UNTIL: the end of the last local day, in UTC for timed events
    const until = rule && e.recurrenceUntil ? (e.allDay ? e.recurrenceUntil.replace(/-/g, "") : utc(new Date(zonedToUtc(addDays(e.recurrenceUntil, 1), tz).getTime() - 1000))) : null;
    const skipped = exc.filter((x) => x.eventId === e.id).map((x) => x.occurrenceDate);
    return {
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
      ...(rule
        ? {
            rrule: toRRule(rule, until),
            exdates: skipped.map((d) => (e.allDay ? `EXDATE;VALUE=DATE:${d.replace(/-/g, "")}` : `EXDATE:${utc(occurrence(e, d, tz).startsAt)}`)),
          }
        : {}),
    };
  });
}

/** Top-bar search: events you can see, by title, place or notes (newest first). */
export async function searchEvents(actor: Actor, q: string, limit: number) {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const tz = await companyTimezone(db);
  const t = likeTerm(q);
  const rows = await db
    .select({ id: events.id, title: events.title, startsAt: events.startsAt, allDay: events.allDay, recurrence: events.recurrence, location: events.location })
    .from(events)
    .where(and(eventScope(db, actor), or(like(events.title, t), like(events.location, t), like(events.description, t))))
    .orderBy(desc(events.startsAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, date: localParts(r.startsAt, tz).date, time: r.allDay ? null : hhmm(localParts(r.startsAt, tz)) }));
}

/** One event you can see, as a file to add to your own calendar app. */
export async function eventIcs(actor: Actor, id: string): Promise<{ filename: string; ics: string } | null> {
  requirePerm(actor, "calendar", "view");
  const db = getDb();
  const [row] = await db.select().from(events).where(and(eq(events.id, id), eventScope(db, actor)));
  if (!row) return null;
  const tz = await companyTimezone(db);
  const safe = row.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "event";
  return { filename: `${safe}.ics`, ics: buildIcs(await toIcs(db, [row], tz), { calendarName: "CoreNovaIT" }) };
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
    .where(and(eventScope(db, actor), overlapping(zonedToUtc(addDays(today, -30), tz), zonedToUtc(addDays(today, 366), tz), addDays(today, -30))))
    .orderBy(asc(events.startsAt))
    .limit(5000);
  const filename = `corenovait-calendar-${today}.ics`;
  await writeAudit(db, actorRef(actor), { action: "export", entity: "calendar", summary: `${filename}: ${rows.length} events` });
  return { filename, ics: buildIcs(await toIcs(db, rows, tz), { calendarName: "CoreNovaIT" }), count: rows.length };
}
