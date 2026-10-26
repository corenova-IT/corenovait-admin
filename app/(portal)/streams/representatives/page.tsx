import Link from "next/link";
import { RepButton } from "@/components/revenue/RepForms";
import { repView } from "@/components/revenue/rep-view";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { linkableUsers, repSummaries, type RepSummary } from "@/lib/dal/revenue";
import { formatMoney, formatRatePercent } from "@/lib/money";
import { saveRep } from "./actions";

export const metadata = { title: "Representatives" };

export default async function RepresentativesPage() {
  const actor = await requirePerm("representatives");
  const canCreate = hasPerm(actor, "representatives", "create");
  const canEdit = hasPerm(actor, "representatives", "edit");
  const [data, sample, users] = await Promise.all([repSummaries(actor), hasSampleData(actor), canCreate || canEdit ? linkableUsers(actor) : Promise.resolve([])]);
  const base = data.baseCurrency;
  const sum = (k: keyof RepSummary) => data.rows.reduce((a, r) => a + Number(r[k]), 0);

  const columns: Column<RepSummary>[] = [
    {
      key: "name",
      header: "Representative",
      cell: (r) => (
        <div>
          <Link href={`/streams/representatives/${r.id}`} className="font-medium text-ink hover:underline">
            {r.name}
          </Link>
          <p className="text-sm text-muted">{[r.email, r.userName ? `login: ${r.userName}` : null].filter(Boolean).join(" · ") || "—"}</p>
        </div>
      ),
    },
    { key: "rate", header: "Rate", cell: (r) => <span className="font-mono">{formatRatePercent(r.commissionRate)}</span> },
    { key: "deals", header: "Deals", align: "right", cell: (r) => <span className="font-mono">{r.deals}</span> },
    { key: "revenue", header: "Paid revenue", align: "right", hideBelow: "md", cell: (r) => <span className="num font-mono">{formatMoney(r.revenueBaseMinor, base, { cents: false })}</span> },
    { key: "earned", header: "Earned", align: "right", hideBelow: "lg", cell: (r) => <span className="num font-mono">{formatMoney(r.commissionEarnedBaseMinor, base)}</span> },
    { key: "paid", header: "Paid", align: "right", hideBelow: "lg", cell: (r) => <span className="num font-mono">{formatMoney(r.commissionPaidBaseMinor, base)}</span> },
    {
      key: "owed",
      header: "Owed",
      align: "right",
      cell: (r) =>
        r.commissionOwedBaseMinor > 0 ? (
          <Badge tone="amber">{formatMoney(r.commissionOwedBaseMinor, base)}</Badge>
        ) : (
          <span className="num font-mono text-muted">{formatMoney(r.commissionOwedBaseMinor, base)}</span>
        ),
    },
    { key: "status", header: "Status", hideBelow: "md", cell: (r) => (r.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>) },
    { key: "actions", header: "", align: "right", cell: (r) => (canEdit ? <RepButton rep={repView(r)} users={users} action={saveRep} /> : null) },
  ];

  return (
    <>
      <PageHeader
        title="Representatives"
        subtitle={`Deals brought in and commission · in ${base}`}
        sample={sample}
        actions={canCreate ? <RepButton users={users} action={saveRep} /> : undefined}
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[40rem]:grid-cols-3">
        <StatCard label="Commission earned" value={formatMoney(sum("commissionEarnedBaseMinor"), base, { cents: false })} detail="On paid deals, all time" />
        <StatCard label="Paid out" value={formatMoney(sum("commissionPaidBaseMinor"), base, { cents: false })} detail="From the payout log" />
        <StatCard
          label="Owed now"
          value={formatMoney(sum("commissionOwedBaseMinor"), base, { cents: false })}
          note={sum("commissionOwedBaseMinor") > 0 ? "Payouts due" : "All settled"}
          noteTone={sum("commissionOwedBaseMinor") > 0 ? "amber" : "green"}
        />
      </div>
      <Card>
        <DataTable
          caption="Representatives"
          columns={columns}
          rows={data.rows}
          rowKey={(r) => r.id}
          empty={{ title: "No representatives yet", body: canCreate ? "Add one to credit deals and track commission." : undefined }}
        />
      </Card>
      <p className="mt-4 text-sm text-muted">Commission is earned when a credited deal is marked paid, at the rate agreed when it was credited, rounded to the cent per deal.</p>
    </>
  );
}
