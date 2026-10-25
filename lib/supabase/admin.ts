import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

/**
 * Service-role client. BYPASSES row-level security. Server-only (the
 * "server-only" import makes the build fail if a client component imports
 * this file). Use only for Auth admin tasks: inviting, banning/unbanning users
 * and listing their two-factor factors. Every caller must first confirm the
 * signed-in user is an admin through the user-scoped client.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
