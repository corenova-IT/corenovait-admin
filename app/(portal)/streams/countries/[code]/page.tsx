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
import { countryDetail, periodSchema } from "@/lib/dal/revenue";
import { formatMoney } from "@/lib/money";
import { ScrollX } from "@/components/ui/ScrollX";

export const metadata = { title: "Country" };

export default async function CountryPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ period?: string }> }) {
  const actor = await requirePerm("countries");
  const code = (await params).code.toUpperCase();
  if (!/^[A-Z]{2,8}$/.test(code)) notFound();
  const period = periodSchema.parse((await searchParams).period) ?? "12m";
  const [d, sample] = await Promise.all([countryDetail(actor, code, period), hasSampleData(actor)]);
  if (!d) notFound();
  const base = d.baseCurrency;

  return (
    <>
      <Link href={`/streams/countries?period=${period}`} className="mb-3 inline-block text-sm text-accent-text hover:underline">
        ← All countries
      </Link>
      <PageHeader
        title={d.country.name}
        subtitle={`Country · ${PERIOD_LABEL[period]} · totals in ${base}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap gap-3">
            <PeriodSwitch path={`/streams/countries/${d.country.code}`} value={period} />
            {hasPerm(actor, "transactions", "view") && (
              <ButtonLink variant="secondary" href={`/transactions?tab=income&country=${d.country.code}`}>
                See entries
              </ButtonLink>
            )}
          </div>
        }
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label={`Revenue in ${base}`} value={formatMoney(d.revenueBaseMinor, base, { cents: false })} note="Paid" detail={PERIOD_LABEL[period]} />
        <StatCard label="Outstanding" value={formatMoney(d.outstandingBaseMinor, base, { cents: false })} note={d.outstandingCount ? `${d.outstandingCount} unpaid` : "All paid"} noteTone={d.outstandingBaseMinor > 0 ? "amber" : "neutral"} detail="Pending + overdue" />
        <StatCard label="Paid deals" value={String(d.deals)} note={PERIOD_LABEL[period]} detail="Income entries marked paid" />
        <StatCard label="Average deal" value={d.deals ? formatMoney(d.averageBaseMinor, base, { cents: false }) : "None yet"} note="Per paid deal" detail="Revenue ÷ deals" />
      </div>
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Revenue by month" subtitle={`Last 12 months, in ${base}`} />
          <MonthBars data={d.monthly.map((m) => ({ month: m.month, value: m.totalBaseMinor }))} currency={base} label={`${d.country.name}: revenue by month`} />
        </Card>
        <Card>
          <CardHeader title="As received" subtitle="Original currency and its value in the base currency" />
          {d.byCurrency.length === 0 ? (
            <p className="text-sm text-muted">Nothing received for this period.</p>
          ) : (
            <ScrollX label="Country table" className="-mx-2 px-2">
              <table className="w-full text-left font-mono text-sm">
                <caption className="sr-only">Revenue by original currency</caption>
                <thead>
                  <tr className="label-mono">
                    <th scope="col" className="pb-3 font-normal">Currency</th>
                    <th scope="col" className="pb-3 text-right font-normal">Received</th>
                    <th scope="col" className="pb-3 text-right font-normal">{base}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byCurrency.map((c) => (
                    <tr key={c.currency} className="border-t border-line">
                      <th scope="row" className="py-3 font-normal text-ink-2">{c.currency}</th>
                      <td className="whitespace-nowrap py-3 pl-3 text-right text-ink">{formatMoney(c.totalMinor, c.currency)}</td>
                      <td className="whitespace-nowrap py-3 pl-3 text-right font-semibold text-ink">{formatMoney(c.totalBaseMinor, base)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollX>
          )}
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        <Card>
          <CardHeader title="By stream" subtitle={PERIOD_LABEL[period]} />
          <BarList currency={base} items={d.byStream.map((s) => ({ key: String(s.id), label: s.name, value: s.totalBaseMinor, href: `/streams/${s.id}?period=${period}`, note: `${s.deals} deals` }))} />
        </Card>
        <TopClients clients={d.topClients} currency={base} subtitle={PERIOD_LABEL[period]} />
      </div>
    </>
  );
}
