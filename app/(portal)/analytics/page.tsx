import { BarList } from "@/components/charts/BarList";
import { Sparkline } from "@/components/charts/Sparkline";
import { TrendChart } from "@/components/charts/TrendChart";
import { TopClients } from "@/components/revenue/TopClients";
import { ExportLink } from "@/components/transactions/LedgerActions";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillSwitch } from "@/components/ui/Pill";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { countryFilter, financeSummary, type FinanceSummary } from "@/lib/dal/analytics";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { fmtMonth } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Finances" };

const COUNTRY_NAME = { GB: "UK", AU: "Australia" } as const;

function Pct({ value, upIsGood = true }: { value: number | null; upIsGood?: boolean }) {
  if (value === null) return <span className="text-muted">—</span>;
  const good = upIsGood ? value >= 0 : value <= 0;
  return (
    <span className={good ? "text-success" : "text-accent-text"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}%
    </span>
  );
}

function ComparisonTable({ s }: { s: FinanceSummary }) {
  const base = s.baseCurrency;
  const rows = [s.comparisons.month, s.comparisons.quarter, s.comparisons.year];
  const metric = (label: string, key: "revenueBaseMinor" | "expensesBaseMinor" | "profitBaseMinor", change: "revenue" | "expenses" | "profit", upIsGood: boolean) =>
    rows.map((r) => (
      <td key={r.label + key} className="py-3 pr-4 text-right align-top font-mono text-sm">
        <span className="block text-ink">{formatMoney(r.current[key], base, { cents: false })}</span>
        <span className="block text-xs text-muted">
          was {formatMoney(r.previous[key], base, { cents: false })} · <Pct value={r.change[change]} upIsGood={upIsGood} />
        </span>
      </td>
    ));
  return (
    <div className="-mx-2 overflow-x-auto px-2">
      <table className="w-full min-w-[560px] text-left">
        <caption className="sr-only">Month, quarter and year comparisons</caption>
        <thead>
          <tr className="label-mono">
            <th scope="col" className="pb-3 font-normal" />
            {rows.map((r) => (
              <th key={r.label} scope="col" className="pb-3 pr-4 text-right font-normal">
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          <tr>
            <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">Revenue</th>
            {metric("Revenue", "revenueBaseMinor", "revenue", true)}
          </tr>
          <tr>
            <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">Expenses</th>
            {metric("Expenses", "expensesBaseMinor", "expenses", false)}
          </tr>
          <tr>
            <th scope="row" className="py-3 pr-4 align-top font-medium text-ink">Profit</th>
            {metric("Profit", "profitBaseMinor", "profit", true)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const actor = await requirePerm("finances");
  const country = countryFilter.parse((await searchParams).country);
  const [s, sample] = await Promise.all([financeSummary(actor, { country }), hasSampleData(actor)]);
  const base = s.baseCurrency;
  const cur = s.totals.current;
  const range = `${fmtMonth(s.monthly[0].month, true)} – ${fmtMonth(s.monthly[s.monthly.length - 1].month, true)}`;
  const scope = country ? COUNTRY_NAME[country] : "All countries";
  const matrixCountries = [...new Set(s.streamByCountry.map((x) => x.code))].sort();
  const matrixStreams = s.byStream;
  const cell = (streamId: number, code: string) => s.streamByCountry.find((x) => x.streamId === streamId && x.code === code)?.totalBaseMinor ?? 0;

  return (
    <>
      <PageHeader
        title="Finances"
        subtitle={`Revenue (paid), expenses and profit · ${range} · in ${base}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <PillSwitch
              label="Country"
              value={country ?? "all"}
              options={[
                { value: "all", label: "All", href: "/analytics" },
                { value: "GB", label: "UK", href: "/analytics?country=GB" },
                { value: "AU", label: "AUS", href: "/analytics?country=AU" },
              ]}
            />
            {hasPerm(actor, "finances", "export") && <ExportLink href={`/api/export/finances${country ? `?country=${country}` : ""}`} />}
          </div>
        }
      />

      <div className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Revenue" value={formatMoney(cur.revenueBaseMinor, base, { cents: false })} note={<Pct value={s.totals.change.revenue} />} detail={`${scope} · vs previous 12 months`} />
        <StatCard label="Expenses" value={formatMoney(cur.expensesBaseMinor, base, { cents: false })} note={<Pct value={s.totals.change.expenses} upIsGood={false} />} detail={country ? `${COUNTRY_NAME[country]} costs only` : "All costs"} />
        <StatCard label="Profit" value={formatMoney(cur.profitBaseMinor, base, { cents: false })} note={<Pct value={s.totals.change.profit} />} detail="Revenue − expenses" />
        <StatCard
          label="Margin"
          value={s.marginPct === null ? "—" : `${s.marginPct}%`}
          detail={s.previousMarginPct === null ? "No earlier data" : `${s.previousMarginPct}% the year before`}
        />
        <StatCard label="Outstanding" value={formatMoney(cur.outstandingBaseMinor, base, { cents: false })} noteTone="amber" note={cur.outstandingBaseMinor > 0 ? "Not yet paid" : undefined} detail="Pending + overdue invoices" />
      </div>

      {country && s.sharedExpensesExcludedBaseMinor > 0 && (
        <p className="mb-6 rounded-[14px] border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
          Showing {COUNTRY_NAME[country]} only. Shared costs not tagged to a country ({formatMoney(s.sharedExpensesExcludedBaseMinor, base, { cents: false })} in this period) are not included. Tag an expense with a country in Transactions to count it here.
        </p>
      )}

      <Card className="mb-6">
        <CardHeader title="Trends" subtitle={`${scope} · by month`} />
        <TrendChart
          data={s.monthly.map((m) => ({ month: m.month, revenue: m.revenueBaseMinor, expenses: m.expensesBaseMinor, profit: m.profitBaseMinor }))}
          currency={base}
          label={`Revenue, expenses and profit by month, ${range}`}
        />
      </Card>

      <Card className="mb-6">
        <CardHeader title="Month, quarter and year" subtitle="Each period compared with the one before it" />
        <ComparisonTable s={s} />
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Revenue by stream" subtitle="Last 12 months, with the monthly trend" />
          {s.byStream.length === 0 ? (
            <p className="text-sm text-muted">No paid revenue in this period.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {s.byStream.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{x.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {x.sharePct}% · {x.deals} paid deals
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <Sparkline values={x.trend} label={`${x.name}: revenue by month`} />
                    <span className="num w-28 text-right font-mono font-semibold text-ink">{formatMoney(x.totalBaseMinor, base, { cents: false })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Revenue by country" subtitle="Last 12 months, with the monthly trend" />
          {s.byCountry.length === 0 ? (
            <p className="text-sm text-muted">No paid revenue in this period.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {s.byCountry.map((x) => (
                <li key={x.code} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="rounded-lg border border-line px-2 py-0.5 font-mono text-[11px] text-ink-2">{x.code === "OTHER" ? "ROW" : x.code}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{x.name}</span>
                      <span className="font-mono text-xs text-muted">{x.sharePct}%</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4">
                    <Sparkline values={x.trend} label={`${x.name}: revenue by month`} />
                    <span className="num w-28 text-right font-mono font-semibold text-ink">{formatMoney(x.totalBaseMinor, base, { cents: false })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader title="Stream × country" subtitle="Paid revenue, last 12 months" />
        {matrixStreams.length === 0 ? (
          <p className="text-sm text-muted">No paid revenue in this period.</p>
        ) : (
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[520px] text-left font-mono text-sm">
              <caption className="sr-only">Paid revenue by stream and country</caption>
              <thead>
                <tr className="label-mono">
                  <th scope="col" className="pb-3 font-normal">Stream</th>
                  {matrixCountries.map((c) => (
                    <th key={c} scope="col" className="pb-3 pr-4 text-right font-normal">
                      {c === "OTHER" ? "ROW" : c}
                    </th>
                  ))}
                  <th scope="col" className="pb-3 text-right font-normal">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {matrixStreams.map((st) => (
                  <tr key={st.id}>
                    <th scope="row" className="py-3 pr-4 font-sans font-medium text-ink">{st.name}</th>
                    {matrixCountries.map((c) => (
                      <td key={c} className="py-3 pr-4 text-right text-ink-2">
                        {cell(st.id, c) ? formatMoney(cell(st.id, c), base, { cents: false }) : "—"}
                      </td>
                    ))}
                    <td className="py-3 text-right font-semibold text-ink">{formatMoney(st.totalBaseMinor, base, { cents: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <TopClients clients={s.topClients} currency={base} subtitle="Paid, last 12 months" />
        <Card>
          <CardHeader title="Expenses by category" subtitle={country ? `${COUNTRY_NAME[country]} costs, last 12 months` : "Last 12 months"} />
          <BarList currency={base} items={s.expensesByCategory.map((c) => ({ key: c.category, label: c.category, value: c.totalBaseMinor }))} />
        </Card>
      </div>
    </>
  );
}
