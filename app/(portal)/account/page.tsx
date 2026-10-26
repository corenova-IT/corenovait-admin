import { RecoveryCodesCard } from "@/components/auth/RecoveryCodesCard";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FormMessage } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/lib/auth/session";
import { recoveryCodesLeft } from "@/lib/dal/auth";
import { regenerateCodes, signOutEverywhere } from "./actions";

export const metadata = { title: "Security" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovery_left?: string }> }) {
  const actor = await requireUser();
  const left = actor.mfaEnabled ? await recoveryCodesLeft(actor) : 0;
  const usedRecovery = (await searchParams).recovery_left !== undefined;

  return (
    <>
      <PageHeader title="Security" subtitle={actor.email} />
      {usedRecovery && (
        <div className="mb-6">
          <FormMessage tone="info">
            You signed in with a recovery code. {left} left. If you&apos;ve lost your phone, move two-factor to your new phone below; that also issues new codes.
          </FormMessage>
        </div>
      )}
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        <Card>
          <CardHeader
            title="Two-factor sign-in"
            aside={actor.mfaEnabled ? <Badge tone="green">On</Badge> : actor.mfaRequired ? <Badge tone="amber">Required</Badge> : <Badge>Off</Badge>}
          />
          {actor.mfaEnabled ? (
            <div className="flex flex-col gap-4">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Your authenticator app is set up. You have <strong className="text-ink">{left}</strong> unused recovery code{left === 1 ? "" : "s"}.
              </p>
              <ButtonLink href="/mfa?setup=1&next=/account" variant="secondary" className="self-start">
                Move to a new phone
              </ButtonLink>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Add a 6-digit code from an authenticator app to every sign-in. It stops anyone who learns your password from getting in.
              </p>
              <ButtonLink href="/mfa?setup=1&next=/account" className="self-start">
                Set up two-factor
              </ButtonLink>
            </div>
          )}
        </Card>
        {actor.mfaEnabled && <RecoveryCodesCard action={regenerateCodes} left={left} />}
        <Card>
          <CardHeader title="Sessions" />
          <p className="mb-4 text-[15px] leading-relaxed text-ink-2">
            Signed in somewhere you shouldn&apos;t be, like a shared computer? End every session, including this one.
          </p>
          <form action={signOutEverywhere}>
            <button type="submit" className={buttonClass("danger")}>
              Sign out of all devices
            </button>
          </form>
        </Card>
      </div>
    </>
  );
}
