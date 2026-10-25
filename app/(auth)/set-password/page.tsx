import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SetPasswordForm } from "@/components/auth/forms";
import { getSession } from "@/lib/auth/session";

export const metadata = { title: "Choose a password" };

/** Reached from an invite or password-reset email (via /auth/confirm, which signs the user in). */
export default async function SetPasswordPage() {
  const session = await getSession();
  if (!session?.profile) redirect("/login?error=link");
  if (!session.profile.active) redirect("/auth/signout?reason=inactive");
  return (
    <AuthCard title="Choose a password" subtitle={`For ${session.profile.email}`}>
      <SetPasswordForm email={session.profile.email} />
    </AuthCard>
  );
}
