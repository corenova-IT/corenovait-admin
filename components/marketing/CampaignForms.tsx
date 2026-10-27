"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { CAMPAIGN_STATUS_LABEL, CAMPAIGN_STATUSES, CHANNEL_LABEL, CHANNELS, type CampaignStatus, type Channel } from "@/lib/marketing";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export type CampaignView = {
  id: string;
  name: string;
  channel: Channel | null;
  status: CampaignStatus;
  startDate: string | null;
  endDate: string | null;
  description: string;
};

function CampaignForm({ campaign, action, onSaved }: { campaign?: CampaignView; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  useEffect(() => {
    if (state.ok) onSaved();
  }, [state, onSaved]);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {campaign && <input type="hidden" name="id" value={campaign.id} />}
      <Field label="Name" htmlFor={`${p}-name`}>
        <Input id={`${p}-name`} name="name" required maxLength={120} defaultValue={campaign?.name} placeholder="e.g. Spring clinic emails" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main channel" htmlFor={`${p}-ch`}>
          <Select id={`${p}-ch`} name="channel" defaultValue={campaign?.channel ?? ""}>
            <option value="">Mixed</option>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" htmlFor={`${p}-st`}>
          <Select id={`${p}-st`} name="status" defaultValue={campaign?.status ?? "active"}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CAMPAIGN_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${p}-start`} hint="Optional">
          <Input id={`${p}-start`} name="startDate" type="date" defaultValue={campaign?.startDate ?? ""} />
        </Field>
        <Field label="Ends" htmlFor={`${p}-end`} hint="Optional">
          <Input id={`${p}-end`} name="endDate" type="date" defaultValue={campaign?.endDate ?? ""} />
        </Field>
      </div>
      <Field label="What it's about" htmlFor={`${p}-desc`}>
        <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={campaign?.description} placeholder="Optional" />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : campaign ? "Save changes" : "Add campaign"}
      </Button>
    </form>
  );
}

export function AddCampaign({ action }: { action: Action }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <IconPlus /> New campaign
      </Button>
      <Drawer open={open} onClose={close} title="New campaign" description="Group activity under a campaign to see its results.">
        <CampaignForm action={action} onSaved={close} />
      </Drawer>
    </>
  );
}

export function CampaignActions({ campaign, canEdit, canDelete, save, remove }: { campaign: CampaignView; canEdit: boolean; canDelete: boolean; save: Action; remove: Action }) {
  const [panel, setPanel] = useState<null | "edit" | "delete">(null);
  const close = useCallback(() => setPanel(null), []);
  const [delState, delAction, delPending] = useActionState(remove, {});
  useEffect(() => {
    if (delState.ok) close();
  }, [delState, close]);
  if (!canEdit && !canDelete) return null;
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setPanel("edit")} aria-label={`Manage campaign ${campaign.name}`}>
        Manage
      </Button>
      <Drawer open={panel === "edit"} onClose={close} title={`Manage ${campaign.name}`}>
        {canDelete && (
          <div className="mb-6 flex flex-wrap items-center gap-2 border-b border-line pb-5">
            <Button size="sm" variant="ghost" className="text-accent-text" onClick={() => setPanel("delete")}>
              Delete campaign
            </Button>
            <span className="text-xs text-muted">Only possible while no activity is logged under it.</span>
          </div>
        )}
        {canEdit && <CampaignForm campaign={campaign} action={save} onSaved={close} />}
      </Drawer>
      <Modal open={panel === "delete"} onClose={close} title={`Delete ${campaign.name}?`} description="A campaign with logged activity can't be deleted; mark it finished instead.">
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={campaign.id} />
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
    </>
  );
}
