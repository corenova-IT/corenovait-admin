// Loads .env.local for command-line scripts (Next.js does this itself for the app).
// Values already set in the real environment (e.g. Hostinger's panel) win.
import { existsSync, readFileSync } from "node:fs";

export function loadEnvFile(file = ".env.local") {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
