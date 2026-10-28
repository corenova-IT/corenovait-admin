import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertRealEmailInProduction, assertSampleSeedAllowed, isSampleEmail } from "@/lib/sample-guard";

/** Sample data and sample accounts can never reach the live portal. */
const local = { NODE_ENV: "development", DATABASE_URL: "mysql://root@127.0.0.1:3307/corenovait_dev", SITE_URL: "http://localhost:3000" };

describe("the sample-data seed", () => {
  it("runs only in development, against this computer's database, for a local site", () => {
    expect(() => assertSampleSeedAllowed(local)).not.toThrow();
    expect(() => assertSampleSeedAllowed({ ...local, NODE_ENV: "production" })).toThrow(/never loads in production/);
    expect(() => assertSampleSeedAllowed({ ...local, DATABASE_URL: "mysql://u123:pw@localhost.evil.example:3306/db" })).toThrow(/on this computer/);
    expect(() => assertSampleSeedAllowed({ ...local, DATABASE_URL: "mysql://u123:pw@srv123.hstgr.io:3306/u123_db" })).toThrow(/on this computer/);
    expect(() => assertSampleSeedAllowed({ ...local, DATABASE_URL: "" })).toThrow(/on this computer/);
    expect(() => assertSampleSeedAllowed({ ...local, SITE_URL: "https://admin.corenovait.com.au" })).toThrow(/real site/);
  });

  it("the actual seed script refuses to start in production", () => {
    const run = () =>
      execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--conditions=react-server", path.resolve("scripts/seed-dev.ts")], {
        env: { ...process.env, ...local, NODE_ENV: "production" },
        stdio: "pipe",
      });
    expect(run).toThrow(/never loads in production/);
  });
});

describe("sample accounts", () => {
  it("recognises sample and test domains", () => {
    for (const e of ["admin.one@example.test", "x@example.com", "x@sub.example.org", "x@foo.test", "x@localhost"]) expect(isSampleEmail(e), e).toBe(true);
    for (const e of ["umair@corenovait.com.au", "someone@gmail.com", "a@examples.com"]) expect(isSampleEmail(e), e).toBe(false);
  });

  it("can't be created in production", () => {
    expect(() => assertRealEmailInProduction("admin.one@example.test", { NODE_ENV: "production" })).toThrow(/sample or test address/);
    expect(() => assertRealEmailInProduction("admin@corenovait.com.au", { NODE_ENV: "production" })).not.toThrow();
    expect(() => assertRealEmailInProduction("admin.one@example.test", { NODE_ENV: "development" })).not.toThrow();
  });
});
