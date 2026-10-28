"use client";

import { useActionState, useId } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Field, FormMessage, Input } from "@/components/ui/Field";

type CodesState = { codes?: string[]; error?: string };

/** New recovery codes, after your password and a current code from your app. */
export function RecoveryCodesCard({ action, left }: { action: (prev: CodesState, fd: FormData) => Promise<CodesState>; left: number }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = useId();
  return (
    <Card>
      <CardHeader title="Recovery codes" subtitle={`${left} unused`} />
      {state.codes ? (
        <div className="flex flex-col gap-4">
          <FormMessage tone="success">New codes issued. The old ones no longer work. Save these now; they won&apos;t be shown again.</FormMessage>
          <ul className="grid grid-cols-2 gap-2 rounded-[14px] border border-line bg-input p-4 font-mono text-[15px] tracking-wider text-ink" aria-label="Recovery codes">
            {state.codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-4">
          {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
          <p className="text-[15px] leading-relaxed text-ink-2">
            Each recovery code signs you in once if you lose your phone. {left <= 3 ? "You're running low. " : ""}Getting new codes cancels the old ones.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your password" htmlFor={`${p}-pw`}>
              <Input id={`${p}-pw`} name="password" type="password" autoComplete="current-password" required />
            </Field>
            <Field label="Code from your app" htmlFor={`${p}-code`}>
              <Input id={`${p}-code`} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="font-mono" />
            </Field>
          </div>
          <Button type="submit" variant="secondary" disabled={pending} className="self-start">
            {pending ? "Generating…" : "Get new recovery codes"}
          </Button>
        </form>
      )}
    </Card>
  );
}
