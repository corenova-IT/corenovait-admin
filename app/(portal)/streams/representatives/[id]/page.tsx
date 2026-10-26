import Link from "next/link";
import { notFound } from "next/navigation";
import { DeletePayoutButton, PayoutButton, RepButton } from "@/components/revenue/RepForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { linkableUsers, repDetail } from "@/lib/dal/revenue";
import { fmtDate } from "@/lib/format";
import { formatMoney, formatRatePercent } from "@/lib/money";
import { deletePayout, recordPayout, saveRep } from "../actions";
import { repView } from "@/components/revenue/rep-view";

export const metadata = { title: "Representative" };

export default async function RepresentativePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePerm("representatives");
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const canEdit = hasPerm(actor, "representatives", "edit");
  const canPay = hasPerm(actor, "representatives", "create");
  const canDelete = hasPerm(actor, "representatives", "delete");
  const [d, sample, users] = await Promise.all([repDetail(actor, id), hasSampleData(actor), canEdit ? linkableUsers(actor) : Promise.resolve([])]);
  if (!d) notFound();
  const base = d.baseCurrency;
  const owed = formatMoney(d.commissionOwedBaseMinor, base);

  return (
    <>
      <Link href="/streams/representatives" className="mb-3 inline-block text-sm text-accent-text hover:underline">
        ← All representatives
      </Link>
      <PageHeader
        title={d.rep.name}
        subtitle={`Representative · ${formatRatePercent(d.rep.commissionRate)} commission${d.rep.active ? "" : " · inactive"}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap gap-3">
            {canEdit && <RepButton rep={repView(d.rep)} users={users} action={saveRep} size="md" />}
            {canPay && <PayoutButton repId={d.rep.id} repName={d.rep.name} base={base} owed={owed} action={recordPayout} />}
          </div>
        }
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Deals credited" value={String(d.dealsCount)} detail={`${formatMoney(d.revenueBaseMinor, base, { cents: false })} paid · ${formatMoney(d.outstandingBaseMinor, base, { cents: false })} outstanding`} />
        <StatCard label="Commission earned" value={formatMoney(d.commissionEarnedBaseMinor, base)} detail="On paid deals" />
        <StatCard label="Paid out" value={formatMoney(d.commissionPaidBaseMinor, base)} detail={`${d.payouts.length} payouts`} />
        <StatCard label="Owed" value={owed} note={d.commissionOwedBaseMinor > 0 ? "Due" : "Settled"} noteTone={d.commissionOwedBaseMinor > 0 ? "amber" : "green"} />
      </div>

      <div className="grid grid-cols-1 gap-cards @min-[72rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Deals credited" subtitle="Most recent 100" />
          <DataTable
            caption={`Deals credited to ${d.rep.name}`}
            rowKey={(r) => r.id}
            rows={d.deals}
            empty={{ title: "No deals credited yet" }}
            columns={[
              { key: "date", header: "Date", cell: (r) => <span className="font-mono text-sm text-ink-2">{fmtDate(r.entryDate)}</span> },
              { key: "client", header: "Client", cell: (r) => <span>{r.client || "—"}<span className="block text-sm text-muted">{r.streamName}</span></span> },
              { key: "amount", header: "Amount", align: "right", hideBelow: "md", cell: (r) => <span className="num font-mono">{formatMoney(r.amountMinor, r.currency)}</span> },
              { key: "status", header: "Status", cell: (r) => <Badge tone={r.status === "paid" ? "green" : r.status === "overdue" ? "red" : "amber"}>{r.status}</Badge> },
              {
                key: "commission",
                header: "Commission",
                align: "right",
                cell: (r) => (
                  <span className="num font-mono">
                    {r.status === "paid" ? formatMoney(r.commissionBaseMinor, base) : <span className="text-muted">when paid</span>}
                    <span className="block text-xs text-muted">{formatRatePercent(r.commissionRate)}</span>
                  </span>
                ),
              },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Payout log" />
          <DataTable
            caption={`Payouts to ${d.rep.name}`}
            rowKey={(r) => r.id}
            rows={d.payouts}
            empty={{ title: "No payouts yet", body: canPay ? "Record one when commission is paid." : undefined }}
            columns={[
              {
                key: "date",
                header: "Paid",
                cell: (r) => (
                  <span>
                    <span className="font-mono text-sm text-ink-2">{fmtDate(r.paidDate)}</span>
                    {r.reference && <span className="block font-mono text-xs text-muted">{r.reference}</span>}
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Amount",
                align: "right",
                cell: (r) => (
                  <span className="num font-mono">
                    {formatMoney(r.amountMinor, r.currency)}
                    {r.currency !== base && <span className="block text-xs text-muted">{formatMoney(r.amountBaseMinor, base)}</span>}
                  </span>
                ),
              },
              {
                key: "actions",
                header: "",
                align: "right",
                cell: (r) => (canDelete ? <DeletePayoutButton id={r.id} label={`${fmtDate(r.paidDate)} · ${formatMoney(r.amountMinor, r.currency)}`} action={deletePayout} /> : null),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
