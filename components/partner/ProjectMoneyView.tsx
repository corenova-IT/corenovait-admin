import { DeductionsEditor } from "@/components/partner/DeductionsEditor";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { fmtDate } from "@/lib/format";
import { formatMoney, minorToInput } from "@/lib/money";
import type { MoneyEntry, MoneyOverview } from "@/lib/dal/project-money";

type Action = (p: { ok?: string; error?: string }, fd: FormData) => Promise<{ ok?: string; error?: string }>;

/**
 * The revenue overview, shared by a partner (their own streams and countries) and by admins: per project the total
 * amount, what taxes and fees took off it, what was left, what the project cost us, and the profit.
 */
export function ProjectMoneyView({ data, entries, saveDeductions }: { data: MoneyOverview; entries: MoneyEntry[]; saveDeductions: Action }) {
  const base = data.baseCurrency;
  const m = (n: number) => formatMoney(n, base, { cents: false });
  const t = data.totals;
  return (
    <>
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-5">
        <StatCard label="Total amount" value={m(t.grossBaseMinor)} detail="Paid income, before taxes and fees" />
        <StatCard label="Taxes and fees" value={m(t.deductionsBaseMinor)} detail="Deducted from that income" />
        <StatCard label="After taxes and fees" value={m(t.netBaseMinor)} detail="What was left" />
        <StatCard label="Costs" value={m(t.expensesBaseMinor + t.payBaseMinor)} detail={`Expenses ${m(t.expensesBaseMinor)} + employee pay ${m(t.payBaseMinor)}`} />
        <StatCard label="Profit" value={m(t.profitBaseMinor)} noteTone={t.profitBaseMinor < 0 ? "red" : "green"} note="After taxes, fees and all costs" />
      </div>
      {t.pendingBaseMinor > 0 && <p className="mb-4 text-sm text-muted">Income not paid yet (not counted above): {m(t.pendingBaseMinor)}.</p>}

      <Card>
        <CardHeader title="By project" subtitle={`${data.from} to ${data.to} · in ${base}. A project's cost is the pay for people on it plus expenses tagged to it. Monthly salaries (${m(t.payNotInProjectsBaseMinor)}) are not tied to a project, so they are only in the Costs total above.`} />
        {data.rows.length === 0 ? (
          <EmptyState title="No projects yet">Add a project and record some income to see it here.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {data.rows.map((r) => {
              const mine = entries.filter((e) => e.projectId === r.projectId);
              return (
                <li key={r.projectId ?? "none"} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-ink">{r.name}</span>
                          <span className="ml-2 text-sm text-muted">{[r.stream, r.niche && (r.subNiche ? `${r.niche} / ${r.subNiche}` : r.niche), r.leadName && `led by ${r.leadName}`].filter(Boolean).join(" · ")}</span>
                        </span>
                        <span className={r.profitBaseMinor < 0 ? "text-danger-text" : "text-ink"}>Profit {m(r.profitBaseMinor)}</span>
                      </span>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                        <div><dt className="text-muted">Total amount</dt><dd className="text-ink">{r.currencies.length ? r.currencies.map((c) => formatMoney(c.grossMinor, c.currency)).join(" + ") : m(0)}{r.currencies.some((c) => c.currency !== base) && <span className="block text-xs text-muted">{m(r.grossBaseMinor)} in {base}</span>}</dd></div>
                        <div><dt className="text-muted">Taxes and fees</dt><dd className="text-ink">{m(r.deductionsBaseMinor)}</dd></div>
                        <div><dt className="text-muted">After taxes and fees</dt><dd className="text-ink">{m(r.netBaseMinor)}</dd></div>
                        <div><dt className="text-muted">Cost</dt><dd className="text-ink">{m(r.costBaseMinor)}</dd></div>
                      </dl>
                    </summary>
                    <div className="mt-4 flex flex-col gap-4">
                      {mine.length === 0 ? (
                        <p className="text-sm text-muted">No payments in this period.</p>
                      ) : (
                        mine.map((e) => (
                          <div key={e.id} className="rounded-[14px] border border-line p-3">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-ink">{e.client || "Payment"}</span>
                              <span className="text-sm text-muted">{fmtDate(e.date)}</span>
                              <Badge tone={e.status === "paid" ? "green" : e.status === "overdue" ? "red" : "amber"}>{e.status === "paid" ? "Paid" : e.status === "overdue" ? "Overdue" : "Not paid yet"}</Badge>
                              <span className="text-ink">{formatMoney(e.amountMinor, e.currency)}</span>
                              <span className="text-sm text-muted">− {formatMoney(e.deductionsMinor, e.currency)} = {formatMoney(e.netMinor, e.currency)}</span>
                            </div>
                            <details>
                              <summary className="cursor-pointer text-sm text-accent-text">Taxes and fees</summary>
                              <div className="mt-3">
                                <DeductionsEditor entryId={e.id} currency={e.currency} initial={e.items.map((i) => ({ kind: i.kind, label: i.label, amount: minorToInput(i.amountMinor) }))} action={saveDeductions} />
                              </div>
                            </details>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
