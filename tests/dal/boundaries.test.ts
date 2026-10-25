import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rule that replaces row-level security: ALL database access goes through
 * lib/dal. Nothing in app/, components/ or the rest of lib/ may import the
 * connection, the schema, the ORM or the MySQL driver.
 */
const ROOT = path.resolve(import.meta.dirname, "../..");
const FORBIDDEN = [/from\s+["']@\/lib\/db(\/[^"']*)?["']/, /from\s+["'](\.\.\/)+(lib\/)?db(\/[^"']*)?["']/, /from\s+["']drizzle-orm[^"']*["']/, /from\s+["']mysql2[^"']*["']/];

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

describe("database access boundary", () => {
  const checked = [...files(path.join(ROOT, "app")), ...files(path.join(ROOT, "components")), ...files(path.join(ROOT, "lib"))].filter(
    (f) => !rel(f).startsWith("lib/dal/") && !rel(f).startsWith("lib/db/")
  );

  it("covers the app", () => {
    expect(checked.length).toBeGreaterThan(40);
  });

  it("no page, component, route handler, server action or helper imports the database directly", () => {
    const offenders = checked.filter((f) => FORBIDDEN.some((re) => re.test(readFileSync(f, "utf8")))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("every data-access module is server-only", () => {
    const dal = files(path.join(ROOT, "lib/dal")).concat(files(path.join(ROOT, "lib/db")).filter((f) => !f.endsWith("schema.ts")));
    const missing = dal.filter((f) => !readFileSync(f, "utf8").includes('import "server-only"')).map(rel);
    expect(missing).toEqual([]);
  });

  it("client components never import the data-access layer", () => {
    const clients = checked.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    const offenders = clients.filter((f) => /from\s+["']@\/lib\/(dal|auth\/session|email)/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
});
