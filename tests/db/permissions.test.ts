import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TestDb, permsJson } from "./harness";

let db: TestDb;
let adminId: string;
let staffId: string;
let streamId: string;

const insertIncome = (createdBy: string, amount = 100_000) =>
  db.rows<{ id: string }>(
    `insert into public.income_entries (entry_date, stream_id, country_code, client, amount_minor, currency, fx_rate_to_base, created_by)
     values ('2026-10-01', $1, 'GB', 'Fake Client Ltd', $2, 'GBP', 1.95, $3) returning id`,
    [streamId, amount, createdBy]
  );

beforeAll(async () => {
  db = await TestDb.create();
  adminId = await db.seedAdmin();
  staffId = await db.createUser("staff@example.test", { invited: true, fullName: "Sam Staff" });
  streamId = (await db.rows<{ id: string }>(`select id from public.streams where name = 'Upwork'`))[0].id;
  await insertIncome(adminId);
  await db.rows(
    `insert into public.expenses (expense_date, category, vendor, amount_minor, currency, created_by)
     values ('2026-10-02', 'Software', 'Fake Vendor', 5000, 'AUD', $1)`,
    [adminId]
  );
});

afterAll(async () => db?.close());

describe("new users get least privilege", () => {
  it("an invited user is active with only home, tasks, calendar and chat", async () => {
    const perms = await db.rows<{ module: string }>(
      `select module from public.user_permissions where user_id = $1 order by module`,
      [staffId]
    );
    expect(perms.map((p) => p.module).sort()).toEqual(["calendar", "chat", "home", "tasks"]);
    const [p] = await db.rows<{ active: boolean; preset_id: string; mfa_required: boolean }>(
      `select active, preset_id, mfa_required from public.profiles where id = $1`,
      [staffId]
    );
    expect(p).toEqual({ active: true, preset_id: "staff", mfa_required: false });
  });

  it("a self-signup (not invited, not provisioned) is created inactive with no access", async () => {
    const id = await db.createUser("stranger@example.test");
    const [p] = await db.rows<{ active: boolean }>(`select active from public.profiles where id = $1`, [id]);
    expect(p.active).toBe(false);
    await db.as(id, "aal1", async () => {
      // they can see only their own (inactive) profile, so the app can explain why they're locked out
      const seen = await db.rows<{ id: string; active: boolean }>(`select id, active from public.profiles`);
      expect(seen).toEqual([{ id, active: false }]);
      // ...and every permission check fails, even for the modules their staff preset lists
      const [{ home, tasks }] = await db.rows<{ home: boolean; tasks: boolean }>(
        `select public.has_perm('home', 'view') home, public.has_perm('tasks', 'view') tasks`
      );
      expect({ home, tasks }).toEqual({ home: false, tasks: false });
      expect(await db.rows(`select * from public.settings`)).toEqual([]);
    });
  });
});

describe("a staff user cannot reach finance data", () => {
  it("sees zero income or expense rows through the API role", async () => {
    const income = await db.as(staffId, "aal1", () => db.rows(`select * from public.income_entries`));
    const expenses = await db.as(staffId, "aal1", () => db.rows(`select * from public.expenses`));
    expect(income).toEqual([]);
    expect(expenses).toEqual([]);
  });

  it("cannot insert, update or delete finance rows", async () => {
    const insert = await db.as(staffId, "aal1", () =>
      db.error(
        `insert into public.income_entries (entry_date, amount_minor, currency, created_by)
         values ('2026-10-03', 999, 'AUD', $1)`,
        [staffId]
      )
    );
    expect(insert).toMatch(/row-level security/);
    const updated = await db.as(staffId, "aal1", () =>
      db.rows(`update public.income_entries set amount_minor = 1 returning id`)
    );
    expect(updated).toEqual([]);
    const deleted = await db.as(staffId, "aal1", () => db.rows(`delete from public.expenses returning id`));
    expect(deleted).toEqual([]);
    const [{ n }] = await db.rows<{ n: number }>(`select count(*)::int n from public.expenses`);
    expect(n).toBe(1);
  });

  it("cannot read the audit log, other profiles or role presets' matrices", async () => {
    await db.as(staffId, "aal1", async () => {
      expect(await db.rows(`select * from public.audit_log`)).toEqual([]);
      expect(await db.rows(`select * from public.preset_permissions`)).toEqual([]);
      const profiles = await db.rows<{ id: string }>(`select id from public.profiles`);
      expect(profiles.map((p) => p.id)).toEqual([staffId]);
      const perms = await db.rows<{ user_id: string }>(`select distinct user_id from public.user_permissions`);
      expect(perms.map((p) => p.user_id)).toEqual([staffId]);
    });
  });

  it("cannot grant itself permissions, directly or through the admin functions", async () => {
    await db.as(staffId, "aal1", async () => {
      expect(
        await db.error(
          `insert into public.user_permissions (user_id, module, can_view, scope) values ($1, 'finances', true, 'all')`,
          [staffId]
        )
      ).toMatch(/permission denied/);
      expect(
        await db.error(`update public.profiles set preset_id = 'admin' where id = $1`, [staffId])
      ).toMatch(/permission denied/);
      expect(await db.error(`select public.admin_apply_preset($1, 'admin')`, [staffId])).toMatch(/Only an admin/);
      expect(
        await db.error(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
          staffId,
          permsJson([{ module: "transactions", view: true, scope: "all" }]),
        ])
      ).toMatch(/Only an admin/);
      expect(await db.error(`select public.bootstrap_first_admin($1)`, [staffId])).toMatch(/permission denied/);
    });
    expect(await db.as(staffId, "aal1", () => db.rows(`select * from public.income_entries`))).toEqual([]);
  });

  it("an anonymous caller sees nothing at all", async () => {
    await db.asAnon(async () => {
      expect(await db.error(`select * from public.income_entries`)).toMatch(/permission denied/);
      expect(await db.error(`select * from public.profiles`)).toMatch(/permission denied/);
      expect(await db.error(`select * from public.audit_log`)).toMatch(/permission denied/);
    });
  });
});

describe("admins must pass two-factor", () => {
  it("an admin signed in with password only (aal1) gets no finance or audit access", async () => {
    await db.as(adminId, "aal1", async () => {
      expect(await db.rows(`select * from public.income_entries`)).toEqual([]);
      expect(await db.rows(`select * from public.audit_log`)).toEqual([]);
      expect(await db.error(`select public.admin_set_active($1, false)`, [staffId])).toMatch(/two-factor/);
    });
  });

  it("the same admin after TOTP (aal2) sees everything", async () => {
    const income = await db.as(adminId, "aal2", () => db.rows(`select * from public.income_entries`));
    expect(income.length).toBeGreaterThan(0);
  });
});

describe("admin-granted permissions and scopes are enforced", () => {
  let otherStaff: string;

  beforeEach(async () => {
    otherStaff = await db.createUser(`rep${Date.now()}@example.test`, { invited: true });
  });

  it("scope 'own' shows only the user's own entries; 'all' shows every entry", async () => {
    await db.as(adminId, "aal2", () =>
      db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        otherStaff,
        permsJson([{ module: "transactions", view: true, create: true, scope: "own" }]),
      ])
    );
    await db.as(otherStaff, "aal1", () => insertIncome(otherStaff, 2_500));
    const own = await db.as(otherStaff, "aal1", () =>
      db.rows<{ created_by: string }>(`select created_by from public.income_entries`)
    );
    expect(own.length).toBe(1);
    expect(own[0].created_by).toBe(otherStaff);

    await db.as(adminId, "aal2", () =>
      db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        otherStaff,
        permsJson([{ module: "transactions", view: true, scope: "all" }]),
      ])
    );
    const all = await db.as(otherStaff, "aal1", () => db.rows(`select id from public.income_entries`));
    expect(all.length).toBeGreaterThan(1);
  });

  it("a user cannot create entries in someone else's name", async () => {
    await db.as(adminId, "aal2", () =>
      db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        otherStaff,
        permsJson([{ module: "transactions", view: true, create: true, scope: "own" }]),
      ])
    );
    const err = await db.as(otherStaff, "aal1", () => db.error(
      `insert into public.income_entries (entry_date, amount_minor, currency, created_by) values ('2026-10-04', 10, 'AUD', $1)`,
      [adminId]
    ));
    expect(err).toMatch(/row-level security/);
  });

  it("custom permissions on a privileged module force two-factor", async () => {
    await db.as(adminId, "aal2", () =>
      db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        otherStaff,
        permsJson([{ module: "audit", view: true, scope: "all" }]),
      ])
    );
    const [p] = await db.rows<{ mfa_required: boolean; preset_id: string }>(
      `select mfa_required, preset_id from public.profiles where id = $1`,
      [otherStaff]
    );
    expect(p).toEqual({ mfa_required: true, preset_id: "custom" });
    expect(await db.as(otherStaff, "aal1", () => db.rows(`select * from public.audit_log`))).toEqual([]);
    expect((await db.as(otherStaff, "aal2", () => db.rows(`select * from public.audit_log`))).length).toBeGreaterThan(0);
  });

  it("a deactivated user loses every permission immediately", async () => {
    await db.as(adminId, "aal2", () =>
      db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        otherStaff,
        permsJson([{ module: "transactions", view: true, scope: "all" }]),
      ])
    );
    expect((await db.as(otherStaff, "aal1", () => db.rows(`select id from public.income_entries`))).length).toBeGreaterThan(0);
    await db.rows(`insert into auth.sessions (user_id) values ($1)`, [otherStaff]);
    await db.as(adminId, "aal2", () => db.rows(`select public.admin_set_active($1, false)`, [otherStaff]));
    expect(await db.as(otherStaff, "aal1", () => db.rows(`select id from public.income_entries`))).toEqual([]);
    expect(await db.rows(`select * from auth.sessions where user_id = $1`, [otherStaff])).toEqual([]);
  });

  it("resetting sessions deletes the user's sessions and stamps the revoke time", async () => {
    await db.rows(`insert into auth.sessions (user_id) values ($1), ($1)`, [otherStaff]);
    await db.as(adminId, "aal2", () => db.rows(`select public.admin_reset_sessions($1)`, [otherStaff]));
    expect(await db.rows(`select * from auth.sessions where user_id = $1`, [otherStaff])).toEqual([]);
    const [p] = await db.rows<{ sessions_revoked_at: string | null }>(
      `select sessions_revoked_at from public.profiles where id = $1`,
      [otherStaff]
    );
    expect(p.sessions_revoked_at).not.toBeNull();
  });
});

describe("role presets", () => {
  it("editing a preset updates everyone on it, but not custom users", async () => {
    const onPreset = await db.createUser(`preset${Date.now()}@example.test`, { invited: true });
    const custom = await db.createUser(`custom${Date.now()}@example.test`, { invited: true });
    await db.as(adminId, "aal2", async () => {
      await db.rows(`select public.admin_set_user_permissions($1, $2::jsonb)`, [
        custom,
        permsJson([{ module: "home", view: true }]),
      ]);
      await db.rows(`select public.admin_update_preset('staff', $1::jsonb)`, [
        permsJson([
          { module: "home", view: true },
          { module: "marketing", view: true, create: true, scope: "own" },
        ]),
      ]);
    });
    const modules = async (id: string) =>
      (await db.rows<{ module: string }>(`select module from public.user_permissions where user_id = $1 order by module`, [id])).map((r) => r.module);
    expect(await modules(onPreset)).toEqual(["home", "marketing"]);
    expect(await modules(custom)).toEqual(["home"]);
  });

  it("the Admin preset cannot be edited", async () => {
    const err = await db.as(adminId, "aal2", () =>
      db.error(`select public.admin_update_preset('admin', '[]'::jsonb)`)
    );
    expect(err).toMatch(/cannot be edited/);
  });
});

describe("there is always an active admin", () => {
  it("the last admin cannot be deactivated, demoted or made custom", async () => {
    await db.as(adminId, "aal2", async () => {
      expect(await db.error(`select public.admin_set_active($1, false)`, [adminId])).toMatch(/own account/);
      expect(await db.error(`select public.admin_apply_preset($1, 'staff')`, [adminId])).toMatch(/last active admin/);
      expect(
        await db.error(`select public.admin_set_user_permissions($1, '[]'::jsonb)`, [adminId])
      ).toMatch(/last active admin/);
    });
  });

  it("a second admin can be added, after which one can be demoted", async () => {
    const second = await db.createUser(`admin2${Date.now()}@example.test`, { invited: true });
    await db.as(adminId, "aal2", () => db.rows(`select public.admin_apply_preset($1, 'admin')`, [second]));
    const [{ n }] = await db.rows<{ n: number }>(`select public.active_admin_count() n`);
    expect(n).toBe(2);
    await db.as(second, "aal2", () => db.rows(`select public.admin_apply_preset($1, 'manager')`, [second]));
    const [{ n: after }] = await db.rows<{ n: number }>(`select public.active_admin_count() n`);
    expect(after).toBe(1);
  });

  it("the seed function only works once", async () => {
    const id = await db.createUser("late@example.test", { provisioned: true });
    const err = await db.asServiceRole(() => db.error(`select public.bootstrap_first_admin($1)`, [id]));
    expect(err).toMatch(/already exists/);
  });
});

describe("audit log", () => {
  it("records before and after values when a finance entry changes", async () => {
    const [{ id }] = await db.as(adminId, "aal2", () => insertIncome(adminId, 12_345));
    await db.as(adminId, "aal2", () =>
      db.rows(`update public.income_entries set amount_minor = 54_321, status = 'paid' where id = $1`, [id])
    );
    const rows = await db.rows<{ action: string; actor_id: string; before: { amount_minor: number } | null; after: { amount_minor: number; status: string } | null }>(
      `select action, actor_id, before, after from public.audit_log where entity = 'income_entries' and entity_id = $1 order by id`,
      [id]
    );
    expect(rows.map((r) => r.action)).toEqual(["create", "update"]);
    expect(rows[1].actor_id).toBe(adminId);
    expect(rows[1].before?.amount_minor).toBe(12_345);
    expect(rows[1].after).toMatchObject({ amount_minor: 54_321, status: "paid" });
  });

  it("is read-only, even for admins", async () => {
    await db.as(adminId, "aal2", async () => {
      expect(await db.error(`update public.audit_log set summary = 'tampered'`)).toMatch(/permission denied/);
      expect(await db.error(`delete from public.audit_log`)).toMatch(/permission denied/);
      expect(
        await db.error(`insert into public.audit_log (action, entity) values ('create', 'x')`)
      ).toMatch(/permission denied/);
    });
  });

  it("logs exports only for users with export permission", async () => {
    expect(
      await db.as(staffId, "aal1", () => db.error(`select public.log_event('export', 'transactions', null, 'csv')`))
    ).toMatch(/No export permission/);
    await db.as(adminId, "aal2", () => db.rows(`select public.log_event('export', 'transactions', null, 'income.csv')`));
    const [row] = await db.rows<{ actor_id: string; summary: string }>(
      `select actor_id, summary from public.audit_log where action = 'export' order by id desc limit 1`
    );
    expect(row).toEqual({ actor_id: adminId, summary: "income.csv" });
  });

  it("records permission changes with the old and new matrix", async () => {
    const [row] = await db.rows<{ before: unknown[]; after: Array<{ module: string }> }>(
      `select before, after from public.audit_log where action = 'permissions' and actor_id = $1 order by id desc limit 1`,
      [adminId]
    );
    expect(Array.isArray(row.before)).toBe(true);
    expect(Array.isArray(row.after)).toBe(true);
  });
});
