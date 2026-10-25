import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for invite and password-reset emails. The Supabase email
 * templates link here with a token_hash (see README). Verifying it signs the
 * user in, then they choose a password.
 */
const ALLOWED: EmailOtpType[] = ["invite", "recovery", "email_change", "email"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/set-password");
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type && ALLOWED.includes(type)) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const target = new URL(ok ? next : "/login?error=link", request.url);
  return NextResponse.redirect(target);
}
