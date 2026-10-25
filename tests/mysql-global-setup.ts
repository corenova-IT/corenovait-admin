import type { TestProject } from "vitest/node";

/**
 * One MySQL 8 server for the whole test run. Each test file then creates its
 * own empty database on it and applies the real migrations (tests/dal/db.ts).
 *
 * - TEST_DATABASE_URL set (e.g. mysql://root:pw@127.0.0.1:3306): use that server.
 * - Otherwise mysql-memory-server downloads the official MySQL 8.4 build once
 *   (cached), starts it on a random local port, and deletes it afterwards.
 * Nothing here ever touches a real database.
 */
declare module "vitest" {
  export interface ProvidedContext {
    mysqlUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const external = process.env.TEST_DATABASE_URL?.trim();
  if (external) {
    project.provide("mysqlUrl", external.replace(/\/[^/]*$/, ""));
    return;
  }
  const { createDB } = await import("mysql-memory-server");
  const db = await createDB({ version: "8.4.x", dbName: "bootstrap", logLevel: "ERROR" });
  project.provide("mysqlUrl", `mysql://${db.username}@127.0.0.1:${db.port}`);
  return async () => {
    await db.stop();
  };
}
