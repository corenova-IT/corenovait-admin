import { redirect } from "next/navigation";
import { RestoreButton } from "@/components/partner/RestoreButton";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { listArchived } from "@/lib/dal/archive";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { restoreItem } from "./actions";

export const metadata = { title: "Archived items" };

/** Admin only: archived expenses and tasks, and cancelled subscriptions, with a Restore button. Nothing is ever deleted. */
export default async function ArchivePage() {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const a = await listArchived(actor);
  const empty = a.expenses.length + a.tasks.length + a.subscriptions.length === 0;
  return (
    <>
      <PageHeader title="Archived items" subtitle="Archived expenses and tasks, and cancelled subscriptions · restoring is logged" />
      {empty && (
        <Card>
          <EmptyState title="Nothing archived">When a partner or an admin archives an expense, task or subscription it will show here.</EmptyState>
        </Card>
      )}
      <div className="flex flex-col gap-[var(--space-gap)]">
        {a.expenses.length > 0 && (
          <Card>
            <CardHeader title="Expenses" subtitle="Hidden from lists and totals until restored" />
            <ul className="flex flex-col">
              {a.expenses.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{x.label}</span>
                    <span className="ml-2 text-sm text-muted">{fmtDate(x.date)}{x.stream ? ` · ${x.stream}` : ""}</span>
                  </span>
                  <span className="text-ink">{formatMoney(x.amountMinor, x.currency)}</span>
                  <RestoreButton kind="expense" id={x.id} action={restoreItem} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {a.tasks.length > 0 && (
          <Card>
            <CardHeader title="Tasks" />
            <ul className="flex flex-col">
              {a.tasks.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{x.title}</span>
                    <span className="ml-2 text-sm text-muted">{x.stream ?? "No stream"}{x.dueDate ? ` · due ${fmtDate(x.dueDate)}` : ""}</span>
                  </span>
                  <RestoreButton kind="task" id={x.id} action={restoreItem} />
                </li>
              ))}
            </ul>
          </Card>
        )}
        {a.subscriptions.length > 0 && (
          <Card>
            <CardHeader title="Cancelled subscriptions" subtitle="Restoring makes one active again, with its next due date unchanged" />
            <ul className="flex flex-col">
              {a.subscriptions.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-ink">{x.vendor}</span>
                    <span className="ml-2 text-sm text-muted">{x.stream ?? "Company-wide"} · due {fmtDate(x.nextDueDate)}</span>
                  </span>
                  <span className="text-ink">{formatMoney(x.amountMinor, x.currency)}</span>
                  <RestoreButton kind="subscription" id={x.id} action={restoreItem} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
