"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/Field";

/** The three forms a stream partner uses: expenses, subscriptions and tasks. The server checks everything again. */
export type PartnerState = { ok?: string; error?: string };
export type PartnerAction = (prev: PartnerState, fd: FormData) => Promise<PartnerState>;
export type Choices = {
  streams: Array<{ id: number; name: string }>;
  countries: Array<{ code: string; name: string }>;
  categories: string[];
  projects: Array<{ id: string; name: string; streamId: number }>;
  employees: Array<{ id: string; name: string }>;
  baseCurrency: string;
};

function Msg({ state }: { state: PartnerState }) {
  if (state.error) return <FormMessage tone="error">{state.error}</FormMessage>;
  if (state.ok) return <FormMessage tone="success">{state.ok}</FormMessage>;
  return null;
}

function StreamCountry({ p, c, streamId, countryCode }: { p: string; c: Choices; streamId?: number | null; countryCode?: string | null }) {
  return (
    <>
      <Field label="Stream" htmlFor={`${p}-stream`}>
        <Select id={`${p}-stream`} name="streamId" required defaultValue={streamId ?? c.streams[0]?.id}>
          {c.streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Country" htmlFor={`${p}-country`}>
        <Select id={`${p}-country`} name="countryCode" required defaultValue={countryCode ?? c.countries[0]?.code}>
          {c.countries.map((x) => (
            <option key={x.code} value={x.code}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
}

export type ExpenseRow = { id: string; expenseDate: string; category: string; vendor: string; description: string; amount: string; currency: string; fxRateToBase: string; isRecurring: boolean; streamId: number | null; countryCode: string | null };

export function ExpenseForm({ c, row, action, idPrefix }: { c: Choices; row?: ExpenseRow; action: PartnerAction; idPrefix: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = idPrefix;
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Date" htmlFor={`${p}-date`}>
        <Input id={`${p}-date`} name="expenseDate" type="date" required defaultValue={row?.expenseDate} />
      </Field>
      <Field label="Category" htmlFor={`${p}-cat`}>
        <Select id={`${p}-cat`} name="category" required defaultValue={row?.category ?? c.categories[0]}>
          {c.categories.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </Field>
      <Field label="Vendor" htmlFor={`${p}-vendor`}>
        <Input id={`${p}-vendor`} name="vendor" maxLength={200} defaultValue={row?.vendor} />
      </Field>
      <Field label="Description" htmlFor={`${p}-desc`}>
        <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={row?.description} />
      </Field>
      <Field label="Amount" htmlFor={`${p}-amount`}>
        <Input id={`${p}-amount`} name="amount" inputMode="decimal" required defaultValue={row?.amount} />
      </Field>
      <Field label="Currency" htmlFor={`${p}-cur`}>
        <Input id={`${p}-cur`} name="currency" maxLength={3} required defaultValue={row?.currency ?? c.baseCurrency} />
      </Field>
      <Field label={`Rate to ${c.baseCurrency}`} htmlFor={`${p}-fx`} hint="1 when the currency is the same">
        <Input id={`${p}-fx`} name="fxRate" inputMode="decimal" defaultValue={row?.fxRateToBase ?? "1"} />
      </Field>
      <div className="flex items-end gap-2 pb-2">
        <input id={`${p}-rec`} type="checkbox" name="isRecurring" defaultChecked={row?.isRecurring} className="size-[18px] accent-[var(--accent)]" />
        <label htmlFor={`${p}-rec`} className="text-sm text-ink">Recurring</label>
      </div>
      <StreamCountry p={p} c={c} streamId={row?.streamId} countryCode={row?.countryCode} />
      <div className="flex flex-col gap-3 sm:col-span-2">
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : row ? "Save expense" : "Add expense"}</Button>
      </div>
    </form>
  );
}

export type SubscriptionRow = { id: string; vendor: string; category: string; description: string; amount: string; currency: string; fxRateToBase: string; billingCycle: string; nextDueDate: string; reminderDays: number; paidFrom: string; streamId: number | null; countryCode: string | null };

export function SubscriptionForm({ c, row, action, idPrefix }: { c: Choices; row?: SubscriptionRow; action: PartnerAction; idPrefix: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = idPrefix;
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Paid to" htmlFor={`${p}-vendor`}>
        <Input id={`${p}-vendor`} name="vendor" required maxLength={200} defaultValue={row?.vendor} />
      </Field>
      <Field label="Category" htmlFor={`${p}-cat`}>
        <Select id={`${p}-cat`} name="category" required defaultValue={row?.category ?? c.categories[0]}>
          {c.categories.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </Select>
      </Field>
      <Field label="Description" htmlFor={`${p}-desc`}>
        <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={row?.description} />
      </Field>
      <Field label="Billing" htmlFor={`${p}-cycle`}>
        <Select id={`${p}-cycle`} name="billingCycle" defaultValue={row?.billingCycle ?? "monthly"}>
          {["weekly", "monthly", "quarterly", "yearly", "once"].map((x) => (
            <option key={x} value={x}>{x}</option>
          ))}
        </Select>
      </Field>
      <Field label="Amount" htmlFor={`${p}-amount`}>
        <Input id={`${p}-amount`} name="amount" inputMode="decimal" required defaultValue={row?.amount} />
      </Field>
      <Field label="Currency" htmlFor={`${p}-cur`}>
        <Input id={`${p}-cur`} name="currency" maxLength={3} required defaultValue={row?.currency ?? c.baseCurrency} />
      </Field>
      <Field label={`Rate to ${c.baseCurrency}`} htmlFor={`${p}-fx`}>
        <Input id={`${p}-fx`} name="fxRate" inputMode="decimal" defaultValue={row?.fxRateToBase ?? "1"} />
      </Field>
      <Field label="Next due date" htmlFor={`${p}-due`}>
        <Input id={`${p}-due`} name="nextDueDate" type="date" required defaultValue={row?.nextDueDate} />
      </Field>
      <Field label="Remind me (days before)" htmlFor={`${p}-rem`}>
        <Input id={`${p}-rem`} name="reminderDays" inputMode="numeric" defaultValue={String(row?.reminderDays ?? 3)} />
      </Field>
      <Field label="Paid from" htmlFor={`${p}-from`}>
        <Input id={`${p}-from`} name="paidFrom" maxLength={120} defaultValue={row?.paidFrom} />
      </Field>
      <StreamCountry p={p} c={c} streamId={row?.streamId} countryCode={row?.countryCode} />
      <div className="flex flex-col gap-3 sm:col-span-2">
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : row ? "Save subscription" : "Add subscription"}</Button>
      </div>
    </form>
  );
}

export type TaskRow = { id: string; title: string; description: string; status: string; priority: string; dueDate: string | null; streamId: number | null; projectId: string | null; assigneeId: string | null };

export function TaskForm({ c, row, action, idPrefix }: { c: Choices; row?: TaskRow; action: PartnerAction; idPrefix: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const p = idPrefix;
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      {row && <input type="hidden" name="id" value={row.id} />}
      <Field label="Task" htmlFor={`${p}-title`} className="sm:col-span-2">
        <Input id={`${p}-title`} name="title" required maxLength={200} defaultValue={row?.title} />
      </Field>
      <Field label="Details" htmlFor={`${p}-desc`} className="sm:col-span-2">
        <Textarea id={`${p}-desc`} name="description" rows={3} defaultValue={row?.description} />
      </Field>
      <Field label="Status" htmlFor={`${p}-status`}>
        <Select id={`${p}-status`} name="status" defaultValue={row?.status ?? "todo"}>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="review">Review</option>
          <option value="done">Done</option>
        </Select>
      </Field>
      <Field label="Priority" htmlFor={`${p}-prio`}>
        <Select id={`${p}-prio`} name="priority" defaultValue={row?.priority ?? "medium"}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="urgent">Urgent</option>
        </Select>
      </Field>
      <Field label="Deadline" htmlFor={`${p}-due`}>
        <Input id={`${p}-due`} name="dueDate" type="date" defaultValue={row?.dueDate ?? ""} />
      </Field>
      <Field label="Stream" htmlFor={`${p}-stream`}>
        <Select id={`${p}-stream`} name="streamId" required defaultValue={row?.streamId ?? c.streams[0]?.id}>
          {c.streams.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Assigned to" htmlFor={`${p}-assignee`} hint="One of your employees. If the task has a project, they must be on it." className="sm:col-span-2">
        <Select id={`${p}-assignee`} name="assigneeId" defaultValue={row?.assigneeId ?? ""}>
          <option value="">Nobody</option>
          {c.employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Project" htmlFor={`${p}-project`} hint="Optional. It must be in the same stream." className="sm:col-span-2">
        <Select id={`${p}-project`} name="projectId" defaultValue={row?.projectId ?? ""}>
          <option value="">No project</option>
          {c.projects.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : row ? "Save task" : "Add task"}</Button>
      </div>
    </form>
  );
}

/** Records this payment as a cost and moves the due date on. The date defaults to today. */
export function MarkPaidForm({ id, action }: { id: string; action: PartnerAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <Field label="Paid on" htmlFor={`paid-${id}`} hint="Leave blank for today">
        <Input id={`paid-${id}`} name="paidDate" type="date" />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Recording…" : "Mark as paid"}</Button>
      <div className="basis-full"><Msg state={state} /></div>
    </form>
  );
}

/** Create a project, or rename one. */
export function ProjectForm({ c, row, action, idPrefix }: { c: Choices; row?: { id: string; name: string }; action: PartnerAction; idPrefix: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3" noValidate>
      {row && <input type="hidden" name="id" value={row.id} />}
      {!row && (
        <Field label="Stream" htmlFor={`${idPrefix}-stream`}>
          <Select id={`${idPrefix}-stream`} name="streamId" required defaultValue={c.streams[0]?.id}>
            {c.streams.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </Field>
      )}
      <Field label="Project name" htmlFor={`${idPrefix}-name`} className="min-w-56 flex-1">
        <Input id={`${idPrefix}-name`} name="name" required maxLength={120} defaultValue={row?.name} />
      </Field>
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : row ? "Rename" : "Add project"}</Button>
      <div className="basis-full"><Msg state={state} /></div>
    </form>
  );
}

/** Team visible, and which of the partner's employees are on the project. */
export function ProjectTeamForm({ project, employees, action }: { project: { id: string; teamVisible: boolean; members: string[] }; employees: Array<{ id: string; name: string }>; action: PartnerAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={project.id} />
      <fieldset>
        <legend className="label-mono mb-2">Who is on this project</legend>
        {employees.length === 0 ? (
          <p className="text-sm text-muted">You have no employees yet. Invite some on the My team page.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {employees.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <input id={`pm-${project.id}-${e.id}`} type="checkbox" name="employeeIds" value={e.id} defaultChecked={project.members.includes(e.id)} className="size-[18px] accent-[var(--accent)]" />
                <label htmlFor={`pm-${project.id}-${e.id}`} className="text-sm text-ink">{e.name}</label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <div className="flex items-start gap-2">
        <input id={`tv-${project.id}`} type="checkbox" name="teamVisible" defaultChecked={project.teamVisible} className="mt-0.5 size-[18px] accent-[var(--accent)]" />
        <label htmlFor={`tv-${project.id}`} className="text-sm text-ink">
          Team visible
          <span className="block text-xs text-muted">Off by default. When on, people on this project see each other&apos;s name and whether they are online. Never tasks, chats, hours or costs.</span>
        </label>
      </div>
      <Msg state={state} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : "Save team"}</Button>
    </form>
  );
}

/** Archive or restore a project. */
export function ProjectActiveButton({ id, active, action }: { id: string; active: boolean; action: PartnerAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Saving…" : active ? "Archive this project" : "Restore this project"}</Button>
      <Msg state={state} />
    </form>
  );
}

/** Invite an employee. They always get the Employee role, for this partner only. */
export function InviteEmployeeForm({ action }: { action: PartnerAction }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" noValidate>
      <Field label="Email" htmlFor="emp-email">
        <Input id="emp-email" name="email" type="email" required autoComplete="off" />
      </Field>
      <Field label="Full name" htmlFor="emp-name">
        <Input id="emp-name" name="fullName" required maxLength={120} />
      </Field>
      <Field label="Job title" htmlFor="emp-title" hint="Optional">
        <Input id="emp-title" name="jobTitle" maxLength={120} />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <Msg state={state} />
        <Button type="submit" disabled={pending} className="self-start">{pending ? "Sending invite…" : "Send invite"}</Button>
        <p className="text-xs text-muted">They get an email to choose a password. They can only see their own tasks, projects and hours, never any money.</p>
      </div>
    </form>
  );
}

/** Archive keeps the record but hides it from every list. */
export function ArchiveButton({ id, action, label }: { id: string; action: PartnerAction; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">{pending ? "Archiving…" : label}</Button>
      <Msg state={state} />
    </form>
  );
}
