import Link from "next/link";
import { ArchiveButton, ExpenseForm } from "@/components/partner/PartnerForms";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myExpenses, myFormChoices } from "@/lib/dal/partner-writes";
import { fmtDate } from "@/lib/format";
import { formatMoney, minorToInput, rateToInput } from "@/lib/money";
import { archiveExpense, saveExpense } from "../actions";

export const metadata = { title: "My expenses" };

/** A stream partner's expenses in their own streams and countries. Archiving hides one; nothing is deleted. */
export default async function MyExpensesPage() {
  const actor = await requirePerm("stream_partner");
  const [rows, c] = await Promise.all([myExpenses(actor), myFormChoices(actor)]);
  return (
    <>
      <PageHeader title="My expenses" subtitle="Costs in your streams and countries" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      {!c.hasData ? (
        <Card>
          <EmptyState title="Nothing to show yet">You need at least one stream and one country before you can add expenses. Ask an admin.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-[var(--space-gap)]">
          <Card>
            <CardHeader title="Add an expense" />
            <div className="p-5 pt-0">
              <ExpenseForm c={c} action={saveExpense} idPrefix="new-exp" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Your expenses" subtitle={`${rows.length} shown, newest first`} />
            {rows.length === 0 ? (
              <EmptyState title="No expenses yet">Add your first one above.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <li key={r.id} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-ink">{r.vendor || r.category}</span>
                          <span className="ml-2 text-sm text-muted">
                            {fmtDate(r.expenseDate)} · {r.category}
                          </span>
                        </span>
                        <span className="text-ink">
                          {formatMoney(r.amountMinor, r.currency)}
                          {r.currency !== c.baseCurrency && <span className="ml-1 text-xs text-muted">({formatMoney(r.amountBaseMinor, c.baseCurrency)})</span>}
                        </span>
                      </summary>
                      <div className="mt-4 flex flex-col gap-4">
                        <ExpenseForm
                          c={c}
                          action={saveExpense}
                          idPrefix={`exp-${r.id}`}
                          row={{
                            id: r.id,
                            expenseDate: r.expenseDate,
                            category: r.category,
                            vendor: r.vendor,
                            description: r.description,
                            amount: minorToInput(r.amountMinor),
                            currency: r.currency,
                            fxRateToBase: rateToInput(r.fxRateToBase),
                            isRecurring: r.isRecurring,
                            streamId: r.streamId,
                            countryCode: r.countryCode,
                          }}
                        />
                        <ArchiveButton id={r.id} action={archiveExpense} label="Archive this expense" />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
