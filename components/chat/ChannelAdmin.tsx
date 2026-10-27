"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Dialog";
import { Field, FormMessage, Input } from "@/components/ui/Field";

type State = { ok?: string; error?: string; channelId?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;
export type AdminChannel = { id: string; name: string; topic: string; isDefault: boolean; archived: boolean; memberCount: number; memberIds: string[] };

function ChannelForm({ channel, people, save, onDone }: { channel?: AdminChannel; people: Array<{ id: string; name: string }>; save: Action; onDone: (channelId?: string) => void }) {
  const p = useId();
  const [state, setState] = useState<State>({});
  const [pending, start] = useTransition();
  const chosen = new Set(channel?.memberIds ?? []);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await save({}, fd);
          setState(r);
          if (r.ok) onDone(r.channelId);
        });
      }}
    >
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {channel && <input type="hidden" name="id" value={channel.id} />}
      <Field label="Name" htmlFor={`${p}-name`} hint="Lower case, e.g. projects or client-updates">
        <Input id={`${p}-name`} name="name" required maxLength={41} defaultValue={channel?.name} autoComplete="off" />
      </Field>
      <Field label="Topic" htmlFor={`${p}-topic`} hint="Optional">
        <Input id={`${p}-topic`} name="topic" maxLength={200} defaultValue={channel?.topic} />
      </Field>
      {channel?.isDefault ? (
        <p className="text-sm text-muted">#general always includes everyone with chat access.</p>
      ) : (
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-ink">Members</legend>
          <p className="mb-2 text-xs text-muted">Only members can read the channel, admins included. Adding yourself is recorded in the audit log.</p>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-[14px] border border-line p-2 sm:grid-cols-2">
            {people.map((u) => (
              <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                <input type="checkbox" name="memberIds" value={u.id} defaultChecked={chosen.has(u.id)} className="size-4 accent-[var(--accent)]" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{u.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : channel ? "Save channel" : "Create channel"}
      </Button>
    </form>
  );
}

/** Admins: create, rename, set members of, archive and restore channels. Never shows messages; DMs aren't listed. */
export function ChannelAdmin({ channels, people, save, archive }: { channels: AdminChannel[]; people: Array<{ id: string; name: string }>; save: Action; archive: Action }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminChannel | "new" | null>(null);
  const [msg, setMsg] = useState<State>({});
  const [pending, start] = useTransition();
  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);
  const done = (channelId?: string) => {
    setEditing(null);
    setMsg({ ok: "Saved." });
    router.refresh();
    if (channelId && editing === "new") router.push(`/chat?c=${channelId}`);
  };
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Manage channels
      </Button>
      <Drawer open={open} onClose={close} wide title="Manage channels" description="Admins only. Direct messages are private and never appear here.">
        {editing ? (
          <div className="flex flex-col gap-4">
            <ChannelForm channel={editing === "new" ? undefined : editing} people={people} save={save} onDone={done} />
            <Button variant="ghost" className="self-start" onClick={() => setEditing(null)}>
              Back to the list
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {msg.ok && <FormMessage tone="success">{msg.ok}</FormMessage>}
            {msg.error && <FormMessage tone="error">{msg.error}</FormMessage>}
            <Button className="self-start" onClick={() => setEditing("new")}>
              New channel
            </Button>
            <ul className="flex flex-col divide-y divide-line">
              {channels.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium text-ink">#{c.name}</span>
                    {c.archived && <span className="ml-2 text-xs text-muted">archived</span>}
                    <span className="block text-xs text-muted">
                      {c.isDefault ? "Everyone" : `${c.memberCount} ${c.memberCount === 1 ? "member" : "members"}`}
                      {c.topic ? ` · ${c.topic}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                    Edit
                  </Button>
                  {!c.isDefault && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const fd = new FormData();
                          fd.set("id", c.id);
                          fd.set("archived", String(!c.archived));
                          setMsg(await archive({}, fd));
                          router.refresh();
                        })
                      }
                    >
                      {c.archived ? "Restore" : "Archive"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Drawer>
    </>
  );
}
