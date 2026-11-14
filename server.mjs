/**
 * The production entry file (Hostinger: application type "Other", entry file
 * server.mjs; locally: npm start after npm run build).
 *
 * Hostinger stops an app that doesn't call listen() within about 3 seconds, and
 * the database update plus Next.js start-up take longer than that. So the HTTP
 * server starts listening straight away and answers every request with a plain
 * 503 "starting up" page (with Retry-After) while this runs in the background:
 *
 *   1. the database: a full backup, then any new migrations (scripts/migrate.mjs)
 *   2. a check that sharp (picture processing) loads
 *   3. Next.js prepare()
 *
 * When that is done, requests are handed to Next.js. If the database step or
 * Next.js fails, one plain line is logged (no values, no secrets) and the app
 * exits, so it never serves against a half-upgraded database.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

process.env.NODE_ENV ??= "production";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

/** The host's PORT (a number, or the socket name some hosts pass), else 3000. */
const listenOn = (() => {
  const raw = process.env.PORT?.trim();
  if (!raw) return 3000;
  return /^\d+$/.test(raw) ? Number(raw) : raw;
})();

const STARTING_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="5">
<title>Starting up</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; text-align: center; font: 16px/1.5 system-ui, sans-serif; }
  main { max-width: 28rem; }
  h1 { margin: 0 0 .5rem; font-size: 1.4rem; }
  p { margin: .25rem 0; opacity: .8; }
</style>
</head>
<body>
<main>
<h1>CoreNovaIT is starting up</h1>
<p>This usually takes a few seconds. This page refreshes by itself.</p>
</main>
</body>
</html>
`;

/** Next.js's request handler: null until everything above is done. */
let handler = null;
/** The database step's process while it runs (a half-finished migration is worse than a slow stop). */
let migration = null;

const server = createServer((req, res) => {
  if (!handler) {
    res.writeHead(503, {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": "5",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    });
    res.end(req.method === "HEAD" ? undefined : STARTING_PAGE);
    return;
  }
  Promise.resolve(handler(req, res)).catch(() => {
    console.error("A request failed inside Next.js.");
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
});

/** One plain line (the step and an error code or name, never a message), then stop. */
function fail(step, err) {
  const code = err && typeof err.code === "string" && /^[A-Z0-9_]+$/.test(err.code) ? err.code : err instanceof Error ? err.name : "Error";
  console.error(`Startup failed in the ${step} step (${code}). The app is stopping; the log lines above say why.`);
  process.exitCode = 1;
  server.close();
  setTimeout(() => process.exit(1), 300);
}

server.on("error", (err) => fail("network", err));
server.listen(listenOn);

/** Backup and migrate in a separate process (scripts/migrate.mjs) so its output goes straight to the log. */
function updateDatabase() {
  return new Promise((resolve, reject) => {
    migration = spawn(process.execPath, [path.join(root, "scripts", "migrate.mjs")], { stdio: "inherit", env: process.env });
    migration.once("error", reject);
    migration.once("exit", (code) => {
      migration = null;
      if (code === 0) resolve();
      else reject(Object.assign(new Error("database step failed"), { code: `EXIT_${code ?? "SIGNAL"}` }));
    });
  });
}

/** sharp crops profile pictures and sizes the logo. Without it the site still works, but pictures can't be uploaded. */
async function checkImages() {
  try {
    const { default: sharp } = await import("sharp");
    console.log(`Image processing ready (sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}).`);
  } catch (err) {
    console.error(`Image processing is NOT available, so profile pictures can't be uploaded: ${err instanceof Error ? err.message.split("\n")[0] : "sharp failed to load"}. See DEPLOY.md, "If something goes wrong".`);
  }
}

async function prepareNext() {
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: root });
  await app.prepare();
  return app.getRequestHandler();
}

server.once("listening", async () => {
  console.log(`CoreNovaIT portal: listening on ${typeof listenOn === "number" ? `port ${listenOn}` : "the host's socket"}, starting up…`);
  let step = "database";
  try {
    await updateDatabase();
    await checkImages();
    step = "Next.js";
    handler = await prepareNext();
    console.log("Ready: serving requests.");
  } catch (err) {
    fail(step, err);
  }
});

// finish requests in flight when the host restarts the app, and let a running database update finish
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    server.close(() => {
      if (!migration) process.exit(0);
    });
    migration?.once("exit", () => process.exit(0));
    setTimeout(() => process.exit(0), migration ? 120_000 : 10_000).unref();
  });
}
