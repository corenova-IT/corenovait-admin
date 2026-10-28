import { execFile } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { actorFor, createPerson, seedStreamCountry, setupTestDatabase } from "./db";

/** Deploys: the automatic backup before a migration, restoring it, and refusing to migrate without one. */
const ROOT = path.resolve(import.meta.dirname, "../..");
const run = promisify(execFile);
// @ts-expect-error plain .mjs script, no types
const lib: typeof import("../../scripts/backup-lib.mjs") = await import("../../scripts/backup-lib.mjs");

let t: Awaited<ReturnType<typeof setupTestDatabase>>;
const base = () => inject("mysqlUrl");
const created: string[] = [];
async function newDatabase() {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const c = await mysql.createConnection({ uri: base() });
  await c.query(`CREATE DATABASE \`${name}\``);
  await c.end();
  created.push(name);
  return `${base()}/${name}`;
}
const tableCounts = async (uri: string) => {
  const c = await mysql.createConnection({ uri });
  const [tables] = (await c.query("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME")) as unknown as [Array<{ n: string }>];
  const out: Record<string, number> = {};
  for (const { n } of tables) out[n] = Number(((await c.query(`SELECT COUNT(*) AS k FROM \`${n}\``)) as unknown as [Array<{ k: number }>])[0][0].k);
  await c.end();
  return out;
};

beforeAll(async () => {
  t = await setupTestDatabase();
  const admin = await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true });
  const a = await actorFor(t, admin.id);
  const [fin, tk] = await Promise.all([import("@/lib/dal/finance"), import("@/lib/dal/tasks")]);
  await fin.createIncome(a, { entryDate: "2026-10-01", ...(await seedStreamCountry(t)), client: "O'Brien & Sons; \"quoted\"\nnew line", amount: "1234.56", currency: "GBP", fxRate: "1.95" });
  await tk.createTask(a, { title: "Backup me", labels: "Website, client", checklist: "Draft\nReview" });
});
afterAll(async () => {
  await t?.cleanup();
  const c = await mysql.createConnection({ uri: base() });
  for (const n of created) await c.query(`DROP DATABASE IF EXISTS \`${n}\``);
  await c.end();
});

describe("database backups", () => {
  it("a backup restores into an empty database with every row, generated amounts, JSON and odd text intact", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cn-backup-"));
    const file = path.join(dir, "b.sql.gz");
    const counts = await lib.dumpDatabase(process.env.DATABASE_URL!, file);
    expect(counts.income_entries).toBe(1);

    const target = await newDatabase();
    const c = await mysql.createConnection({ uri: target, multipleStatements: true });
    await c.query(gunzipSync(readFileSync(file)).toString("utf8"));
    await c.end();
    expect(await tableCounts(target)).toEqual(await tableCounts(process.env.DATABASE_URL!));

    const pick = async (uri: string) => {
      const k = await mysql.createConnection({ uri, timezone: "Z" });
      const [[income]] = (await k.query("SELECT client, amount_minor, amount_base_minor, created_at FROM income_entries")) as unknown as [Array<Record<string, unknown>>];
      const [[task]] = (await k.query("SELECT labels, checklist FROM tasks")) as unknown as [Array<Record<string, unknown>>];
      const [[user]] = (await k.query("SELECT password_hash, totp_secret_enc FROM users WHERE email = 'admin@example.test'")) as unknown as [Array<Record<string, unknown>>];
      await k.end();
      return { income, task, user };
    };
    const [before, after] = [await pick(process.env.DATABASE_URL!), await pick(target)];
    expect(after).toEqual(before);
    expect(after.income.client).toBe("O'Brien & Sons; \"quoted\"\nnew line");
  });

  it("knows when there are migrations to apply, and when the database is brand new", async () => {
    const c = await mysql.createConnection({ uri: process.env.DATABASE_URL! });
    expect(await lib.pendingMigrations(c, path.join(ROOT, "drizzle"))).toEqual({ pending: 0, empty: false });
    await c.end();
    const fresh = await mysql.createConnection({ uri: await newDatabase() });
    const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
    expect(await lib.pendingMigrations(fresh, path.join(ROOT, "drizzle"))).toEqual({ pending: journal.entries.length, empty: true });
    await fresh.end();
  });

  it("npm start backs up before migrating, and migrates nothing if the backup can't be written", async () => {
    // a database one migration behind, with data in it
    const uri = await newDatabase();
    const older = mkdtempSync(path.join(tmpdir(), "cn-drizzle-"));
    const journal = JSON.parse(readFileSync(path.join(ROOT, "drizzle/meta/_journal.json"), "utf8"));
    mkdirSync(path.join(older, "meta"));
    const keep = journal.entries.slice(0, -1);
    writeFileSync(path.join(older, "meta/_journal.json"), JSON.stringify({ ...journal, entries: keep }));
    for (const e of keep) copyFileSync(path.join(ROOT, "drizzle", `${e.tag}.sql`), path.join(older, `${e.tag}.sql`));
    const c = await mysql.createConnection({ uri, timezone: "Z" });
    await migrate(drizzle(c), { migrationsFolder: older });
    const applied = async () => Number(((await c.query("SELECT COUNT(*) AS n FROM __drizzle_migrations")) as unknown as [Array<{ n: number }>])[0][0].n);
    expect(await applied()).toBe(keep.length);

    const migrateWith = (backupDir: string) =>
      run(process.execPath, ["scripts/migrate.mjs"], { cwd: ROOT, env: { ...process.env, DATABASE_URL: uri, BACKUP_DIR: backupDir, NODE_ENV: "production" } }).then(
        (r) => ({ code: 0, out: r.stdout + r.stderr }),
        (e: { code: number; stdout: string; stderr: string }) => ({ code: e.code, out: e.stdout + e.stderr })
      );

    // the backup folder is actually a file: the backup fails, so nothing is migrated
    const blocker = path.join(mkdtempSync(path.join(tmpdir(), "cn-x-")), "not-a-folder");
    writeFileSync(blocker, "");
    const failed = await migrateWith(blocker);
    expect(failed.code).toBe(1);
    expect(failed.out).toMatch(/backup before migrating failed, so nothing was changed/);
    expect(await applied()).toBe(keep.length);

    const dir = mkdtempSync(path.join(tmpdir(), "cn-backups-"));
    const ok = await migrateWith(dir);
    expect(ok.code, ok.out).toBe(0);
    expect(ok.out).toMatch(/Backed up \d+ tables/);
    expect(await applied()).toBe(journal.entries.length);
    expect(readdirSync(dir).filter((f) => /^pre-migration-.*\.sql\.gz$/.test(f))).toHaveLength(1);
    // the log names the file, never the database password
    expect(ok.out).not.toContain(new URL(uri).password || "\u0000");

    // up to date: no new backup
    expect((await migrateWith(dir)).out).toMatch(/Database is up to date/);
    expect(readdirSync(dir)).toHaveLength(1);
    await c.end();
  });
});
