/**
 * One-time: create the first admin.
 *
 *   1. Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (and optionally SEED_ADMIN_NAME)
 *      in .env.local, or in the server's environment.
 *   2. npm run seed:admin
 *   3. Remove the SEED_ADMIN_* values again.
 *
 * Refuses if an active admin already exists (further admins are invited from
 * the Team page). Credentials come from the environment only and are never printed.
 */
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Add it to .env.local (never commit that file).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const email = need("SEED_ADMIN_EMAIL").toLowerCase();
  const password = need("SEED_ADMIN_PASSWORD");
  const fullName = process.env.SEED_ADMIN_NAME?.trim() || email.split("@")[0];
  need("DATABASE_URL");

  const { bootstrapFirstAdmin } = await import("../lib/dal/auth");
  const { closeDb } = await import("../lib/db");
  try {
    await bootstrapFirstAdmin({ email, password, fullName });
    console.log(`First admin created for ${email}.`);
    console.log("Next: sign in, set up two-factor when asked, save the recovery codes, then remove the SEED_ADMIN_* values.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Seeding failed.");
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

main();
