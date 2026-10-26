import Link from "next/link";
import { redirect } from "next/navigation";
import { BarList } from "@/components/charts/BarList";
import { Sparkline } from "@/components/charts/Sparkline";
import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { Pill } from "@/components/ui/Pill";
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

  return (
    <>
      <PageHeader
        title="Revenue streams"
        subtitle={`Where the money comes from · ${PERIOD_LABEL[period]} · in ${base}`}
        sample={sample}
        actions={<PeriodSwitch path="/streams" value={period} />}
      />
      <div className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={formatMoney(data.totalBaseMinor, base, { cents: false })} detail="Paid invoices, all streams" />
        <StatCard label="Outstanding" value={formatMoney(data.outstandingBaseMinor, base, { cents: false })} note="Pending + overdue" noteTone={data.outstandingBaseMinor > 0 ? "amber" : "neutral"} detail="Invoiced, not yet paid" />
        <StatCard label="Paid deals" value={String(deals)} detail="In the period" />
        <StatCard label="Average deal" value={formatMoney(divRound(data.totalBaseMinor, deals), base, { cents: false })} detail="Revenue ÷ deals" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-5 sm:grid-cols-2">
          {data.rows.map((s) => (
            <Link key={s.id} href={`/streams/${s.id}?period=${period}`} className="glass glass-glow flex flex-col justify-between gap-5 p-6 transition-colors hover:border-accent-line">
              <div className="flex items-start justify-between gap-3">
                <p className="font-display text-lg font-bold text-ink">{s.name}</p>
                <Pill>{s.sharePct}%</Pill>
              </div>
              <p className="num glow-text text-3xl font-bold text-ink">{formatMoney(s.revenueBaseMinor, base, { cents: false })}</p>
              <div className="flex items-end justify-between gap-3">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm">
                  <dt className="text-muted">Paid deals</dt>
                  <dd className="font-mono text-ink">{s.deals}</dd>
                  <dt className="text-muted">Average</dt>
                  <dd className="font-mono text-ink">{formatMoney(s.averageBaseMinor, base, { cents: false })}</dd>
                  {s.outstandingBaseMinor > 0 && (
                    <>
                      <dt className="text-muted">Outstanding</dt>
                      <dd className="font-mono text-warning">{formatMoney(s.outstandingBaseMinor, base, { cents: false })}</dd>
                    </>
                  )}
                </dl>
                <Sparkline values={s.trend} label={`${s.name}: revenue by month for the last 12 months`} />
              </div>
            </Link>
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
