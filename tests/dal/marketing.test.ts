import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DataScope } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/zoned";
import { actorFor, countRows, createPerson, setupTestDatabase, snapshot } from "./db";

/** Phase 3: marketing permissions and scope, money, the time-zone heatmap and the insight rules. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let mkt: typeof import("@/lib/dal/marketing");
let ids: { admin: string; plain: string; own: string; assigned: string; manager: string };
const DENIED = /permission|yourself|campaigns|isn't yours|two-factor|session/i;
const TZ = "Australia/Sydney";

/** Staff preset plus marketing access with a given scope (what an admin would grant on the Team page). */
async function grantMarketing(userId: string, scope: DataScope, actions = { view: true, create: true, edit: true, delete: true, export: false }) {
  const { loadUserPerms, writeUserPerms } = await import("@/lib/dal/internal");
  await t.db.transaction(async (tx) => {
    const map = await loadUserPerms(tx, userId);
    map.marketing = { ...actions, scope };
    await writeUserPerms(tx, userId, map);
    await tx.update(t.schema.users).set({ presetId: "custom" }).where(eq(t.schema.users.id, userId));
  });
}

const as = (id: string) => actorFor(t, id);
const activity = (over: Record<string, unknown> = {}) => ({
  occurredAt: "2026-01-07T10:30",
  channel: "email" as const,
  contactName: "Sample Contact",
  contactCompany: "Example Pty",
  outcome: "replied" as const,
  ...over,
});

beforeAll(async () => {
  t = await setupTestDatabase();
  mkt = await import("@/lib/dal/marketing");
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    plain: (await createPerson(t, { email: "plain@example.test" })).id,
    own: (await createPerson(t, { email: "own@example.test" })).id,
    assigned: (await createPerson(t, { email: "assigned@example.test" })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true })).id,
  };
  await grantMarketing(ids.own, "own");
  await grantMarketing(ids.assigned, "assigned");
});
afterAll(() => t?.cleanup());

describe("staff without marketing access", () => {
  it("can't read or change any of it, and nothing changes", async () => {
    const admin = await as(ids.admin);
    const campaignId = await mkt.saveCampaign(admin, null, { name: "Locked campaign" });
    const activityId = await mkt.createActivity(admin, activity({ campaignId }));
    const staff = await as(ids.plain); // signing in adds a session row, so snapshot after it
    const before = { ...(await snapshot(t)), acts: await countRows(t, "marketing_activities"), camps: await countRows(t, "campaigns") };
    const attempts: Array<() => Promise<unknown>> = [
      () => mkt.marketingSummary(staff, {}),
      () => mkt.marketingSnapshot(staff),
      () => mkt.listActivities(staff, {}),
      () => mkt.marketingLookups(staff),
      () => mkt.campaignResults(staff),
      () => mkt.exportActivitiesCsv(staff, {}),
      () => mkt.createActivity(staff, activity()),
      () => mkt.updateActivity(staff, activityId, activity({ contactName: "Changed" })),
      () => mkt.deleteActivity(staff, activityId),
      () => mkt.saveCampaign(staff, null, { name: "Sneaky" }),
      () => mkt.saveCampaign(staff, campaignId, { name: "Renamed" }),
      () => mkt.deleteCampaign(staff, campaignId),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toThrow(DENIED);
    expect({ ...(await snapshot(t)), acts: await countRows(t, "marketing_activities"), camps: await countRows(t, "campaigns") }).toEqual(before);
    await mkt.deleteActivity(admin, activityId);
    await mkt.deleteCampaign(admin, campaignId);
  });
});

describe("scope", () => {
  let adminsOwn: string;
  let adminsForAssigned: string;
  let ownsOwn: string;

  beforeAll(async () => {
    const admin = await as(ids.admin);
    adminsOwn = await mkt.createActivity(admin, activity({ contactName: "Admin's contact", occurredAt: "2026-02-03T09:15" }));
    adminsForAssigned = await mkt.createActivity(admin, activity({ contactName: "Logged for assigned", ownerId: ids.assigned, occurredAt: "2026-02-04T11:00" }));
    ownsOwn = await mkt.createActivity(await as(ids.own), activity({ contactName: "Own's contact", occurredAt: "2026-02-05T14:00", outcome: "no_response" }));
  });

  it("own: sees and counts only the activity they logged", async () => {
    const own = await as(ids.own);
    const list = await mkt.listActivities(own, { month: "2026-02" });
    expect(list.rows.map((r) => r.contactName)).toEqual(["Own's contact"]);
    const s = await mkt.marketingSummary(own, { month: "2026-02" });
    expect(s.totals.contacts).toBe(1);
    expect(s.totals.responded).toBe(0);
  });

  it("own: can't change, delete or take over someone else's activity", async () => {
    const own = await as(ids.own);
    await expect(mkt.updateActivity(own, adminsOwn, activity({ contactName: "Hijacked" }))).rejects.toThrow(DENIED);
    await expect(mkt.deleteActivity(own, adminsOwn)).rejects.toThrow(DENIED);
    await expect(mkt.createActivity(own, activity({ ownerId: ids.admin }))).rejects.toThrow(/only log activity as yourself/);
    await expect(mkt.updateActivity(own, ownsOwn, activity({ ownerId: ids.admin, occurredAt: "2026-02-05T14:00" }))).rejects.toThrow(/only log activity as yourself/);
  });

  it("own: can't manage campaigns (they're shared by everyone)", async () => {
    await expect(mkt.saveCampaign(await as(ids.own), null, { name: "Mine" })).rejects.toThrow(/manage campaigns/);
  });

  it("assigned: also sees activity someone logged for them", async () => {
    const list = await mkt.listActivities(await as(ids.assigned), { month: "2026-02" });
    expect(list.rows.map((r) => r.contactName)).toEqual(["Logged for assigned"]);
    // and may edit it, but not hand it to someone else
    const assigned = await as(ids.assigned);
    await mkt.updateActivity(assigned, adminsForAssigned, activity({ contactName: "Logged for assigned", ownerId: ids.assigned, occurredAt: "2026-02-04T11:00", outcome: "meeting" }));
    await expect(mkt.updateActivity(assigned, adminsForAssigned, activity({ ownerId: ids.admin, occurredAt: "2026-02-04T11:00" }))).rejects.toThrow(DENIED);
  });

  it("all: sees everything and can filter by owner", async () => {
    const admin = await as(ids.admin);
    expect((await mkt.listActivities(admin, { month: "2026-02" })).total).toBe(3);
    const byOwner = await mkt.listActivities(admin, { month: "2026-02", owner: ids.own });
    expect(byOwner.rows.map((r) => r.contactName)).toEqual(["Own's contact"]);
    // a manager (all scope) sees the same
    expect((await mkt.listActivities(await as(ids.manager), { month: "2026-02" })).total).toBe(3);
  });

  it("changes are audited with before and after", async () => {
    const admin = await as(ids.admin);
    await mkt.updateActivity(admin, adminsOwn, activity({ contactName: "Admin's contact (edited)", occurredAt: "2026-02-03T09:15" }));
    await mkt.deleteActivity(admin, adminsOwn);
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, adminsOwn));
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(Object.keys(byAction).sort()).toEqual(["create", "delete", "update"]);
    expect(byAction.update.before).toMatchObject({ contactName: "Admin's contact" });
    expect(byAction.update.after).toMatchObject({ contactName: "Admin's contact (edited)" });
    expect(byAction.delete.before).toMatchObject({ contactName: "Admin's contact (edited)" });
  });

  it("export follows the scope and is logged", async () => {
    await grantMarketing(ids.own, "own", { view: true, create: true, edit: true, delete: true, export: true });
    const out = await mkt.exportActivitiesCsv(await as(ids.own), { month: "2026-02" });
    expect(out.rows).toBe(1);
    expect(out.csv).toContain("Own's contact");
    expect(out.csv).not.toContain("Logged for assigned");
    const [log] = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entity, "marketing"));
    expect(log).toMatchObject({ action: "export" });
  });
});

describe("money", () => {
  it("stores a won deal in its own currency and converts it to the base currency in MySQL", async () => {
    const admin = await as(ids.admin);
    const id = await mkt.createActivity(admin, activity({ outcome: "deal_won", dealValue: "1,000.50", dealCurrency: "GBP", dealFxRate: "1.95", occurredAt: "2026-03-02T10:00" }));
    const [row] = await t.db.select().from(t.schema.marketingActivities).where(eq(t.schema.marketingActivities.id, id));
    expect(row).toMatchObject({ dealValueMinor: 100050, dealCurrency: "GBP", dealValueBaseMinor: 195098 }); // 1000.50 x 1.95 = 1950.975 -> 1950.98
    const s = await mkt.marketingSummary(admin, { month: "2026-03" });
    expect(s.totals).toMatchObject({ won: 1, wonValueBaseMinor: 195098 });
  });

  it("ignores a value on anything but a won deal, and refuses a zero or negative one", async () => {
    const admin = await as(ids.admin);
    const id = await mkt.createActivity(admin, activity({ outcome: "meeting", dealValue: "500", occurredAt: "2026-03-03T10:00" }));
    const [row] = await t.db.select().from(t.schema.marketingActivities).where(eq(t.schema.marketingActivities.id, id));
    expect(row.dealValueMinor).toBeNull();
    await expect(mkt.createActivity(admin, activity({ outcome: "deal_won", dealValue: "0" }))).rejects.toThrow(/above zero/);
    await expect(mkt.createActivity(admin, activity({ outcome: "deal_won", dealValue: "-5" }))).rejects.toThrow();
  });

  it("refuses activity in the future", async () => {
    await expect(mkt.createActivity(await as(ids.admin), activity({ occurredAt: "2099-01-01T09:00" }))).rejects.toThrow(/future/);
  });
});

describe("heatmap and insights, in the company time zone", () => {
  /** Inserts activity directly (fast) at a local Sydney time. */
  async function bulk(local: string, contacts: number, responded: number) {
    const at = zonedToUtc(local, TZ);
    await t.db.insert(t.schema.marketingActivities).values(
      Array.from({ length: contacts }, (_, i) => ({
        occurredAt: at,
        channel: "cold_call" as const,
        contactName: `Bulk ${i}`,
        outcome: i < responded ? ("replied" as const) : ("no_response" as const),
        ownerId: ids.admin,
        createdBy: ids.admin,
      }))
    );
  }

  it("files activity under the local weekday and hour, across daylight saving", async () => {
    const admin = await as(ids.admin);
    // Wed 7 Jan 2026 10:30 Sydney (summer, UTC+11) is Tue 23:30 UTC
    await mkt.createActivity(admin, activity({ occurredAt: "2026-01-07T10:30", contactName: "Summer" }));
    const jan = await mkt.marketingSummary(admin, { month: "2026-01" });
    expect(jan.heat[2][10]).toEqual({ contacts: 1, responded: 1 });
    expect(jan.heat[1][23].contacts).toBe(0);
    // Tue 7 Jul 2026 10:30 Sydney (winter, UTC+10)
    await mkt.createActivity(admin, activity({ occurredAt: "2026-07-07T10:30", contactName: "Winter", outcome: "no_response" }));
    const jul = await mkt.marketingSummary(admin, { month: "2026-07" });
    expect(jul.heat[1][10]).toEqual({ contacts: 1, responded: 0 });
    expect(jul.totals.ratePct).toBe(0);
  });

  it("counts activity at local midnight on the 1st in the new month, not the old one", async () => {
    const admin = await as(ids.admin);
    await mkt.createActivity(admin, activity({ occurredAt: "2026-05-01T00:10", contactName: "Just after midnight" }));
    expect((await mkt.listActivities(admin, { month: "2026-05" })).rows.map((r) => r.contactName)).toContain("Just after midnight");
    expect((await mkt.listActivities(admin, { month: "2026-04" })).rows.map((r) => r.contactName)).not.toContain("Just after midnight");
  });

  it("says 'not enough data' instead of guessing, then picks the best day and hour", async () => {
    const admin = await as(ids.admin);
    await bulk("2026-08-04T10:00", 10, 6); // Tuesday 10:00
    let s = await mkt.marketingSummary(admin, { month: "2026-08", channel: "cold_call" });
    expect(s.insights.day).toBeNull(); // 10 < 20 contacts on any day
    expect(s.insights.hour).toBeNull(); // 10 < 15 in any hour

    await bulk("2026-08-11T10:00", 12, 6); // another Tuesday 10:00: Tue = 22 contacts, 12 responded
    await bulk("2026-08-12T15:00", 24, 6); // Wednesday 15:00: 24 contacts, 6 responded
    s = await mkt.marketingSummary(admin, { month: "2026-08", channel: "cold_call" });
    expect(s.insights.day).toEqual({ label: "Tuesday", ratePct: 54.5, contacts: 22, responded: 12 });
    expect(s.insights.hour).toEqual({ label: "10", ratePct: 54.5, contacts: 22, responded: 12 });
    expect(s.totals).toMatchObject({ contacts: 46, responded: 18, ratePct: 39.1 });
    // the channel table agrees with the totals
    expect(s.byChannel.find((c) => c.channel === "cold_call")).toMatchObject({ contacts: 46, responded: 18, ratePct: 39.1 });
  });

  it("compares with the previous period", async () => {
    const admin = await as(ids.admin);
    await bulk("2026-09-08T10:00", 23, 10); // Sep: 23 contacts vs Aug's 46
    const s = await mkt.marketingSummary(admin, { month: "2026-09", channel: "cold_call" });
    expect(s.change.contacts).toBe(-50);
    expect(s.change.ratePoints).toBe(4.4); // 43.5% vs 39.1%
  });
});

describe("campaigns", () => {
  it("can be managed by people with the all scope, with unique names, and audited", async () => {
    const manager = await as(ids.manager);
    const id = await mkt.saveCampaign(manager, null, { name: "Autumn referrals", channel: "individual_referral", startDate: "2026-03-01", endDate: "2026-05-31" });
    await expect(mkt.saveCampaign(manager, null, { name: "Autumn referrals" })).rejects.toThrow(/already a campaign/);
    await expect(mkt.saveCampaign(manager, null, { name: "Backwards", startDate: "2026-05-01", endDate: "2026-04-01" })).rejects.toThrow(/before the start/);
    await mkt.saveCampaign(manager, id, { name: "Autumn referrals", status: "finished", startDate: "2026-03-01", endDate: "2026-05-31" });
    const log = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));
    expect(log.map((r) => r.action).sort()).toEqual(["create", "update"]);
  });

  it("show results within the caller's scope, and can't be deleted once used", async () => {
    const admin = await as(ids.admin);
    const id = await mkt.saveCampaign(admin, null, { name: "Clinic emails" });
    await mkt.createActivity(admin, activity({ campaignId: id, outcome: "deal_won", dealValue: "2000", occurredAt: "2026-06-02T10:00" }));
    await mkt.createActivity(await as(ids.own), activity({ campaignId: id, outcome: "no_response", occurredAt: "2026-06-03T10:00" }));
    const all = (await mkt.campaignResults(admin)).find((c) => c.id === id)!;
    expect(all).toMatchObject({ contacts: 2, responded: 1, won: 1, wonValueBaseMinor: 200000, ratePct: 50 });
    const mine = (await mkt.campaignResults(await as(ids.own))).find((c) => c.id === id)!;
    expect(mine).toMatchObject({ contacts: 1, won: 0 });
    await expect(mkt.deleteCampaign(admin, id)).rejects.toThrow(/Mark it finished instead/);
  });
});
