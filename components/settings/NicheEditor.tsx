"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { FormMessage, Input } from "@/components/ui/Field";

type State = { ok?: string; error?: string };
type Action = (p: State, fd: FormData) => Promise<State>;
export type NicheRow = { id: number; name: string; active: boolean; subs: Array<{ id: number; name: string; isCustom: boolean; active: boolean }> };

function SaveForm({ kind, id, nicheId, name, label, action }: { kind: "niche" | "sub"; id?: number; nicheId?: number; name?: string; label: string; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {nicheId ? <input type="hidden" name="nicheId" value={nicheId} /> : null}
      <Input aria-label={label} name="name" defaultValue={name} maxLength={80} required className="w-56" placeholder={id ? undefined : label} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? "Saving…" : id ? "Rename" : "Add"}</Button>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}

function ActiveButton({ kind, id, active, action }: { kind: "niche" | "sub"; id: number; active: boolean; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>{active ? "Archive" : "Restore"}</Button>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
    </form>
  );
}

/** Admin: the kinds of work. Partners also add their own sub-categories when adding a project; archive tidies them. */
export function NicheEditor({ niches, save, toggle }: { niches: NicheRow[]; save: Action; toggle: Action }) {
  return (
    <div className="flex flex-col gap-5">
      {niches.map((n) => (
        <section key={n.id} className="rounded-[14px] border border-line p-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SaveForm kind="niche" id={n.id} name={n.name} label="Niche name" action={save} />
            {!n.active && <Badge tone="amber">Archived</Badge>}
            <ActiveButton kind="niche" id={n.id} active={n.active} action={toggle} />
          </div>
          <ul className="flex flex-col gap-2">
            {n.subs.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3">
                <SaveForm kind="sub" id={s.id} nicheId={n.id} name={s.name} label="Sub-category name" action={save} />
                {s.isCustom && <Badge>Added by a partner</Badge>}
                {!s.active && <Badge tone="amber">Archived</Badge>}
                <ActiveButton kind="sub" id={s.id} active={s.active} action={toggle} />
              </li>
            ))}
            <li>
              <SaveForm kind="sub" nicheId={n.id} label="Add a sub-category" action={save} />
            </li>
          </ul>
        </section>
      ))}
      <div>
        <SaveForm kind="niche" label="Add a niche" action={save} />
      </div>
    </div>
  );
}
