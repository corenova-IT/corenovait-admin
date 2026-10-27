"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { CURRENCIES } from "@/components/transactions/types";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { CHANNEL_LABEL, CHANNELS, OUTCOME_LABEL, OUTCOMES, type Channel, type Outcome } from "@/lib/marketing";
import { minorToInput, rateToInput } from "@/lib/money";

type State = { ok?: string; error?: string; savedAt?: number };
type Action = (prev: State, fd: FormData) => Promise<State>;

export type ActivityView = {
  id: string;
  occurredLocal: string;
  channel: Channel;
  campaignId: string | null;
  contactName: string;
  contactCompany: string;
  outcome: Outcome;
  dealValueMinor: number | null;
  dealCurrency: string | null;
  dealFxRateToBase: string | null;
  ownerId: string;
  notes: string | null;
};

export type ActivityLookups = {
  timezone: string;
  baseCurrency: string;
  nowLocal: string;
  campaigns: Array<{ id: string; name: string; status: string; channel: Channel | null }>;
  owners: Array<{ id: string; name: string; email: string }>;
  canChooseOwner: boolean;
  selfId: string;
};

function ActivityForm({ row, lookups, action, onSaved }: { row?: ActivityView; lookups: ActivityLookups; action: Action; onSaved?: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  const base = lookups.baseCurrency;
  const [outcome, setOutcome] = useState<Outcome>(row?.outcome ?? "no_response");
  const [cur, setCur] = useState(row?.dealCurrency ?? base);
  const [channel, setChannel] = useState<Channel>(row?.channel ?? "email");
  useEffect(() => {
    if (state.ok && onSaved) onSaved();
  }, [state, onSaved]);
  // campaigns still running come first; finished ones stay pickable when editing older activity
  const campaigns = lookups.campaigns.filter((c) => c.status !== "finished" || c.id === row?.campaignId);

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="When" htmlFor={`${p}-at`} hint={`Your time zone setting: ${lookups.timezone}`}>
          <Input id={`${p}-at`} name="occurredAt" type="datetime-local" required defaultValue={row?.occurredLocal ?? lookups.nowLocal} max={lookups.nowLocal} />
        </Field>
        <Field label="Channel" htmlFor={`${p}-ch`}>
          <Select id={`${p}-ch`} name="channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Who you contacted" htmlFor={`${p}-name`}>
          <Input id={`${p}-name`} name="contactName" required maxLength={200} defaultValue={row?.contactName} placeholder="Name" autoComplete="off" />
        </Field>
        <Field label="Company" htmlFor={`${p}-co`}>
          <Input id={`${p}-co`} name="contactCompany" maxLength={200} defaultValue={row?.contactCompany} placeholder="Optional" autoComplete="off" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-ink">What happened</legend>
        <div className="flex flex-wrap gap-2">
          {OUTCOMES.map((o) => (
            <label
              key={o}
              className="cursor-pointer rounded-[12px] border border-line px-3 py-2 text-sm text-ink-2 has-checked:border-accent-line has-checked:bg-accent-soft has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-accent-text"
            >
              <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="sr-only" />
              {OUTCOME_LABEL[o]}
            </label>
          ))}
        </div>
      </fieldset>
      {outcome === "deal_won" && (
        <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
          <Field label="Deal value" htmlFor={`${p}-val`} hint="Optional">
            <Input id={`${p}-val`} name="dealValue" inputMode="decimal" className="font-mono" defaultValue={row?.dealValueMinor != null ? minorToInput(row.dealValueMinor) : ""} />
          </Field>
          <Field label="Currency" htmlFor={`${p}-cur`}>
            <Select id={`${p}-cur`} name="dealCurrency" value={cur} onChange={(e) => setCur(e.target.value)}>
              {[...new Set([base, ...CURRENCIES, cur])].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Rate to ${base}`} htmlFor={`${p}-fx`} hint={cur === base ? "Same as base currency" : `1 ${cur} = ? ${base}`}>
            <Input key={cur} id={`${p}-fx`} name="dealFxRate" inputMode="decimal" className="font-mono" readOnly={cur === base} defaultValue={cur === base ? "1" : rateToInput(row?.dealFxRateToBase)} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campaign" htmlFor={`${p}-camp`}>
          <Select id={`${p}-camp`} name="campaignId" defaultValue={row?.campaignId ?? ""}>
            <option value="">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.status === "finished" ? " (finished)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {lookups.canChooseOwner ? (
          <Field label="Owner" htmlFor={`${p}-owner`} hint="Who did the outreach">
            <Select id={`${p}-owner`} name="ownerId" defaultValue={row?.ownerId ?? lookups.selfId}>
              {lookups.owners.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <input type="hidden" name="ownerId" value={row?.ownerId ?? lookups.selfId} />
        )}
      </div>
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" maxLength={5000} rows={3} defaultValue={row?.notes ?? ""} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : row ? "Save changes" : "Log activity"}
      </Button>
    </form>
  );
}

/**
 * The quick "Log activity" panel. After each save the form clears (the panel
 * stays open) so a run of calls can be logged one after another.
 */
export function LogActivity({ lookups, action }: { lookups: ActivityLookups; action: Action }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [last, setLast] = useState<string | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setLast(null);
  }, []);
  // a fresh, empty form after each successful save
  const logged = useCallback<Action>(
    async (prev, fd) => {
      const r = await action(prev, fd);
      if (r.ok) {
        const who = fd.get("contactName");
        setLast(`Logged ${typeof who === "string" && who ? who : "the activity"}. Add the next one, or close this panel.`);
        setRound((n) => n + 1);
      }
      return r;
    },
    [action]
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> Log activity
      </Button>
      <Drawer open={open} onClose={close} wide title="Log activity" description="One call, email, referral or message, and how it went.">
        <div className="flex flex-col gap-5">
          {last && <FormMessage tone="success">{last}</FormMessage>}
          <ActivityForm key={round} lookups={lookups} action={logged} />
        </div>
      </Drawer>
    </>
  );
}

export function ActivityRowActions({ row, label, lookups, canEdit, canDelete, save, remove }: { row: ActivityView; label: string; lookups: ActivityLookups; canEdit: boolean; canDelete: boolean; save: Action; remove: Action }) {
  const [panel, setPanel] = useState<null | "edit" | "delete">(null);
  const close = useCallback(() => setPanel(null), []);
  const [delState, delAction, delPending] = useActionState(remove, {});
  useEffect(() => {
    if (delState.ok) close();
  }, [delState, close]);
  if (!canEdit && !canDelete) return null;
  return (
    <div className="flex flex-nowrap justify-end gap-2">
      {canEdit && (
        <Button size="sm" variant="secondary" onClick={() => setPanel("edit")} aria-label={`Edit ${label}`}>
          Edit
        </Button>
      )}
      {canDelete && (
        <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPanel("delete")} aria-label={`Delete ${label}`}>
          Delete
        </Button>
      )}
      <Drawer open={panel === "edit"} onClose={close} wide title="Edit activity" description={label}>
        <ActivityForm row={row} lookups={lookups} action={save} onSaved={close} />
      </Drawer>
      <Modal open={panel === "delete"} onClose={close} title="Delete this activity?" description={`${label}. It will no longer count in the marketing figures. This can't be undone.`}>
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={row.id} />
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
