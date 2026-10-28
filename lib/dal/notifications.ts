import "server-only";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { notificationEmail, sendMail } from "@/lib/email";
import { mailConfig } from "@/lib/env";
import { can, type AppModule } from "@/lib/permissions";
import { occurrenceDates } from "@/lib/recurrence";
import { localParts, zonedToUtc } from "@/lib/zoned";
import { actorRef, writeAudit } from "./audit";
import { assertCaller, type Actor } from "./guard";
import { loadUserPerms } from "./internal";
import { companyTimezone } from "./marketing";

/**
 * Notifications: in-app for everyone, and by email for people who leave
 * "email me too" on (and once Resend is set up).
 *
 * - task assigned and chat mentions are created as they happen;
 * - task due soon, meeting reminders and payments due are created by the
 *   scheduler (runScheduler), which a cron job calls every few minutes;
 * - the scheduler also sends the emails.
 *
 * Every notification has a unique dedupe key, so running the scheduler
 * twice (or two runs at once) never creates or emails the same thing twice.
 * People only ever see their own notifications.
 */
const { notifications, users, tasks, events, eventAttendees, eventExceptions, subscriptions } = schema;

export type NewNotification = {
  userId: string;
  type: (typeof schema.NOTIFICATION_TYPES)[number];
  title: string;
  body?: string;
  href?: string;
  dedupeKey: string;
};

/** Adds a notification unless one with the same key exists. Returns true when it was new. */
export async function notify(db: Db | Tx, n: NewNotification): Promise<boolean> {
  const id = crypto.randomUUID();
  const dedupeKey = n.dedupeKey.slice(0, 191);
  await db
    .insert(notifications)
    .values({ id, userId: n.userId, type: n.type, title: n.title.slice(0, 200), body: (n.body ?? "").slice(0, 500), href: n.href ?? "", dedupeKey })
    .onDuplicateKeyUpdate({ set: { dedupeKey: sql`${notifications.dedupeKey}` } });
  // new only if the row under this key is the one just written (the driver counts a duplicate as "affected" too)
  const [row] = await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.dedupeKey, dedupeKey));
  return row?.id === id;
}

// ---------------------------------------------------------------- the person's own
export async function unreadNotificationCount(actor: Actor): Promise<number> {
  assertCaller(actor);
  const [r] = await getDb().select({ n: count() }).from(notifications).where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)));
  return r.n;
}

export async function listNotifications(actor: Actor, limit = 50) {
  assertCaller(actor);
  const rows = await getDb()
    .select()
    .from(notifications)
    .where(eq(notifications.userId, actor.userId))
    .orderBy(desc(notifications.createdAt))
    .limit(Math.min(200, limit));
  return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, body: r.body, href: r.href, read: !!r.readAt, createdAt: r.createdAt }));
}

/** Marks one as read and returns where it points; null when it isn't the caller's. */
export async function openNotification(actor: Actor, id: string): Promise<string | null> {
  assertCaller(actor);
  const db = getDb();
  const [n] = await db.select().from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, actor.userId)));
  if (!n) return null;
  if (!n.readAt) await db.update(notifications).set({ readAt: new Date() }).where(eq(notifications.id, id));
  return n.href || "/notifications";
}

export async function markAllNotificationsRead(actor: Actor): Promise<number> {
  assertCaller(actor);
  const [res] = (await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, actor.userId), isNull(notifications.readAt)))) as unknown as [{ affectedRows: number }];
  return res.affectedRows;
}

export async function getEmailPreference(actor: Actor): Promise<boolean> {
  assertCaller(actor);
  const [u] = await getDb().select({ on: users.notifyEmail }).from(users).where(eq(users.id, actor.userId));
  return u?.on ?? true;
}

/** Self-service: email me my notifications too, or not. Audited. */
export async function setEmailPreference(actor: Actor, on: boolean) {
  assertCaller(actor);
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select({ notifyEmail: users.notifyEmail }).from(users).where(eq(users.id, actor.userId)).for("update");
    if (!before || before.notifyEmail === on) return;
    await tx.update(users).set({ notifyEmail: on }).where(eq(users.id, actor.userId));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "users", entityId: actor.userId, summary: `Email notifications ${on ? "on" : "off"}`, before, after: { notifyEmail: on } });
  });
}

// ---------------------------------------------------------------- the scheduler
/** Active people who may see a module (their own permission rows, not presets). */
async function peopleWhoCan(db: Db | Tx, ids: string[], module: AppModule): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const active = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, unique), eq(users.status, "active")));
  const ok = new Set<string>();
  for (const u of active) if (can(await loadUserPerms(db, u.id), module, "view")) ok.add(u.id);
  return ok;
}

const fmtTime = (d: Date, tz: string) => new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);

export type SchedulerResult = { taskDue: number; meetings: number; payments: number; emailed: number; emailSkipped: number; emailFailed: number };

/**
 * One scheduler pass. Safe to run any number of times: reminders are keyed
 * (task + due date, event + person + start time, payment + due date) and each
 * email is claimed before it's sent.
 */
export async function runScheduler(now = new Date()): Promise<SchedulerResult> {
  const db = getDb();
  const tz = await companyTimezone(db);
  const today = localParts(now, tz).date;
  const tomorrow = addDays(today, 1);
  const out: SchedulerResult = { taskDue: 0, meetings: 0, payments: 0, emailed: 0, emailSkipped: 0, emailFailed: 0 };

  // tasks due today or tomorrow, for whoever they're assigned to
  const due = await db
    .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(isNotNull(tasks.assigneeId), ne(tasks.status, "done"), gte(tasks.dueDate, today), lte(tasks.dueDate, tomorrow)));
  const taskPeople = await peopleWhoCan(db, due.map((t) => t.assigneeId!), "tasks");
  for (const t of due) {
    if (!taskPeople.has(t.assigneeId!)) continue;
    const when = t.dueDate === today ? "today" : "tomorrow";
    if (await notify(db, { userId: t.assigneeId!, type: "task_due", title: `Due ${when}: ${t.title}`, body: "A task assigned to you is due soon.", href: `/tasks?task=${t.id}`, dedupeKey: `task_due:${t.id}:${t.dueDate}` })) out.taskDue++;
  }

  // meetings whose reminder time has come and that haven't started yet (each occurrence of a repeating one)
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const rows = await db
    .select()
    .from(events)
    .where(
      and(
        isNotNull(events.reminderMinutes),
        lte(events.startsAt, weekAhead),
        or(and(eq(events.recurrence, "none"), gte(events.startsAt, now)), and(ne(events.recurrence, "none"), or(isNull(events.recurrenceUntil), gte(events.recurrenceUntil, addDays(today, -1)))))
      )
    );
  const skipped = rows.some((e) => e.recurrence !== "none")
    ? await db.select().from(eventExceptions).where(inArray(eventExceptions.eventId, rows.filter((e) => e.recurrence !== "none").map((e) => e.id)))
    : [];
  const upcoming = rows.flatMap((e) => {
    if (e.recurrence === "none") return [e];
    const first = localParts(e.startsAt, tz).date;
    const lp = localParts(e.startsAt, tz);
    const time = e.allDay ? "" : `T${String(lp.hour).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}`;
    return occurrenceDates(first, e.recurrence, { from: today, to: addDays(today, 8) }, { until: e.recurrenceUntil, exceptions: skipped.filter((x) => x.eventId === e.id).map((x) => x.occurrenceDate) })
      .map((d) => ({ ...e, startsAt: zonedToUtc(`${d}${time}`, tz) }))
      .filter((o) => o.startsAt >= now && o.startsAt <= weekAhead);
  });
  const dueNow = upcoming.filter((e) => e.startsAt.getTime() - (e.reminderMinutes ?? 0) * 60_000 <= now.getTime());
  if (dueNow.length) {
    const att = await db.select().from(eventAttendees).where(inArray(eventAttendees.eventId, [...new Set(dueNow.map((e) => e.id))]));
    const meetingPeople = await peopleWhoCan(db, [...att.map((a) => a.userId), ...dueNow.map((e) => e.createdBy)], "calendar");
    for (const e of dueNow) {
      const who = new Set([e.createdBy, ...att.filter((a) => a.eventId === e.id).map((a) => a.userId)]);
      for (const userId of who) {
        if (!meetingPeople.has(userId)) continue;
        const key = `meeting:${e.id}:${userId}:${e.startsAt.toISOString()}`;
        if (await notify(db, { userId, type: "meeting_reminder", title: `${e.allDay ? "Today" : `At ${fmtTime(e.startsAt, tz)}`}: ${e.title}`, body: [e.location, e.videoUrl].filter(Boolean).join(" · ") || "Calendar reminder", href: `/calendar?view=agenda&date=${localParts(e.startsAt, tz).date}`, dedupeKey: key })) out.meetings++;
      }
    }
  }

  // payments inside their reminder window (or overdue): the person responsible, plus everyone with payments access
  const subs = await db.select().from(subscriptions).where(and(eq(subscriptions.status, "active"), lte(subscriptions.nextDueDate, addDays(today, 90))));
  const windowed = subs.filter((s) => s.nextDueDate <= addDays(today, s.reminderDays));
  if (windowed.length) {
    const active = (await db.select({ id: users.id }).from(users).where(eq(users.status, "active"))).map((u) => u.id);
    const payPeople = await peopleWhoCan(db, active, "payments");
    for (const s of windowed) {
      const responsible = s.responsibleUserId ?? s.createdBy;
      const when = s.nextDueDate < today ? "Overdue" : s.nextDueDate === today ? "Due today" : `Due ${s.nextDueDate}`;
      // everyone who can see payments; the responsible person too, if they can (a reminder shows payment details)
      for (const userId of payPeople) {
        const mine = userId === responsible;
        if (
          await notify(db, {
            userId,
            type: "payment_due",
            title: `${when}: ${s.vendor}`,
            body: mine ? "A payment you look after is coming up. Mark it paid on the Payments page once it's done." : "A company payment is coming up.",
            href: "/payments",
            // the responsible person's key is unchanged from Phase 5, so nobody gets a repeat after the update
            dedupeKey: mine ? `payment:${s.id}:${s.nextDueDate}` : `payment:${s.id}:${s.nextDueDate}:${userId}`,
          })
        )
          out.payments++;
      }
    }
  }

  // emails: each one claimed first, so overlapping runs can't send it twice
  const mailOn = !!mailConfig() || process.env.NODE_ENV !== "production";
  const pending = await db
    .select({ n: notifications, email: users.email, notifyEmail: users.notifyEmail, status: users.status })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(isNull(notifications.emailedAt), eq(notifications.emailSkipped, false), gte(notifications.createdAt, new Date(now.getTime() - 2 * 86_400_000))))
    .orderBy(asc(notifications.createdAt))
    .limit(200);
  for (const p of pending) {
    if (!p.notifyEmail || p.status !== "active" || !mailOn) {
      await db.update(notifications).set({ emailSkipped: true }).where(eq(notifications.id, p.n.id));
      out.emailSkipped++;
      continue;
    }
    const [claim] = (await db.update(notifications).set({ emailedAt: new Date() }).where(and(eq(notifications.id, p.n.id), isNull(notifications.emailedAt)))) as unknown as [{ affectedRows: number }];
    if (claim.affectedRows !== 1) continue;
    const sent = await sendMail(notificationEmail(p.email, p.n));
    if (sent.ok) out.emailed++;
    else {
      // let the next run try again (for up to two days)
      await db.update(notifications).set({ emailedAt: null }).where(eq(notifications.id, p.n.id));
      out.emailFailed++;
    }
  }
  return out;
}
