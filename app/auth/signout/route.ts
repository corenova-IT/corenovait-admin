import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { endSession } from "@/lib/dal/auth";

const REASONS = new Set(["idle", "expired", "revoked", "inactive"]);

async function signOut(request: NextRequest, reason: string) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  await endSession(token, reason).catch(() => undefined);
  const res = NextResponse.redirect(new URL(`/login?reason=${reason}`, request.url), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

/** The "Sign out" button posts here (Next checks the Origin header on POST). */
export async function POST(request: NextRequest) {
  return signOut(request, "signed_out");
}

/** Forced sign-outs (idle timeout, expired, deactivated) redirect here. */
export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("reason") ?? "";
  return signOut(request, REASONS.has(reason) ? reason : "signed_out");
}
