import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { SummaryCard } from "@/components/revenue/SummaryCard";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { countrySummaries, periodSchema } from "@/lib/dal/revenue";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Countries" };

export default async function CountriesPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const actor = await requirePerm("countries");
  const period = periodSchema.parse((await searchParams).period) ?? "12m";
  const [data, sample] = await Promise.all([countrySummaries(actor, period), hasSampleData(actor)]);
  const base = data.baseCurrency;
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });
  const ukAu = data.rows.filter((r) => r.code === "GB" || r.code === "AU").reduce((a, r) => a + r.sharePct, 0);

  return (
    <>
      <PageHeader
        title="Countries"
        subtitle={`Revenue by client country · ${PERIOD_LABEL[period]} · totals in ${base}`}
        sample={sample}
        actions={<PeriodSwitch path="/streams/countries" value={period} />}
      />
      <p className="mb-[var(--space-gap)] font-mono text-sm text-ink-2">
        UK + AUS = {Math.round(ukAu)}% of revenue · total {formatMoney(data.totalBaseMinor, base, { cents: false })}
      </p>
      <div className="grid grid-cols-1 gap-cards @min-[52rem]:grid-cols-3">
        {data.rows.map((c) => (
          <SummaryCard
            key={c.code}
            href={`/streams/countries/${c.code}?period=${period}`}
            tag={c.code === "OTHER" ? "ROW" : c.code}
            name={c.name}
            sharePct={c.sharePct}
            valueLabel={`Revenue in ${base}`}
            value={whole(c.revenueBaseMinor)}
            stats={[
              { label: "Deals", value: String(c.deals) },
              { label: "Average", value: c.deals ? whole(c.averageBaseMinor) : "None" },
              { label: "Unpaid", value: c.outstandingBaseMinor > 0 ? whole(c.outstandingBaseMinor) : "None", tone: c.outstandingBaseMinor > 0 ? "warning" : undefined },
            ]}
          >
            <div>
              <p className="label-mono mb-2">As received</p>
              {c.byCurrency.length === 0 ? (
                <p className="text-sm text-muted">Nothing received yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 font-mono text-sm">
                  {c.byCurrency.map((x) => (
                    <li key={x.currency} className="flex justify-between gap-3">
                      <span className="text-muted">{x.currency}</span>
                      <span className="whitespace-nowrap text-ink">{formatMoney(x.totalMinor, x.currency, { cents: false })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </SummaryCard>
        ))}
      </div>
    </>
  );
}
