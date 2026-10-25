import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { SecondFactorForm, TotpSetup } from "@/components/auth/forms";
import { getSessionState } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/safe-redirect";

export const metadata = { title: "Two-factor" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string }> }) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  const s = await getSessionState();
  if (s.status === "ended") redirect(s.reason === "none" ? "/login" : `/auth/signout?reason=${s.reason}`);

  if (s.status === "mfa_verify") {
    return (
      <AuthCard title="Two-factor check" subtitle="Enter the 6-digit code from your authenticator app.">
        <SecondFactorForm next={next} />
      </AuthCard>
    );
  }

  // Signed in already: only stay if they asked to set up (or move) two-factor.
  if (s.status === "ok" && sp.setup !== "1") redirect(next);

  const required = s.status === "mfa_setup" ? s.mfaRequired : s.actor.mfaRequired;
  const moving = s.status === "ok" && s.actor.mfaEnabled;
  return (
    <AuthCard
      title={moving ? "Move two-factor to a new phone" : "Set up two-factor"}
      subtitle={
        moving
          ? "Scanning a new QR code replaces your old authenticator and recovery codes."
          : required
            ? "Your role can see sensitive company data, so two-factor is required before you continue."
            : "Add a second step to your sign-in."
      }
    >
      <TotpSetup next={next} />
    </AuthCard>
  );
}
