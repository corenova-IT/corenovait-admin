/**
 * One-time: create the first admin.
 *
 *   1. Put SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (and optionally SEED_ADMIN_NAME)
 *      in .env.local alongside the Supabase keys.
 *   2. npm run seed:admin
 *   3. Delete the SEED_ADMIN_* lines from .env.local.
 *
 * It refuses to run if an active admin already exists (further admins are
 * invited from the Team page). Credentials are read from the environment
 * only and never printed.
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { passwordProblems } from "../lib/password";

function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(".env.local");

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing ${name}. Add it to .env.local (never commit that file).`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const url = need("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = need("SUPABASE_SERVICE_ROLE_KEY");
  const email = need("SEED_ADMIN_EMAIL").toLowerCase();
  const password = need("SEED_ADMIN_PASSWORD");
  const name = process.env.SEED_ADMIN_NAME?.trim() || email.split("@")[0];

  const problems = passwordProblems(password, email);
  if (problems.length) {
    console.error("SEED_ADMIN_PASSWORD is too weak:\n - " + problems.join("\n - "));
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { count, error: countError } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("preset_id", "admin")
    .eq("active", true);
  if (countError) {
    console.error("Couldn't read the database. Have you run the migrations? " + countError.message);
    process.exit(1);
  }
  if ((count ?? 0) > 0) {
    console.error("An admin already exists. Invite further admins from the Team page instead.");
    process.exit(1);
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
    app_metadata: { provisioned: true },
  });
  if (error || !data.user) {
    console.error("Couldn't create the user: " + (error?.message ?? "unknown error"));
    process.exit(1);
  }

  const { error: promoteError } = await supabase.rpc("bootstrap_first_admin", { p_user: data.user.id });
  if (promoteError) {
    console.error("User created but couldn't be made admin: " + promoteError.message);
    process.exit(1);
  }
  console.log(`First admin created for ${email}.`);
  console.log("Next: sign in, set up two-factor when prompted, then remove the SEED_ADMIN_* lines from .env.local.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
