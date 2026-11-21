import "server-only";
import { and, desc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { zonedToUtc } from "@/lib/zoned";
import { mysqlCode } from "./assignments";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, requireAdmin, requirePerm, type Actor } from "./guard";
import { ownEmployee } from "./partner-employees";
import { companyToday } from "./payments";
import { NotFound, partnerScope } from "./scope";

/**
 * Shifts: an employee clocks in and out; hours worked and history come from here.
 *
 * - One open shift per person, enforced by the database (unique key on user + open_key).
 * - A shift that stays open longer than settings.shift_flag_hours is FLAGGED as a forgotten clock-out. The
 *   employee can't clock out of it (or start a new one) themselves; their partner or an admin corrects
 *   it. A correction needs a reason, can't overlap another shift or end in the future, and is logged (who,
 *   when, why, before and after) in the shifts row AND the audit log, where the partner and admins see it.
 * - Hours count CLOSED shifts, attributed to the day they started (company time zone). An open shift counts
 *   only once it is closed or corrected.
 * - Employees see only their own shifts and hours. Only their partner and admins see an employee's.
 */
const { shifts, users, settings } = schema;

const MAX_SHIFT_HOURS = 24;

export async function shiftFlagHours(db: Db | Tx): Promise<number> {
  const [row] = await db.select({ h: settings.shiftFlagHours }).from(settings).where(eq(settings.id, 1));
  return row?.h ?? 12;
}

async function companyZone(db: Db | Tx): Promise<string> {
  const [row] = await db.select({ tz: settings.timezone }).from(settings).where(eq(settings.id, 1));
  return row?.tz ?? "Australia/Sydney";
}

/** Marks open shifts that have run past the limit. Safe to run as often as you like. */
export async function flagForgottenShifts(db: Db | Tx = getDb(), now = new Date()): Promise<number> {
  const hours = await shiftFlagHours(db);
  const cutoff = new Date(now.getTime() - hours * 3_600_000);
  const [res] = await db
    .update(shifts)
    .set({ flaggedAt: now })
    .where(and(isNull(shifts.clockOutAt), isNull(shifts.flaggedAt), lt(shifts.clockInAt, cutoff)));
  return Number((res as unknown as { affectedRows?: number }).affectedRows ?? 0);
}

const isFlagged = (s: { clockOutAt: Date | null; clockInAt: Date }, hours: number, now: Date) => !s.clockOutAt && now.getTime() - s.clockInAt.getTime() > hours * 3_600_000;
const minutesOf = (s: { clockInAt: Date; clockOutAt: Date | null }) => (s.clockOutAt ? Math.round((s.clockOutAt.getTime() - s.clockInAt.getTime()) / 60_000) : 0);

/** The UTC window for local dates from..to inclusive, in the company time zone. */
async function window(db: Db | Tx, from: string, to: string) {
  const tz = await companyZone(db);
  return { tz, start: zonedToUtc(`${from}T00:00`, tz), end: zonedToUtc(`${addDays(to, 1)}T00:00`, tz) };
}

export type ShiftView = {
  id: string;
  clockInAt: string;
  clockOutAt: string | null;
  minutes: number;
  open: boolean;
  flagged: boolean;
  corrected: boolean;
  correctionNote: string | null;
  correctedAt: string | null;
};

const toView = (s: typeof shifts.$inferSelect, hours: number, now: Date): ShiftView => ({
  id: s.id,
  clockInAt: s.clockInAt.toISOString(),
  clockOutAt: s.clockOutAt?.toISOString() ?? null,
  minutes: minutesOf(s),
  open: !s.clockOutAt,
  flagged: isFlagged(s, hours, now),
  corrected: !!s.correctedAt,
  correctionNote: s.correctionNote,
  correctedAt: s.correctedAt?.toISOString() ?? null,
});

// ---------------------------------------------------------------- the employee's own clock
function ensureEmployee(actor: Actor, action: "view" | "create" | "edit") {
  requirePerm(actor, "employee", action);
  const s = actor.scoped;
  if (actor.presetId !== "employee" || !s || s.kind !== "employee") throw new AccessDenied();
  if (!s.partnerUserId) throw new RuleError("Your account isn't linked to a partner yet. Ask an admin.");
}

export async function clockIn(actor: Actor): Promise<void> {
  ensureEmployee(actor, "create");
  const db = getDb();
  const now = new Date();
  const hours = await shiftFlagHours(db);
  const [open] = await db.select().from(shifts).where(and(eq(shifts.userId, actor.userId), isNull(shifts.clockOutAt)));
  if (open) {
    throw new RuleError(isFlagged(open, hours, now) ? "You still have an open shift from before. Ask your partner to correct it, then clock in." : "You're already clocked in.");
  }
  try {
    await db.insert(shifts).values({ userId: actor.userId, clockInAt: now });
  } catch (e) {
    if (mysqlCode(e) === "ER_DUP_ENTRY") throw new RuleError("You're already clocked in."); // two clicks at once: the database allows only one
    throw e;
  }
}

export async function clockOut(actor: Actor): Promise<{ minutes: number }> {
  ensureEmployee(actor, "edit");
  const db = getDb();
  const now = new Date();
  const hours = await shiftFlagHours(db);
  return db.transaction(async (tx) => {
    const [open] = await tx.select().from(shifts).where(and(eq(shifts.userId, actor.userId), isNull(shifts.clockOutAt))).for("update");
    if (!open) throw new RuleError("You aren't clocked in.");
    if (isFlagged(open, hours, now)) throw new RuleError("This shift has been open for too long to close yourself. Ask your partner to correct it.");
    await tx.update(shifts).set({ clockOutAt: now }).where(eq(shifts.id, open.id));
    return { minutes: minutesOf({ clockInAt: open.clockInAt, clockOutAt: now }) };
  });
}

export type MyShifts = {
  timeZone: string;
  open: { since: string; flagged: boolean } | null;
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  recent: ShiftView[];
};

/** Hours (closed shifts that started in the window) for one person. */
async function minutesBetween(db: Db | Tx, userId: string, from: string, to: string): Promise<number> {
  const w = await window(db, from, to);
  const rows = await db.select({ clockInAt: shifts.clockInAt, clockOutAt: shifts.clockOutAt }).from(shifts).where(and(eq(shifts.userId, userId), gte(shifts.clockInAt, w.start), lt(shifts.clockInAt, w.end)));
  return rows.reduce((a, r) => a + minutesOf(r), 0);
}

const weekStartOf = (today: string) => {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(today, -dow);
};

export async function myShifts(actor: Actor): Promise<MyShifts> {
  ensureEmployee(actor, "view");
  const db = getDb();
  const now = new Date();
  await flagForgottenShifts(db, now);
  const [today, hours, timeZone] = await Promise.all([companyToday(db), shiftFlagHours(db), companyZone(db)]);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [todayM, weekM, monthM, recent, [open]] = await Promise.all([
    minutesBetween(db, actor.userId, today, today),
    minutesBetween(db, actor.userId, weekStartOf(today), today),
    minutesBetween(db, actor.userId, monthStart, today),
    db.select().from(shifts).where(eq(shifts.userId, actor.userId)).orderBy(desc(shifts.clockInAt)).limit(30),
    db.select().from(shifts).where(and(eq(shifts.userId, actor.userId), isNull(shifts.clockOutAt))),
  ]);
  return { timeZone, open: open ? { since: open.clockInAt.toISOString(), flagged: isFlagged(open, hours, now) } : null, todayMinutes: todayM, weekMinutes: weekM, monthMinutes: monthM, recent: recent.map((s) => toView(s, hours, now)) };
}

// ---------------------------------------------------------------- the partner and the admin
/** Which employees this actor may look at: a partner's own, or (admin) anyone who is an employee. */
async function employeeAccess(db: Db | Tx, actor: Actor, employeeId: string) {
  assertCaller(actor);
  if (actor.isAdmin) {
    requireAdmin(actor);
    const [u] = await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(and(eq(users.id, employeeId), eq(users.presetId, "employee")));
    if (!u) throw new RuleError("That person isn't an employee.");
    return { id: u.id, name: u.name || u.email, email: u.email };
  }
  if (actor.presetId !== "stream_partner") throw new AccessDenied();
  requirePerm(actor, "stream_partner", "view");
  partnerScope(actor);
  const e = await ownEmployee(db, actor, employeeId); // someone else's employee = not found
  return { id: e.id, name: e.fullName || e.email, email: e.email };
}

export type EmployeeShifts = {
  employee: { id: string; name: string; email: string };
  from: string;
  to: string;
  totalMinutes: number;
  open: ShiftView | null;
  shifts: ShiftView[];
  timeZone: string;
};

/** One employee's shifts and hours between two local dates (for their partner or an admin). */
export async function employeeShifts(actor: Actor, employeeId: string, range: { from?: string; to?: string } = {}): Promise<EmployeeShifts> {
  const db = getDb();
  const employee = await employeeAccess(db, actor, employeeId);
  const now = new Date();
  await flagForgottenShifts(db, now);
  const today = await companyToday(db);
  const from = range.from && /^\d{4}-\d{2}-\d{2}$/.test(range.from) ? range.from : `${today.slice(0, 7)}-01`;
  const toRaw = range.to && /^\d{4}-\d{2}-\d{2}$/.test(range.to) ? range.to : today;
  const to = toRaw < from ? from : toRaw;
  const [w, hours] = await Promise.all([window(db, from, to), shiftFlagHours(db)]);
  const [rows, [open]] = await Promise.all([
    db.select().from(shifts).where(and(eq(shifts.userId, employeeId), gte(shifts.clockInAt, w.start), lt(shifts.clockInAt, w.end))).orderBy(desc(shifts.clockInAt)).limit(500),
    db.select().from(shifts).where(and(eq(shifts.userId, employeeId), isNull(shifts.clockOutAt))),
  ]);
  const views = rows.map((s) => toView(s, hours, now));
  return { employee, from, to, totalMinutes: views.reduce((a, s) => a + s.minutes, 0), open: open ? toView(open, hours, now) : null, shifts: views, timeZone: w.tz };
}

const localTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a date and time like 2026-03-04 09:00.");
export const correctionInput = z.object({
  clockIn: localTime,
  clockOut: localTime,
  note: z.string().trim().min(3, "Say why you are correcting it.").max(300),
});
export type CorrectionInput = z.input<typeof correctionInput>;

/**
 * The partner (their own employee) or an admin corrects a shift: both times, with a required reason.
 * Logged in the shift itself and in the audit log with before and after.
 */
export async function correctShift(actor: Actor, shiftId: string, input: CorrectionInput) {
  const parsed = correctionInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the times and try again.");
  const v = parsed.data;
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).for("update");
    if (!before) throw actor.isAdmin ? new RuleError("That shift no longer exists.") : new NotFound();
    const employee = await employeeAccess(tx, actor, before.userId); // NotFound for a partner if it isn't their employee's
    const tz = await companyZone(tx);
    const clockIn = zonedToUtc(v.clockIn, tz);
    const clockOut = zonedToUtc(v.clockOut, tz);
    if (Number.isNaN(clockIn.getTime()) || Number.isNaN(clockOut.getTime())) throw new RuleError("Those times aren't valid.");
    if (clockOut <= clockIn) throw new RuleError("The clock-out has to be after the clock-in.");
    if (clockOut.getTime() - clockIn.getTime() > MAX_SHIFT_HOURS * 3_600_000) throw new RuleError(`A shift can't be longer than ${MAX_SHIFT_HOURS} hours. Split it into two days.`);
    if (clockOut.getTime() > Date.now() + 5 * 60_000) throw new RuleError("The clock-out can't be in the future.");
    const [clash] = await tx
      .select({ id: shifts.id })
      .from(shifts)
      .where(and(eq(shifts.userId, before.userId), ne(shifts.id, shiftId), lt(shifts.clockInAt, clockOut), or(isNull(shifts.clockOutAt), gte(shifts.clockOutAt, clockIn)))); // overlaps another shift (or another open one)
    if (clash) throw new RuleError("That overlaps another shift for this person.");
    await tx.update(shifts).set({ clockInAt: clockIn, clockOutAt: clockOut, correctedBy: actor.userId, correctedAt: new Date(), correctionNote: v.note }).where(eq(shifts.id, shiftId));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "shifts",
      entityId: before.userId,
      summary: `Corrected a shift for ${employee.name}: ${v.note}`,
      before: { shiftId, clockInAt: before.clockInAt.toISOString(), clockOutAt: before.clockOutAt?.toISOString() ?? null },
      after: { shiftId, clockInAt: clockIn.toISOString(), clockOutAt: clockOut.toISOString(), note: v.note },
    });
  });
}

/** Employees with a flagged (forgotten) clock-out among these ids, for the partner's and admin's lists. */
export async function flaggedCounts(db: Db | Tx, employeeIds: string[], now = new Date()): Promise<Map<string, number>> {
  if (!employeeIds.length) return new Map();
  await flagForgottenShifts(db, now);
  const hours = await shiftFlagHours(db);
  const rows = await db.select({ userId: shifts.userId, clockInAt: shifts.clockInAt, clockOutAt: shifts.clockOutAt }).from(shifts).where(and(inArray(shifts.userId, employeeIds), isNull(shifts.clockOutAt)));
  const out = new Map<string, number>();
  for (const r of rows) if (isFlagged(r, hours, now)) out.set(r.userId, (out.get(r.userId) ?? 0) + 1);
  return out;
}

/** Total closed-shift minutes per employee between two local dates. */
export async function minutesByEmployee(db: Db | Tx, employeeIds: string[], from: string, to: string): Promise<Map<string, number>> {
  if (!employeeIds.length) return new Map();
  const w = await window(db, from, to);
  const rows = await db
    .select({ userId: shifts.userId, clockInAt: shifts.clockInAt, clockOutAt: shifts.clockOutAt })
    .from(shifts)
    .where(and(inArray(shifts.userId, employeeIds), gte(shifts.clockInAt, w.start), lt(shifts.clockInAt, w.end)));
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.userId, (out.get(r.userId) ?? 0) + minutesOf(r));
  return out;
}

/** For the Settings page: the current limit (admins only). */
export async function currentShiftFlagHours(actor: Actor): Promise<number> {
  requireAdmin(actor);
  requirePerm(actor, "settings", "view");
  return shiftFlagHours(getDb());
}

/** Admin: how long an open shift may run before it is flagged (hours). */
export async function setShiftFlagHours(actor: Actor, hoursRaw: number) {
  requireAdmin(actor);
  requirePerm(actor, "settings", "edit");
  const hours = z.coerce.number().int().min(1, "Use 1 to 48 hours.").max(48, "Use 1 to 48 hours.").safeParse(hoursRaw);
  if (!hours.success) throw new RuleError(hours.error.issues[0].message);
  const db = getDb();
  await db.transaction(async (tx) => {
    const before = await shiftFlagHours(tx);
    if (before === hours.data) return;
    await tx.update(settings).set({ shiftFlagHours: hours.data, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(settings.id, 1));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "settings", entityId: "1", summary: `Forgotten clock-out flag set to ${hours.data} hours`, before: { shiftFlagHours: before }, after: { shiftFlagHours: hours.data } });
  });
}

