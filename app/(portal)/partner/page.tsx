import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { partnerEarnings, type PartnerEarnings } from "@/lib/dal/partners";
import { fmtDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "My earnings" };

type Project = PartnerEarnings["byProject"][number];
type Item = PartnerEarnings["recent"][number];
type Payout = PartnerEarnings["payouts"][number];

const statusBadge = (s: Item["status"]) =>
  s === "paid" ? <Badge tone="green">Paid</Badge> : s === "overdue" ? <Badge tone="red">Overdue</Badge> : <Badge tone="amber">Not paid yet</Badge>;

/** A partner's own page: only their share, payouts and balance (see lib/dal/partners.ts for what is deliberately left out). */
export default async function PartnerPage() {
  const actor = await requirePerm("partner");
  const d = await partnerEarnings(actor);
  const base = d.baseCurrency;
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });

  if (!d.linked) {
    return (
      <>
        <PageHeader title="My earnings" subtitle={`Your share of the projects you're a partner on · in ${base}`} />
        <Card>
          <EmptyState title="Your login isn't set up as a partner yet">
            An admin needs to link your sign-in to your partner record. Once they have, your share of each project, your payouts and what you&apos;re owed will show here.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="My earnings" subtitle={`Your share of the projects you're a partner on · in ${base}`} />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Earned" value={whole(d.earnedBaseMinor)} detail="Your share of income that's been paid" />
        <StatCard label="Still to come" value={whole(d.expectedBaseMinor)} detail="Your share of income not paid yet" />
        <StatCard label="Paid to you" value={whole(d.paidOutBaseMinor)} detail={`${d.payouts.length} ${d.payouts.length === 1 ? "payout" : "payouts"}`} />
        <StatCard
          label="Owed to you now"
          value={whole(d.owedBaseMinor)}
          note={d.owedBaseMinor > 0 ? "Due" : "All settled"}
          noteTone={d.owedBaseMinor > 0 ? "amber" : "green"}
          detail="Earned, less what's been paid to you"
        />
      </div>

      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="By project" subtitle="Your share of each project you're on" />
          <DataTable<Project>
            caption="Your earnings by project"
            columns={[
              {
                key: "project",
                header: "Project",
                cell: (p) => (
                  <div>
                    <p className="font-medium text-ink [overflow-wrap:anywhere]">{p.project}</p>
                    <p className="text-sm text-muted">{p.stream}</p>
                  </div>
                ),
              },
              { key: "share", header: "Your share", align: "right", cell: (p) => <span className="font-mono">{p.sharePercent == null ? "—" : `${p.sharePercent}%`}</span> },
              { key: "earned", header: "Earned", align: "right", cell: (p) => <span className="num font-mono">{formatMoney(p.earnedBaseMinor, base)}</span> },
              { key: "expected", header: "Still to come", align: "right", hideBelow: "sm", cell: (p) => <span className="num font-mono text-muted">{formatMoney(p.expectedBaseMinor, base)}</span> },
            ]}
            rows={d.byProject}
            rowKey={(p) => p.projectId}
            empty={{ title: "No projects yet", body: "Nothing has been filed under a project you're on." }}
          />
        </Card>

        <Card>
          <CardHeader title="Recent entries" subtitle="Your share of each one. The most recent 100." />
          <DataTable<Item>
            caption="Your share of recent income entries"
            columns={[
              { key: "date", header: "Date", cell: (r) => <span className="whitespace-nowrap">{fmtDate(r.date)}</span> },
              {
                key: "what",
                header: "For",
                cell: (r) => (
                  <div>
                    <p className="text-ink [overflow-wrap:anywhere]">{r.project ?? "Deal you brought in"}</p>
                    <p className="text-sm text-muted">{r.kind === "commission" ? "Commission" : "Project share"} · {r.ratePercent}%</p>
                  </div>
                ),
              },
              { key: "status", header: "Status", hideBelow: "sm", cell: (r) => statusBadge(r.status) },
              { key: "amount", header: "Your share", align: "right", cell: (r) => <span className="num font-mono">{formatMoney(r.amountBaseMinor, base)}</span> },
            ]}
            rows={d.recent}
            rowKey={(r) => r.key}
            empty={{ title: "Nothing yet", body: "Entries will appear here as income is filed under your projects." }}
          />
        </Card>

        <Card>
          <CardHeader title="Payouts to you" />
          <DataTable<Payout>
            caption="Payouts made to you"
            columns={[
              { key: "date", header: "Date", cell: (p) => <span className="whitespace-nowrap">{fmtDate(p.date)}</span> },
              { key: "ref", header: "Reference", hideBelow: "sm", cell: (p) => <span className="text-ink-2 [overflow-wrap:anywhere]">{p.reference || "—"}</span> },
              { key: "amount", header: "Amount", align: "right", cell: (p) => <span className="num font-mono">{formatMoney(p.amountBaseMinor, base)}</span> },
            ]}
            rows={d.payouts}
            rowKey={(p) => p.id}
            empty={{ title: "No payouts yet" }}
          />
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">A share counts as earned once the income it comes from is marked paid. Amounts are in {base}, rounded to the cent for each entry.</p>
    </>
  );
}
