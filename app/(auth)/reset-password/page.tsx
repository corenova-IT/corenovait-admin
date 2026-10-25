import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { SetPasswordForm } from "@/components/auth/forms";
import { FormMessage } from "@/components/ui/Field";
import { peekLinkToken } from "@/lib/dal/auth";

export const metadata = { title: "Choose a new password" };

/** Reached from the password-reset email. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const who = token ? await peekLinkToken(token, "reset") : null;
  if (!who) {
    return (
      <AuthCard title="Link expired" subtitle="Reset links work once and expire after an hour.">
        <div className="flex flex-col gap-5">
          <FormMessage tone="error">That link has expired or was already used.</FormMessage>
          <Link href="/forgot-password" className="self-center text-sm text-accent-text hover:underline">
            Send me a new link
          </Link>
        </div>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle={`For ${who.email}`}>
      <SetPasswordForm email={who.email} token={token} kind="reset" />
    </AuthCard>
  );
}
