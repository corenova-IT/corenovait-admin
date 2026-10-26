"use client";

import { useActionState, useEffect, useState } from "react";
import { Msg } from "@/components/transactions/LedgerForms";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;
export type ListKind = "stream" | "country" | "category";
export type ListItem = { id?: number; code?: string; name: string; sort: number; active?: boolean; uses: number };

const NOUN: Record<ListKind, string> = { stream: "stream", country: "country", category: "category" };

function Row({ kind, item, actions }: { kind: ListKind; item: ListItem; actions: { save: Action; toggle: Action; remove: Action } }) {
  const [saveState, saveAction, saving] = useActionState(actions.save, {});
  const [toggleState, toggleAction, toggling] = useActionState(actions.toggle, {});
  const [delState, delAction, deleting] = useActionState(actions.remove, {});
  const [confirm, setConfirm] = useState(false);
  const submit = useKeepValues(saveAction);
  const label = item.code ? `${item.name} (${item.code})` : item.name;
  const archived = item.active === false;
  const msg = saveState.error || toggleState.error ? { error: saveState.error ?? toggleState.error } : saveState.ok ? { ok: saveState.ok } : {};

  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <form action={saveAction} onSubmit={submit} className="flex min-w-0 flex-1 flex-wrap items-center gap-2" aria-label={`Edit ${label}`}>
          <input type="hidden" name="kind" value={kind} />
          {item.id && <input type="hidden" name="id" value={item.id} />}
          {item.code && <input type="hidden" name="code" value={item.code} />}
          {kind === "country" && <span className="w-16 rounded-lg border border-line px-2 py-1 text-center font-mono text-xs text-ink-2">{item.code}</span>}
          <Input name="name" defaultValue={item.name} required maxLength={80} aria-label={`Name for ${label}`} className="h-10 min-w-[160px] flex-1" />
          <Input name="sort" defaultValue={item.sort} type="number" min={0} max={32000} aria-label={`Order for ${label}`} className="h-10 w-20 font-mono" title="Order (lower shows first)" />
          <Button type="submit" size="sm" variant="secondary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </form>
        <span className="font-mono text-xs text-muted" title="Records using it">
          {item.uses} in use
        </span>
        {archived && <Badge>Archived</Badge>}
        {item.active !== undefined && (
          <form action={toggleAction}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="active" value={archived ? "true" : "false"} />
            <Button type="submit" size="sm" variant="ghost" disabled={toggling} aria-label={`${archived ? "Restore" : "Archive"} ${label}`}>
              {archived ? "Restore" : "Archive"}
            </Button>
          </form>
        )}
        {item.uses === 0 && (
          <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setConfirm(true)} aria-label={`Delete ${label}`}>
            Delete
          </Button>
        )}
      </div>
      {(msg.error || msg.ok) && <Msg state={msg} />}
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Delete ${label}?`} description={`Nothing uses this ${NOUN[kind]}, so it can be removed. The audit log keeps a copy.`}>
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="kind" value={kind} />
          {item.id && <input type="hidden" name="id" value={item.id} />}
          {item.code && <input type="hidden" name="code" value={item.code} />}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={deleting}>
              Delete
            </Button>
          </div>
        </form>
      </Modal>
    </li>
  );
}

function AddRow({ kind, save }: { kind: ListKind; save: Action }) {
  const [state, action, pending] = useActionState(save, {});
  const [formKey, setFormKey] = useState(0);
  const submit = useKeepValues(action);
  // empty the fields after a successful add; keep them after an error
  useEffect(() => {
    if (state.ok) setFormKey((k) => k + 1);
  }, [state]);
  return (
    <form key={formKey} action={action} onSubmit={submit} className="flex flex-col gap-2 rounded-[14px] border border-dashed border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="isNew" value="1" />
        {kind === "country" && <Input name="code" required maxLength={8} placeholder="Code, e.g. NZ" aria-label="New country code" className="h-10 w-28 font-mono uppercase" />}
        <Input name="name" required maxLength={80} placeholder={`New ${NOUN[kind]} name`} aria-label={`New ${NOUN[kind]} name`} className="h-10 min-w-[160px] flex-1" />
        <Input name="sort" type="number" min={0} max={32000} defaultValue={100} aria-label="Order" className="h-10 w-20 font-mono" title="Order (lower shows first)" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : `Add ${NOUN[kind]}`}
        </Button>
      </div>
      <Msg state={state} />
    </form>
  );
}

export function ListEditor({ kind, items, actions }: { kind: ListKind; items: ListItem[]; actions: { save: Action; toggle: Action; remove: Action } }) {
  return (
    <div className="flex flex-col gap-4">
      <AddRow kind={kind} save={actions.save} />
      <ul className="flex flex-col divide-y divide-line">
        {items.map((it) => (
          <Row key={it.id ?? it.code} kind={kind} item={it} actions={actions} />
        ))}
      </ul>
    </div>
  );
}
