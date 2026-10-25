import "server-only";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { databaseUrl } from "@/lib/env";
import * as schema from "./schema";

/**
 * The one MySQL connection pool. Import it ONLY from lib/dal/**: every query
 * must go through a data-access function that checks the caller's permissions.
 * tests/dal/boundaries.test.ts fails the build if anything else imports it.
 */
export type Db = MySql2Database<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

const g = globalThis as unknown as { __cnDb?: Db; __cnPool?: mysql.Pool };

export function getDb(): Db {
  if (!g.__cnDb) {
    g.__cnPool = mysql.createPool({
      uri: databaseUrl(),
      timezone: "Z", // read and write every DATETIME as UTC
      dateStrings: ["DATE"], // calendar dates stay 'YYYY-MM-DD'
      connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 5) || 5,
      supportBigNumbers: true,
      charset: "utf8mb4",
    });
    g.__cnDb = drizzle(g.__cnPool, { schema, mode: "default" });
  }
  return g.__cnDb;
}

/** For scripts and tests: close the pool so the process can exit. */
export async function closeDb() {
  await g.__cnPool?.end();
  g.__cnPool = undefined;
  g.__cnDb = undefined;
}
