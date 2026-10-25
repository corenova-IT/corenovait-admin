import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth/AuthCard";
import { TotpSetup, TotpVerifyForm } from "@/components/auth/forms";
import { getSession } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Two-factor" };

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string; setup?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.profile?.active) redirect("/auth/signout?reason=inactive");
  const next = safeNextPath((await searchParams).next);
  const wantsSetup = (await searchParams).setup === "1";

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).find((f) => f.status === "verified");

  if (verified && session.aal === "aal2" && !wantsSetup) redirect(next);

  if (verified) {
    return (
      <AuthCard title="Two-factor check" subtitle="Enter the 6-digit code from your authenticator app.">
        <TotpVerifyForm factorId={verified.id} next={next} />
      </AuthCard>
    );
  }

  if (!session.profile.mfa_required && !wantsSetup) redirect(next);

  return (
    <AuthCard
      title="Set up two-factor"
      subtitle={
        session.profile.mfa_required
          ? "Your role can see sensitive company data, so two-factor is required before you continue."
          : "Add a second step to your sign-in."
      }
    >
      <TotpSetup next={next} />
    </AuthCard>
  );
}
