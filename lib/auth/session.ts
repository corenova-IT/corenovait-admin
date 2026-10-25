import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, type SessionState } from "@/lib/dal/auth";
import { AccessDenied, RuleError, hasPerm, type Actor } from "@/lib/dal/guard";
import { SESSION_MAX_HOURS, isProduction } from "@/lib/env";
import type { AppAction, AppModule } from "@/lib/permissions";

/**
 * Cookie glue between Next.js and the session table. The cookie holds only a
 * random token; the database decides whether it's still valid (idle timeout,
 * 12-hour cap, deactivation, admin "reset sessions"). __Host- in production
 * means: Secure, no Domain, Path=/, so subdomains can't set or read it.
 */
export const SESSION_COOKIE = isProduction() ? "__Host-cn_session" : "cn_session";

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_HOURS * 3600,
});

export async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Only from server actions and route handlers (Server Components can't set cookies). */
export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Cached per request. */
export const getSessionState = cache(async (): Promise<SessionState> => resolveSession(await readSessionToken()));

/** For portal pages: an Actor or a redirect to wherever they need to go first. */
export const requireUser = cache(async (): Promise<Actor> => {
  const s = await getSessionState();
  if (s.status === "ok") return s.actor;
  if (s.status === "mfa_verify" || s.status === "mfa_setup") redirect("/mfa");
  if (s.reason === "none") redirect("/login");
  redirect(`/auth/signout?reason=${s.reason}`);
});

/** Page guard. The data-access layer checks again on every query. */
export async function requirePerm(module: AppModule, action: AppAction = "view"): Promise<Actor> {
  const actor = await requireUser();
  if (!hasPerm(actor, module, action)) redirect(`/no-access?module=${module}`);
  return actor;
}

/** For server actions: the Actor, or a plain-language error instead of a redirect. */
export async function actorForAction(): Promise<{ actor: Actor; error?: undefined } | { actor?: undefined; error: string }> {
  const s = await getSessionState();
  if (s.status === "ok") return { actor: s.actor };
  if (s.status === "ended") return { error: "Your session has ended. Sign in again." };
  return { error: "Verify your two-factor code, then try again." };
}

/** Turns DAL errors into messages that are safe to show; anything unexpected stays generic. */
export function errorMessage(e: unknown, fallback = "That couldn't be saved. Refresh the page and try again."): string {
  if (e instanceof AccessDenied || e instanceof RuleError) return e.message;
  if (e && typeof e === "object" && "issues" in e) return "Check the highlighted fields and try again.";
  console.error("[action]", e instanceof Error ? e.name : "error");
  return fallback;
}
