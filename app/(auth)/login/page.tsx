import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/forms";
import { getSessionState, readSessionToken } from "@/lib/auth/session";
import { SESSION_IDLE_MINUTES } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  idle: `You were signed out after ${SESSION_IDLE_MINUTES} minutes without activity.`,
  expired: "Your session reached its time limit. Sign in again to continue.",
  revoked: "An admin ended your sessions. Sign in again to continue.",
  inactive: "This account isn't active. If you think that's a mistake, ask an admin.",
  signed_out: "You've signed out.",
  password_reset: "Your password was changed and you were signed out everywhere. Sign in with the new one.",
  link: "That link has expired or was already used. Request a new one below.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const { next, reason } = await searchParams;
  // Already signed in? Skip the form. (Only checked when a cookie exists, so the
  // page still renders before a database is configured.)
  if (await readSessionToken()) {
    const s = await getSessionState().catch(() => null);
    if (s?.status === "ok") redirect(safeNextPath(next));
    if (s?.status === "mfa_verify" || s?.status === "mfa_setup") redirect("/mfa");
  }
  return (
    <AuthCard title="Sign in" subtitle="Use the email your admin invited.">
      <LoginForm next={next} notice={NOTICES[reason ?? ""]} />
    </AuthCard>
  );
}
