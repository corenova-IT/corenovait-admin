import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Field, Input, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { listPartners, partnerFilters, type PartnerRow } from "@/lib/dal/admin-partners";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { redirect } from "next/navigation";

export const metadata = { title: "Partners" };

/** Admin only: every partner, with this period's figures. Respects what the Owner hides from the admin. */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const filters = partnerFilters.parse(await searchParams);
  const { rows, options, baseCurrency, from, to } = await listPartners(actor, filters);
  const money = (n: number) => formatMoney(n, baseCurrency, { cents: false });

  const columns: Column<PartnerRow>[] = [
    {
      key: "name",
      header: "Partner",
      cell: (p) => (
        <Link href={`/partners/${p.id}`} className="min-w-0 hover:underline">
          <p className="clamp-2 font-semibold text-ink">{p.name}</p>
          <p className="clamp-2 text-sm text-muted">{p.email}</p>
        </Link>
      ),
    },
    { key: "streams", header: "Streams", hideBelow: "sm", cell: (p) => <span className="text-ink-2">{p.streams.join(", ") || "None"}</span> },
    { key: "countries", header: "Countries", hideBelow: "md", cell: (p) => (p.countries.length ? <span className="text-ink-2">{p.countries.join(", ")}</span> : <Badge tone="amber">None: sees nothing</Badge>) },
    { key: "rev", header: "Revenue", align: "right", cell: (p) => money(p.revenueBaseMinor) },
    { key: "profit", header: "Profit", align: "right", cell: (p) => <span className={p.profitBaseMinor < 0 ? "text-danger-text" : "text-ink"}>{money(p.profitBaseMinor)}</span> },
    { key: "tasks", header: "Open tasks", align: "right", hideBelow: "lg", cell: (p) => p.openTasks },
    { key: "subs", header: "Payments due in 30 days", align: "right", hideBelow: "lg", cell: (p) => p.upcomingPayments },
    { key: "last", header: "Last active", hideBelow: "md", cell: (p) => <span className="text-ink-2">{p.lastActive ? fmtDate(p.lastActive.slice(0, 10)) : "Never"}</span> },
  ];

  return (
    <>
      <PageHeader title="Partners" subtitle={`Partners · revenue and profit ${from} to ${to} · in ${baseCurrency}`} />
      <Card className="mb-6">
        <form method="get" className="grid gap-4 @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-5 @min-[52rem]:items-end">
          <Field label="Stream" htmlFor="p-stream">
            <Select id="p-stream" name="stream" defaultValue={filters.stream ? String(filters.stream) : ""}>
              <option value="">All streams</option>
              {options.streams.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Country" htmlFor="p-country">
            <Select id="p-country" name="country" defaultValue={filters.country ?? ""}>
              <option value="">All countries</option>
              {options.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="p-from">
            <Input id="p-from" name="from" type="date" defaultValue={filters.from ?? from} />
          </Field>
          <Field label="To" htmlFor="p-to">
            <Input id="p-to" name="to" type="date" defaultValue={filters.to ?? to} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Apply</Button>
            <ButtonLink href="/partners" variant="secondary">
              Clear
            </ButtonLink>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader title="Partners" subtitle="Click a name for their page. Revenue is paid income only." />
        {rows.length === 0 ? (
          <EmptyState title="No partners">Invite someone with the Partner role on the Team page, then give them a stream and a country.</EmptyState>
        ) : (
          <DataTable caption="Partners" columns={columns} rows={rows} rowKey={(p) => p.id} />
        )}
      </Card>
    </>
  );
}
