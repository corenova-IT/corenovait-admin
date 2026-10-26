import Link from "next/link";
import { notFound } from "next/navigation";
import { BarList } from "@/components/charts/BarList";
import { MonthBars } from "@/components/charts/MonthBars";
import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { TopClients } from "@/components/revenue/TopClients";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { periodSchema, streamDetail } from "@/lib/dal/revenue";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Revenue stream" };

export default async function StreamPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ period?: string }> }) {
  const actor = await requirePerm("streams");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const period = periodSchema.parse((await searchParams).period) ?? "12m";
  const [d, sample] = await Promise.all([streamDetail(actor, id, period), hasSampleData(actor)]);
  if (!d) notFound();
  const base = d.baseCurrency;

  return (
    <>
      <Link href={`/streams?period=${period}`} className="mb-3 inline-block text-sm text-accent-text hover:underline">
        ← All streams
      </Link>
      <PageHeader
        title={d.stream.name}
        subtitle={`Revenue stream · ${PERIOD_LABEL[period]} · in ${base}${d.stream.active ? "" : " · archived"}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap gap-3">
            <PeriodSwitch path={`/streams/${id}`} value={period} />
            {hasPerm(actor, "transactions", "view") && (
              <ButtonLink variant="secondary" href={`/transactions?tab=income&stream=${id}`}>
                See entries
              </ButtonLink>
            )}
          </div>
        }
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(d.revenueBaseMinor, base, { cents: false })} detail={`Paid invoices, ${PERIOD_LABEL[period]}`} />
        <StatCard label="Outstanding" value={formatMoney(d.outstandingBaseMinor, base, { cents: false })} note={`${d.outstandingCount} unpaid`} noteTone={d.outstandingBaseMinor > 0 ? "amber" : "neutral"} detail="Pending + overdue" />
        <StatCard label="Paid deals" value={String(d.deals)} detail="Income entries marked paid" />
        <StatCard label="Average deal" value={formatMoney(d.averageBaseMinor, base, { cents: false })} detail="Revenue ÷ deals" />
      </div>
      <Card className="mb-6">
        <CardHeader title="Revenue by month" subtitle="Last 12 months" />
        <MonthBars data={d.monthly.map((m) => ({ month: m.month, value: m.totalBaseMinor }))} currency={base} label={`${d.stream.name}: revenue by month`} />
      </Card>
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        <Card>
          <CardHeader title="By country" subtitle={PERIOD_LABEL[period]} />
          <BarList
            currency={base}
            items={d.byCountry.map((c) => ({ key: c.code, tag: c.code, label: c.name, value: c.totalBaseMinor, href: `/streams/countries/${c.code}?period=${period}`, note: `${c.deals} deals` }))}
          />
        </Card>
        <TopClients clients={d.topClients} currency={base} subtitle={PERIOD_LABEL[period]} />
      </div>
    </>
  );
}
