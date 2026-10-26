"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { CURRENCIES } from "@/components/transactions/types";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { minorToInput, rateToInput } from "@/lib/money";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export type SubView = {
  id: string;
  vendor: string;
  category: string;
  description: string;
  amountMinor: number;
  currency: string;
  fxRateToBase: string;
  billingCycle: "weekly" | "monthly" | "quarterly" | "yearly" | "once";
  nextDueDate: string;
  status: "active" | "paused" | "cancelled" | "completed";
  reminderDays: number;
  paidFrom: string;
  responsibleUserId: string | null;
  countryCode: string | null;
  notes: string | null;
};

export type PaymentLookups = {
  categories: string[];
  countries: Array<{ code: string; name: string }>;
  people: Array<{ id: string; name: string; email: string }>;
  baseCurrency: string;
  today: string;
};

function SubscriptionForm({ sub, lookups, action, onSaved }: { sub?: SubView; lookups: PaymentLookups; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  const base = lookups.baseCurrency;
  const [cur, setCur] = useState(sub?.currency ?? base);
  useEffect(() => {
    if (state.ok) onSaved();
  }, [state, onSaved]);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {sub && <input type="hidden" name="id" value={sub.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid to" htmlFor={`${p}-vendor`}>
          <Input id={`${p}-vendor`} name="vendor" required maxLength={200} defaultValue={sub?.vendor} placeholder="e.g. Hostinger" />
        </Field>
        <Field label="Category" htmlFor={`${p}-cat`}>
          <Select id={`${p}-cat`} name="category" defaultValue={sub?.category ?? lookups.categories[0]}>
            {[...new Set([...lookups.categories, ...(sub ? [sub.category] : [])])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description" htmlFor={`${p}-desc`}>
        <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={sub?.description} placeholder="e.g. Business hosting plan" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
        <Field label="Amount each time" htmlFor={`${p}-amount`}>
          <Input id={`${p}-amount`} name="amount" required inputMode="decimal" className="font-mono" defaultValue={sub ? minorToInput(sub.amountMinor) : ""} />
        </Field>
        <Field label="Currency" htmlFor={`${p}-cur`}>
          <Select id={`${p}-cur`} name="currency" value={cur} onChange={(e) => setCur(e.target.value)}>
            {[...new Set([base, ...CURRENCIES, cur])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={`Rate to ${base}`} htmlFor={`${p}-fx`} hint={cur === base ? "Same as base currency" : `1 ${cur} = ? ${base}`}>
          <Input key={cur} id={`${p}-fx`} name="fxRate" inputMode="decimal" defaultValue={cur === base ? "1" : rateToInput(sub?.fxRateToBase)} readOnly={cur === base} className="font-mono" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Billing" htmlFor={`${p}-cycle`}>
          <Select id={`${p}-cycle`} name="billingCycle" defaultValue={sub?.billingCycle ?? "monthly"}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
            <option value="once">One-off</option>
          </Select>
        </Field>
        <Field label="Next due" htmlFor={`${p}-due`}>
          <Input id={`${p}-due`} name="nextDueDate" type="date" required defaultValue={sub?.nextDueDate ?? lookups.today} />
        </Field>
        <Field label="Remind (days before)" htmlFor={`${p}-rem`}>
          <Input id={`${p}-rem`} name="reminderDays" type="number" min={0} max={90} defaultValue={sub?.reminderDays ?? 3} className="font-mono" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Paid from" htmlFor={`${p}-from`} hint="Card or account">
          <Input id={`${p}-from`} name="paidFrom" maxLength={120} defaultValue={sub?.paidFrom} placeholder="e.g. Company Visa" />
        </Field>
        <Field label="Who looks after it" htmlFor={`${p}-who`}>
          <Select id={`${p}-who`} name="responsibleUserId" defaultValue={sub?.responsibleUserId ?? ""}>
            <option value="">No one in particular</option>
            {lookups.people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Country" htmlFor={`${p}-country`}>
          <Select id={`${p}-country`} name="countryCode" defaultValue={sub?.countryCode ?? ""}>
            <option value="">Shared</option>
            {lookups.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" maxLength={5000} defaultValue={sub?.notes ?? ""} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : sub ? "Save changes" : "Add payment"}
      </Button>
    </form>
  );
}

export function AddSubscription({ lookups, action }: { lookups: PaymentLookups; action: Action }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> Add payment
      </Button>
      <Drawer open={open} onClose={close} wide title="Add a subscription or payment" description="Recurring costs like hosting and software, or a one-off payment that's coming up.">
        <SubscriptionForm lookups={lookups} action={action} onSaved={close} />
      </Drawer>
    </>
  );
}

/** Edit, mark paid, pause/resume, cancel and delete for one subscription. */
export function SubscriptionActions({
  sub,
  lookups,
  can,
  actions,
}: {
  sub: SubView;
  lookups: PaymentLookups;
  can: { edit: boolean; delete: boolean };
  actions: { save: Action; setStatus: Action; markPaid: Action; remove: Action };
}) {
  const [panel, setPanel] = useState<null | "edit" | "paid" | "cancel" | "delete">(null);
  const close = useCallback(() => setPanel(null), []);
  const [paidState, paidAction, paidPending] = useActionState(actions.markPaid, {});
  const [statusState, statusAction, statusPending] = useActionState(actions.setStatus, {});
  const [delState, delAction, delPending] = useActionState(actions.remove, {});
  useEffect(() => {
    if (paidState.ok || statusState.ok) close();
  }, [paidState, statusState, close]);
  if (!can.edit && !can.delete) return null;
  const live = sub.status === "active";
  const ended = sub.status === "cancelled" || sub.status === "completed";

  return (
    <div className="flex flex-nowrap justify-end gap-2">
      {can.edit && live && (
        <Button size="sm" onClick={() => setPanel("paid")} aria-label={`Mark ${sub.vendor} as paid`}>
          Mark paid
        </Button>
      )}
      {can.edit && !ended && (
        <Button size="sm" variant="secondary" onClick={() => setPanel("edit")} aria-label={`Manage ${sub.vendor}`}>
          Manage
        </Button>
      )}
      {ended && can.delete && (
        <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPanel("delete")} aria-label={`Delete ${sub.vendor}`}>
          Delete
        </Button>
      )}

      <Drawer open={panel === "edit"} onClose={close} wide title={`Manage ${sub.vendor}`}>
        <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-5">
          <form action={statusAction}>
            <input type="hidden" name="id" value={sub.id} />
            <input type="hidden" name="status" value={live ? "paused" : "active"} />
            <Button type="submit" size="sm" variant="secondary" disabled={statusPending}>
              {live ? "Pause payments" : "Resume payments"}
            </Button>
          </form>
          <Button size="sm" variant="ghost" onClick={() => setPanel("cancel")}>
            Cancel subscription
          </Button>
          {can.delete && (
            <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPanel("delete")}>
              Delete
            </Button>
          )}
          {statusState.error && <p className="w-full text-xs text-accent-text">{statusState.error}</p>}
        </div>
        <SubscriptionForm sub={sub} lookups={lookups} action={actions.save} onSaved={close} />
      </Drawer>

      <Modal open={panel === "paid"} onClose={close} title={`Mark ${sub.vendor} as paid?`} description={`This adds an expense for the amount and moves the next due date on (from ${sub.nextDueDate}).`}>
        <form action={paidAction} className="flex flex-col gap-4">
          <Msg state={paidState} />
          <input type="hidden" name="id" value={sub.id} />
          <Field label="Date paid" htmlFor={`paid-${sub.id}`}>
            <Input id={`paid-${sub.id}`} name="paidDate" type="date" required defaultValue={lookups.today} />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={close}>
              Not now
            </Button>
            <Button type="submit" disabled={paidPending}>
              {paidPending ? "Saving…" : "Mark as paid"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={panel === "cancel"} onClose={close} title={`Cancel ${sub.vendor}?`} description="It stops appearing in upcoming payments and the monthly total. Expenses already recorded are kept. This can't be undone; add it again if needed.">
        <form action={statusAction} className="flex justify-end gap-3">
          <input type="hidden" name="id" value={sub.id} />
          <input type="hidden" name="status" value="cancelled" />
          <Button variant="ghost" onClick={close}>
            Keep it
          </Button>
          <Button type="submit" variant="danger" disabled={statusPending}>
            Cancel subscription
          </Button>
        </form>
      </Modal>

      <Modal open={panel === "delete"} onClose={close} title={`Delete ${sub.vendor}?`} description="Removes it completely. Expenses already recorded from it are kept. The audit log keeps a copy.">
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={sub.id} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={close}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" disabled={delPending}>
              {delPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
