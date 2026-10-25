"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  acceptInvite,
  confirmTotp,
  requestPasswordReset,
  resetPassword,
  signIn,
  startTotpEnrollment,
  verifySecondFactor,
  type EnrollResult,
  type FormState,
} from "@/app/(auth)/actions";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Field, FormMessage, Input } from "@/components/ui/Field";
import { PASSWORD_MIN } from "@/lib/password";

const initial: FormState = {};

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signIn, initial);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {notice && !state.error && <FormMessage tone="info">{notice}</FormMessage>}
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/forgot-password" className="self-center rounded text-sm text-accent-text hover:underline">
        Forgot your password?
      </Link>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, initial);
  if (state.ok) {
    return (
      <div className="flex flex-col gap-5">
        <FormMessage tone="success">{state.ok}</FormMessage>
        <Link href="/login" className="self-center text-sm text-accent-text hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus invalid={!!state.fieldErrors?.email} aria-describedby={state.fieldErrors?.email ? "email-error" : undefined} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="self-center text-sm text-accent-text hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}

/** Used by both the invite and the password-reset links. */
export function SetPasswordForm({ email, token, kind }: { email: string; token: string; kind: "invite" | "reset" }) {
  const [state, action, pending] = useActionState(kind === "invite" ? acceptInvite : resetPassword, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field
        label={kind === "invite" ? "Choose a password" : "New password"}
        htmlFor="password"
        error={e.password}
        hint={`At least ${PASSWORD_MIN} characters, mixing three of: lowercase, uppercase, numbers, symbols.`}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus invalid={!!e.password} aria-describedby={e.password ? "password-error" : "password-hint"} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={e.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required invalid={!!e.confirm} aria-describedby={e.confirm ? "confirm-error" : undefined} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : kind === "invite" ? "Activate my account" : "Save password"}
      </Button>
    </form>
  );
}

export function SecondFactorForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifySecondFactor, initial);
  const [useRecovery, setUseRecovery] = useState(false);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="next" value={next} />
      <Field
        label={useRecovery ? "Recovery code" : "6-digit code"}
        htmlFor="code"
        error={state.fieldErrors?.code}
        hint={useRecovery ? "One of the codes you saved when you set up two-factor, like 7KQ4-M2XP. Each works once." : undefined}
      >
        <Input
          key={useRecovery ? "rc" : "totp"}
          id="code"
          name="code"
          inputMode={useRecovery ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={useRecovery ? 9 : 6}
          required
          autoFocus
          className="text-center font-mono text-2xl tracking-[0.4em] uppercase"
          invalid={!!state.fieldErrors?.code}
          aria-describedby={state.fieldErrors?.code ? "code-error" : useRecovery ? "code-hint" : undefined}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Verify"}
      </Button>
      <button type="button" onClick={() => setUseRecovery((v) => !v)} className="self-center rounded text-sm text-accent-text hover:underline">
        {useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </form>
  );
}

function RecoveryCodes({ codes, next }: { codes: string[]; next: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-5">
      <FormMessage tone="success">Two-factor is on.</FormMessage>
      <div>
        <p className="mb-2 text-[15px] font-medium text-ink">Save these recovery codes</p>
        <p className="text-sm leading-relaxed text-ink-2">
          If you lose your phone, each code gets you in once. Store them in a password manager or print them. They won&apos;t be shown again.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-[14px] border border-line bg-input p-4 font-mono text-[15px] tracking-wider text-ink" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button
        variant="secondary"
        onClick={() => navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true), () => setCopied(false))}
      >
        {copied ? "Copied" : "Copy codes"}
      </Button>
      <ButtonLink href={next}>I&apos;ve saved them, continue</ButtonLink>
    </div>
  );
}

function ConfirmCodeForm({ action, pending, state }: { action: (payload: FormData) => void; pending: boolean; state: FormState }) {
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <Field label="6-digit code" htmlFor="code" error={state.fieldErrors?.code}>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus
          className="text-center font-mono text-2xl tracking-[0.5em]"
          invalid={!!state.fieldErrors?.code}
          aria-describedby={state.fieldErrors?.code ? "code-error" : undefined}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Turn on two-factor"}
      </Button>
    </form>
  );
}

export function TotpSetup({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [pending, start] = useTransition();
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmTotp, initial);
  // once confirmed, the QR code and key are no longer needed on screen
  if (confirmState.recoveryCodes) return <RecoveryCodes codes={confirmState.recoveryCodes} next={next} />;
  if (!enrollment || "error" in enrollment) {
    return (
      <div className="flex flex-col gap-5">
        {enrollment && "error" in enrollment && <FormMessage tone="error">{enrollment.error}</FormMessage>}
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-ink-2">
          <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar).</li>
          <li>Scan the QR code we show you next.</li>
          <li>Enter the 6-digit code it gives you, then save your recovery codes.</li>
        </ol>
        <Button disabled={pending} onClick={() => start(async () => setEnrollment(await startTotpEnrollment()))}>
          {pending ? "Preparing…" : "Show my QR code"}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto rounded-2xl bg-white p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated SVG data URI */}
        <img src={enrollment.qrCode} alt="QR code to add CoreNovaIT to your authenticator app" width={184} height={184} />
      </div>
      <details className="rounded-[14px] border border-line px-4 py-3 text-sm text-ink-2">
        <summary className="cursor-pointer">Can&apos;t scan it? Enter this key instead</summary>
        <p className="mt-2 break-all font-mono text-ink">{enrollment.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
      </details>
      <ConfirmCodeForm action={confirmAction} pending={confirmPending} state={confirmState} />
    </div>
  );
}
