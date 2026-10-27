"use client";

import { useActionState, useState } from "react";
import { setBadges } from "@/components/layout/badges";
import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/Field";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export function MarkAllRead({ action, disabled }: { action: Action; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(async (prev: State, fd: FormData) => {
    const r = await action(prev, fd);
    if (r.ok) setBadges({ notifications: 0 });
    return r;
  }, {});
  return (
    <form action={formAction} className="flex items-center gap-3">
      <Button type="submit" variant="secondary" size="sm" disabled={pending || disabled}>
        {pending ? "Marking…" : "Mark all as read"}
      </Button>
      {state.error && <span className="text-sm text-accent-text">{state.error}</span>}
    </form>
  );
}

/** "Email me as well": the person's own setting. In-app notifications always appear. */
export function EmailToggle({ on, action, mailReady }: { on: boolean; action: Action; mailReady: boolean }) {
  const [checked, setChecked] = useState(on);
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="notifyEmail"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            e.currentTarget.form?.requestSubmit();
          }}
          disabled={pending}
          className="mt-1 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="block font-medium text-ink">Email me as well</span>
          <span className="block text-sm text-muted">
            Task assigned, due soon, meeting reminders, payments due and @mentions. Emails go out within a few minutes.
            {!mailReady && " (Email isn't set up on this server yet, so nothing is sent for now.)"}
          </span>
        </span>
      </label>
      {state.ok && <FormMessage tone="success">{state.ok}</FormMessage>}
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}
