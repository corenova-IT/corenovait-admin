import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const REASONS = new Set(["idle", "revoked", "inactive"]);

async function signOut(request: NextRequest, reason: string) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) {
    await supabase.rpc("log_event", {
      p_action: "sign_out",
      p_entity: "auth",
      p_entity_id: null,
      p_summary: reason === "signed_out" ? "Signed out" : `Signed out (${reason})`,
    });
  }
  // "local" ends this browser's session; admins use "reset sessions" to end them everywhere
  await supabase.auth.signOut({ scope: "local" });
  const res = NextResponse.redirect(new URL(`/login?reason=${reason}`, request.url), { status: 303 });
  res.cookies.delete("cn_last_active");
  return res;
}

/** The "Sign out" button posts here. */
export async function POST(request: NextRequest) {
  return signOut(request, "signed_out");
}

/** Forced sign-outs (idle timeout, revoked or deactivated accounts) redirect here. */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") ?? "";
  return signOut(request, REASONS.has(reason) ? reason : "signed_out");
}
