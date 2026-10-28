/**
 * The production entry file (Hostinger: application type "Other", entry file
 * server.mjs; locally: npm start after npm run build).
 *
 * 1. Applies new database migrations, writing a full backup first
 *    (scripts/migrate.mjs). If the backup or a migration fails, the app does
 *    not start, so it never runs against a half-upgraded database.
 * 2. Starts Next.js in this process on PORT (default 3000).
 */
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.NODE_ENV ??= "production";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const migration = spawnSync(process.execPath, [path.join(root, "scripts", "migrate.mjs")], { stdio: "inherit", env: process.env });
if (migration.status !== 0) {
  console.error("Not starting: the database step above failed. Nothing was served.");
  process.exit(migration.status ?? 1);
}

const { default: next } = await import("next");
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const app = next({ dev: false, dir: root });
const handle = app.getRequestHandler();
await app.prepare();
const server = createServer((req, res) => handle(req, res));
server.listen(port, () => console.log(`CoreNovaIT portal listening on port ${port}`));

// finish requests in flight when the host restarts the app
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
