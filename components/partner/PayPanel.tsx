"use client";

import { useActionState, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input, Select } from "@/components/ui/Field";

/**
 * Employee pay, for the employee's partner and for admins (never the employee). The actions are passed in:
 * the partner's and the admin's both end up in lib/dal/employee-pay.ts, which checks everything again.
 */
export type PayState = { ok?: string; error?: string };
export type PayAction = (prev: PayState, fd: FormData) => Promise<PayState>;
export type PayPlanRow = {
  id: string;
  kind: "monthly" | "project";
  streamName: string;
  countryCode: string;
  project: string | null;
  amountText: string;
  baseText: string | null;
  startMonth: string | null;
  active: boolean;
  status: "due" | "paid" | null;
  paidDate: string | null;
};
export type PayChoicesView = {
  streams: Array<{ id: number; name: string }>;
  countries: Array<{ code: string; name: string }>;
  projects: Array<{ id: string; name: string; streamId: number }>;
  baseCurrency: string;
};

function Msg({ state }: { state: PayState }) {
  if (state.error) return <FormMessage tone="error">{state.error}</FormMessage>;
  if (state.ok) return <FormMessage tone="success">{state.ok}</FormMessage>;
  return null;
}

function PlanActions({ plan, stop, markPaid }: { plan: PayPlanRow; stop: PayAction; markPaid: PayAction }) {
  const [stopState, stopAction, stopPending] = useActionState(stop, {});
  const [paidState, paidAction, paidPending] = useActionState(markPaid, {});
  return (
    <div className="flex flex-wrap items-center gap-2">
      {plan.kind === "project" && plan.status === "due" && plan.active && (
        <form action={paidAction} className="flex items-center gap-2">
          <input type="hidden" name="planId" value={plan.id} />
          <Input aria-label="Paid on" name="paidDate" type="date" className="w-40" />
          <Button type="submit" size="sm" disabled={paidPending}>{paidPending ? "Saving…" : "Mark as paid"}</Button>
        </form>
      )}
      {plan.active && plan.status !== "paid" && (
        <form action={stopAction}>
          <input type="hidden" name="planId" value={plan.id} />
          <Button type="submit" size="sm" variant="secondary" disabled={stopPending}>{stopPending ? "Stopping…" : "Stop"}</Button>
        </form>
      )}
      <Msg state={paidState} />
      <Msg state={stopState} />
    </div>
  );
}

export function PayPanel({
  employeeId,
  plans,
  choices,
  actions,
}: {
  employeeId: string;
  plans: PayPlanRow[];
  choices: PayChoicesView;
  actions: { add: PayAction; stop: PayAction; markPaid: PayAction };
}) {
  const [state, addAction, pending] = useActionState(actions.add, {});
  const [kind, setKind] = useState<"monthly" | "project">("monthly");
  const id = `pay-${employeeId}`;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="label-mono mb-2">Pay arrangements</h4>
        {plans.length === 0 ? (
          <p className="text-sm text-muted">No pay set yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{p.kind === "monthly" ? "Monthly" : `Project: ${p.project ?? ""}`}</span>
                  <span className="text-ink">{p.amountText}</span>
                  {p.baseText && <span className="text-xs text-muted">({p.baseText})</span>}
                  <span className="text-sm text-muted">{p.streamName} · {p.countryCode}{p.startMonth ? ` · from ${p.startMonth}` : ""}</span>
                  {!p.active && p.status !== "paid" && <Badge tone="amber">Stopped</Badge>}
                  {p.status === "paid" && <Badge tone="green">Paid {p.paidDate}</Badge>}
                  {p.status === "due" && p.active && <Badge>Not paid yet</Badge>}
                </div>
                <PlanActions plan={p} stop={actions.stop} markPaid={actions.markPaid} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <form action={addAction} className="grid gap-4 sm:grid-cols-2" noValidate>
        <input type="hidden" name="employeeId" value={employeeId} />
        <Field label="Pay is" htmlFor={`${id}-kind`}>
          <Select id={`${id}-kind`} name="kind" value={kind} onChange={(e) => setKind(e.target.value as "monthly" | "project")}>
            <option value="monthly">A fixed amount every month</option>
            <option value="project">A fixed amount for one project</option>
          </Select>
        </Field>
        {kind === "project" ? (
          <Field label="Project" htmlFor={`${id}-project`} hint="Their stream is the project's stream.">
            <Select id={`${id}-project`} name="projectId" required defaultValue="">
              <option value="" disabled>Choose a project</option>
              {choices.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Stream" htmlFor={`${id}-stream`}>
            <Select id={`${id}-stream`} name="streamId" required defaultValue={choices.streams[0]?.id}>
              {choices.streams.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Country" htmlFor={`${id}-country`}>
          <Select id={`${id}-country`} name="countryCode" required defaultValue={choices.countries[0]?.code}>
            {choices.countries.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Amount" htmlFor={`${id}-amount`}>
          <Input id={`${id}-amount`} name="amount" inputMode="decimal" required />
        </Field>
        <Field label="Currency" htmlFor={`${id}-cur`}>
          <Input id={`${id}-cur`} name="currency" maxLength={3} required defaultValue={choices.baseCurrency} />
        </Field>
        <Field label={`Rate to ${choices.baseCurrency}`} htmlFor={`${id}-fx`} hint="1 when the currency is the same">
          <Input id={`${id}-fx`} name="fxRate" inputMode="decimal" defaultValue="1" />
        </Field>
        {kind === "monthly" && (
          <Field label="First month" htmlFor={`${id}-start`} hint="Leave blank for this month. Format 2026-03." className="sm:col-span-2">
            <Input id={`${id}-start`} name="startMonth" maxLength={7} placeholder="YYYY-MM" />
          </Field>
        )}
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Msg state={state} />
          <Button type="submit" disabled={pending} className="self-start">{pending ? "Saving…" : "Add pay"}</Button>
          <p className="text-xs text-muted">Pay counts as a cost under that stream. Monthly pay is a cost every month; project pay is a cost once you mark it paid. Every change is logged. The employee never sees it.</p>
        </div>
      </form>
    </div>
  );
}
