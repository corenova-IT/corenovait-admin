"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input } from "@/components/ui/Field";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

function Message({ state }: { state: State }) {
  if (state.error) return <FormMessage tone="error">{state.error}</FormMessage>;
  if (state.ok) return <FormMessage tone="success">{state.ok}</FormMessage>;
  return null;
}

/** Name, job title and phone. Email and role are shown but changed by an admin. */
export function DetailsForm({ action, values }: { action: Action; values: { fullName: string; jobTitle: string; phone: string; email: string; roleName: string } }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = useId();
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Message state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" htmlFor={`${p}-name`}>
          <Input id={`${p}-name`} name="fullName" required maxLength={120} autoComplete="name" defaultValue={values.fullName} />
        </Field>
        <Field label="Job title" htmlFor={`${p}-title`} hint="Optional">
          <Input id={`${p}-title`} name="jobTitle" maxLength={120} autoComplete="organization-title" defaultValue={values.jobTitle} />
        </Field>
        <Field label="Phone" htmlFor={`${p}-phone`} hint="Optional">
          <Input id={`${p}-phone`} name="phone" type="tel" maxLength={40} autoComplete="tel" defaultValue={values.phone} />
        </Field>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[8rem_1fr]">
        <dt className="label-mono">Email</dt>
        <dd className="text-ink [overflow-wrap:anywhere]">{values.email}</dd>
        <dt className="label-mono">Role</dt>
        <dd className="text-ink">{values.roleName}</dd>
      </dl>
      <p className="text-sm text-muted">To change your email address or role, ask an admin (Team and permissions).</p>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}

/** Upload a new picture or go back to initials. The server checks, crops and re-encodes it. */
export function PictureForm({ name, src, upload, remove }: { name: string; src: string | null; upload: Action; remove: Action }) {
  const [up, upAction, uploading] = useActionState(upload, {});
  const [rm, rmAction, removing] = useActionState(remove, {});
  const form = useRef<HTMLFormElement>(null);
  const p = useId();
  useEffect(() => {
    if (up.ok) form.current?.reset();
  }, [up]);
  return (
    <div className="flex flex-col gap-5">
      <Message state={up.error || up.ok ? up : rm} />
      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={name} src={src} size={88} ring />
        <form ref={form} action={upAction} className="flex min-w-0 flex-[1_1_16rem] flex-col gap-3">
          <Field label="New picture" htmlFor={`${p}-pic`} hint="JPG, PNG or WebP, up to 2 MB. It's cropped to a square.">
            <input
              id={`${p}-pic`}
              name="picture"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              className="max-w-full text-sm text-ink-2 file:mr-3 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-ink"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload picture"}
            </Button>
            {src && (
              <Button type="submit" variant="ghost" formAction={rmAction} formNoValidate disabled={removing}>
                {removing ? "Removing…" : "Remove picture"}
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Current password first; the new one follows the usual rules. */
export function PasswordForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const form = useRef<HTMLFormElement>(null);
  const p = useId();
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={formAction} className="flex flex-col gap-4">
      <Message state={state} />
      <Field label="Current password" htmlFor={`${p}-cur`}>
        <Input id={`${p}-cur`} name="current" type="password" autoComplete="current-password" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" htmlFor={`${p}-new`} hint="12+ characters, with at least 3 of: lowercase, uppercase, number, symbol">
          <Input id={`${p}-new`} name="password" type="password" autoComplete="new-password" required minLength={12} />
        </Field>
        <Field label="New password again" htmlFor={`${p}-conf`}>
          <Input id={`${p}-conf`} name="confirm" type="password" autoComplete="new-password" required minLength={12} />
        </Field>
      </div>
      <p className="text-sm text-muted">Changing it signs you out on every other device.</p>
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? "Changing…" : "Change password"}
      </Button>
    </form>
  );
}
