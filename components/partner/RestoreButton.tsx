"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/Field";

type State = { ok?: string; error?: string };

/** "Restore" for one archived item. */
export function RestoreButton({ kind, id, action }: { kind: "expense" | "task" | "subscription"; id: string; action: (p: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Restoring…" : "Restore"}</Button>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}
