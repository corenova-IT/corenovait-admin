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

/** Why the first connection failed, in plain words and without any of DATABASE_URL's values. */
function whyNoConnection(err) {
  const code = typeof err?.code === "string" ? err.code : "ERROR";
  const hint =
    {
      ECONNREFUSED: "the database server isn't reachable at that host and port (on Hostinger use 127.0.0.1)",
      ENOTFOUND: "the host name in DATABASE_URL wasn't found",
      ETIMEDOUT: "the database server didn't answer in time",
      EHOSTUNREACH: "the database server isn't reachable at that host",
      ER_ACCESS_DENIED_ERROR: "the database user or password was refused",
      ER_DBACCESS_DENIED_ERROR: "that database user isn't allowed to use that database",
      ER_BAD_DB_ERROR: "that database name doesn't exist",
      ERR_INVALID_URL: "DATABASE_URL isn't a valid address (special characters in the password must be URL-encoded)",
    }[code] ?? "check DATABASE_URL (user, password, host, port and database name)";
  return `Could not connect to the database (${code}): ${hint}.`;
}

let connection;
try {
  connection = await mysql.createConnection({ uri: url, timezone: "Z", multipleStatements: false });
} catch (err) {
  console.error(whyNoConnection(err));
  process.exit(1);
}
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
