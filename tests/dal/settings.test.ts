import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Company time zone in Settings: admin only, validated, audited, and used by the marketing heatmap. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let settings: typeof import("@/lib/dal/settings");
let ids: { admin: string; manager: string; staff: string };

beforeAll(async () => {
  t = await setupTestDatabase();
  settings = await import("@/lib/dal/settings");
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
  };
});
afterAll(() => t?.cleanup());

const tz = async () => (await t.db.select().from(t.schema.settings).where(eq(t.schema.settings.id, 1)))[0].timezone;

describe("company time zone", () => {
  it("can't be changed by staff or a manager (an admin without two-factor has no session at all)", async () => {
    await expect(settings.updateCompanyTimezone(await actorFor(t, ids.staff), "Europe/London")).rejects.toThrow(/permission/);
    await expect(settings.updateCompanyTimezone(await actorFor(t, ids.manager), "Europe/London")).rejects.toThrow(/permission/);
    expect(await tz()).toBe("Australia/Sydney");
  });

  it("rejects anything that isn't a real time zone", async () => {
    const admin = await actorFor(t, ids.admin);
    for (const bad of ["Mars/Olympus", "", "AEST", "Australia/Sydney; drop table settings"]) await expect(settings.updateCompanyTimezone(admin, bad)).rejects.toThrow(/Choose a time zone/);
    expect(await tz()).toBe("Australia/Sydney");
  });

  it("an admin can change it; the change is audited with before and after", async () => {
    await settings.updateCompanyTimezone(await actorFor(t, ids.admin), "Europe/London");
    expect(await tz()).toBe("Europe/London");
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, "settings"));
    expect(log).toMatchObject({ action: "update", before: { timezone: "Australia/Sydney" }, after: { timezone: "Europe/London" } });
  });

  it("drives the marketing heatmap: the same UTC instant moves to London's local hour", async () => {
    const mkt = await import("@/lib/dal/marketing");
    const admin = await actorFor(t, ids.admin);
    // typed as 10:30 London time (BST, UTC+1) = 09:30 UTC
    await mkt.createActivity(admin, { occurredAt: "2026-06-10T10:30", channel: "email", contactName: "Zone test", outcome: "replied" });
    const [row] = await t.db.select().from(t.schema.marketingActivities);
    expect(row.occurredAt.toISOString()).toBe("2026-06-10T09:30:00.000Z");
    expect((await mkt.marketingSummary(admin, { month: "2026-06" })).heat[2][10]).toEqual({ touches: 1, responded: 1 });
    // back to Sydney: the stored instant is unchanged and now reads as 19:30 on Wednesday
    await settings.updateCompanyTimezone(admin, "Australia/Sydney");
    expect((await mkt.marketingSummary(admin, { month: "2026-06" })).heat[2][19]).toEqual({ touches: 1, responded: 1 });
  });
});
