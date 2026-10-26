"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { CURRENCIES } from "@/components/transactions/types";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { formatMoney } from "@/lib/money";

type State = { ok?: string; error?: string; overpayment?: { owedBaseMinor: number; amountBaseMinor: number } };
type Action = (prev: State, fd: FormData) => Promise<State>;

export type RepView = { id: string; name: string; email: string | null; phone: string | null; commissionPercent: string; userId: string | null; active: boolean };
export type LinkableUser = { id: string; name: string; email: string };

function useCloseOnOk(state: State, close: () => void) {
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
}

function RepForm({ rep, users, action, onSaved }: { rep?: RepView; users: LinkableUser[]; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  useCloseOnOk(state, onSaved);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {rep && <input type="hidden" name="id" value={rep.id} />}
      <Field label="Name" htmlFor={`${p}-name`}>
        <Input id={`${p}-name`} name="name" required maxLength={120} defaultValue={rep?.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor={`${p}-email`}>
          <Input id={`${p}-email`} name="email" type="email" maxLength={254} defaultValue={rep?.email ?? ""} />
        </Field>
        <Field label="Phone" htmlFor={`${p}-phone`}>
          <Input id={`${p}-phone`} name="phone" maxLength={40} defaultValue={rep?.phone ?? ""} />
        </Field>
      </div>
      <Field
        label="Commission (%)"
        htmlFor={`${p}-rate`}
        hint={rep ? "Changing it applies to deals credited from now on. Earlier deals keep the rate they were credited at." : "E.g. 10 or 12.5"}
      >
        <Input id={`${p}-rate`} name="commissionPercent" required inputMode="decimal" defaultValue={rep?.commissionPercent ?? "10"} className="font-mono" />
      </Field>
      <Field label="Portal login (optional)" htmlFor={`${p}-user`} hint="Link the rep's own login so 'assigned' access shows them their deals.">
        <Select id={`${p}-user`} name="userId" defaultValue={rep?.userId ?? ""}>
          <option value="">Not linked</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-3 text-[15px] text-ink-2">
        <input type="checkbox" name="active" defaultChecked={rep?.active ?? true} className="size-5 accent-[var(--accent)]" />
        Active (can be credited with new deals)
      </label>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : rep ? "Save changes" : "Add representative"}
      </Button>
    </form>
  );
}

export function RepButton({ rep, users, action, size }: { rep?: RepView; users: LinkableUser[]; action: Action; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant={rep ? "secondary" : "primary"} size={size ?? (rep ? "sm" : "md")} onClick={() => setOpen(true)} aria-label={rep ? `Edit ${rep.name}` : undefined}>
        {rep ? "Edit" : (
          <>
            <IconPlus /> Add representative
          </>
        )}
      </Button>
      <Drawer open={open} onClose={close} title={rep ? `Edit ${rep.name}` : "Add a representative"}>
        <RepForm rep={rep} users={users} action={action} onSaved={close} />
      </Drawer>
    </>
  );
}

export function PayoutButton({ repId, repName, base, owed, action }: { repId: string; repName: string; base: string; owed: string; action: Action }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const [cur, setCur] = useState(base);
  const p = useId();
  useCloseOnOk(state, close);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> Record payout
      </Button>
      <Drawer open={open} onClose={close} title="Record a payout" description={`Commission paid to ${repName}. Currently owed: ${owed}.`}>
        <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
          <Msg state={state.overpayment ? {} : state} />
          {state.overpayment && (
            <div role="alert" className="flex flex-col gap-3 rounded-[14px] border border-warning/45 bg-warning-soft px-4 py-3 text-sm text-ink">
              <p className="font-semibold">This payout is more than the commission owed.</p>
              <p className="font-mono text-xs text-ink-2">
                Owed now {formatMoney(state.overpayment.owedBaseMinor, base)} · this payout {formatMoney(state.overpayment.amountBaseMinor, base)} · over by{" "}
                {formatMoney(state.overpayment.amountBaseMinor - state.overpayment.owedBaseMinor, base)}
              </p>
              <label className="flex items-start gap-3">
                <input type="checkbox" name="confirmOverpayment" className="mt-0.5 size-5 accent-[var(--accent)]" />
                <span>I confirm this payout is correct. Your name and the amounts are recorded in the audit log.</span>
              </label>
            </div>
          )}
          <input type="hidden" name="representativeId" value={repId} />
          <Field label="Date paid" htmlFor={`${p}-date`}>
            <Input id={`${p}-date`} name="paidDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
            <Field label="Amount" htmlFor={`${p}-amount`}>
              <Input id={`${p}-amount`} name="amount" required inputMode="decimal" className="font-mono" />
            </Field>
            <Field label="Currency" htmlFor={`${p}-cur`}>
              <Select id={`${p}-cur`} name="currency" value={cur} onChange={(e) => setCur(e.target.value)}>
                {[...new Set([base, ...CURRENCIES])].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Rate to ${base}`} htmlFor={`${p}-fx`}>
              <Input key={cur} id={`${p}-fx`} name="fxRate" inputMode="decimal" defaultValue="1" readOnly={cur === base} className="font-mono" />
            </Field>
          </div>
          <Field label="Reference" htmlFor={`${p}-ref`} hint="Bank or transfer reference">
            <Input id={`${p}-ref`} name="reference" maxLength={120} className="font-mono" />
          </Field>
          <Field label="Notes" htmlFor={`${p}-notes`}>
            <Textarea id={`${p}-notes`} name="notes" maxLength={2000} />
          </Field>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Saving…" : state.overpayment ? "Record payout anyway" : "Record payout"}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

export function DeletePayoutButton({ id, label, action }: { id: string; label: string; action: Action }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <>
      <Button variant="ghost" size="sm" className="text-accent-text" onClick={() => setOpen(true)} aria-label={`Delete payout ${label}`}>
        Delete
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Delete this payout?" description={`${label}. The amount goes back into commission owed. The audit log keeps a copy.`}>
        <form action={formAction} className="flex flex-col gap-4">
          <Msg state={state} />
          <input type="hidden" name="id" value={id} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
