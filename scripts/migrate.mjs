/**
 * Applies any new migrations in /drizzle to the database in DATABASE_URL.
 * Safe to run repeatedly: applied migrations are recorded in __drizzle_migrations.
 * `npm start` runs this first, so a deploy upgrades the schema before serving.
 */
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (local) or the hosting panel (production).");
  process.exit(1);
}
const connection = await mysql.createConnection({ uri: url, timezone: "Z", multipleStatements: false });
try {
  await migrate(drizzle(connection), { migrationsFolder: "./drizzle" });
  console.log("Database is up to date.");
} catch (err) {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await connection.end();
}
