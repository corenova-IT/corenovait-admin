import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { zonedToUtc } from "@/lib/zoned";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Clock in and out, hours, forgotten clock-outs and their logged corrections. Partner A has employees eA1 and eA2; partner B has eB1. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let sh: typeof import("@/lib/dal/shifts");
let emp: typeof import("@/lib/dal/partner-employees");
let ap: typeof import("@/lib/dal/admin-partners");
let assign: typeof import("@/lib/dal/assignments");
let ids: Record<"owner" | "staff" | "a" | "b" | "orphan", string>;
let E: Record<"a1" | "a2" | "b1", string>;

const TZ = "Australia/Sydney";
const today = () => todayIn(TZ);
const at = (day: string, hhmm: string) => zonedToUtc(`${day}T${hhmm}`, TZ);
const as = (id: string) => actorFor(t, id);
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const rows = (userId: string) => t.db.select().from(t.schema.shifts).where(eq(t.schema.shifts.userId, userId));
const wipe = (userId: string) => t.db.delete(t.schema.shifts).where(eq(t.schema.shifts.userId, userId));
const addShift = (userId: string, over: Record<string, unknown>) => t.db.insert(t.schema.shifts).values({ id: crypto.randomUUID(), userId, clockInAt: new Date(), ...over } as never);

beforeAll(async () => {
  t = await setupTestDatabase();
  sh = await import("@/lib/dal/shifts");
  emp = await import("@/lib/dal/partner-employees");
  ap = await import("@/lib/dal/admin-partners");
  assign = await import("@/lib/dal/assignments");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    orphan: (await createPerson(t, { email: "orphan@example.test", preset: "employee" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const streams = await t.db.select().from(t.schema.streams);
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [streams.find((s) => s.name === "Upwork")!.id], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [streams.find((s) => s.name === "Fiverr")!.id], countryCodes: ["AU"] });
  const mk = async (who: string, email: string) => {
    const id = (await emp.inviteMyEmployee(await as(who), { email, fullName: `Emp ${email.split("@")[0]}`, jobTitle: "" })).userId;
    await t.db.update(t.schema.users).set({ status: "active" }).where(eq(t.schema.users.id, id));
    return id;
  };
  E = { a1: await mk(ids.a, "ea1@example.test"), a2: await mk(ids.a, "ea2@example.test"), b1: await mk(ids.b, "eb1@example.test") };
});
afterAll(() => t?.cleanup());

describe("clocking in and out", () => {
  it("an employee clocks in and out, and the shift is recorded", async () => {
    const e = await as(E.a1);
    await sh.clockIn(e);
    const [open] = await rows(E.a1);
    expect(open).toMatchObject({ clockOutAt: null, correctedBy: null });
    expect((await sh.myShifts(e)).open).toMatchObject({ flagged: false });
    const out = await sh.clockOut(e);
    expect(out.minutes).toBeGreaterThanOrEqual(0);
    const [done] = await rows(E.a1);
    expect(done.clockOutAt).toBeInstanceOf(Date);
    expect((await sh.myShifts(e)).open).toBeNull();
  });

  it("refuses a second clock-in, clocking out when not clocked in, and two clicks at the same moment (the database allows one open shift)", async () => {
    const e = await as(E.a2);
    await expect(sh.clockOut(e)).rejects.toThrow(/aren't clocked in/);
    const results = await Promise.allSettled([sh.clockIn(e), sh.clockIn(e)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ name: "RuleError" });
    expect(await rows(E.a2)).toHaveLength(1);
    await expect(sh.clockIn(e)).rejects.toThrow(/already clocked in/);
    await sh.clockOut(e);
    // and the database itself refuses a second open shift, whatever the app does
    await addShift(E.a2, {});
    await expect(addShift(E.a2, {})).rejects.toThrow();
    await wipe(E.a2);
  });

  it("is only for employees who work for a partner", async () => {
    for (const who of [ids.staff, ids.a, ids.owner]) await expect(sh.clockIn(await as(who)), who).rejects.toThrow(/permission/i);
    await expect(sh.clockIn(await as(ids.orphan))).rejects.toThrow(/isn't linked to a partner/);
    await expect(sh.myShifts(await as(ids.a))).rejects.toThrow(/permission/i);
  });
});

describe("hours", () => {
  it("add up closed shifts for today, this week and this month, by the day they started in the company's time zone", async () => {
    await wipe(E.a1);
    const day = today();
    await addShift(E.a1, { clockInAt: at(day, "09:00"), clockOutAt: at(day, "11:30") }); // 150
    await addShift(E.a1, { clockInAt: at(day, "13:00"), clockOutAt: at(day, "14:00") }); // 60
    await addShift(E.a1, { clockInAt: at(addDays(day, -40), "09:00"), clockOutAt: at(addDays(day, -40), "17:00") }); // long ago: not this month
    const mine = await sh.myShifts(await as(E.a1));
    expect(mine.todayMinutes).toBe(210);
    expect(mine.weekMinutes).toBeGreaterThanOrEqual(210);
    expect(mine.monthMinutes).toBeGreaterThanOrEqual(210);
    expect(mine.recent).toHaveLength(3);
    const range = await sh.employeeShifts(await as(ids.a), E.a1, { from: day, to: day });
    expect(range.totalMinutes).toBe(210);
    expect(range.shifts).toHaveLength(2);
    const wide = await sh.employeeShifts(await as(ids.owner), E.a1, { from: addDays(day, -60), to: day });
    expect(wide.totalMinutes).toBe(210 + 480);
    // the minutes list used by the partner's and admin's lists agrees
    const byEmployee = await sh.minutesByEmployee(t.db, [E.a1, E.a2], day, day);
    expect(byEmployee.get(E.a1)).toBe(210);
  });

  it("show an employee only their own, and a partner only their own employees' (another partner's look like they don't exist)", async () => {
    await addShift(E.b1, { clockInAt: at(today(), "10:00"), clockOutAt: at(today(), "12:00") });
    expect((await sh.myShifts(await as(E.a2))).recent).toEqual([]);
    expect((await sh.myShifts(await as(E.b1))).todayMinutes).toBe(120);
    const missing = await msg(sh.employeeShifts(await as(ids.a), crypto.randomUUID()));
    expect(missing).toMatch(/no longer exists/);
    expect(await msg(sh.employeeShifts(await as(ids.a), E.b1))).toBe(missing);
    expect(await msg(sh.employeeShifts(await as(ids.a), ids.staff))).toBe(missing);
    for (const who of [ids.staff, E.a1]) await expect(sh.employeeShifts(await as(who), E.a1), who).rejects.toThrow(/permission/i);
  });
});

describe("forgotten clock-outs", () => {
  it("are flagged after the configured time, and the employee can't close or start one themselves", async () => {
    await wipe(E.a1);
    await addShift(E.a1, { clockInAt: new Date(Date.now() - 20 * 3_600_000) }); // open for 20 hours; the limit is 12
    expect(await sh.flagForgottenShifts(t.db)).toBe(1);
    expect(await sh.flagForgottenShifts(t.db)).toBe(0); // running it again does nothing more
    const e = await as(E.a1);
    expect((await sh.myShifts(e)).open).toMatchObject({ flagged: true });
    await expect(sh.clockOut(e)).rejects.toThrow(/ask your partner to correct/i);
    await expect(sh.clockIn(e)).rejects.toThrow(/ask your partner to correct/i);
    expect([...(await sh.flaggedCounts(t.db, [E.a1, E.a2])).entries()]).toEqual([[E.a1, 1]]);
  });

  it("the time is configurable by an admin only, and logged", async () => {
    const owner = await as(ids.owner);
    await sh.setShiftFlagHours(owner, 24);
    expect((await sh.myShifts(await as(E.a1))).open).toMatchObject({ flagged: false }); // 20h is under the new limit
    await sh.setShiftFlagHours(owner, 12);
    expect((await sh.myShifts(await as(E.a1))).open).toMatchObject({ flagged: true });
    await expect(sh.setShiftFlagHours(owner, 0)).rejects.toThrow(/1 to 48/);
    await expect(sh.setShiftFlagHours(owner, 49)).rejects.toThrow(/1 to 48/);
    for (const who of [ids.a, ids.staff, E.a1]) await expect(sh.setShiftFlagHours(await as(who), 8), who).rejects.toThrow(/permission|admins/i);
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, "settings"))).filter((r) => /Forgotten clock-out/.test(r.summary ?? ""));
    expect(log.map((r) => r.after)).toEqual([{ shiftFlagHours: 24 }, { shiftFlagHours: 12 }]);
  });
});

describe("corrections", () => {
  let shiftId: string;
  const times = (day: string, a = "09:00", b = "17:00") => ({ clockIn: `${day}T${a}`, clockOut: `${day}T${b}`, note: "Forgot to clock out" });
  beforeAll(async () => {
    shiftId = (await rows(E.a1)).find((s) => !s.clockOutAt)!.id;
  });

  it("the partner corrects their own employee's shift: reason required, logged with before and after, and the flag clears", async () => {
    const a = await as(ids.a);
    const day = addDays(today(), -1);
    await expect(sh.correctShift(a, shiftId, { ...times(day), note: "" })).rejects.toThrow(/say why/i);
    await sh.correctShift(a, shiftId, times(day));
    const [fixed] = (await rows(E.a1)).filter((s) => s.id === shiftId);
    expect(fixed).toMatchObject({ correctedBy: ids.a, correctionNote: "Forgot to clock out" });
    expect(fixed.clockOutAt).toBeInstanceOf(Date);
    expect(fixed.correctedAt).toBeInstanceOf(Date);
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, E.a1))).filter((r) => r.entity === "shifts");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: "update", actorId: ids.a, before: { shiftId, clockOutAt: null }, after: { shiftId, note: "Forgot to clock out" } });
    expect((await sh.myShifts(await as(E.a1))).open).toBeNull();
    expect((await sh.myShifts(await as(E.a1))).recent.find((s) => s.id === shiftId)).toMatchObject({ corrected: true, minutes: 480, correctionNote: "Forgot to clock out" });
    await sh.clockIn(await as(E.a1)); // free to clock in again
    await sh.clockOut(await as(E.a1));
  });

  it("refuses impossible corrections: backwards, too long, in the future, or overlapping another shift", async () => {
    const a = await as(ids.a);
    const day = addDays(today(), -1);
    await expect(sh.correctShift(a, shiftId, times(day, "17:00", "09:00"))).rejects.toThrow(/after the clock-in/);
    await expect(sh.correctShift(a, shiftId, { clockIn: `${addDays(day, -1)}T08:00`, clockOut: `${day}T20:00`, note: "too long" })).rejects.toThrow(/longer than 24 hours/);
    await expect(sh.correctShift(a, shiftId, { clockIn: `${addDays(today(), 1)}T09:00`, clockOut: `${addDays(today(), 1)}T10:00`, note: "future" })).rejects.toThrow(/future/);
    await addShift(E.a1, { clockInAt: at(addDays(today(), -3), "10:00"), clockOutAt: at(addDays(today(), -3), "12:00") });
    await expect(sh.correctShift(a, shiftId, times(addDays(today(), -3), "11:00", "13:00"))).rejects.toThrow(/overlaps/);
    await expect(sh.correctShift(a, shiftId, { clockIn: "yesterday", clockOut: "now", note: "bad" })).rejects.toThrow(/date and time/i);
  });

  it("an admin can correct any employee's shift, and it shows with the partner's changes whoever made it", async () => {
    const owner = await as(ids.owner);
    const [b1shift] = await rows(E.b1);
    await sh.correctShift(owner, b1shift.id, { clockIn: `${addDays(today(), -1)}T10:00`, clockOut: `${addDays(today(), -1)}T13:00`, note: "Admin fixed the end time" });
    expect((await rows(E.b1))[0]).toMatchObject({ correctedBy: ids.owner });
    const detail = await ap.partnerDetail(owner, ids.b);
    expect(detail.changes.some((c) => c.entity === "shifts" && /Admin fixed the end time/.test(c.summary ?? ""))).toBe(true);
    const mine = await ap.partnerDetail(owner, ids.a);
    expect(mine.changes.some((c) => c.entity === "shifts" && /Forgot to clock out/.test(c.summary ?? ""))).toBe(true);
    expect(mine.changes.some((c) => /Admin fixed the end time/.test(c.summary ?? ""))).toBe(false); // not another partner's
  });

  it("nobody else can correct: another partner, the employee, staff; and a missing shift looks like someone else's", async () => {
    const [b1shift] = await rows(E.b1);
    const before = JSON.stringify(await rows(E.b1));
    const stranger = await as(ids.a);
    await expect(sh.correctShift(stranger, b1shift.id, times(today()))).rejects.toThrow(/no longer exists/);
    expect(await msg(sh.correctShift(stranger, b1shift.id, times(today())))).toBe(await msg(sh.correctShift(stranger, crypto.randomUUID(), times(today()))));
    for (const who of [E.b1, ids.staff]) await expect(sh.correctShift(await as(who), b1shift.id, times(today())), who).rejects.toThrow(/permission/i);
    expect(JSON.stringify(await rows(E.b1))).toBe(before);
  });
});
