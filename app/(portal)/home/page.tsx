import Link from "next/link";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { TrendChart } from "@/components/charts/TrendChart";
import { IconCalendar, IconMegaphone, IconOverview, IconTasks } from "@/components/icons";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, PillSwitch } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { countryFilter, financeSummary } from "@/lib/dal/analytics";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { paymentsOverview } from "@/lib/dal/payments";
import { dueLabel, fmtDate, fmtMonth } from "@/lib/format";
import { formatMoney, splitMinor } from "@/lib/money";

export const metadata = { title: "Overview" };

const COUNTRY_NAME = { GB: "UK", AU: "Australia" } as const;

/** "+18.2%" with a tone: up is good for revenue and profit, bad for expenses. */
function change(pct: number | null, upIsGood: boolean): { note: string; tone: "green" | "amber" | "red" | "neutral" } {
  if (pct === null) return { note: "No earlier data", tone: "neutral" };
  const good = upIsGood ? pct >= 0 : pct <= 0;
  return { note: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, tone: good ? "green" : upIsGood ? "red" : "amber" };
}

/** "A$694,000" and ".00" separately, for the lighter-grey decimals. */
const parts = (minor: number, currency: string) => splitMinor(BigInt(minor), currency);

/** A later phase's card: no numbers until the data exists. */
function ComingTile({ icon, title, phase, children, className }: { icon: React.ReactNode; title: string; phase: number; children: React.ReactNode; className?: string }) {
  return (
    <Card className={`flex flex-col gap-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-[20px] font-bold tracking-[-0.02em] text-ink">{title}</h2>
        <Pill>Phase {phase}</Pill>
      </div>
      <div className="flex items-start gap-3 text-sm text-muted">
        <span className="mt-0.5 text-ink-2">{icon}</span>
        <p>{children}</p>
      </div>
    </Card>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const user = await requirePerm("home");
  const sample = await hasSampleData(user);

  if (!hasPerm(user, "finances", "view")) {
    const first = (user.fullName || "there").split(" ")[0];
    return (
      <>
        <PageHeader title={`Hello, ${first}`} subtitle="Your day at CoreNovaIT" sample={sample} />
        <Card>
          <EmptyState icon={<IconOverview size={22} />} title="Your “My Day” page arrives in Phase 4">
            Today&apos;s meetings, the tasks due for you, unread chat and quick actions will appear here.
          </EmptyState>
        </Card>
      </>
    );
  }

  const country = countryFilter.parse((await searchParams).country);
  const canPayments = hasPerm(user, "payments", "view");
  const [s, payments] = await Promise.all([financeSummary(user, { country }), canPayments ? paymentsOverview(user, { country }) : Promise.resolve(null)]);
  const base = s.baseCurrency;
  const cur = s.totals.current;
  const series = s.monthly;
  const range = `${fmtMonth(series[0].month, true)} – ${fmtMonth(series[series.length - 1].month, true)}`;
  const scope = country ? COUNTRY_NAME[country] : "All countries";
  const rev = change(s.totals.change.revenue, true);
  const pro = change(s.totals.change.profit, true);
  const exp = change(s.totals.change.expenses, false);
  const revM = parts(cur.revenueBaseMinor, base);
  const proM = parts(cur.profitBaseMinor, base);
  const expM = parts(cur.expensesBaseMinor, base);
  const upcoming = payments?.timeline.filter((x) => x.daysUntil <= 30) ?? [];
  const ukAu = s.byCountry.filter((c) => c.code === "GB" || c.code === "AU").reduce((a, c) => a + c.sharePct, 0);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Company finances · last 12 months · reported in ${base}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-[14px] border border-line bg-surface px-4 py-2.5 font-mono text-sm text-ink-2">{range}</span>
            <PillSwitch
              label="Country"
              value={country ?? "all"}
              options={[
                { value: "all", label: "All", href: "/home" },
                { value: "GB", label: "UK", href: "/home?country=GB" },
                { value: "AU", label: "AUS", href: "/home?country=AU" },
              ]}
            />
          </div>
        }
      />

      {/* bento grid: 12 columns on wide screens, cards of different sizes */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-12">
        <div className="xl:col-span-3">
          <StatCard label="Total revenue" value={revM.main} decimals={revM.decimals} note={rev.note} noteTone={rev.tone} detail={`${scope} · paid · vs prior year`} trend={series.map((m) => m.revenueBaseMinor)} />
        </div>
        <div className="xl:col-span-3">
          <StatCard label="Net profit" value={proM.main} decimals={proM.decimals} note={pro.note} noteTone={pro.tone} detail={s.marginPct === null ? `${scope} · vs prior year` : `${s.marginPct}% margin · vs prior year`} trend={series.map((m) => m.profitBaseMinor)} />
        </div>
        <div className="xl:col-span-3">
          <StatCard
            label="Total expenses"
            value={expM.main}
            decimals={expM.decimals}
            note={exp.note}
            noteTone={exp.tone}
            detail={country ? `${COUNTRY_NAME[country]} costs · shared ${formatMoney(s.sharedExpensesExcludedBaseMinor, base, { cents: false })} not included` : `${scope} · vs prior year`}
            trend={series.map((m) => m.expensesBaseMinor)}
          />
        </div>
        <div className="xl:col-span-3">
          {payments ? (
            <StatCard
              label="Upcoming payments"
              value={formatMoney(payments.due30.totalBaseMinor, base, { cents: false })}
              note={`${payments.due30.count} ${payments.due30.count === 1 ? "payment" : "payments"} due`}
              noteTone={payments.due30.count ? "amber" : "neutral"}
              detail={payments.overdue.count ? `Next 30 days · ${payments.overdue.count} overdue` : "Next 30 days"}
            />
          ) : (
            <StatCard label="Upcoming payments" value="—" detail="You don't have access to payments" />
          )}
        </div>

        <Card className="md:col-span-2 xl:col-span-8">
          <CardHeader title="Revenue, expenses and profit" subtitle={`${scope} · by month`} />
          <TrendChart
            data={series.map((m) => ({ month: m.month, revenue: m.revenueBaseMinor, expenses: m.expensesBaseMinor, profit: m.profitBaseMinor }))}
            currency={base}
            label={`Revenue, expenses and profit by month, ${range}`}
          />
        </Card>

        <Card className="xl:col-span-4">
          <CardHeader title="Revenue by source" subtitle="Paid, last 12 months" />
          {s.byStream.length === 0 ? (
            <p className="text-sm text-muted">No paid revenue in this period.</p>
          ) : (
            <Donut caption="Revenue by stream" centerLabel="12 months" currency={base} items={s.byStream.map((x) => ({ key: String(x.id), label: x.name, value: x.totalBaseMinor }))} />
          )}
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader title="Revenue by country" aside={!country && s.byCountry.length > 0 ? <Pill>UK + AUS = {Math.round(ukAu)}%</Pill> : undefined} />
          <BarList
            currency={base}
            items={s.byCountry.map((c) => ({ key: c.code, tag: c.code === "OTHER" ? "ROW" : c.code, label: c.name, value: c.totalBaseMinor }))}
          />
          {!country && <p className="mt-5 rounded-[14px] border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">Use the country switch at the top to see revenue, profit and costs for the UK or Australia alone.</p>}
        </Card>

        <Card className="md:col-span-2 xl:col-span-7">
          <CardHeader
            title="Upcoming payments"
            subtitle={payments ? `${formatMoney(payments.due30.totalBaseMinor, base, { cents: false })} · next 30 days` : undefined}
            aside={canPayments ? <Link href="/payments" className="text-sm text-accent-text hover:underline">Open payments</Link> : undefined}
          />
          {!payments ? (
            <p className="text-sm text-muted">You don&apos;t have access to payments.</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing due in the next 30 days.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {upcoming.slice(0, 6).map((x) => (
                <li key={`${x.subscriptionId}-${x.dueDate}`} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line font-display font-bold text-ink">{x.vendor.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{x.vendor}</span>
                      <span className="block text-xs text-muted">
                        {x.category} · due {fmtDate(x.dueDate)}
                      </span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <Badge tone={x.overdue ? "red" : x.dueSoon ? "amber" : "neutral"}>{dueLabel(x.daysUntil)}</Badge>
                    <span className="num font-mono text-sm font-semibold text-ink">{formatMoney(x.amountBaseMinor, base, { cents: false })}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="xl:col-span-3" accent={cur.outstandingBaseMinor > 0}>
          <CardHeader title="Outstanding" subtitle="Invoiced, not yet paid" aside={cur.outstandingBaseMinor > 0 ? <Badge tone="amber">Follow up</Badge> : <Badge tone="green">All paid</Badge>} />
          <p className="num text-[34px] font-bold leading-none text-warning">{formatMoney(cur.outstandingBaseMinor, base, { cents: false })}</p>
          <p className="mt-3 text-sm text-muted">Pending and overdue invoices from the last 12 months{country ? ` (${COUNTRY_NAME[country]})` : ""}. Not counted in revenue until marked paid.</p>
          {hasPerm(user, "transactions", "view") && (
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink size="sm" variant="secondary" href={`/transactions?tab=income&status=overdue${country ? `&country=${country}` : ""}`}>
                Overdue
              </ButtonLink>
              <ButtonLink size="sm" variant="ghost" href={`/transactions?tab=income&status=pending${country ? `&country=${country}` : ""}`}>
                Pending
              </ButtonLink>
            </div>
          )}
        </Card>
        <ComingTile className="xl:col-span-3" icon={<IconMegaphone />} title="Marketing snapshot" phase={3}>
          Contacts reached, response rate and deals won will appear here once marketing activity is logged.
        </ComingTile>
        <ComingTile className="xl:col-span-3" icon={<IconCalendar />} title="Next meetings" phase={4}>
          Your next meetings from the calendar.
        </ComingTile>
        <ComingTile className="xl:col-span-3" icon={<IconTasks />} title="Team tasks this week" phase={4}>
          Progress per team member from the task board.
        </ComingTile>
      </div>
    </>
  );
}
