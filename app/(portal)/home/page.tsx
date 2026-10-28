import Link from "next/link";
import { BarList } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { TrendChart } from "@/components/charts/LazyTrendChart";
import { IconCalendar, IconCard, IconMegaphone, IconTasks } from "@/components/icons";
import { ChatCard } from "@/components/home/ChatCard";
import { MeetingList, ProgressList, QuickActions, TaskList, type QuickAction } from "@/components/home/WorkCards";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill, PillSwitch } from "@/components/ui/Pill";
import { FitText } from "@/components/ui/FitText";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import type { Actor } from "@/lib/dal/guard";
import { upcomingEvents } from "@/lib/dal/calendar";
import { unreadChatSummary } from "@/lib/dal/chat";
import { myOpenTasks, teamProgress } from "@/lib/dal/tasks";
import { toTaskView } from "@/lib/task-view";
import { countryFilter, financeSummary } from "@/lib/dal/analytics";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { marketingSnapshot } from "@/lib/dal/marketing";
import { paymentsOverview } from "@/lib/dal/payments";
import { dueLabel, fmtMonth, fmtShortDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Overview" };

const COUNTRY_NAME = { GB: "UK", AU: "Australia" } as const;

/** "+18.2%" with a tone: up is good for revenue and profit, bad for expenses. */
function change(pct: number | null, upIsGood: boolean): { note: string; tone: "green" | "amber" | "red" | "neutral" } {
  if (pct === null) return { note: "No prior period", tone: "neutral" };
  const good = upIsGood ? pct >= 0 : pct <= 0;
  return { note: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, tone: good ? "green" : upIsGood ? "red" : "amber" };
}

/** Icon, title and an "Open" link, the same on every small Home card. */
function TileHeader({ icon, title, href }: { icon: React.ReactNode; title: string; href?: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="text-ink-2">{icon}</span>
      <h2 className="title-card mr-auto font-bold tracking-[-0.02em] text-ink">{title}</h2>
      {href && (
        <Link href={href} className="text-sm text-accent-text hover:underline">
          Open
        </Link>
      )}
    </div>
  );
}

/** Shortcuts to the forms this person may use. */
function quickActionsFor(user: Actor): QuickAction[] {
  const out: QuickAction[] = [];
  if (hasPerm(user, "tasks", "create")) out.push({ href: "/tasks?new=1", label: "New task", icon: "task" });
  if (hasPerm(user, "calendar", "create")) out.push({ href: "/calendar?new=1", label: "New event", icon: "event" });
  if (hasPerm(user, "marketing", "create")) out.push({ href: "/marketing?new=1", label: "Log activity", icon: "marketing" });
  if (hasPerm(user, "transactions", "create")) out.push({ href: "/transactions?new=1", label: "Add income", icon: "income" });
  if (hasPerm(user, "payments", "create")) out.push({ href: "/payments?new=1", label: "Add payment", icon: "payment" });
  return out;
}

/**
 * Staff home ("My Day"): today's meetings, the tasks due for you, quick
 * actions for what you're allowed to do, and payments or marketing only when
 * you have access to them.
 */
async function MyDay({ user, sample }: { user: Actor; sample: boolean }) {
  const first = (user.fullName || "there").split(" ")[0];
  const canCalendar = hasPerm(user, "calendar", "view");
  const canTasks = hasPerm(user, "tasks", "view");
  const canPayments = hasPerm(user, "payments", "view");
  const canMarketing = hasPerm(user, "marketing", "view");
  const canChat = hasPerm(user, "chat", "view");
  const [today, soon, mine, payments, mk, chat] = await Promise.all([
    canCalendar ? upcomingEvents(user, { todayOnly: true, limit: 8 }) : Promise.resolve(null),
    canCalendar ? upcomingEvents(user, { days: 7, limit: 4 }) : Promise.resolve(null),
    canTasks ? myOpenTasks(user, 6) : Promise.resolve(null),
    canPayments ? paymentsOverview(user) : Promise.resolve(null),
    canMarketing ? marketingSnapshot(user) : Promise.resolve(null),
    canChat ? unreadChatSummary(user, 4) : Promise.resolve(null),
  ]);
  const todayIso = today?.today ?? mine?.today ?? "";
  const dateLine = todayIso ? new Date(`${todayIso}T00:00:00Z`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "";
  const actions = quickActionsFor(user);
  const laterThisWeek = soon?.events.filter((e) => e.date !== todayIso) ?? [];
  const dueSoon = payments?.timeline.filter((x) => x.daysUntil <= 7) ?? [];
  const extras = (payments ? 1 : 0) + (mk ? 1 : 0) + (chat ? 1 : 0);

  return (
    <>
      <PageHeader title={`Hello, ${first}`} subtitle={`${dateLine} · your day at CoreNovaIT`} sample={sample} />
      {actions.length > 0 && (
        <Card className="mb-[var(--space-gap)]">
          <h2 className="label-mono mb-3">Quick actions</h2>
          <QuickActions actions={actions} />
        </Card>
      )}
      <div className="grid grid-cols-1 gap-cards @min-[56rem]:grid-cols-2">
        <Card className="flex flex-col">
          <TileHeader icon={<IconCalendar />} title="Today's meetings" href={canCalendar ? "/calendar?view=agenda" : undefined} />
          {!today ? (
            <p className="text-sm text-muted">You don&apos;t have access to the calendar.</p>
          ) : today.events.length === 0 ? (
            <p className="text-sm text-muted">Nothing on today.</p>
          ) : (
            <MeetingList items={today.events} today={today.today} showDay={false} />
          )}
          {laterThisWeek.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="label-mono mb-2">Later this week</h3>
              <MeetingList items={laterThisWeek} today={todayIso} />
            </div>
          )}
        </Card>
        <Card className="flex flex-col">
          <TileHeader icon={<IconTasks />} title="My tasks" href={canTasks ? "/tasks?assignee=me" : undefined} />
          {!mine ? (
            <p className="text-sm text-muted">You don&apos;t have access to tasks.</p>
          ) : mine.tasks.length === 0 ? (
            <p className="text-sm text-muted">Nothing due this week. Nice.</p>
          ) : (
            <>
              <TaskList tasks={mine.tasks.map(toTaskView)} />
              {mine.openTotal > mine.tasks.length && (
                <p className="mt-3 text-sm text-muted">
                  {mine.openTotal} open in total ·{" "}
                  <Link href="/tasks?assignee=me" className="text-accent-text hover:underline">
                    see all
                  </Link>
                </p>
              )}
            </>
          )}
        </Card>
      </div>
      {extras > 0 && (
        <div className={`mt-[var(--space-gap)] grid grid-cols-1 gap-cards ${extras > 1 ? "@min-[48rem]:grid-cols-2" : ""} ${extras > 2 ? "@min-[72rem]:grid-cols-3" : ""}`}>
          {payments && (
            <Card className="flex flex-col">
              <TileHeader icon={<IconCard />} title="Payments this week" href="/payments" />
              {dueSoon.length === 0 ? (
                <p className="text-sm text-muted">Nothing due in the next 7 days.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {dueSoon.slice(0, 5).map((x) => (
                    <li key={`${x.subscriptionId}-${x.dueDate}`} className="flex min-h-12 items-center justify-between gap-3 py-2">
                      <span className="clamp-2 min-w-0 text-sm font-medium text-ink">{x.vendor}</span>
                      <Badge tone={x.overdue ? "red" : x.dueSoon ? "amber" : "neutral"}>{dueLabel(x.daysUntil)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {mk && (
            <Card className="flex flex-col">
              <TileHeader icon={<IconMegaphone />} title="My marketing" href="/marketing" />
              <p className="text-sm text-ink-2">
                Last 30 days: <span className="font-semibold text-ink">{mk.contacts}</span> contacts reached, <span className="font-semibold text-ink">{mk.touches}</span> touches
                {mk.ratePct !== null ? `, ${mk.ratePct}% got a response` : ""}, <span className="font-semibold text-ink">{mk.won}</span> deals won.
              </p>
            </Card>
          )}
          {chat && <ChatCard summary={chat} />}
        </div>
      )}
    </>
  );
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const user = await requirePerm("home");
  const sample = await hasSampleData(user);

  if (!hasPerm(user, "finances", "view")) return <MyDay user={user} sample={sample} />;

  const country = countryFilter.parse((await searchParams).country);
  const canPayments = hasPerm(user, "payments", "view");
  const canMarketing = hasPerm(user, "marketing", "view");
  const canCalendar = hasPerm(user, "calendar", "view");
  const canTasks = hasPerm(user, "tasks", "view");
  const [s, payments, mk, meetings, team, mine] = await Promise.all([
    financeSummary(user, { country }),
    canPayments ? paymentsOverview(user, { country }) : Promise.resolve(null),
    canMarketing ? marketingSnapshot(user) : Promise.resolve(null),
    canCalendar ? upcomingEvents(user, { days: 14, limit: 4 }) : Promise.resolve(null),
    canTasks && user.perms.tasks.scope === "all" ? teamProgress(user) : Promise.resolve(null),
    canTasks && user.perms.tasks.scope !== "all" ? myOpenTasks(user, 4) : Promise.resolve(null),
  ]);
  const chat = hasPerm(user, "chat", "view") ? await unreadChatSummary(user, 3) : null;
  const base = s.baseCurrency;
  const cur = s.totals.current;
  const series = s.monthly;
  const range = `${fmtMonth(series[0].month, true)} – ${fmtMonth(series[series.length - 1].month, true)}`;
  const scope = country ? COUNTRY_NAME[country] : "All countries";
  const rev = change(s.totals.change.revenue, true);
  const pro = change(s.totals.change.profit, true);
  const exp = change(s.totals.change.expenses, false);
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });
  // sparklines show complete months only, so a month in progress doesn't look like a drop
  const done = s.lastMonthPartial ? series.slice(0, -1) : series;
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

      {/* bento grid: sized to the content area (container query), 12 columns when there is room */}
      <div className="grid grid-cols-1 gap-cards @min-[40rem]:grid-cols-2 @min-[60rem]:grid-cols-12">
        <div className="@min-[60rem]:col-span-3">
          <StatCard label="Total revenue" value={whole(cur.revenueBaseMinor)} note={rev.note} noteTone={rev.tone} detail={`${scope} · paid · vs prior year`} trend={done.map((m) => m.revenueBaseMinor)} />
        </div>
        <div className="@min-[60rem]:col-span-3">
          <StatCard label="Net profit" value={whole(cur.profitBaseMinor)} note={pro.note} noteTone={pro.tone} detail={s.marginPct === null ? `${scope} · vs prior year` : `${s.marginPct}% margin · vs prior year`} trend={done.map((m) => m.profitBaseMinor)} />
        </div>
        <div className="@min-[60rem]:col-span-3">
          <StatCard
            label="Total expenses"
            value={whole(cur.expensesBaseMinor)}
            note={exp.note}
            noteTone={exp.tone}
            detail={country ? `${COUNTRY_NAME[country]} costs · shared ${whole(s.sharedExpensesExcludedBaseMinor)} not included` : `${scope} · vs prior year`}
            trend={done.map((m) => m.expensesBaseMinor)}
          />
        </div>
        <div className="@min-[60rem]:col-span-3">
          {payments ? (
            <StatCard
              label="Upcoming payments"
              value={whole(payments.due30.totalBaseMinor)}
              note={`${payments.due30.count} ${payments.due30.count === 1 ? "payment" : "payments"} due`}
              noteTone={payments.due30.count ? "amber" : "neutral"}
              detail={payments.overdue.count ? `Next 30 days · ${payments.overdue.count} overdue` : "Next 30 days"}
            />
          ) : (
            <StatCard label="Upcoming payments" value="No access" detail="Ask an admin for access to payments" />
          )}
        </div>

        <Card className="@min-[40rem]:col-span-2 @min-[60rem]:col-span-8">
          <CardHeader title="Revenue, expenses and profit" subtitle={`${scope} · by month`} />
          <TrendChart
            data={series.map((m) => ({ month: m.month, revenue: m.revenueBaseMinor, expenses: m.expensesBaseMinor, profit: m.profitBaseMinor }))}
            currency={base}
            label={`Revenue, expenses and profit by month, ${range}`}
            partialLast={s.lastMonthPartial}
          />
        </Card>

        <Card className="@min-[60rem]:col-span-4">
          <CardHeader title="Revenue by source" subtitle="Paid, last 12 months" />
          {s.byStream.length === 0 ? (
            <p className="text-sm text-muted">No paid revenue in this period.</p>
          ) : (
            <Donut caption="Revenue by stream" centerLabel="12 months" currency={base} items={s.byStream.map((x) => ({ key: String(x.id), label: x.name, value: x.totalBaseMinor }))} />
          )}
        </Card>

        <Card className="@min-[60rem]:col-span-4">
          <CardHeader title="Revenue by country" aside={!country && s.byCountry.length > 0 ? <Pill>UK + AUS = {Math.round(ukAu)}%</Pill> : undefined} />
          <BarList
            currency={base}
            items={s.byCountry.map((c) => ({ key: c.code, tag: c.code === "OTHER" ? "ROW" : c.code, label: c.name, value: c.totalBaseMinor }))}
          />
          {!country && <p className="mt-5 rounded-[14px] border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">Use the country switch at the top to see revenue, profit and costs for the UK or Australia alone.</p>}
        </Card>

        <ChatCard summary={chat} className="@min-[60rem]:col-span-3" />

        <Card className="@min-[40rem]:col-span-2 @min-[60rem]:col-span-5">
          <CardHeader
            title="Upcoming payments"
            subtitle={payments ? `${whole(payments.due30.totalBaseMinor)} · next 30 days` : undefined}
            aside={canPayments ? <Link href="/payments" className="text-sm text-accent-text hover:underline">Open payments</Link> : undefined}
          />
          {!payments ? (
            <p className="text-sm text-muted">You don&apos;t have access to payments.</p>
          ) : upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing due in the next 30 days.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {upcoming.slice(0, 6).map((x) => (
                <li key={`${x.subscriptionId}-${x.dueDate}`} className="flex min-h-14 items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line font-display font-bold text-ink">{x.vendor.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="clamp-2 font-medium leading-snug text-ink">{x.vendor}</span>
                    <span className="block whitespace-nowrap text-xs text-muted">
                      {x.category} · {fmtShortDate(x.dueDate)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num font-mono text-sm font-semibold text-ink">{whole(x.amountBaseMinor)}</span>
                    <Badge tone={x.overdue ? "red" : x.dueSoon ? "amber" : "neutral"}>{dueLabel(x.daysUntil)}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="@container flex flex-col @min-[60rem]:col-span-6 @min-[80rem]:col-span-3" accent={cur.outstandingBaseMinor > 0}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="title-card mr-auto font-bold tracking-[-0.02em] text-ink">Outstanding</h2>
            {cur.outstandingBaseMinor > 0 ? <Badge tone="amber">Follow up</Badge> : <Badge tone="green">All paid</Badge>}
          </div>
          <FitText className="kpi-number font-bold text-warning">{whole(cur.outstandingBaseMinor)}</FitText>
          <p className="mt-3 text-sm text-muted">Invoiced, not yet paid: pending and overdue invoices from the last 12 months{country ? ` (${COUNTRY_NAME[country]})` : ""}. Not counted in revenue until marked paid.</p>
          {hasPerm(user, "transactions", "view") && (
            <div className="mt-auto flex flex-wrap gap-2 pt-4">
              <ButtonLink size="sm" variant="secondary" href={`/transactions?tab=income&status=overdue${country ? `&country=${country}` : ""}`}>
                Overdue
              </ButtonLink>
              <ButtonLink size="sm" variant="ghost" href={`/transactions?tab=income&status=pending${country ? `&country=${country}` : ""}`}>
                Pending
              </ButtonLink>
            </div>
          )}
        </Card>
        <Card className="flex flex-col @min-[60rem]:col-span-6 @min-[80rem]:col-span-3">
          <TileHeader icon={<IconMegaphone />} title="Marketing" href={mk ? "/marketing" : undefined} />
          {!mk ? (
            <p className="text-sm text-muted">You don&apos;t have access to marketing.</p>
          ) : mk.touches === 0 ? (
            <p className="text-sm text-muted">No activity logged in the last 30 days.</p>
          ) : (
            <>
              {/* wraps to fewer columns rather than letting labels and figures run into each other */}
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-3">
                <div className="min-w-0">
                  <dt className="label-mono">Reached</dt>
                  <dd className="num mt-1 font-display text-2xl font-bold text-ink">{mk.contacts}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="label-mono">Response</dt>
                  <dd className="num mt-1 font-display text-2xl font-bold text-ink">{mk.ratePct}%</dd>
                </div>
                <div className="min-w-0">
                  <dt className="label-mono">Won</dt>
                  <dd className="num mt-1 font-display text-2xl font-bold text-ink">{mk.won}</dd>
                </div>
              </dl>
              <p className="mt-auto pt-3 text-sm text-muted">
                Last 30 days · {mk.touches} touches{mk.wonValueBaseMinor ? ` · ${whole(mk.wonValueBaseMinor)} won` : ""}
              </p>
            </>
          )}
        </Card>
        <Card className="flex flex-col @min-[60rem]:col-span-6 @min-[80rem]:col-span-3">
          <TileHeader icon={<IconCalendar />} title="Next meetings" href={meetings ? "/calendar?view=agenda" : undefined} />
          {!meetings ? (
            <p className="text-sm text-muted">You don&apos;t have access to the calendar.</p>
          ) : meetings.events.length === 0 ? (
            <p className="text-sm text-muted">Nothing booked in the next two weeks.</p>
          ) : (
            <MeetingList items={meetings.events} today={meetings.today} />
          )}
        </Card>
        <Card className="flex flex-col @min-[60rem]:col-span-6 @min-[80rem]:col-span-3">
          <TileHeader icon={<IconTasks />} title={team ? "Team tasks this week" : "My tasks"} href={canTasks ? "/tasks" : undefined} />
          {team ? (
            team.people.length === 0 ? (
              <p className="text-sm text-muted">No open tasks.</p>
            ) : (
              <ProgressList people={team.people.slice(0, 5)} />
            )
          ) : mine ? (
            mine.tasks.length === 0 ? (
              <p className="text-sm text-muted">Nothing due this week.</p>
            ) : (
              <TaskList tasks={mine.tasks.map(toTaskView)} />
            )
          ) : (
            <p className="text-sm text-muted">You don&apos;t have access to tasks.</p>
          )}
        </Card>
      </div>
    </>
  );
}
