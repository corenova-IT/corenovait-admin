/**
 * Per-file test database: a fresh, fully migrated MySQL database, plus helpers
 * that create people and real sessions the same way the app does.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { inject } from "vitest";

export async function setupTestDatabase() {
  const base = inject("mysqlUrl");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = await mysql.createConnection({ uri: base });
  await admin.query(`CREATE DATABASE \`${name}\``);
  await admin.end();

  process.env.DATABASE_URL = `${base}/${name}`;
  process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.UPLOAD_DIR = mkdtempSync(path.join(tmpdir(), "cn-uploads-"));

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: "Z" });
  await migrate(drizzle(conn), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  await conn.end();

  const dbmod = await import("@/lib/db");
  return {
    db: dbmod.getDb(),
    schema: dbmod.schema,
    async cleanup() {
      await dbmod.closeDb();
      const c = await mysql.createConnection({ uri: base });
      await c.query(`DROP DATABASE IF EXISTS \`${name}\``);
      await c.end();
    },
  };
}

type TestDb = Awaited<ReturnType<typeof setupTestDatabase>>;

export const STRONG_PASSWORD = "Correct-Horse-42-battery";

/** A person, created through the same preset-copy path the Team page uses. */
export async function createPerson(
  t: TestDb,
  opts: { email: string; preset?: string; status?: "active" | "invited" | "deactivated"; password?: string | null; totp?: boolean }
) {
  const { hashPassword } = await import("@/lib/auth/hash");
  const { copyPresetToUser } = await import("@/lib/dal/internal");
  const { encryptSecret } = await import("@/lib/auth/crypto");
  const { generateTotpSecret } = await import("@/lib/auth/totp");
  const id = crypto.randomUUID();
  const secret = opts.totp ? generateTotpSecret() : null;
  await t.db.insert(t.schema.users).values({
    id,
    email: opts.email,
    fullName: opts.email.split("@")[0],
    status: opts.status ?? "active",
    passwordHash: opts.password === null ? null : await hashPassword(opts.password ?? STRONG_PASSWORD),
    totpSecretEnc: secret ? encryptSecret(secret) : null,
    totpEnabledAt: secret ? new Date() : null,
  });
  await t.db.transaction((tx) => copyPresetToUser(tx, id, opts.preset ?? "staff"));
  return { id, email: opts.email, totpSecret: secret };
}

/** A real session row; returns the cookie token. */
export async function sessionFor(t: TestDb, userId: string, opts: { mfaVerified?: boolean; lastSeen?: Date; expires?: Date } = {}) {
  const { randomToken, sha256Hex } = await import("@/lib/auth/crypto");
  const token = randomToken();
  const now = new Date();
  await t.db.insert(t.schema.sessions).values({
    id: sha256Hex(token),
    userId,
    lastSeenAt: opts.lastSeen ?? now,
    expiresAt: opts.expires ?? new Date(now.getTime() + 12 * 3600_000),
    mfaVerifiedAt: opts.mfaVerified ? now : null,
  });
  return token;
}

/** Signed in, two-factor done (when relevant): the Actor the app would build. */
export async function actorFor(t: TestDb, userId: string, opts: { mfaVerified?: boolean } = {}) {
  const { resolveSession } = await import("@/lib/dal/auth");
  const token = await sessionFor(t, userId, { mfaVerified: opts.mfaVerified ?? true });
  const s = await resolveSession(token);
  if (s.status !== "ok") throw new Error(`expected an ok session, got ${s.status}`);
  return s.actor;
}

export async function countRows(t: TestDb, table: string): Promise<number> {
  const [rows] = (await t.db.execute(sql`select count(*) as n from ${sql.identifier(table)}`)) as unknown as [Array<{ n: number }>];
  return Number(rows[0].n);
}

/** A fingerprint of every table, to prove a refused request changed nothing. */
export async function snapshot(t: TestDb) {
  const tables = ["users", "user_permissions", "preset_permissions", "sessions", "auth_tokens", "recovery_codes", "income_entries", "expenses", "files", "settings", "campaigns", "marketing_activities"];
  const out: Record<string, unknown> = {};
  for (const tb of tables) {
    const [rows] = (await t.db.execute(sql`select * from ${sql.identifier(tb)}`)) as unknown as [unknown[]];
    out[tb] = JSON.stringify(rows);
  }
  return out;
}

export async function userRow(t: TestDb, id: string) {
  const [u] = await t.db.select().from(t.schema.users).where(eq(t.schema.users.id, id));
  return u;
}

export async function seedStreamCountry(t: TestDb) {
  const [s] = await t.db.select().from(t.schema.streams).limit(1);
  return { streamId: s.id, countryCode: "GB" };
}
