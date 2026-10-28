/**
 * Applies any new migrations in /drizzle to the database in DATABASE_URL.
 * Safe to run repeatedly: applied migrations are recorded in __drizzle_migrations.
 * `npm start` runs this first, so a deploy upgrades the schema before serving.
 *
 * Before applying anything to a database that already has tables, it writes a
 * full backup (BACKUP_DIR, default ~/corenovait-backups). If that backup can't
 * be written, nothing is migrated and the app doesn't start, so a schema
 * change never runs without a copy to go back to.
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { dumpDatabase, newBackupPath, pendingMigrations, pruneBackups } from "./backup-lib.mjs";
import { loadEnvFile } from "./load-env.mjs";

const FOLDER = "./drizzle";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (local) or the hosting panel (production).");
  process.exit(1);
}
const connection = await mysql.createConnection({ uri: url, timezone: "Z", multipleStatements: false });
try {
  const { pending, empty } = await pendingMigrations(connection, FOLDER);
  let ok = true;
  if (pending > 0 && !empty) {
    try {
      const file = newBackupPath("pre-migration-");
      const counts = await dumpDatabase(url, file);
      console.log(`Backed up ${Object.keys(counts).length} tables (${Object.values(counts).reduce((a, b) => a + b, 0)} rows) to ${file}`);
      pruneBackups(path.dirname(file), "pre-migration-");
    } catch (err) {
      ok = false;
      console.error(`The backup before migrating failed, so nothing was changed: ${err instanceof Error ? err.message : "unknown error"}`);
      console.error('Check BACKUP_DIR and redeploy. See DEPLOY.md, "If the app does not start after a deploy".');
      process.exitCode = 1;
    }
  }
  if (ok) {
    if (pending > 0) await migrate(drizzle(connection), { migrationsFolder: FOLDER });
    console.log(pending > 0 ? `Applied ${pending} migration${pending === 1 ? "" : "s"}. Database is up to date.` : "Database is up to date.");
  }
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await connection.end();
}
