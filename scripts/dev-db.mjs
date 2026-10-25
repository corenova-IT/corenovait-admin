/**
 * npm run db:local — one command for a local development MySQL on Windows
 * (also works on macOS/Linux). No Docker or installer needed.
 *
 *   - Uses the official MySQL 8.4 build (downloaded once and cached by the
 *     test tooling; about 1.2 GB unpacked, in your temp folder).
 *   - Keeps its data in %LOCALAPPDATA%\CoreNovaIT\mysql-data (outside the project),
 *     listening on 127.0.0.1:3307 only. MySQL 8.4 on Windows can't start from a
 *     folder whose path contains a space (like "CoreNovaIT 2.0"), hence the location.
 *     Override with DEV_DB_DIR.
 *   - Creates .env.local if you don't have one, applies migrations, and loads
 *     clearly fake sample data the first time.
 *   - Keep this window open while you work; Ctrl+C stops MySQL cleanly.
 *
 *   npm run db:local -- --reset   wipe the local data and start fresh
 *
 * Development only: it refuses to run with NODE_ENV=production.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";

if (process.env.NODE_ENV === "production") {
  console.error("db:local is for development only.");
  process.exit(1);
}

const ROOT = process.cwd();
const PORT = Number(process.env.DEV_DB_PORT ?? 3307);
const HOME = process.env.DEV_DB_DIR
  ? path.resolve(process.env.DEV_DB_DIR)
  : os.platform() === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "CoreNovaIT")
    : path.join(os.homedir(), ".corenovait");
const DATA = path.join(HOME, "mysql-data");
const LOG = path.join(HOME, "mysql-dev.log");
const DB_NAME = "corenovait_dev";
const URL = `mysql://root@127.0.0.1:${PORT}/${DB_NAME}`;
const exe = os.platform() === "win32" ? "mysqld.exe" : "mysqld";

function findBinary() {
  const base = path.join(os.tmpdir(), "mysqlmsn", "binaries");
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).filter((v) => v.startsWith("8.4.")).sort().reverse();
  for (const v of versions) {
    const p = path.join(base, v, "mysql", "bin", exe);
    if (existsSync(p)) return p;
  }
  return null;
}

async function ensureBinary() {
  let bin = findBinary();
  if (bin) return bin;
  console.log("Downloading the official MySQL 8.4 build (one time, a few hundred MB)…");
  const { createDB } = await import("mysql-memory-server");
  const tmp = await createDB({ version: "8.4.x", logLevel: "ERROR" });
  await tmp.stop();
  bin = findBinary();
  if (!bin) throw new Error("MySQL download finished but mysqld wasn't found.");
  return bin;
}

async function tryConnect(database) {
  try {
    const c = await mysql.createConnection({ host: "127.0.0.1", port: PORT, user: "root", database, connectTimeout: 1500 });
    return c;
  } catch {
    return null;
  }
}

function ensureEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) {
    writeFileSync(
      file,
      [
        "# Local development settings, created by npm run db:local. Never commit this file.",
        `DATABASE_URL=${URL}`,
        `APP_ENCRYPTION_KEY=${randomBytes(32).toString("base64")}`,
        "SITE_URL=http://localhost:3000",
        "",
      ].join("\n"),
      { mode: 0o600 }
    );
    console.log("Created .env.local for the local database.");
    return;
  }
  const current = /^DATABASE_URL=(.*)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();
  if (current !== URL) {
    console.warn(`Note: .env.local points DATABASE_URL somewhere else. For this local database use:\n  DATABASE_URL=${URL}`);
  }
}

function runNode(args) {
  execFileSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, DATABASE_URL: URL } });
}

function migrateAndSeed() {
  runNode([path.join(ROOT, "scripts", "migrate.mjs")]);
  runNode([path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", path.join(ROOT, "scripts", "seed-dev.ts")]);
}

async function main() {
  if (/\s/.test(DATA)) {
    console.error(`MySQL can't use a data folder whose path contains a space:\n  ${DATA}`);
    console.error("Set DEV_DB_DIR to a folder without spaces, e.g. C:\\corenovait-dev, and run again.");
    process.exit(1);
  }
  mkdirSync(HOME, { recursive: true });
  ensureEnvLocal();

  const running = await tryConnect();
  if (running) {
    await running.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
    await running.end();
    console.log(`Local MySQL is already running on 127.0.0.1:${PORT}.`);
    migrateAndSeed();
    return;
  }

  if (process.argv.includes("--reset") && existsSync(DATA)) {
    rmSync(DATA, { recursive: true, force: true });
    console.log("Local data wiped.");
  }

  const bin = await ensureBinary();
  if (!existsSync(path.join(DATA, "mysql"))) {
    console.log("Creating the local MySQL data folder…");
    execFileSync(bin, ["--no-defaults", `--datadir=${DATA}`, "--initialize-insecure"], { stdio: "ignore" });
  }

  const log = openSync(LOG, "a");
  const server = spawn(
    bin,
    [
      "--no-defaults",
      `--datadir=${DATA}`,
      `--port=${PORT}`,
      "--bind-address=127.0.0.1",
      "--mysqlx=OFF",
      "--character-set-server=utf8mb4",
      "--default-time-zone=+00:00",
      `--log-error=${LOG}`,
      ...(os.platform() === "win32" ? [`--socket=MySQL-corenovait-dev-${PORT}`] : [`--socket=${path.join(DATA, "mysqld.sock")}`]),
    ],
    { stdio: ["ignore", log, log] }
  );
  server.on("exit", (code) => {
    console.log(code ? `MySQL stopped (code ${code}). See ${LOG}.` : "MySQL stopped.");
    process.exit(code ? 1 : 0);
  });

  let conn = null;
  for (let i = 0; i < 60 && !conn; i++) {
    await new Promise((r) => setTimeout(r, 500));
    conn = await tryConnect();
  }
  if (!conn) {
    server.kill();
    throw new Error(`MySQL didn't start. See ${LOG}.`);
  }
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4`);
  await conn.end();

  migrateAndSeed();

  console.log(`\nLocal MySQL is running at 127.0.0.1:${PORT} (database ${DB_NAME}).`);
  console.log("In another terminal run:  npm run dev   then open http://localhost:3000");
  console.log("Keep this window open. Press Ctrl+C to stop MySQL.\n");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log("\nStopping MySQL…");
    const c = await tryConnect();
    if (c) await c.query("SHUTDOWN").catch(() => undefined);
    else server.kill();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
