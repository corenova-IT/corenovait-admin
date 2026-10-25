import { defineConfig } from "drizzle-kit";

/**
 * `npm run db:generate` turns lib/db/schema.ts into a new SQL file in /drizzle.
 * It doesn't connect to any database. Migrations are applied with
 * `npm run db:migrate`, which reads DATABASE_URL.
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "mysql://localhost/unused" },
  strict: true,
  verbose: true,
});
