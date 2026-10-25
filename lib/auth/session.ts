import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, toPermMap, type AppAction, type AppModule, type PermMap, type PermRow } from "@/lib/permissions";

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  job_title: string;
  preset_id: string;
  active: boolean;
  mfa_required: boolean;
  sessions_revoked_at: string | null;
};

export type SessionInfo = {
  userId: string;
  aal: "aal1" | "aal2";
  issuedAt: number; // seconds
  profile: Profile | null;
};

export type CurrentUser = SessionInfo & {
  profile: Profile;
  perms: PermMap;
  isAdmin: boolean;
};

/** Verified session claims plus the profile row. Null when signed out. Cached per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const claims = data.claims as { sub: string; aal?: string; iat?: number };
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, email, full_name, job_title, preset_id, active, mfa_required, sessions_revoked_at")
    .eq("id", claims.sub)
    .maybeSingle<Profile>();
  return {
    userId: claims.sub,
    aal: claims.aal === "aal2" ? "aal2" : "aal1",
    issuedAt: claims.iat ?? 0,
    profile: profile ?? null,
  };
});

/** Where a signed-in user must go before they may use the portal, or null if they're clear. */
export function gateFor(s: SessionInfo): string | null {
  if (!s.profile || !s.profile.active) return "/auth/signout?reason=inactive";
  if (s.profile.sessions_revoked_at && s.issuedAt * 1000 < Date.parse(s.profile.sessions_revoked_at)) {
    return "/auth/signout?reason=revoked";
  }
  if (s.profile.mfa_required && s.aal !== "aal2") return "/mfa";
  return null;
}

/** For pages and actions inside the portal. Redirects anyone not fully signed in. */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const s = await getSession();
  if (!s) redirect("/login");
  const gate = gateFor(s);
  if (gate) redirect(gate);
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("user_permissions")
    .select("module, can_view, can_create, can_edit, can_delete, can_export, scope")
    .eq("user_id", s.userId)
    .returns<PermRow[]>();
  const profile = s.profile!;
  return { ...s, profile, perms: toPermMap(rows), isAdmin: profile.preset_id === "admin" };
});

/** Page guard. The database enforces the same rule; this just avoids showing an empty page. */
export async function requirePerm(module: AppModule, action: AppAction = "view"): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.perms, module, action)) redirect(`/no-access?module=${module}`);
  return user;
}

/** For server actions: returns the user or a plain-language error instead of redirecting. */
export async function userForAction(
  module: AppModule,
  action: AppAction
): Promise<{ user: CurrentUser; error?: undefined } | { user?: undefined; error: string }> {
  const s = await getSession();
  if (!s || gateFor(s)) return { error: "Your session has ended. Sign in again." };
  const user = await requireUser();
  if (!can(user.perms, module, action)) return { error: "You don't have permission to do that." };
  return { user };
}
