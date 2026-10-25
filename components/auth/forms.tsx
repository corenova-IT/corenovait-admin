"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  requestPasswordReset,
  setNewPassword,
  signIn,
  startTotpEnrollment,
  verifyTotp,
  type EnrollResult,
  type FormState,
} from "@/app/(auth)/actions";
import { Button } from "@/components/ui/Button";
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

export function SetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(setNewPassword, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />
      <Field
        label="New password"
        htmlFor="password"
        error={e.password}
        hint={`At least ${PASSWORD_MIN} characters, mixing three of: lowercase, uppercase, numbers, symbols.`}
      >
        <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus invalid={!!e.password} aria-describedby={e.password ? "password-error" : "password-hint"} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={e.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required invalid={!!e.confirm} aria-describedby={e.confirm ? "confirm-error" : undefined} />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}

function CodeForm({ factorId, next, submitLabel }: { factorId: string; next: string; submitLabel: string }) {
  const [state, action, pending] = useActionState(verifyTotp, initial);
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <input type="hidden" name="factorId" value={factorId} />
      <input type="hidden" name="next" value={next} />
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
        {pending ? "Checking…" : submitLabel}
      </Button>
    </form>
  );
}

export function TotpVerifyForm({ factorId, next }: { factorId: string; next: string }) {
  return <CodeForm factorId={factorId} next={next} submitLabel="Verify" />;
}

export function TotpSetup({ next }: { next: string }) {
  const [enrollment, setEnrollment] = useState<EnrollResult | null>(null);
  const [pending, start] = useTransition();
  if (!enrollment || "error" in enrollment) {
    return (
      <div className="flex flex-col gap-5">
        {enrollment && "error" in enrollment && <FormMessage tone="error">{enrollment.error}</FormMessage>}
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-ink-2">
          <li>Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password or similar).</li>
          <li>Scan the QR code we show you next.</li>
          <li>Enter the 6-digit code it gives you.</li>
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
        {/* eslint-disable-next-line @next/next/no-img-element -- Supabase returns an SVG data URI */}
        <img src={enrollment.qrCode} alt="QR code to add CoreNovaIT to your authenticator app" width={184} height={184} />
      </div>
      <details className="rounded-[14px] border border-line px-4 py-3 text-sm text-ink-2">
        <summary className="cursor-pointer">Can't scan it? Enter this key instead</summary>
        <p className="mt-2 break-all font-mono text-ink">{enrollment.secret}</p>
      </details>
      <CodeForm factorId={enrollment.factorId} next={next} submitLabel="Turn on two-factor" />
    </div>
  );
}
