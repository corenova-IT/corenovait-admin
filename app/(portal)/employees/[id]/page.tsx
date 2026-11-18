import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuditTable } from "@/components/audit/AuditTable";
import { MessageUserButton } from "@/components/partner/MessageForms";
import { ShiftPanel } from "@/components/partner/ShiftPanel";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { employeeDetail, employeeFilters } from "@/lib/dal/admin-employees";
import { NotFound } from "@/lib/dal/scope";
import { fmtDate } from "@/lib/format";
import { fmtMinutes } from "@/lib/hours";
import { formatMoney } from "@/lib/money";
import { shiftRows } from "@/lib/shift-view";
import { messageUser } from "../../partners/actions";
import { correctShift } from "../actions";

export const metadata = { title: "Employee" };

/** Admin only: one employee. Partner, projects, tasks, shifts and hours (with corrections), online status and cost. */
export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const { id } = await params;
  let d;
  try {
    d = await employeeDetail(actor, id, employeeFilters.parse(await searchParams));
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const money = (n: number) => formatMoney(n, d.baseCurrency, { cents: false });
  return (
    <>
      <PageHeader
        title={d.person.name}
        subtitle={`${d.person.email} · ${d.from} to ${d.to}`}
        actions={
          <>
            <MessageUserButton userId={d.person.id} action={messageUser} />
            <Link href="/employees" className="text-sm text-accent-text hover:underline">All employees</Link>
          </>
        }
      />
      <Card className="mb-6">
        <dl className="grid gap-4 p-5 sm:grid-cols-4">
          <div>
            <dt className="label-mono">Works for</dt>
            <dd className="mt-1 text-ink">{d.partner ? <Link href={`/partners/${d.partner.id}`} className="text-accent-text hover:underline">{d.partner.name}</Link> : "No partner"}</dd>
          </div>
          <div>
            <dt className="label-mono">Streams and countries</dt>
            <dd className="mt-1 text-ink">{[...d.streams, ...d.countries].join(", ") || "None"}</dd>
          </div>
          <div>
            <dt className="label-mono">Projects</dt>
            <dd className="mt-1 text-ink">{d.projects.map((p) => p.name).join(", ") || "None"}</dd>
          </div>
          <div>
            <dt className="label-mono">Status</dt>
            <dd className="mt-1">
              {d.person.status === "active" ? d.person.online ? <Badge tone="green">Online</Badge> : <Badge>{d.person.lastActive ? `Seen ${fmtDate(d.person.lastActive.slice(0, 10))}` : "Never signed in"}</Badge> : <Badge tone={d.person.status === "invited" ? "amber" : "red"}>{d.person.status}</Badge>}
            </dd>
          </div>
        </dl>
      </Card>

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Hours" value={fmtMinutes(d.shifts.totalMinutes)} detail="Closed shifts in the period" />
        <StatCard label="Cost" value={money(d.costBaseMinor)} detail="Employee pay, counted once" />
        <StatCard label="Open tasks" value={String(d.tasks.open)} detail={`${d.tasks.done} done`} />
        <StatCard label="Overdue tasks" value={String(d.tasks.overdue)} noteTone={d.tasks.overdue ? "red" : "green"} note={d.tasks.overdue ? "Needs attention" : "None overdue"} />
      </div>

      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="Shifts and hours" subtitle="Corrections are logged with who, when and why." />
          <div className="px-5 pb-5">
            {d.shifts.open?.flagged && <p className="mb-3 text-sm text-danger-text">This employee forgot to clock out of a shift. Correct it below.</p>}
            <ShiftPanel shifts={shiftRows(d.shifts.shifts, d.shifts.timeZone)} timeZone={d.shifts.timeZone} action={correctShift} />
            {d.shifts.open && !d.shifts.shifts.some((s) => s.id === d.shifts.open!.id) && (
              <div className="mt-3 border-t border-line/70 pt-3">
                <p className="mb-2 text-sm text-muted">An older open shift (outside this period):</p>
                <ShiftPanel shifts={shiftRows([d.shifts.open], d.shifts.timeZone)} timeZone={d.shifts.timeZone} action={correctShift} />
              </div>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Tasks and deadlines" />
          {d.tasks.upcoming.length === 0 ? (
            <EmptyState title="No open tasks">Open tasks assigned to this employee will appear here.</EmptyState>
          ) : (
            <ul className="flex flex-col">
              {d.tasks.upcoming.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-3 border-b border-line/70 px-5 py-3 last:border-b-0">
                  <span className="min-w-0 flex-1 font-semibold text-ink">{t.title}{t.project && <span className="ml-2 text-sm font-normal text-muted">{t.project}</span>}</span>
                  <span className={t.overdue ? "text-danger-text" : "text-sm text-muted"}>{t.dueDate ? fmtDate(t.dueDate) : "No deadline"}</span>
                  {t.overdue ? <Badge tone="red">Overdue</Badge> : <Badge>{t.status.replace("_", " ")}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Changes made" subtitle="Shift corrections, pay changes and partner assignments for this employee, whoever made them (newest first)" />
          <AuditTable rows={d.changes} timeZone={d.shifts.timeZone} />
        </Card>
        {d.partner && (
          <p className="text-xs text-muted">
            Pay for this employee is set on <Link href={`/partners/${d.partner.id}`} className="text-accent-text hover:underline">{d.partner.name}&apos;s page</Link>.
          </p>
        )}
      </div>
    </>
  );
}
