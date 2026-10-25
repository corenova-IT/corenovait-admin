import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/forms";
import { SESSION_IDLE_MINUTES } from "@/lib/env";

export const metadata = { title: "Sign in" };

const NOTICES: Record<string, string> = {
  idle: `You were signed out after ${SESSION_IDLE_MINUTES} minutes without activity.`,
  revoked: "An admin ended your sessions. Sign in again to continue.",
  inactive: "This account isn't active. If you think that's a mistake, ask an admin.",
  signed_out: "You've signed out.",
  link: "That link has expired or was already used. Request a new one below.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string; error?: string }> }) {
  const { next, reason, error } = await searchParams;
  const notice = NOTICES[reason ?? ""] ?? (error ? NOTICES.link : undefined);
  return (
    <AuthCard title="Sign in" subtitle="Use the email your admin invited.">
      <LoginForm next={next} notice={notice} />
    </AuthCard>
  );
}
