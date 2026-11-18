import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { employeeFilters, listEmployees, type EmployeeRow } from "@/lib/dal/admin-employees";
import { fmtDate } from "@/lib/format";
import { fmtMinutes } from "@/lib/hours";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Employees" };

/** Admin only: every employee with their partner, projects, tasks, hours and cost for the chosen period. */
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const filters = employeeFilters.parse(await searchParams);
  const { rows, options, partners, baseCurrency, from, to } = await listEmployees(actor, filters);
  const money = (n: number) => formatMoney(n, baseCurrency, { cents: false });

  const columns: Column<EmployeeRow>[] = [
    {
      key: "name",
      header: "Employee",
      cell: (p) => (
        <Link href={`/employees/${p.id}`} className="min-w-0 hover:underline">
          <p className="clamp-2 font-semibold text-ink">{p.name}</p>
          <p className="clamp-2 text-sm text-muted">{p.email}</p>
        </Link>
      ),
    },
    { key: "partner", header: "Partner", hideBelow: "sm", cell: (p) => <span className="text-ink-2">{p.partnerName ?? "None"}</span> },
    { key: "projects", header: "Projects", hideBelow: "lg", cell: (p) => <span className="clamp-2 text-ink-2">{p.projects.join(", ") || "None"}</span> },
    { key: "tasks", header: "Open tasks", align: "right", hideBelow: "md", cell: (p) => (p.overdueTasks ? `${p.openTasks} (${p.overdueTasks} overdue)` : p.openTasks) },
    { key: "hours", header: "Hours", align: "right", cell: (p) => fmtMinutes(p.hoursMinutes) },
    { key: "cost", header: "Cost", align: "right", hideBelow: "sm", cell: (p) => money(p.costBaseMinor) },
    {
      key: "status",
      header: "Status",
      hideBelow: "md",
      cell: (p) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {p.status === "active" ? p.online ? <Badge tone="green">Online</Badge> : <Badge>{p.lastActive ? `Seen ${fmtDate(p.lastActive.slice(0, 10))}` : "Never"}</Badge> : <Badge tone={p.status === "invited" ? "amber" : "red"}>{p.status === "invited" ? "Invite sent" : "Deactivated"}</Badge>}
          {p.flaggedShifts > 0 && <Badge tone="red">Forgot to clock out</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Employees" subtitle={`Hours and cost ${from} to ${to} · cost in ${baseCurrency}`} />
      <Card className="mb-6">
        <form method="get" className="grid gap-4 @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-6 @min-[52rem]:items-end">
          <Field label="Partner" htmlFor="e-partner">
            <Select id="e-partner" name="partner" defaultValue={filters.partner ?? ""}>
              <option value="">All partners</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Stream" htmlFor="e-stream">
            <Select id="e-stream" name="stream" defaultValue={filters.stream ? String(filters.stream) : ""}>
              <option value="">All streams</option>
              {options.streams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Country" htmlFor="e-country">
            <Select id="e-country" name="country" defaultValue={filters.country ?? ""}>
              <option value="">All countries</option>
              {options.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="e-from">
            <Input id="e-from" name="from" type="date" defaultValue={filters.from ?? from} />
          </Field>
          <Field label="To" htmlFor="e-to">
            <Input id="e-to" name="to" type="date" defaultValue={filters.to ?? to} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/employees" variant="secondary">
              Clear
            </ButtonLink>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Employees" subtitle="Click a name for their page. Hours count closed shifts by the day they started." />
        {rows.length === 0 ? (
          <EmptyState title="No employees">Stream partners invite employees from their My team page, or you can invite one on the Team page.</EmptyState>
        ) : (
          <DataTable caption="Employees" columns={columns} rows={rows} rowKey={(p) => p.id} />
        )}
      </Card>
    </>
  );
}
