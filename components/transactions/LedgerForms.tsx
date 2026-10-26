"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field, FormMessage, Input, Select, Textarea } from "@/components/ui/Field";
import { useKeepValues } from "@/components/ui/useKeepValues";
import { formatMinor, formatRatePercent, minorToInput, rateToInput } from "@/lib/money";
import { CURRENCIES, type ExpenseView, type IncomeView, type LedgerAction, type LedgerState, type Lookups } from "./types";

const empty: LedgerState = {};
const today = () => new Date().toISOString().slice(0, 10);

export function Msg({ state }: { state: LedgerState }) {
  if (state.error)
    return (
      <FormMessage tone="error">
        {state.error}
        {state.errors && (
          <ul className="mt-2 list-disc pl-5 font-mono text-xs leading-relaxed">
            {state.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </FormMessage>
    );
  if (state.ok) return <FormMessage tone="success">{state.ok}</FormMessage>;
  return null;
}

/** Amount + currency + manual exchange rate, with the base-currency value worked out live. */
function MoneyFields({ prefix, base, amount, currency, rate }: { prefix: string; base: string; amount: string; currency: string; rate: string }) {
  const [cur, setCur] = useState(currency || base);
  const [fx, setFx] = useState(cur === base ? "1" : rate);
  const [amt, setAmt] = useState(amount);
  const sameAsBase = cur === base;
  // exact integer maths, rounded half away from zero exactly as MySQL will store it
  const preview = (() => {
    const a = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amt.replace(/,/g, "").trim());
    const r = /^(\d+)(?:\.(\d{1,8}))?$/.exec(fx.trim());
    if (!a || !r) return null;
    const cents = BigInt(a[1]) * 100n + BigInt((a[2] ?? "").padEnd(2, "0"));
    const scaled = BigInt(r[1]) * 100_000_000n + BigInt((r[2] ?? "").padEnd(8, "0"));
    const product = cents * scaled;
    const baseCents = product / 100_000_000n + ((product % 100_000_000n) * 2n >= 100_000_000n ? 1n : 0n);
    return formatMinor(baseCents, base);
  })();
  return (
    <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1fr]">
      <Field label="Amount" htmlFor={`${prefix}-amount`} hint="Up to 2 decimals, e.g. 1250.50">
        <Input id={`${prefix}-amount`} name="amount" inputMode="decimal" required value={amt} onChange={(e) => setAmt(e.target.value)} className="font-mono" />
      </Field>
      <Field label="Currency" htmlFor={`${prefix}-currency`}>
        <Select
          id={`${prefix}-currency`}
          name="currency"
          value={cur}
          onChange={(e) => {
            setCur(e.target.value);
            if (e.target.value === base) setFx("1");
          }}
        >
          {[...new Set([base, ...CURRENCIES, cur])].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={`Rate to ${base}`} htmlFor={`${prefix}-fx`} hint={sameAsBase ? "Same as base currency" : `1 ${cur} = ? ${base}`}>
        <Input id={`${prefix}-fx`} name="fxRate" inputMode="decimal" value={fx} onChange={(e) => setFx(e.target.value)} readOnly={sameAsBase} className="font-mono" />
      </Field>
      {preview && !sameAsBase && (
        <p className="font-mono text-xs text-muted sm:col-span-3">
          Converted: {preview}
        </p>
      )}
    </div>
  );
}

function Attachment({ id, existing, label }: { id: string; existing: string | null; label: string }) {
  return (
    <Field label={label} htmlFor={id} hint="PDF, PNG, JPG or WebP, up to 10 MB. Replaces the current file.">
      <div className="flex flex-col gap-2">
        {existing && (
          <a href={`/api/files/${existing}?download=1`} className="text-sm text-accent-text hover:underline">
            Current file (download)
          </a>
        )}
        <input
          id={id}
          name="attachment"
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          className="text-sm text-ink-2 file:mr-3 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-ink"
        />
      </div>
    </Field>
  );
}

export function IncomeForm({ row, lookups, action, onSaved }: { row?: IncomeView; lookups: Lookups; action: LedgerAction; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, empty);
  const submit = useKeepValues(formAction);
  const p = useId();
  useEffect(() => {
    if (state.ok) onSaved();
  }, [state, onSaved]);
  const streams = lookups.streams.filter((s) => s.active || s.id === row?.streamId);
  const reps = lookups.representatives.filter((r) => r.active || r.id === row?.representativeId);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor={`${p}-date`}>
          <Input id={`${p}-date`} name="entryDate" type="date" required defaultValue={row?.entryDate ?? today()} />
        </Field>
        <Field label="Status" htmlFor={`${p}-status`}>
          <Select id={`${p}-status`} name="status" defaultValue={row?.status ?? "pending"}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
          </Select>
        </Field>
        <Field label="Revenue stream" htmlFor={`${p}-stream`}>
          <Select id={`${p}-stream`} name="streamId" required defaultValue={row?.streamId ?? streams[0]?.id}>
            {streams.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Country" htmlFor={`${p}-country`}>
          <Select id={`${p}-country`} name="countryCode" required defaultValue={row?.countryCode ?? lookups.countries[0]?.code}>
            {lookups.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Client" htmlFor={`${p}-client`}>
          <Input id={`${p}-client`} name="client" maxLength={200} defaultValue={row?.client} />
        </Field>
        <Field label="Invoice reference" htmlFor={`${p}-inv`}>
          <Input id={`${p}-inv`} name="invoiceRef" maxLength={80} defaultValue={row?.invoiceRef ?? ""} className="font-mono" />
        </Field>
      </div>
      <Field label="Description" htmlFor={`${p}-desc`}>
        <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={row?.description} />
      </Field>
      <MoneyFields
        prefix={p}
        base={lookups.baseCurrency}
        amount={row ? minorToInput(row.amountMinor) : ""}
        currency={row?.currency ?? lookups.baseCurrency}
        rate={rateToInput(row?.fxRateToBase)}
      />
      <Field label="Representative" htmlFor={`${p}-rep`} hint="Commission uses their rate at the time the deal is credited.">
        <Select id={`${p}-rep`} name="representativeId" defaultValue={row?.representativeId ?? ""}>
          <option value="">None</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({formatRatePercent(r.commissionRate)})
            </option>
          ))}
        </Select>
      </Field>
      <Attachment id={`${p}-file`} existing={row?.invoiceFileId ?? null} label="Invoice (optional)" />
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" maxLength={5000} defaultValue={row?.notes ?? ""} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : row ? "Save changes" : "Add income"}
      </Button>
    </form>
  );
}

export function ExpenseForm({ row, lookups, action, onSaved }: { row?: ExpenseView; lookups: Lookups; action: LedgerAction; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(action, empty);
  const submit = useKeepValues(formAction);
  const p = useId();
  useEffect(() => {
    if (state.ok) onSaved();
  }, [state, onSaved]);
  return (
    <form action={formAction} onSubmit={submit} className="flex flex-col gap-5">
      <Msg state={state} />
      {row && <input type="hidden" name="id" value={row.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" htmlFor={`${p}-date`}>
          <Input id={`${p}-date`} name="expenseDate" type="date" required defaultValue={row?.expenseDate ?? today()} />
        </Field>
        <Field label="Category" htmlFor={`${p}-cat`} hint="Admins edit this list in Settings">
          <Select id={`${p}-cat`} name="category" required defaultValue={row?.category ?? lookups.categories[0]}>
            {/* an archived category stays selectable on the expense that already uses it */}
            {[...new Set([...lookups.categories, ...(row?.category ? [row.category] : [])])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Vendor" htmlFor={`${p}-vendor`}>
          <Input id={`${p}-vendor`} name="vendor" maxLength={200} defaultValue={row?.vendor} />
        </Field>
        <Field label="Description" htmlFor={`${p}-desc`}>
          <Input id={`${p}-desc`} name="description" maxLength={500} defaultValue={row?.description} />
        </Field>
        <Field label="Country" htmlFor={`${p}-country`} className="sm:col-span-2" hint="Leave as Shared for costs the whole company carries. A country view on Home only counts that country's costs.">
          <Select id={`${p}-country`} name="countryCode" defaultValue={row?.countryCode ?? ""}>
            <option value="">Shared (all countries)</option>
            {lookups.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <MoneyFields
        prefix={p}
        base={lookups.baseCurrency}
        amount={row ? minorToInput(row.amountMinor) : ""}
        currency={row?.currency ?? lookups.baseCurrency}
        rate={rateToInput(row?.fxRateToBase)}
      />
      <label className="flex items-center gap-3 text-[15px] text-ink-2">
        <input type="checkbox" name="isRecurring" defaultChecked={row?.isRecurring} className="size-5 accent-[var(--accent)]" />
        Recurring cost (monthly software, hosting and similar)
      </label>
      <Attachment id={`${p}-file`} existing={row?.receiptFileId ?? null} label="Receipt (optional)" />
      <Field label="Notes" htmlFor={`${p}-notes`}>
        <Textarea id={`${p}-notes`} name="notes" maxLength={5000} defaultValue={row?.notes ?? ""} />
      </Field>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : row ? "Save changes" : "Add expense"}
      </Button>
    </form>
  );
}
