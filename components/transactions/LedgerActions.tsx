"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { IconDownload, IconPlus } from "@/components/icons";
import { Button, buttonClass } from "@/components/ui/Button";
import { Drawer, Modal } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { ExpenseForm, IncomeForm, Msg } from "./LedgerForms";
import type { ExpenseView, IncomeView, LedgerAction, LedgerState, Lookups } from "./types";

type Tab = "income" | "expenses";

export function AddEntry({ tab, lookups, saveIncome, saveExpense, initialOpen = false }: { tab: Tab; lookups: Lookups; saveIncome: LedgerAction; saveExpense: LedgerAction; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <IconPlus /> {tab === "income" ? "Add income" : "Add expense"}
      </Button>
      <Drawer
        open={open}
        onClose={close}
        wide
        title={tab === "income" ? "Add income" : "Add expense"}
        description={`Amounts are stored in whole cents; the ${lookups.baseCurrency} value uses the exchange rate you enter.`}
      >
        {tab === "income" ? (
          <IncomeForm lookups={lookups} action={saveIncome} onSaved={close} />
        ) : (
          <ExpenseForm lookups={lookups} action={saveExpense} onSaved={close} />
        )}
      </Drawer>
    </>
  );
}

export function ImportCsv({ tab, action }: { tab: Tab; action: LedgerAction }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [state, formAction, pending] = useActionState(action, {} as LedgerState);
  useEffect(() => {
    if (state.ok) setFormKey((k) => k + 1);
  }, [state]);
  const label = tab === "income" ? "income" : "expenses";
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Import CSV
      </Button>
      <Drawer open={open} onClose={() => setOpen(false)} title={`Import ${label}`} description="Every row is checked first. If any row has a problem, nothing is imported.">
        <form key={formKey} action={formAction} className="flex flex-col gap-5" encType="multipart/form-data">
          <Msg state={state} />
          <input type="hidden" name="kind" value={tab} />
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px] text-ink-2">
            <li>
              <a className="text-accent-text hover:underline" href={`/api/export/transactions?tab=${tab}&template=1`}>
                Download the template
              </a>{" "}
              and fill it in (or export first and edit).
            </li>
            <li>
              {tab === "income"
                ? "Streams, countries and representatives are matched by name. Country can be GB, AU, OTHER or the full name."
                : "Mark recurring costs with yes in the recurring column."}
            </li>
            <li>Save as CSV (comma separated), up to 1,000 rows and 1 MB.</li>
          </ol>
          <Field label="CSV file" htmlFor="csv-file">
            <input
              id="csv-file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="text-sm text-ink-2 file:mr-3 file:rounded-xl file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-ink"
            />
          </Field>
          <Button type="submit" disabled={pending} className="self-start">
            {pending ? "Checking…" : `Import ${label}`}
          </Button>
        </form>
      </Drawer>
    </>
  );
}

export function ExportLink({ href }: { href: string }) {
  return (
    <a href={href} className={buttonClass("secondary")}>
      <IconDownload /> Export CSV
    </a>
  );
}

type RowProps =
  | { tab: "income"; row: IncomeView; label: string }
  | { tab: "expenses"; row: ExpenseView; label: string };

export function RowActions({
  lookups,
  canEdit,
  canDelete,
  save,
  remove,
  ...props
}: RowProps & { lookups: Lookups; canEdit: boolean; canDelete: boolean; save: LedgerAction; remove: LedgerAction }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [delState, delAction, delPending] = useActionState(remove, {} as LedgerState);
  const close = useCallback(() => setEditing(false), []);
  if (!canEdit && !canDelete) return null;
  return (
    <div className="flex justify-end gap-2">
      {canEdit && (
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)} aria-label={`Edit ${props.label}`}>
          Edit
        </Button>
      )}
      {canDelete && (
        <Button variant="ghost" size="sm" className="text-accent-text" onClick={() => setConfirming(true)} aria-label={`Delete ${props.label}`}>
          Delete
        </Button>
      )}
      <Drawer open={editing} onClose={close} wide title={props.tab === "income" ? "Edit income" : "Edit expense"} description={props.label}>
        {props.tab === "income" ? (
          <IncomeForm row={props.row} lookups={lookups} action={save} onSaved={close} />
        ) : (
          <ExpenseForm row={props.row} lookups={lookups} action={save} onSaved={close} />
        )}
      </Drawer>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title={props.tab === "income" ? "Delete this income entry?" : "Delete this expense?"}
        description={`${props.label}. It's removed from every total. The audit log keeps a copy of what it said.`}
      >
        <form action={delAction} className="flex flex-col gap-4">
          <Msg state={delState} />
          <input type="hidden" name="id" value={props.row.id} />
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
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
