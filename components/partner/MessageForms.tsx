"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Select, Textarea } from "@/components/ui/Field";

export type MessageState = { ok?: string; error?: string };
export type MessageAction = (prev: MessageState, fd: FormData) => Promise<MessageState>;

/** Start (or reopen) a conversation with someone you're allowed to message. */
export function StartConversationForm({ contacts, action }: { contacts: Array<{ id: string; name: string; role: string }>; action: MessageAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (contacts.length === 0) return <p className="text-sm text-muted">There is nobody to message yet.</p>;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field label="Message" htmlFor="msg-with" className="min-w-56 flex-1">
        <Select id="msg-with" name="withId" defaultValue={contacts[0].id}>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.role})
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Opening…" : "Open conversation"}</Button>
      {state.error && <div className="basis-full"><FormMessage tone="error">{state.error}</FormMessage></div>}
    </form>
  );
}

/** An admin's "Message" button next to a partner or employee. */
export function MessageUserButton({ userId, action, label = "Message" }: { userId: string; action: MessageAction; label?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Opening…" : label}</Button>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}

/** Write a message in the open conversation. */
export function SendMessageForm({ channelId, action }: { channelId: string; action: MessageAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3" key={state.ok ? `ok-${Date.now()}` : "form"}>
      <input type="hidden" name="channelId" value={channelId} />
      <Textarea name="body" rows={3} required maxLength={4000} aria-label="Your message" placeholder="Write a message" />
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      <Button type="submit" disabled={pending} className="self-start">{pending ? "Sending…" : "Send"}</Button>
    </form>
  );
}
