"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { IconPlus } from "@/components/icons";
import { Msg } from "@/components/transactions/LedgerForms";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { formatMoney } from "@/lib/money";

type State = { ok?: string; error?: string };
type Action = (prev: State, fd: FormData) => Promise<State>;

export type ProjectItem = {
  id: string;
  name: string;
  streamId: number;
  streamName: string;
  active: boolean;
  entries: number;
  paidBaseMinor: number;
  hiddenFrom: string[];
  /** partners on the project and each one's share, as a percentage string */
  partners: Array<{ representativeId: string; percent: string }>;
};
export type PartnerChoice = { id: string; name: string; active: boolean };
export type PersonItem = { id: string; name: string; email: string; status: "invited" | "active" | "deactivated" };
export type StreamItem = { id: number; name: string };

type Actions = { save: Action; setActive: Action; remove: Action; saveHidden: Action; savePartners: Action };

function useCloseOnOk(state: State, close: () => void) {
  useEffect(() => {
    if (state.ok) close();
  }, [state, close]);
}

function ProjectForm({ project, streams, action, onSaved }: { project?: ProjectItem; streams: StreamItem[]; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const submit = useKeepValues(formAction);
  const p = useId();
  useCloseOnOk(state, onSaved);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {project && <input type="hidden" name="id" value={project.id} />}
      {!project && (
        <Field label="Revenue stream" htmlFor={`${p}-stream`} hint="A project belongs to one stream.">
          <Select id={`${p}-stream`} name="streamId" required defaultValue={streams[0]?.id}>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Project name" htmlFor={`${p}-name`}>
        <Input id={`${p}-name`} name="name" required maxLength={120} defaultValue={project?.name} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : project ? "Save name" : "Add project"}
      </Button>
    </form>
  );
}

function HiddenFromForm({ project, people, action, onSaved }: { project: ProjectItem; people: PersonItem[]; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = useId();
  useCloseOnOk(state, onSaved);
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Msg state={state} />
      <input type="hidden" name="id" value={project.id} />
      <p className="text-sm text-ink-2">
        Tick the people who must <strong className="font-semibold text-ink">not</strong> see this project&apos;s money. For them it disappears from totals, charts, lists, exports, search, invoice downloads and the audit log. You always see everything.
      </p>
      {people.length === 0 ? (
        <p className="rounded-[14px] border border-line px-4 py-3 text-sm text-muted">There&apos;s nobody else on the team yet. Invite people from Team &amp; permissions first.</p>
      ) : (
        <fieldset className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
          <legend className="sr-only">People who can&apos;t see {project.name}</legend>
          {people.map((u) => (
            <label key={u.id} htmlFor={`${p}-${u.id}`} className="flex items-center gap-3 px-4 py-3 text-[15px] text-ink-2">
              <input id={`${p}-${u.id}`} type="checkbox" name="userId" value={u.id} defaultChecked={project.hiddenFrom.includes(u.id)} className="size-5 accent-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block truncate font-medium text-ink">{u.name || u.email}</span>
                <span className="block truncate text-xs text-muted">
                  {u.name ? u.email : ""}
                  {u.status === "active" ? "" : `${u.name ? " · " : ""}${u.status}`}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save who can't see it"}
      </Button>
    </form>
  );
}

/** A one-button form (switch on/off, delete) with its own result message. */
function QuickAction({ action, fields, label, tone = "secondary", confirm }: { action: Action; fields: Record<string, string>; label: string; tone?: "secondary" | "danger"; confirm?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={tone === "danger" ? "secondary" : "secondary"} size="sm" disabled={pending}>
        {pending ? "…" : label}
      </Button>
      {state.error && (
        <p role="alert" className="max-w-[16rem] text-xs text-danger-text">
          {state.error}
        </p>
      )}
    </form>
  );
}

function PartnersForm({ project, choices, action, onSaved }: { project: ProjectItem; choices: PartnerChoice[]; action: Action; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = useId();
  const counter = useRef(project.partners.length);
  const [rows, setRows] = useState(() => project.partners.map((x, i) => ({ key: `r${i}`, repId: x.representativeId, percent: x.percent })));
  useCloseOnOk(state, onSaved);
  const total = Math.round(rows.reduce((a, r) => a + (Number(r.percent) || 0), 0) * 100) / 100;
  const over = total > 100;
  const patch = (key: string, change: Partial<{ repId: string; percent: string }>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Msg state={state} />
      <input type="hidden" name="id" value={project.id} />
      <p className="text-sm text-ink-2">
        Each partner earns their share of this project&apos;s income once it&apos;s marked paid. Partners only ever see their own share: never the total, the client, each other, or what&apos;s left for the company.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-[14px] border border-line px-4 py-3 text-sm text-muted">No partners on this project yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.key} className="flex flex-wrap items-end gap-3">
              <Field label={i === 0 ? "Partner" : "Another partner"} htmlFor={`${p}-${r.key}-rep`} className="min-w-48 flex-1">
                <Select id={`${p}-${r.key}-rep`} name="repId" value={r.repId} onChange={(e) => patch(r.key, { repId: e.target.value })}>
                  <option value="">Choose…</option>
                  {choices
                    .filter((c) => (c.active || c.id === r.repId) && (c.id === r.repId || !rows.some((o) => o.repId === c.id)))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.active ? "" : " (switched off)"}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Share (%)" htmlFor={`${p}-${r.key}-pct`} className="w-32">
                <Input id={`${p}-${r.key}-pct`} name="percent" inputMode="decimal" value={r.percent} onChange={(e) => patch(r.key, { percent: e.target.value })} className="font-mono" placeholder="e.g. 30" />
              </Field>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))} aria-label="Remove this partner">
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            counter.current += 1;
            setRows((all) => [...all, { key: `r${counter.current}`, repId: "", percent: "" }]);
          }}
          disabled={rows.length >= choices.filter((c) => c.active).length + rows.filter((r) => choices.find((c) => c.id === r.repId && !c.active)).length}
        >
          <IconPlus /> Add a partner
        </Button>
        {choices.length === 0 && <p className="mt-2 text-sm text-muted">There are no representatives yet. Add the partner under Representatives first.</p>}
      </div>
      {rows.length > 0 && (
        <p role="status" className={over ? "text-sm font-semibold text-danger-text" : "text-sm text-ink-2"}>
          {over ? `The shares add up to ${total}%. They can't be more than 100%.` : `Partners get ${total}% in total. The company keeps ${Math.round((100 - total) * 100) / 100}%.`}
        </p>
      )}
      {project.entries > 0 && (
        <label className="flex items-start gap-3 text-[15px] text-ink-2">
          <input type="checkbox" name="applyToExisting" className="mt-0.5 size-5 accent-[var(--accent)]" />
          <span>
            Also apply to the {project.entries} {project.entries === 1 ? "entry" : "entries"} already in this project.
            <span className="block text-sm text-muted">Leave this off and existing entries keep the shares they were filed with, so past earnings don&apos;t change.</span>
          </span>
        </label>
      )}
      <Button type="submit" disabled={pending || over} className="self-start">
        {pending ? "Saving…" : "Save partners"}
      </Button>
    </form>
  );
}

function ProjectRow({
  project,
  people,
  choices,
  streams,
  base,
  actions,
}: {
  project: ProjectItem;
  people: PersonItem[];
  choices: PartnerChoice[];
  streams: StreamItem[];
  base: string;
  actions: Actions;
}) {
  const [rename, setRename] = useState(false);
  const [access, setAccess] = useState(false);
  const [partners, setPartners] = useState(false);
  const closeRename = useCallback(() => setRename(false), []);
  const closeAccess = useCallback(() => setAccess(false), []);
  const closePartners = useCallback(() => setPartners(false), []);
  const hiddenCount = project.hiddenFrom.length;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-[1_1_16rem]">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span className="[overflow-wrap:anywhere]">{project.name}</span>
          {!project.active && <Badge>Switched off</Badge>}
          {hiddenCount > 0 && <Badge tone="amber">Hidden from {hiddenCount}</Badge>}
          {project.partners.length > 0 && <Badge tone="green">{project.partners.length} {project.partners.length === 1 ? "partner" : "partners"}</Badge>}
        </p>
        <p className="mt-0.5 text-sm text-muted">
          {project.entries} {project.entries === 1 ? "entry" : "entries"} · paid {formatMoney(project.paidBaseMinor, base, { cents: false })}
        </p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <Button variant="secondary" size="sm" onClick={() => setPartners(true)} aria-label={`Partners and shares for ${project.name}`}>
          Partners &amp; shares
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setAccess(true)} aria-label={`Choose who can't see ${project.name}`}>
          Who can&apos;t see it
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setRename(true)} aria-label={`Rename ${project.name}`}>
          Rename
        </Button>
        <QuickAction action={actions.setActive} fields={{ id: project.id, active: project.active ? "0" : "1" }} label={project.active ? "Switch off" : "Switch on"} />
        {project.entries === 0 && <QuickAction action={actions.remove} fields={{ id: project.id }} label="Delete" tone="danger" confirm={`Delete the empty project "${project.name}"?`} />}
      </div>
      <Drawer open={partners} onClose={closePartners} title={`Partners on ${project.name}`} description="Who shares in this project's income, and how much each gets.">
        {partners && <PartnersForm project={project} choices={choices} action={actions.savePartners} onSaved={closePartners} />}
      </Drawer>
      <Drawer open={rename} onClose={closeRename} title={`Rename ${project.name}`}>
        <ProjectForm project={project} streams={streams} action={actions.save} onSaved={closeRename} />
      </Drawer>
      <Drawer open={access} onClose={closeAccess} title={`Who can't see ${project.name}`} description="Applies to this project's income only.">
        <HiddenFromForm project={project} people={people} action={actions.saveHidden} onSaved={closeAccess} />
      </Drawer>
    </li>
  );
}

export function AddProjectButton({ streams, action }: { streams: StreamItem[]; action: Action }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={streams.length === 0}>
        <IconPlus /> Add project
      </Button>
      <Drawer open={open} onClose={close} title="Add a project">
        <ProjectForm streams={streams} action={action} onSaved={close} />
      </Drawer>
    </>
  );
}

export function ProjectsManager({
  projects,
  people,
  choices,
  streams,
  base,
  actions,
}: {
  projects: ProjectItem[];
  people: PersonItem[];
  choices: PartnerChoice[];
  streams: StreamItem[];
  base: string;
  actions: Actions;
}) {
  const byStream = streams.map((s) => ({ stream: s, items: projects.filter((p) => p.streamId === s.id) })).filter((g) => g.items.length > 0);
  if (byStream.length === 0) return null;
  return (
    <div className="flex flex-col gap-[var(--space-gap)]">
      {byStream.map(({ stream, items }) => (
        <section key={stream.id} aria-labelledby={`stream-${stream.id}`} className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <h2 id={`stream-${stream.id}`} className="border-b border-line px-5 py-3 font-display text-lg font-bold tracking-[-0.01em] text-ink">
            {stream.name}
          </h2>
          <ul className="divide-y divide-line">
            {items.map((p) => (
              <ProjectRow key={p.id} project={p} people={people} choices={choices} streams={streams} base={base} actions={actions} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
