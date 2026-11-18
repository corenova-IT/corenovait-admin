"use client";

import { useActionState } from "react";
import { FormMessage, Select } from "@/components/ui/Field";

export type WorkState = { ok?: string; error?: string };
export type WorkAction = (prev: WorkState, fd: FormData) => Promise<WorkState>;

/** One select that saves as soon as it changes: the employee moves their own task along. */
export function TaskStatusSelect({ id, status, action }: { id: string; status: string; action: WorkAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <Select
        aria-label="Status"
        name="status"
        defaultValue={status}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="todo">To do</option>
        <option value="in_progress">In progress</option>
        <option value="review">Review</option>
        <option value="done">Done</option>
      </Select>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}
