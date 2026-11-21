import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { myDashboard, type DashboardData, type StreamFigures } from "@/lib/dal/partner-dashboard";
import { myAssignments } from "@/lib/dal/stream-partners";
import { dueLabel, fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "My dashboard" };

type Payment = DashboardData["upcomingPayments"][number];
type Task = DashboardData["tasks"]["upcoming"][number];

/** A partner's own page. Everything on it comes through lib/dal/scope.ts: only their streams and countries. */
export default async function MyDashboardPage() {
  const actor = await requirePerm("stream_partner");
  const [mine, d] = await Promise.all([myAssignments(actor), myDashboard(actor)]);
  const base = d.baseCurrency;
  const money = (minor: number) => formatMoney(minor, base, { cents: false });

  if (!d.hasData) {
    return (
      <>
        <PageHeader title="My dashboard" subtitle="The streams and countries you run" />
        <Card>
          <EmptyState title="Nothing to show yet">
            {mine.streams.length === 0
              ? "An admin hasn't given you a stream yet. Once they do, and give you at least one country, your numbers will appear here."
              : "An admin hasn't given you a country yet. You'll see your data here as soon as they do."}
          </EmptyState>
        </Card>
      </>
    );
  }

  const o = d.overall;
  const streamColumns: Column<StreamFigures>[] = [
    { key: "stream", header: "Stream", cell: (s) => <span className="font-semibold text-ink">{s.stream}</span> },
    { key: "rev", header: "Revenue this month", align: "right", cell: (s) => money(s.revenueMonthBaseMinor) },
    { key: "pending", header: "Still to come", align: "right", hideBelow: "md", cell: (s) => money(s.pendingBaseMinor) },
    { key: "costs", header: "Costs this month", align: "right", hideBelow: "sm", cell: (s) => money(s.costsMonthBaseMinor) },
    { key: "net", header: "Net this month", align: "right", cell: (s) => <span className={s.netMonthBaseMinor < 0 ? "text-danger-text" : "text-ink"}>{money(s.netMonthBaseMinor)}</span> },
    { key: "nettotal", header: "Net, all time", align: "right", hideBelow: "lg", cell: (s) => money(s.netTotalBaseMinor) },
  ];
  const paymentColumns: Column<Payment>[] = [
    {
      key: "what",
      header: "Payment",
      cell: (p) => (
        <div className="min-w-0">
          <p className="clamp-2 font-semibold text-ink">{p.vendor}</p>
          <p className="clamp-2 text-sm text-muted">{[p.category, p.stream, p.billingCycle].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    { key: "due", header: "Due", cell: (p) => <span className="text-ink-2">{fmtDate(p.nextDueDate)} · {dueLabel(p.daysUntilDue)}</span> },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (p) => (
        <div>
          <p className="text-ink">{formatMoney(p.amountMinor, p.currency)}</p>
          {p.currency !== base && <p className="text-xs text-muted">{formatMoney(p.amountBaseMinor, base)} in {base}</p>}
        </div>
      ),
    },
  ];
  const taskColumns: Column<Task>[] = [
    { key: "title", header: "Task", cell: (t) => <span className="clamp-2 font-semibold text-ink">{t.title}</span> },
    { key: "stream", header: "Stream", hideBelow: "sm", cell: (t) => <span className="text-ink-2">{t.stream}</span> },
    { key: "due", header: "Deadline", cell: (t) => (t.dueDate ? <span className={t.overdue ? "text-danger-text" : "text-ink-2"}>{fmtDate(t.dueDate)}</span> : <span className="text-muted">No deadline</span>) },
    { key: "status", header: "", align: "right", cell: (t) => (t.overdue ? <Badge tone="red">Overdue</Badge> : <Badge>{t.status.replace("_", " ")}</Badge>) },
  ];

  return (
    <>
      <PageHeader
        title="My dashboard"
        subtitle={`${mine.streams.map((s) => s.name).join(", ")} · ${mine.countries.map((c) => c.name).join(", ")} · in ${base}`}
        actions={
          <>
            <ButtonLink href="/my-dashboard/expenses" variant="secondary">Expenses</ButtonLink>
            <ButtonLink href="/my-dashboard/subscriptions" variant="secondary">Subscriptions</ButtonLink>
            <ButtonLink href="/my-dashboard/tasks" variant="secondary">Tasks</ButtonLink>
            <ButtonLink href="/my-dashboard/projects" variant="secondary">Projects</ButtonLink>
            <ButtonLink href="/my-dashboard/team" variant="secondary">My team</ButtonLink>
          </>
        }
      />

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue this month" value={money(o.revenueMonthBaseMinor)} detail="Income that has been paid" />
        <StatCard label="Costs this month" value={money(o.costsMonthBaseMinor)} detail="Expenses and subscriptions paid" />
        <StatCard label="Net this month" value={money(o.netMonthBaseMinor)} noteTone={o.netMonthBaseMinor < 0 ? "red" : "green"} note={o.netMonthBaseMinor < 0 ? "Costs are ahead" : "Revenue minus costs"} />
        <StatCard label="Still to come" value={money(o.pendingBaseMinor)} detail="Income not paid yet" />
      </div>
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue, all time" value={money(o.revenueTotalBaseMinor)} detail="Paid income" />
        <StatCard label="Net, all time" value={money(o.netTotalBaseMinor)} detail="Paid income minus costs" />
        <StatCard label="Open tasks" value={String(d.tasks.open)} noteTone={d.tasks.overdue ? "red" : "green"} note={d.tasks.overdue ? `${d.tasks.overdue} overdue` : "None overdue"} />
        <StatCard label="Payments due in 30 days" value={money(d.dueWithin30DaysBaseMinor)} detail="Subscriptions and renewals" />
      </div>

      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="By stream" subtitle={`Revenue, costs and net for each of your streams · ${d.monthLabel}`} />
          <DataTable caption="Figures by stream" columns={streamColumns} rows={d.perStream} rowKey={(s) => String(s.streamId)} />
        </Card>
        <Card>
          <CardHeader title="Upcoming payments and renewals" subtitle="Each amount shows its own currency, and its value in the base currency when different" />
          {d.upcomingPayments.length === 0 ? (
            <EmptyState title="No upcoming payments">Nothing is due in your streams right now.</EmptyState>
          ) : (
            <DataTable caption="Upcoming payments" columns={paymentColumns} rows={d.upcomingPayments} rowKey={(p) => p.id} />
          )}
        </Card>
        <Card>
          <CardHeader title="Tasks and deadlines" subtitle="Open tasks in your streams, soonest first" />
          {d.tasks.upcoming.length === 0 ? (
            <EmptyState title="No open tasks">Tasks in your streams will appear here.</EmptyState>
          ) : (
            <DataTable caption="Open tasks" columns={taskColumns} rows={d.tasks.upcoming} rowKey={(t) => t.id} />
          )}
        </Card>
      </div>
    </>
  );
}
