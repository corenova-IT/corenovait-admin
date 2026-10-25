import { AuthCard } from "@/components/auth/AuthCard";
import { SetPasswordForm } from "@/components/auth/forms";
import { FormMessage } from "@/components/ui/Field";
import { peekLinkToken } from "@/lib/dal/auth";

export const metadata = { title: "Accept your invite" };

/** Reached from the invite email. */
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  const who = token ? await peekLinkToken(token, "invite") : null;
  if (!who) {
    return (
      <AuthCard title="Invite expired" subtitle="Invites work once and expire after 7 days.">
        <FormMessage tone="error">This invite has expired or was already used. Ask an admin to send you a new one.</FormMessage>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`Welcome${who.fullName ? `, ${who.fullName.split(" ")[0]}` : ""}`} subtitle={`Choose a password for ${who.email}`}>
      <SetPasswordForm email={who.email} token={token} kind="invite" />
    </AuthCard>
  );
}
