/**
 * Server for the browser layout test (npm run test:layout). Never touches a
 * real database:
 *   1. starts a throwaway MySQL 8.4 (mysql-memory-server, deleted on exit)
 *   2. applies the migrations and loads the development sample data
 *   3. creates sessions for an admin, a staff member, a marketing staff member
 *      and an admin who hasn't done two-factor yet, and writes their cookie
 *      tokens to .e2e/sessions.json
 *   4. runs the production build (next start) on 127.0.0.1:3210
 * Playwright starts this as its webServer and stops it afterwards.
 */
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

const ROOT = process.cwd();
const require = createRequire(path.join(ROOT, "package.json"));
const { createDB } = require("mysql-memory-server");
const PORT = Number(process.env.E2E_PORT ?? 3210);

const db = await createDB({ version: "8.4.x", dbName: "corenovait_e2e", logLevel: "ERROR" });
const url = `mysql://${db.username}@127.0.0.1:${db.port}/${db.dbName}`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: url,
  APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  SITE_URL: `http://localhost:${PORT}`,
  UPLOAD_DIR: mkdtempSync(path.join(os.tmpdir(), "cn-e2e-uploads-")),
};

execFileSync(process.execPath, [path.join(ROOT, "scripts", "migrate.mjs")], { env, stdio: "inherit" });
// the dev seed refuses production; it runs as development against this local throwaway database
execFileSync(process.execPath, [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", path.join(ROOT, "scripts", "seed-dev.ts")], {
  env: { ...env, NODE_ENV: "development" },
  stdio: "ignore",
});

const conn = await mysql.createConnection({ uri: url, timezone: "Z" });
async function session(email, mfaVerified) {
  const [[u]] = await conn.query("select id from users where email = ?", [email]);
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await conn.query("insert into sessions (id, user_id, created_at, last_seen_at, expires_at, mfa_verified_at) values (?, ?, ?, ?, ?, ?)", [
    createHash("sha256").update(token).digest("hex"),
    u.id,
    now,
    now,
    new Date(now.getTime() + 12 * 3600_000),
    mfaVerified ? now : null,
  ]);
  return token;
}
const [[rep]] = await conn.query("select id from representatives limit 1");
const tokens = {
  admin: await session("admin.one@example.test", true),
  staff: await session("web.dev@example.test", false),
  mfaPending: await session("admin.two@example.test", false),
  // staff with marketing access limited to their own activity
  marketing: await session("marketing@example.test", false),
  repId: rep.id,
};
await conn.end();
mkdirSync(path.join(ROOT, ".e2e"), { recursive: true });
writeFileSync(path.join(ROOT, ".e2e", "sessions.json"), JSON.stringify(tokens));

const next = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: "inherit" });

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  next.kill();
  await db.stop().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
next.on("exit", stop);
