import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, seedStreamCountry, setupTestDatabase, userRow } from "./db";

/**
 * Permission rules, enforced by the data-access layer against a real MySQL 8
 * database with the real migrations. These replace the old RLS tests.
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let dal: {
  finance: typeof import("@/lib/dal/finance");
  team: typeof import("@/lib/dal/team");
  audit: typeof import("@/lib/dal/audit");
  guard: typeof import("@/lib/dal/guard");
  auth: typeof import("@/lib/dal/auth");
  files: typeof import("@/lib/dal/files");
};
let ids: { admin: string; admin2?: string; staff: string; manager: string; rep: string };
let streamCountry: { streamId: number; countryCode: string };

const income = (over: Record<string, unknown> = {}) => ({
  entryDate: "2026-10-01",
  streamId: streamCountry.streamId,
  countryCode: streamCountry.countryCode,
  client: "Example Client",
  amount: "1250.50",
  currency: "GBP",
  fxRate: "1.95",
  ...over,
});

beforeAll(async () => {
  t = await setupTestDatabase();
  dal = {
    finance: await import("@/lib/dal/finance"),
    team: await import("@/lib/dal/team"),
    audit: await import("@/lib/dal/audit"),
    guard: await import("@/lib/dal/guard"),
    auth: await import("@/lib/dal/auth"),
    files: await import("@/lib/dal/files"),
  };
  streamCountry = await seedStreamCountry(t);
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager" })).id,
    rep: (await createPerson(t, { email: "rep@example.test" })).id,
  };
});
afterAll(() => t?.cleanup());

const DENIED = /permission|two-factor|session|admins/i;

describe("new people get least privilege", () => {
  it("staff preset: home, tasks, calendar and chat only; no finance, team or audit", async () => {
    const staff = await actorFor(t, ids.staff);
    const granted = Object.entries(staff.perms).filter(([, p]) => p.view).map(([m]) => m).sort();
    expect(granted).toEqual(["calendar", "chat", "home", "tasks"]);
    expect(staff.perms.tasks.scope).toBe("assigned");
    expect(staff.mfaRequired).toBe(false);
  });

  it("an invited user can't sign in until they accept, whatever password is tried", async () => {
    const p = await createPerson(t, { email: "invited@example.test", status: "invited", password: null });
    const r = await dal.auth.signInWithPassword(p.email, "anything-at-all-1A!", {});
    expect(r).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("a staff user cannot reach finance, team or audit data", () => {
  it("every finance read and write is refused", async () => {
    const admin = await actorFor(t, ids.admin);
    const entryId = await dal.finance.createIncome(admin, income());
    const staff = await actorFor(t, ids.staff);
    await expect(dal.finance.listIncome(staff)).rejects.toThrow(DENIED);
    await expect(dal.finance.getIncome(staff, entryId)).rejects.toThrow(DENIED);
    await expect(dal.finance.createIncome(staff, income())).rejects.toThrow(DENIED);
    await expect(dal.finance.updateIncome(staff, entryId, income({ amount: "1" }))).rejects.toThrow(DENIED);
    await expect(dal.finance.deleteIncome(staff, entryId)).rejects.toThrow(DENIED);
    await expect(dal.finance.listExpenses(staff)).rejects.toThrow(DENIED);
    await expect(dal.finance.createExpense(staff, { expenseDate: "2026-10-01", category: "Software", amount: "10", currency: "AUD" })).rejects.toThrow(DENIED);
    await expect(dal.audit.logExport(staff, "transactions", "x.csv")).rejects.toThrow(DENIED);
    const [row] = await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, entryId));
    expect(row.amountMinor).toBe(125050);
  });

  it("team and audit reads are refused", async () => {
    const staff = await actorFor(t, ids.staff);
    await expect(dal.team.listTeam(staff)).rejects.toThrow(DENIED);
    await expect(dal.audit.listAudit(staff, {})).rejects.toThrow(DENIED);
  });

  it("every team change is refused, including raising their own permissions", async () => {
    const staff = await actorFor(t, ids.staff);
    const all = { ...staff.perms, finances: { view: true, create: true, edit: true, delete: true, export: true, scope: "all" as const } };
    await expect(dal.team.setPermissions(staff, { userId: ids.staff, perms: all })).rejects.toThrow(DENIED);
    await expect(dal.team.applyPreset(staff, { userId: ids.staff, presetId: "admin" })).rejects.toThrow(DENIED);
    await expect(dal.team.inviteUser(staff, { email: "x@example.test", fullName: "X", jobTitle: "", presetId: "admin" })).rejects.toThrow(DENIED);
    await expect(dal.team.updatePreset(staff, { presetId: "staff", perms: all })).rejects.toThrow(DENIED);
    await expect(dal.team.setActive(staff, { userId: ids.admin, active: false })).rejects.toThrow(DENIED);
    await expect(dal.team.resetSessions(staff, ids.admin)).rejects.toThrow(DENIED);
    await expect(dal.team.resetTwoFactor(staff, ids.admin)).rejects.toThrow(DENIED);
    expect((await userRow(t, ids.staff)).presetId).toBe("staff");
  });

  it("a hand-made Actor with every permission is rejected", async () => {
    const real = await actorFor(t, ids.staff);
    const forged = { ...real, isAdmin: true, perms: Object.fromEntries(Object.keys(real.perms).map((m) => [m, { view: true, create: true, edit: true, delete: true, export: true, scope: "all" }])) };
    await expect(dal.finance.listIncome(forged as never)).rejects.toThrow(/session/i);
    await expect(dal.team.listTeam(forged as never)).rejects.toThrow(/session/i);
  });
});

describe("two-factor gates privileged access", () => {
  it("an admin who hasn't passed two-factor this session can't even get an Actor", async () => {
    const { sessionFor } = await import("./db");
    const token = await sessionFor(t, ids.admin, { mfaVerified: false });
    const s = await dal.auth.resolveSession(token);
    expect(s.status).toBe("mfa_verify");
  });

  it("finance or transactions access makes two-factor required; plain staff stay optional", async () => {
    const admin = await actorFor(t, ids.admin);
    expect((await userRow(t, ids.manager)).mfaRequired).toBe(true); // Manager preset includes finance
    expect((await userRow(t, ids.staff)).mfaRequired).toBe(false);
    for (const module of ["finances", "transactions"] as const) {
      const p = await createPerson(t, { email: `${module}-viewer@example.test` });
      const perms = (await actorFor(t, p.id)).perms;
      await dal.team.setPermissions(admin, { userId: p.id, perms: { ...perms, [module]: { view: true, create: false, edit: false, delete: false, export: false, scope: "own" } } });
      expect((await userRow(t, p.id)).mfaRequired).toBe(true);
    }
  });

  it("custom permissions on team, settings or audit make two-factor required", async () => {
    const admin = await actorFor(t, ids.admin);
    const p = await createPerson(t, { email: "auditor@example.test" });
    const perms = (await actorFor(t, p.id)).perms;
    await dal.team.setPermissions(admin, { userId: p.id, perms: { ...perms, audit: { view: true, create: false, edit: false, delete: false, export: false, scope: "all" } } });
    const u = await userRow(t, p.id);
    expect(u.presetId).toBe("custom");
    expect(u.mfaRequired).toBe(true);
    const { sessionFor } = await import("./db");
    expect((await dal.auth.resolveSession(await sessionFor(t, p.id))).status).toBe("mfa_setup");
  });
});

describe("data scope", () => {
  it("own sees only their entries, assigned adds entries credited to them, all sees everything", async () => {
    const admin = await actorFor(t, ids.admin);
    // two people get transactions access with different scopes
    const owner = await createPerson(t, { email: "own@example.test" });
    const ownPerms = (await actorFor(t, owner.id)).perms;
    await dal.team.setPermissions(admin, { userId: owner.id, perms: { ...ownPerms, transactions: { view: true, create: true, edit: true, delete: false, export: false, scope: "own" } } });
    const repPerms = (await actorFor(t, ids.rep)).perms;
    await dal.team.setPermissions(admin, { userId: ids.rep, perms: { ...repPerms, transactions: { view: true, create: false, edit: false, delete: false, export: false, scope: "assigned" } } });

    const [rep] = await t.db
      .insert(t.schema.representatives)
      .values({ id: crypto.randomUUID(), name: "Rep", userId: ids.rep, createdBy: ids.admin })
      .$returningId();
    const adminEntry = await dal.finance.createIncome(admin, income({ client: "Admin's" }));
    const credited = await dal.finance.createIncome(admin, income({ client: "Credited to rep", representativeId: rep.id }));

    const ownActor = await actorFor(t, owner.id);
    const mine = await dal.finance.createIncome(ownActor, income({ client: "Mine" }));
    const ownList = await dal.finance.listIncome(ownActor);
    expect(ownList.rows.map((r) => r.id)).toEqual([mine]);
    expect(await dal.finance.getIncome(ownActor, adminEntry)).toBeNull();
    await expect(dal.finance.updateIncome(ownActor, adminEntry, income())).rejects.toThrow(/isn't yours/);

    const repActor = await actorFor(t, ids.rep);
    const repList = await dal.finance.listIncome(repActor);
    expect(repList.rows.map((r) => r.id)).toEqual([credited]);

    const all = await dal.finance.listIncome(admin);
    expect(all.rows.map((r) => r.id)).toEqual(expect.arrayContaining([adminEntry, credited, mine]));
  });

  it("someone can't create an entry in another person's name", async () => {
    const admin = await actorFor(t, ids.admin);
    const id = await dal.finance.createIncome(admin, { ...income(), createdBy: ids.staff } as never);
    const [row] = await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, id));
    expect(row.createdBy).toBe(ids.admin);
  });
});

describe("money", () => {
  it("is stored as integer minor units and MySQL computes the base amount", async () => {
    const admin = await actorFor(t, ids.admin);
    const id = await dal.finance.createIncome(admin, income({ amount: "100.01", fxRate: "1.955" }));
    const [row] = await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, id));
    expect(row.amountMinor).toBe(10001);
    expect(row.fxRateToBase).toBe("1.95500000");
    expect(row.amountBaseMinor).toBe(19552); // 19551.955 rounds half away from zero
  });

  it("rejects floats with too many decimals, zero and negative amounts", async () => {
    const admin = await actorFor(t, ids.admin);
    await expect(dal.finance.createIncome(admin, income({ amount: "10.005" }))).rejects.toThrow(/amount/i);
    await expect(dal.finance.createIncome(admin, income({ amount: "-5" }))).rejects.toThrow(/amount/i);
    await expect(dal.finance.createIncome(admin, income({ amount: "0" }))).rejects.toThrow();
  });
});

describe("team rules", () => {
  it("deactivating ends their sessions and blocks the next request", async () => {
    const admin = await actorFor(t, ids.admin);
    const p = await createPerson(t, { email: "leaver@example.test" });
    const { sessionFor } = await import("./db");
    const token = await sessionFor(t, p.id);
    await dal.team.setActive(admin, { userId: p.id, active: false });
    expect((await dal.auth.resolveSession(token)).status).toBe("ended");
    expect(await dal.auth.signInWithPassword(p.email, (await import("./db")).STRONG_PASSWORD, {})).toEqual({ ok: false, reason: "invalid" });
  });

  it("reset sessions signs a person out everywhere", async () => {
    const admin = await actorFor(t, ids.admin);
    const { sessionFor } = await import("./db");
    const a = await sessionFor(t, ids.manager);
    const b = await sessionFor(t, ids.manager);
    await dal.team.resetSessions(admin, ids.manager);
    expect((await dal.auth.resolveSession(a)).status).toBe("ended");
    expect((await dal.auth.resolveSession(b)).status).toBe("ended");
  });

  it("editing a preset updates everyone on it, but not custom users", async () => {
    const admin = await actorFor(t, ids.admin);
    const onStaff = await createPerson(t, { email: "onstaff@example.test" });
    const map = (await actorFor(t, onStaff.id)).perms;
    await dal.team.updatePreset(admin, { presetId: "staff", perms: { ...map, marketing: { view: true, create: true, edit: false, delete: false, export: false, scope: "own" } } });
    expect((await actorFor(t, onStaff.id)).perms.marketing.create).toBe(true);
    expect((await actorFor(t, (await t.db.select().from(t.schema.users).where(eq(t.schema.users.email, "own@example.test")))[0].id)).perms.marketing.view).toBe(false);
    // put it back for the other tests
    await dal.team.updatePreset(admin, { presetId: "staff", perms: map });
  });

  it("the Admin and Custom presets can't be edited", async () => {
    const admin = await actorFor(t, ids.admin);
    await expect(dal.team.updatePreset(admin, { presetId: "admin", perms: admin.perms })).rejects.toThrow(/can't be edited/);
    await expect(dal.team.updatePreset(admin, { presetId: "custom", perms: admin.perms })).rejects.toThrow(/can't be edited/);
  });

  it("the last active admin can't be deactivated, demoted or made custom; with a second admin they can", async () => {
    const admin = await actorFor(t, ids.admin);
    const LAST = /at least one active admin/;
    const p2 = await createPerson(t, { email: "other@example.test" });
    const otherActor = await actorFor(t, p2.id);
    void otherActor;
    await expect(dal.team.applyPreset(admin, { userId: ids.admin, presetId: "staff" })).rejects.toThrow(LAST);
    await expect(dal.team.setPermissions(admin, { userId: ids.admin, perms: admin.perms })).rejects.toThrow(LAST);
    await expect(dal.team.setActive(admin, { userId: ids.admin, active: false })).rejects.toThrow(/own account/);

    await dal.team.applyPreset(admin, { userId: p2.id, presetId: "admin" });
    expect((await userRow(t, p2.id)).mfaRequired).toBe(true);
    await dal.team.applyPreset(admin, { userId: p2.id, presetId: "staff" });
    expect((await userRow(t, p2.id)).presetId).toBe("staff");
  });

  it("an admin can reset another person's two-factor, not their own", async () => {
    const admin = await actorFor(t, ids.admin);
    const p = await createPerson(t, { email: "lostphone@example.test", preset: "manager", totp: true });
    await dal.team.resetTwoFactor(admin, p.id);
    const u = await userRow(t, p.id);
    expect(u.totpSecretEnc).toBeNull();
    expect(u.totpEnabledAt).toBeNull();
    await expect(dal.team.resetTwoFactor(admin, ids.admin)).rejects.toThrow(/Security page/);
  });
});

describe("audit log", () => {
  it("records before and after values when a finance entry changes", async () => {
    const admin = await actorFor(t, ids.admin);
    const id = await dal.finance.createIncome(admin, income({ amount: "500" }));
    await dal.finance.updateIncome(admin, id, income({ amount: "650", status: "paid" }));
    const { rows } = await dal.audit.listAudit(admin, { entity: "income_entries", action: "update" });
    const r = rows.find((x) => x.entity_id === id)!;
    expect((r.before as Record<string, unknown>).amountMinor).toBe(50000);
    expect((r.after as Record<string, unknown>).amountMinor).toBe(65000);
    expect((r.after as Record<string, unknown>).status).toBe("paid");
    expect(r.actor_email).toBe("admin@example.test");
  });

  it("records permission changes with the old and new matrix", async () => {
    const admin = await actorFor(t, ids.admin);
    const { rows } = await dal.audit.listAudit(admin, { action: "permissions" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].before).toHaveProperty("perms");
    expect(rows[0].after).toHaveProperty("preset");
  });

  it("logs exports only for people with export permission", async () => {
    const admin = await actorFor(t, ids.admin);
    await dal.audit.logExport(admin, "transactions", "income-oct.csv");
    const { rows } = await dal.audit.listAudit(admin, { action: "export" });
    expect(rows[0].summary).toBe("income-oct.csv");
  });

  it("is read-only: the data-access layer has no way to change or delete audit rows", async () => {
    const exported = Object.keys(dal.audit);
    expect(exported.filter((k) => /update|delete|remove|clear|truncate/i.test(k))).toEqual([]);
  });

  it("is filterable and paged", async () => {
    const admin = await actorFor(t, ids.admin);
    const page = await dal.audit.listAudit(admin, { q: "income-oct" }, 1);
    expect(page.rows).toHaveLength(1);
    expect(page.total).toBe(1);
  });
});
