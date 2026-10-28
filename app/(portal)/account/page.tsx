import { DetailsForm, PasswordForm, PictureForm } from "@/components/account/ProfileForms";
import { RecoveryCodesCard } from "@/components/auth/RecoveryCodesCard";
import { EmailToggle } from "@/components/notifications/NotificationForms";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { FormMessage } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireUser } from "@/lib/auth/session";
import { getMyProfile } from "@/lib/dal/profile";
import { mailConfig } from "@/lib/env";
import { setEmailNotifications } from "../notifications/actions";
import { changePassword, regenerateCodes, removeAvatar, saveProfile, signOutEverywhere, uploadAvatar } from "./actions";

export const metadata = { title: "Your profile" };

/** The signed-in person's own profile, picture, password, two-factor and sessions. Nobody else's. */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ recovery_left?: string }> }) {
  const actor = await requireUser();
  const me = await getMyProfile(actor);
  const usedRecovery = (await searchParams).recovery_left !== undefined;
  const mailReady = !!mailConfig() || process.env.NODE_ENV !== "production";
  const name = me.fullName || me.email;

  return (
    <>
      <PageHeader title="Your profile" subtitle={me.email} />
      {usedRecovery && (
        <div className="mb-[var(--space-gap)]">
          <FormMessage tone="info">
            You signed in with a recovery code. {me.recoveryCodesLeft} left. If you&apos;ve lost your phone, move two-factor to your new phone below; that also issues new codes.
          </FormMessage>
        </div>
      )}
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        <Card>
          <CardHeader title="Details" subtitle="Shown to your colleagues" />
          <DetailsForm action={saveProfile} values={{ fullName: me.fullName, jobTitle: me.jobTitle, phone: me.phone, email: me.email, roleName: me.roleName }} />
        </Card>
        <div className="flex flex-col gap-cards">
          <Card>
            <CardHeader title="Profile picture" subtitle="Shown next to your name in chat, tasks, the calendar and the team list" />
            <PictureForm name={name} src={me.avatarUrl} upload={uploadAvatar} remove={removeAvatar} />
          </Card>
          <Card>
            <CardHeader title="Notifications" />
            <EmailToggle on={me.notifyEmail} action={setEmailNotifications} mailReady={mailReady} />
          </Card>
        </div>
        <Card>
          <CardHeader title="Password" subtitle={me.passwordChangedAt ? `Last changed ${me.passwordChangedAt.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : undefined} />
          <PasswordForm action={changePassword} />
        </Card>
        <Card>
          <CardHeader
            title="Two-factor sign-in"
            aside={me.mfaEnabled ? <Badge tone="green">On</Badge> : me.mfaRequired ? <Badge tone="amber">Required</Badge> : <Badge>Off</Badge>}
          />
          {me.mfaEnabled ? (
            <div className="flex flex-col gap-4">
              <p className="text-[15px] leading-relaxed text-ink-2">
                Your authenticator app is set up. You have <strong className="text-ink">{me.recoveryCodesLeft}</strong> unused recovery code{me.recoveryCodesLeft === 1 ? "" : "s"}.
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
        {me.mfaEnabled && <RecoveryCodesCard action={regenerateCodes} left={me.recoveryCodesLeft} />}
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
