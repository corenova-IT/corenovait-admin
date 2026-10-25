import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFirstAdminSql } from "../../scripts/lib/first-admin-sql";
import { setupTestDatabase } from "./db";

/** The phpMyAdmin fallback, imported into a real migrated database the way phpMyAdmin would run it. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let hash: string;
const PASSWORD = "Imported-Admin-2026!";

async function importSql(sql: string) {
  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL!, multipleStatements: true });
  const [results] = (await conn.query(sql)) as unknown as [unknown[]];
  await conn.end();
  const last = results[results.length - 1] as Array<{ result: string }>;
  return last[0].result;
}

beforeAll(async () => {
  t = await setupTestDatabase();
  hash = await (await import("@/lib/auth/hash")).hashPassword(PASSWORD);
});
afterAll(() => t?.cleanup());

describe("first admin SQL file", () => {
  it("never contains the password, only an argon2id hash", () => {
    const sql = buildFirstAdminSql({ id: crypto.randomUUID(), email: "a@example.test", fullName: "A", passwordHash: hash, now: new Date() });
    expect(sql).not.toContain(PASSWORD);
    expect(sql).toContain("$argon2id$");
    expect(() => buildFirstAdminSql({ id: "x", email: "a@example.test", fullName: "A", passwordHash: PASSWORD, now: new Date() })).toThrow(/argon2id/);
  });

  it("creates a working admin who must set up two-factor, with names safely quoted", async () => {
    const id = crypto.randomUUID();
    const result = await importSql(buildFirstAdminSql({ id, email: "owner@example.test", fullName: "Siobhán O'Brien", passwordHash: hash, now: new Date() }));
    expect(result).toMatch(/^First admin created/);

    const [u] = await t.db.select().from(t.schema.users);
    expect(u).toMatchObject({ id, email: "owner@example.test", fullName: "Siobhán O'Brien", presetId: "admin", status: "active", mfaRequired: true });
    const perms = await t.db.select().from(t.schema.userPermissions);
    expect(perms).toHaveLength(14);

    const auth = await import("@/lib/dal/auth");
    const r = await auth.signInWithPassword("owner@example.test", PASSWORD, {});
    expect(r.ok && r.next).toBe("mfa_setup");
  });

  it("does nothing if an admin already exists, and says so", async () => {
    const result = await importSql(buildFirstAdminSql({ id: crypto.randomUUID(), email: "second@example.test", fullName: "Two", passwordHash: hash, now: new Date() }));
    expect(result).toMatch(/^NOT CREATED/);
    expect(await t.db.select().from(t.schema.users)).toHaveLength(1);
  });
});
