/**
 * npm run db:backup: a full backup of DATABASE_URL to BACKUP_DIR (default
 * ~/corenovait-backups), as gzipped SQL. Run it over SSH on the server.
 */
import path from "node:path";
import { dumpDatabase, newBackupPath, pruneBackups } from "./backup-lib.mjs";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
const file = newBackupPath("manual-");
try {
  const counts = await dumpDatabase(process.env.DATABASE_URL, file);
  console.log(`Backed up ${Object.keys(counts).length} tables (${Object.values(counts).reduce((a, b) => a + b, 0)} rows) to ${file}`);
  pruneBackups(path.dirname(file), "manual-", 30);
} catch (err) {
  console.error(`Backup failed: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exitCode = 1;
}
