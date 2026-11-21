"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage } from "@/components/ui/Field";

type State = { ok?: string; error?: string };

/** Makes a simple bill (PDF) for an expense and keeps it with the expense. Replaces the current document. */
export function BillButton({ id, action }: { id: string; action: (p: State, fd: FormData) => Promise<State> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Making the bill…" : "Make a bill (PDF)"}</Button>
      <p className="text-xs text-muted">Creates a simple bill with your company name, a bill number, the date and the amount, and attaches it here in place of the current document.</p>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage tone="success">{state.ok}</FormMessage>}
    </form>
  );
}
