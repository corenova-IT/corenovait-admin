import Link from "next/link";
import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { Pill } from "@/components/ui/Pill";
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
  const ukAu = data.rows.filter((r) => r.code === "GB" || r.code === "AU").reduce((a, r) => a + r.sharePct, 0);

  return (
    <>
      <PageHeader
        title="Countries"
        subtitle={`Revenue by client country · ${PERIOD_LABEL[period]} · totals in ${base}`}
        sample={sample}
        actions={<PeriodSwitch path="/streams/countries" value={period} />}
      />
      <p className="mb-5 font-mono text-sm text-ink-2">
        UK + AUS = {Math.round(ukAu)}% of revenue · total {formatMoney(data.totalBaseMinor, base, { cents: false })}
      </p>
      <div className="grid gap-5 lg:grid-cols-3">
        {data.rows.map((c) => (
          <Link key={c.code} href={`/streams/countries/${c.code}?period=${period}`} className="glass glass-glow flex flex-col gap-5 p-6 transition-colors hover:border-accent-line">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className="rounded-lg border border-line px-2 py-0.5 font-mono text-xs text-ink-2">{c.code === "OTHER" ? "ROW" : c.code}</span>
                <span className="font-display text-lg font-bold text-ink">{c.name}</span>
              </span>
              <Pill>{c.sharePct}%</Pill>
            </div>
            <div>
              <p className="label-mono mb-2">Revenue in {base}</p>
              <p className="num glow-text text-3xl font-bold text-ink">{formatMoney(c.revenueBaseMinor, base, { cents: false })}</p>
            </div>
            <div>
              <p className="label-mono mb-2">As received</p>
              {c.byCurrency.length === 0 ? (
                <p className="text-sm text-muted">Nothing received yet.</p>
              ) : (
                <ul className="flex flex-col gap-1 font-mono text-sm">
                  {c.byCurrency.map((x) => (
                    <li key={x.currency} className="flex justify-between gap-3">
                      <span className="text-muted">{x.currency}</span>
                      <span className="text-ink">{formatMoney(x.totalMinor, x.currency)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="font-mono text-xs text-muted">
              {c.deals} deals · average {formatMoney(c.averageBaseMinor, base, { cents: false })}
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
