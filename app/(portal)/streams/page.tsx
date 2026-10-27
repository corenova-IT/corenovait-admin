import { redirect } from "next/navigation";
import { BarList } from "@/components/charts/BarList";
import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { SummaryCard } from "@/components/revenue/SummaryCard";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { requireUser } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { divRound, periodSchema, streamSummaries } from "@/lib/dal/revenue";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Revenue streams" };

export default async function StreamsPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requireUser();
  if (!hasPerm(actor, "streams", "view")) {
    // the sidebar shows "Revenue streams" for any of the three views; open the one they have
    if (hasPerm(actor, "countries", "view")) redirect("/streams/countries");
    if (hasPerm(actor, "representatives", "view")) redirect("/streams/representatives");
    redirect("/no-access?module=streams");
  }
  const period = periodSchema.parse((await searchParams).period) ?? "12m";
  const [data, sample] = await Promise.all([streamSummaries(actor, period), hasSampleData(actor)]);
  const { baseCurrency: base } = data;
  const deals = data.rows.reduce((a, r) => a + r.deals, 0);
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });

  return (
    <>
      <PageHeader
        title="Revenue streams"
        subtitle={`Where the money comes from · ${PERIOD_LABEL[period]} · in ${base}`}
        sample={sample}
        actions={<PeriodSwitch path="/streams" value={period} />}
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue" value={whole(data.totalBaseMinor)} note="Paid" detail="All streams" />
        <StatCard label="Outstanding" value={whole(data.outstandingBaseMinor)} note={data.outstandingBaseMinor > 0 ? "Not yet paid" : "All paid"} noteTone={data.outstandingBaseMinor > 0 ? "amber" : "green"} detail="Pending + overdue invoices" />
        <StatCard label="Paid deals" value={String(deals)} note={PERIOD_LABEL[period]} detail="Income entries marked paid" />
        <StatCard label="Average deal" value={deals ? whole(divRound(data.totalBaseMinor, deals)) : "None yet"} note="Per paid deal" detail="Revenue ÷ deals" />
      </div>
      <div className="grid grid-cols-1 gap-cards @min-[76rem]:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* wrapping row: the cards in the last row grow to fill it, so there is never an empty slot */}
        <div className="flex flex-wrap gap-cards [&>*]:flex-[1_1_17rem]">
          {data.rows.map((s) => (
            <SummaryCard
              key={s.id}
              href={`/streams/${s.id}?period=${period}`}
              name={s.name}
              sharePct={s.sharePct}
              value={whole(s.revenueBaseMinor)}
              trend={s.trend}
              trendLabel={`${s.name}: revenue by month for the last 12 months`}
              stats={[
                { label: "Deals", value: String(s.deals) },
                { label: "Average", value: s.deals ? whole(s.averageBaseMinor) : "None" },
                { label: "Unpaid", value: s.outstandingBaseMinor > 0 ? whole(s.outstandingBaseMinor) : "None", tone: s.outstandingBaseMinor > 0 ? "warning" : undefined },
              ]}
            />
          ))}
        </div>
        <Card>
          <CardHeader title="Revenue by stream" subtitle={PERIOD_LABEL[period]} />
          <BarList
            currency={base}
            total={data.totalBaseMinor}
            items={[...data.rows]
              .sort((a, b) => b.revenueBaseMinor - a.revenueBaseMinor)
              .map((s) => ({ key: String(s.id), label: s.name, value: s.revenueBaseMinor, href: `/streams/${s.id}?period=${period}`, note: `${s.deals} deals` }))}
          />
        </Card>
      </div>
    </>
  );
}
