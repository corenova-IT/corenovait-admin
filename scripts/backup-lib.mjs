/**
 * A plain SQL backup of the whole database, written by Node (no mysqldump
 * needed, so it works on Hostinger's Node.js hosting). The file is gzipped SQL
 * that phpMyAdmin can import, or: gunzip < file.sql.gz | mysql -u USER -p DB
 *
 * Used by scripts/migrate.mjs before it applies new migrations, and by
 * `npm run db:backup`. Nothing is logged except the file name and row counts.
 */
import { createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createGzip } from "node:zlib";
import mysql from "mysql2/promise";

/** Where backups go: BACKUP_DIR, or ~/corenovait-backups (outside the app folder, so deploys never touch it). */
export function backupDir() {
  const configured = process.env.BACKUP_DIR?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) throw new Error("BACKUP_DIR must be an absolute path");
    return configured;
  }
  return path.join(os.homedir(), "corenovait-backups");
}

const BATCH = 200;

/** Writes every table (structure and rows) to `file` (.sql.gz). Returns the tables and row counts. */
export async function dumpDatabase(uri, file) {
  // dates and big numbers as text, exactly as stored
  const conn = await mysql.createConnection({ uri, timezone: "Z", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true });
  const gzip = createGzip();
  const out = createWriteStream(file, { mode: 0o600, flags: "wx" });
  gzip.pipe(out);
  const write = async (s) => {
    if (!gzip.write(s)) await once(gzip, "drain");
  };
  const counts = {};
  try {
    const [[{ db }]] = await conn.query("SELECT DATABASE() AS db");
    await write(`-- CoreNovaIT portal backup of \`${db}\`, ${new Date().toISOString()}\n-- Restore into an EMPTY database (or one you are replacing): it drops and recreates every table.\n`);
    await write("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS=0;\nSET UNIQUE_CHECKS=0;\nSET time_zone='+00:00';\n\n");
    const [tables] = await conn.query("SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
    for (const { name } of tables) {
      const [[create]] = await conn.query(`SHOW CREATE TABLE \`${name}\``);
      await write(`DROP TABLE IF EXISTS \`${name}\`;\n${create["Create Table"]};\n`);
      // generated columns (e.g. base-currency amounts) are recalculated on restore, so they're left out
      const [cols] = await conn.query(
        "SELECT COLUMN_NAME AS col, DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND EXTRA NOT LIKE '%GENERATED%' ORDER BY ORDINAL_POSITION",
        [name]
      );
      const list = cols.map((c) => `\`${c.col}\``).join(", ");
      const json = cols.map((c) => c.type === "json");
      let n = 0;
      for (let offset = 0; ; offset += BATCH) {
        const [rows] = await conn.query({ sql: `SELECT ${list} FROM \`${name}\` LIMIT ? OFFSET ?`, rowsAsArray: true }, [BATCH, offset]);
        if (!rows.length) break;
        const values = rows.map((r) => `(${r.map((v, i) => (v === null ? "NULL" : json[i] ? conn.escape(JSON.stringify(v)) : conn.escape(v))).join(", ")})`).join(",\n");
        await write(`INSERT INTO \`${name}\` (${list}) VALUES\n${values};\n`);
        n += rows.length;
        if (rows.length < BATCH) break;
      }
      counts[name] = n;
      await write("\n");
    }
    await write("SET FOREIGN_KEY_CHECKS=1;\nSET UNIQUE_CHECKS=1;\n");
    gzip.end();
    await once(out, "close");
    return counts;
  } catch (err) {
    gzip.destroy();
    out.destroy();
    rmSync(file, { force: true });
    throw err;
  } finally {
    await conn.end();
  }
}

/** Keeps the newest `keep` automatic backups and removes older ones. */
export function pruneBackups(dir, prefix, keep = 20) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".sql.gz"))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) rmSync(path.join(dir, f), { force: true });
}

/** A new backup file name in the backup folder, e.g. pre-migration-2026-10-28T10-15-00Z.sql.gz */
export function newBackupPath(prefix) {
  const dir = backupDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");
  return path.join(dir, `${prefix}${stamp}.sql.gz`);
}

/** How many migrations in `folder` haven't been applied yet, and whether the database has no tables at all (a first install). */
export async function pendingMigrations(connection, folder) {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
  const [[{ tables }]] = await connection.query("SELECT COUNT(*) AS tables FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  const [[{ has }]] = await connection.query("SELECT COUNT(*) AS has FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '__drizzle_migrations'");
  const applied = Number(has) ? Number((await connection.query("SELECT COUNT(*) AS n FROM `__drizzle_migrations`"))[0][0].n) : 0;
  return { pending: Math.max(0, journal.entries.length - applied), empty: Number(tables) === 0 };
}
