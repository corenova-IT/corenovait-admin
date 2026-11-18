"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input } from "@/components/ui/Field";

type State = { ok?: string; error?: string };

/** How many hours an open shift can run before it is flagged as a forgotten clock-out. */
export function ShiftFlagForm({ current, action }: { current: number; action: (p: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage tone="success">{state.ok}</FormMessage>}
      <Field label="Flag an open shift after (hours)" htmlFor="flag-hours" hint="1 to 48. The default is 12.">
        <Input id="flag-hours" name="hours" inputMode="numeric" required defaultValue={String(current)} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Save"}</Button>
    </form>
  );
}
