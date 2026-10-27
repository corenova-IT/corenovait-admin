"use client";

import { useActionState, useCallback, useEffect, useId, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { Button } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { EVENT_TYPES, EVENT_TYPE_LABEL, REMINDERS, type EventDetail } from "@/lib/work";

export type CalState = { ok?: string; error?: string };
export type CalAction = (prev: CalState, fd: FormData) => Promise<CalState>;
export type EventLookups = { invitees: Array<{ id: string; name: string }>; selfId: string; timezone: string; defaultStart: string; defaultEnd: string };

export function EventForm({ event, lookups, action, onSaved, date }: { event?: EventDetail; lookups: EventLookups; action: CalAction; onSaved?: () => void; date?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  useEffect(() => {
    if (state.ok && onSaved) onSaved();
  }, [state, onSaved]);
  const start = event?.startLocal ?? (date ? `${date}T09:00` : lookups.defaultStart);
  const end = event?.endLocal ?? (date ? `${date}T10:00` : lookups.defaultEnd);
  const invited = new Set(event ? event.attendees.map((a) => a.id) : [lookups.selfId]);

  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {event && <input type="hidden" name="id" value={event.id} />}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Title" htmlFor={`${p}-title`}>
          <Input id={`${p}-title`} name="title" required maxLength={200} defaultValue={event?.title} placeholder="e.g. Call with Example Dental" />
        </Field>
        <Field label="Type" htmlFor={`${p}-type`}>
          <Select id={`${p}-type`} name="type" defaultValue={event?.type ?? "meeting"}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="allDay" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="size-4 accent-[var(--accent)]" />
        All day
      </label>
      {allDay ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First day" htmlFor={`${p}-sd`}>
            <Input id={`${p}-sd`} name="startDate" type="date" required defaultValue={start.slice(0, 10)} />
          </Field>
          <Field label="Last day" htmlFor={`${p}-ed`}>
            <Input id={`${p}-ed`} name="endDate" type="date" required defaultValue={end.slice(0, 10)} />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts" htmlFor={`${p}-s`} hint={`Times in ${lookups.timezone}`}>
            <Input id={`${p}-s`} name="start" type="datetime-local" required defaultValue={start.length > 10 ? start : `${start}T09:00`} />
          </Field>
          <Field label="Ends" htmlFor={`${p}-e`}>
            <Input id={`${p}-e`} name="end" type="datetime-local" required defaultValue={end.length > 10 ? end : `${end}T10:00`} />
          </Field>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Where" htmlFor={`${p}-loc`} hint="Optional">
          <Input id={`${p}-loc`} name="location" maxLength={300} defaultValue={event?.location} placeholder="Office, address or phone" />
        </Field>
        <Field label="Video link" htmlFor={`${p}-video`} hint="Optional, https://…">
          <Input id={`${p}-video`} name="videoUrl" type="url" maxLength={500} defaultValue={event?.videoUrl} placeholder="https://meet.google.com/…" />
        </Field>
      </div>
      <Field label="Reminder" htmlFor={`${p}-rem`} hint="Sent once notifications arrive (Phase 5); saved now">
        <Select id={`${p}-rem`} name="reminderMinutes" defaultValue={event?.reminderMinutes == null ? (event ? "" : "10") : String(event.reminderMinutes)}>
          {REMINDERS.map((r) => (
            <option key={r.label} value={r.minutes ?? ""}>
              {r.label}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">Who&apos;s invited</legend>
        <div className="grid max-h-52 gap-1 overflow-y-auto rounded-[14px] border border-line p-2 sm:grid-cols-2">
          {lookups.invitees.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
              <input type="checkbox" name="attendeeIds" value={u.id} defaultChecked={invited.has(u.id)} className="size-4 accent-[var(--accent)]" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {u.name}
                {u.id === lookups.selfId ? " (you)" : ""}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Notes" htmlFor={`${p}-desc`}>
        <Textarea id={`${p}-desc`} name="description" rows={3} maxLength={10_000} defaultValue={event?.description ?? ""} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : event ? "Save changes" : "Add event"}
      </Button>
    </form>
  );
}

export function AddEvent({ lookups, action, initialOpen = false }: { lookups: EventLookups; action: CalAction; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> New event
      </Button>
      <Drawer open={open} onClose={close} wide title="New event" description="Invited people see it on their calendar.">
        <EventForm lookups={lookups} action={action} onSaved={close} />
      </Drawer>
    </>
  );
}

const fmtWhen = (e: EventDetail, tz: string) => {
  const d = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  if (e.allDay) return e.startLocal === e.endLocal ? `${d(e.startLocal)}, all day` : `${d(e.startLocal)} – ${d(e.endLocal)}, all day`;
  const sameDay = e.startLocal.slice(0, 10) === e.endLocal.slice(0, 10);
  return `${d(e.startLocal)}, ${e.startLocal.slice(11)} – ${sameDay ? e.endLocal.slice(11) : `${d(e.endLocal)} ${e.endLocal.slice(11)}`} (${tz})`;
};

/** An event's details, with edit and delete for the person who created it (or someone with the "all" scope). */
export function EventPanel({ event, editable, canDelete, lookups, save, remove, onClose }: { event: EventDetail; editable: boolean; canDelete: boolean; lookups: EventLookups; save: CalAction; remove: CalAction; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [delState, delAction, deleting] = useActionState(remove, {});
  useEffect(() => {
    if (delState.ok) onClose();
  }, [delState, onClose]);
  const reminder = REMINDERS.find((r) => r.minutes === event.reminderMinutes)?.label ?? (event.reminderMinutes == null ? "No reminder" : `${event.reminderMinutes} minutes before`);
  return (
    <Drawer open onClose={onClose} wide title={event.title} description={EVENT_TYPE_LABEL[event.type]}>
      {editing ? (
        <EventForm event={event} lookups={lookups} action={save} onSaved={onClose} />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_1fr]">
            <dt className="label-mono">When</dt>
            <dd className="text-ink">{fmtWhen(event, lookups.timezone)}</dd>
            {event.location && (
              <>
                <dt className="label-mono">Where</dt>
                <dd className="text-ink [overflow-wrap:anywhere]">{event.location}</dd>
              </>
            )}
            {event.videoUrl && (
              <>
                <dt className="label-mono">Video</dt>
                <dd className="[overflow-wrap:anywhere]">
                  <a href={event.videoUrl} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">
                    Join the call
                  </a>
                  <span className="ml-2 font-mono text-xs text-muted">{event.videoUrl}</span>
                </dd>
              </>
            )}
            <dt className="label-mono">Invited</dt>
            <dd className="text-ink">{event.attendees.length ? event.attendees.map((a) => a.name).join(", ") : "Nobody else"}</dd>
            <dt className="label-mono">Reminder</dt>
            <dd className="text-ink-2">{reminder}</dd>
            <dt className="label-mono">Created by</dt>
            <dd className="text-ink-2">{event.mine ? "You" : event.createdByName || "A former member"}</dd>
          </dl>
          {event.description && <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-2">{event.description}</p>}
          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            <a href={`/api/calendar/event/${event.id}`} className="inline-flex h-12 items-center rounded-[14px] border border-line bg-surface px-5 text-[15px] font-semibold text-ink hover:border-accent-line">
              Add to my calendar (.ics)
            </a>
            {editable && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {editable && canDelete && (
              <Button variant="ghost" className="text-accent-text" onClick={() => setConfirm(true)}>
                Delete
              </Button>
            )}
          </div>
          {!editable && <p className="text-sm text-muted">Only the person who created this event can change it.</p>}
        </div>
      )}
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Delete this event?" description="It disappears from everyone's calendar. This can't be undone.">
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={event.id} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
            <Button type="submit" variant="danger" disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </form>
      </Modal>
    </Drawer>
  );
}
