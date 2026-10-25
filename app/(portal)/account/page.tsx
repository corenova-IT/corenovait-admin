import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Security" };

async function signOutEverywhere() {
  "use server";
  const supabase = await createClient();
  await supabase.rpc("log_event", { p_action: "sign_out", p_entity: "auth", p_entity_id: null, p_summary: "Signed out of all devices" });
  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?reason=signed_out");
}

export default async function AccountPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const totp = (data?.totp ?? []).filter((f) => f.status === "verified");

  return (
    <>
      <PageHeader title="Security" subtitle={user.profile.email} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Two-factor sign-in"
            aside={totp.length > 0 ? <Badge tone="green">On</Badge> : user.profile.mfa_required ? <Badge tone="amber">Required</Badge> : <Badge>Off</Badge>}
          />
          {totp.length > 0 ? (
            <p className="text-[15px] leading-relaxed text-ink-2">
              Your authenticator app is set up{totp[0].created_at ? ` (added ${new Date(totp[0].created_at).toLocaleDateString("en-AU")})` : ""}.
              If you lose your phone, ask another admin to reset your access.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Add a 6-digit code from an authenticator app to every sign-in. It stops anyone who learns your password from getting in.
              </p>
              <ButtonLink href="/mfa?setup=1&next=/account" className="self-start">Set up two-factor</ButtonLink>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Sessions" />
          <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
            Signed in somewhere you shouldn&apos;t be, like a shared computer? End every session, including this one.
          </p>
          <form action={signOutEverywhere}>
            <button type="submit" className={buttonClass("danger")}>Sign out of all devices</button>
          </form>
        </Card>
      </div>
    </>
  );
}
