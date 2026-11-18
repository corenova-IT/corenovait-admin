import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuditTable } from "@/components/audit/AuditTable";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { partnerDetail, partnerFilters } from "@/lib/dal/admin-partners";
import type { DashboardData, StreamFigures } from "@/lib/dal/partner-dashboard";
import { NotFound } from "@/lib/dal/scope";
import { dueLabel, fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Partner" };

type Payment = DashboardData["upcomingPayments"][number];
type Task = DashboardData["tasks"]["upcoming"][number];

/** Admin only: one stream partner's page. The same figures the partner sees, plus the log of what they changed. */
export default async function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const { id } = await params;
  let d;
  try {
    d = await partnerDetail(actor, id, partnerFilters.parse(await searchParams));
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const base = d.dashboard.baseCurrency;
  const money = (n: number) => formatMoney(n, base, { cents: false });
  const o = d.dashboard.overall;

  const streamColumns: Column<StreamFigures>[] = [
    { key: "stream", header: "Stream", cell: (s) => <span className="font-semibold text-ink">{s.stream}</span> },
    { key: "rev", header: "Revenue", align: "right", cell: (s) => money(s.revenueMonthBaseMinor) },
    { key: "pending", header: "Still to come", align: "right", hideBelow: "md", cell: (s) => money(s.pendingBaseMinor) },
    { key: "costs", header: "Costs", align: "right", hideBelow: "sm", cell: (s) => money(s.costsMonthBaseMinor) },
    { key: "net", header: "Profit", align: "right", cell: (s) => <span className={s.netMonthBaseMinor < 0 ? "text-danger-text" : "text-ink"}>{money(s.netMonthBaseMinor)}</span> },
  ];
  const paymentColumns: Column<Payment>[] = [
    { key: "what", header: "Payment", cell: (p) => <span className="clamp-2 font-semibold text-ink">{p.vendor} <span className="font-normal text-muted">· {p.stream}</span></span> },
    { key: "due", header: "Due", cell: (p) => <span className="text-ink-2">{fmtDate(p.nextDueDate)} · {dueLabel(p.daysUntilDue)}</span> },
    { key: "amount", header: "Amount", align: "right", cell: (p) => (p.currency === base ? formatMoney(p.amountMinor, p.currency) : `${formatMoney(p.amountMinor, p.currency)} (${formatMoney(p.amountBaseMinor, base)})`) },
  ];
  const taskColumns: Column<Task>[] = [
    { key: "title", header: "Task", cell: (t) => <span className="clamp-2 font-semibold text-ink">{t.title}</span> },
    { key: "due", header: "Deadline", cell: (t) => (t.dueDate ? <span className={t.overdue ? "text-danger-text" : "text-ink-2"}>{fmtDate(t.dueDate)}</span> : <span className="text-muted">No deadline</span>) },
    { key: "st", header: "", align: "right", cell: (t) => (t.overdue ? <Badge tone="red">Overdue</Badge> : <Badge>{t.status.replace("_", " ")}</Badge>) },
  ];

  return (
    <>
      <PageHeader title={d.person.name} subtitle={`${d.person.email} · ${d.from} to ${d.to} · in ${base}`} actions={<Link href="/partners" className="text-sm text-accent-text hover:underline">All partners</Link>} />

      <Card className="mb-6">
        <dl className="grid gap-4 p-5 sm:grid-cols-3">
          <div>
            <dt className="label-mono">Streams</dt>
            <dd className="mt-1 text-ink">{d.streams.map((s) => s.name).join(", ") || "None"}</dd>
          </div>
          <div>
            <dt className="label-mono">Countries</dt>
            <dd className="mt-1 text-ink">{d.countries.map((c) => c.name).join(", ") || "None: this partner sees nothing yet"}</dd>
          </div>
          <div>
            <dt className="label-mono">Change these on</dt>
            <dd className="mt-1"><Link href="/team" className="text-accent-text hover:underline">Team and permissions</Link></dd>
          </div>
        </dl>
      </Card>

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue" value={money(o.revenueMonthBaseMinor)} detail="Paid income in the period" />
        <StatCard label="Costs" value={money(o.costsMonthBaseMinor)} detail="Expenses and subscriptions paid" />
        <StatCard label="Profit" value={money(o.netMonthBaseMinor)} noteTone={o.netMonthBaseMinor < 0 ? "red" : "green"} note="Revenue minus costs" />
        <StatCard label="Still to come" value={money(o.pendingBaseMinor)} detail="Income not paid yet" />
      </div>
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Open tasks" value={String(d.taskProgress.open)} detail={`${d.taskProgress.done} done`} />
        <StatCard label="Overdue tasks" value={String(d.taskProgress.overdue)} noteTone={d.taskProgress.overdue ? "red" : "green"} note={d.taskProgress.overdue ? "Needs attention" : "None overdue"} />
        <StatCard label="Revenue, all time" value={money(o.revenueTotalBaseMinor)} detail="Paid income" />
        <StatCard label="Profit, all time" value={money(o.netTotalBaseMinor)} detail="Paid income minus costs" />
      </div>

      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="By stream" subtitle="Revenue, costs and profit for the period" />
          {d.dashboard.perStream.length === 0 ? (
            <EmptyState title="Nothing to show yet">This partner needs at least one stream and one country.</EmptyState>
          ) : (
            <DataTable caption="Figures by stream" columns={streamColumns} rows={d.dashboard.perStream} rowKey={(s) => String(s.streamId)} />
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming subscriptions and renewals" />
          {d.dashboard.upcomingPayments.length === 0 ? <EmptyState title="None coming up">No active subscriptions in this partner&apos;s streams.</EmptyState> : <DataTable caption="Upcoming payments" columns={paymentColumns} rows={d.dashboard.upcomingPayments} rowKey={(p) => p.id} />}
        </Card>
        <Card>
          <CardHeader title="Deadlines and task progress" />
          {d.dashboard.tasks.upcoming.length === 0 ? <EmptyState title="No open tasks">Open tasks in this partner&apos;s streams will appear here.</EmptyState> : <DataTable caption="Open tasks" columns={taskColumns} rows={d.dashboard.tasks.upcoming} rowKey={(t) => t.id} />}
        </Card>
        <Card>
          <CardHeader title="Employees and their cost" subtitle="Employees arrive in a later update" />
          <EmptyState title="No employees yet">This partner has no employees.</EmptyState>
        </Card>
        <Card>
          <CardHeader title="Changes made" subtitle="What this partner added, edited or archived (newest first)" />
          <AuditTable rows={d.changes} timeZone={d.timeZone} />
        </Card>
      </div>
    </>
  );
}
