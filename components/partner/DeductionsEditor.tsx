"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FormMessage, Input, Select } from "@/components/ui/Field";

type State = { ok?: string; error?: string };
type Action = (p: State, fd: FormData) => Promise<State>;
export type DeductionItem = { kind: "platform" | "withdrawal" | "vat_transfer" | "other"; label: string; amount: string };

const KINDS: Array<[DeductionItem["kind"], string]> = [
  ["platform", "Platform fee (Upwork, Fiverr…)"],
  ["withdrawal", "Withdrawal tax"],
  ["vat_transfer", "VAT or transfer charge"],
  ["other", "Other"],
];

/**
 * Taxes and fees on one payment: the platform's cut, a withdrawal tax, VAT or a transfer charge, and any other
 * deduction with its own name. Amounts are in the payment's own currency. The server checks everything again.
 */
export function DeductionsEditor({ entryId, currency, initial, action }: { entryId: string; currency: string; initial: DeductionItem[]; action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [rows, setRows] = useState<DeductionItem[]>(initial.length ? initial : [{ kind: "platform", label: "", amount: "" }]);
  const update = (i: number, patch: Partial<DeductionItem>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="entryId" value={entryId} />
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label="Kind of deduction" name="kind" value={r.kind} onChange={(e) => update(i, { kind: e.target.value as DeductionItem["kind"] })} className="w-64">
              {KINDS.map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </Select>
            <Input aria-label="Name (for other)" name="label" value={r.kind === "other" ? r.label : ""} disabled={r.kind !== "other"} onChange={(e) => update(i, { label: e.target.value })} placeholder={r.kind === "other" ? "Name, e.g. Bank charge" : ""} maxLength={80} className="w-48" />
            <Input aria-label={`Amount in ${currency}`} name="amount" inputMode="decimal" value={r.amount} onChange={(e) => update(i, { amount: e.target.value })} placeholder={`Amount (${currency})`} className="w-36" />
            <Button type="button" size="sm" variant="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>Remove</Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={() => setRows((x) => [...x, { kind: "other", label: "", amount: "" }])}>Add another deduction</Button>
        <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save taxes and fees"}</Button>
      </div>
      {state.error && <FormMessage tone="error">{state.error}</FormMessage>}
      {state.ok && <FormMessage tone="success">{state.ok}</FormMessage>}
      <p className="text-xs text-muted">Enter what was really taken off this payment. Leave a row blank to ignore it, or remove every row to clear the deductions. Every change is logged.</p>
    </form>
  );
}
