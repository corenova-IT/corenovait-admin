import { AddSubscription, SubscriptionActions, type PaymentLookups, type SubView } from "@/components/payments/PaymentForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { PillSwitch } from "@/components/ui/Pill";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { countryFilter } from "@/lib/dal/analytics";
import { financeLookups, hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { CYCLE_LABEL, paymentsOverview, responsibleCandidates, type Occurrence, type SubscriptionRow } from "@/lib/dal/payments";
import { dueLabel, fmtShortDate, hrefWith } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { deleteSubscription, markPaid, saveSubscription, setStatus } from "./actions";

export const metadata = { title: "Payments" };

const subView = (s: SubscriptionRow): SubView => ({
  id: s.id,
  vendor: s.vendor,
  category: s.category,
  description: s.description,
  amountMinor: s.amountMinor,
  currency: s.currency,
  fxRateToBase: s.fxRateToBase,
  billingCycle: s.billingCycle,
  nextDueDate: s.nextDueDate,
  status: s.status,
  reminderDays: s.reminderDays,
  paidFrom: s.paidFrom,
  responsibleUserId: s.responsibleUserId,
  countryCode: s.countryCode,
  notes: s.notes,
});

const STATUS = { active: ["Active", "green"], paused: ["Paused", "amber"], cancelled: ["Cancelled", "neutral"], completed: ["Completed", "neutral"] } as const;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ window?: string; country?: string; new?: string }> }) {
  const actor = await requirePerm("payments");
  const sp = await searchParams;
  const windowDays = sp.window === "60" ? 60 : sp.window === "90" ? 90 : 30;
  const country = countryFilter.parse(sp.country);
  const can = { create: hasPerm(actor, "payments", "create"), edit: hasPerm(actor, "payments", "edit"), delete: hasPerm(actor, "payments", "delete") };
  const [o, lookupsRaw, people, sample] = await Promise.all([
    paymentsOverview(actor, { country }),
    financeLookups(actor),
    can.create || can.edit ? responsibleCandidates(actor) : Promise.resolve([]),
    hasSampleData(actor),
  ]);
  const base = o.baseCurrency;
  const lookups: PaymentLookups = { categories: lookupsRaw.categories, countries: lookupsRaw.countries, people, baseCurrency: base, today: o.today };
  const shown = o.timeline.filter((x) => x.daysUntil <= windowDays);
  const shownTotal = shown.reduce((a, x) => a + x.amountBaseMinor, 0);
  const keep = { window: sp.window, country };
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });
  const actions = { save: saveSubscription, setStatus, markPaid, remove: deleteSubscription };

  const columns: Column<SubscriptionRow>[] = [
    {
      key: "vendor",
      header: "Paid to",
      cell: (s) => (
        <div className="min-w-0">
          <p className="clamp-2 font-medium leading-snug text-ink">{s.vendor}</p>
          <p className="clamp-2 text-sm text-muted">{[s.category, CYCLE_LABEL[s.billingCycle], s.countryCode ?? "Shared"].filter(Boolean).join(" · ")}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (s) => (
        <span className="num whitespace-nowrap font-mono">
          {formatMoney(s.amountMinor, s.currency)}
          {s.monthlyBaseMinor > 0 && s.billingCycle !== "monthly" && <span className="block text-xs text-muted">{formatMoney(s.monthlyBaseMinor, base)}/mo</span>}
        </span>
      ),
    },
    {
      key: "due",
      header: "Next due",
      cell: (s) =>
        s.status === "active" ? (
          <span className="flex flex-col items-start gap-1">
            <span className="whitespace-nowrap font-mono text-sm text-ink-2">{fmtShortDate(s.nextDueDate)}</span>
            <Badge tone={s.overdue ? "red" : s.dueSoon ? "amber" : "neutral"}>{dueLabel(s.daysUntilDue)}</Badge>
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "status", header: "Status", cell: (s) => <Badge tone={STATUS[s.status][1]}>{STATUS[s.status][0]}</Badge> },
    { key: "actions", header: "", align: "right", cell: (s) => <SubscriptionActions sub={subView(s)} lookups={lookups} can={can} actions={actions} /> },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={`Subscriptions and upcoming payments · in ${base}${country ? ` · ${country === "GB" ? "UK" : "Australia"} only` : ""}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <PillSwitch
              label="Country"
              value={country ?? "all"}
              options={[
                { value: "all", label: "All", href: hrefWith("/payments", keep, { country: undefined }) },
                { value: "GB", label: "UK", href: hrefWith("/payments", keep, { country: "GB" }) },
                { value: "AU", label: "AUS", href: hrefWith("/payments", keep, { country: "AU" }) },
              ]}
            />
            {can.create && <AddSubscription lookups={lookups} action={saveSubscription} initialOpen={sp.new === "1"} />}
          </div>
        }
      />
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Due next 30 days" value={whole(o.due30.totalBaseMinor)} note={`${o.due30.count} payments`} noteTone={o.due30.count ? "amber" : "neutral"} detail={`60 days ${whole(o.due60.totalBaseMinor)} · 90 days ${whole(o.due90.totalBaseMinor)}`} />
        <StatCard label="Monthly recurring" value={whole(o.monthlyRecurringBaseMinor)} note="Per month" detail="Active subscriptions (weekly × 52 ÷ 12, yearly ÷ 12)" />
        <StatCard label="Overdue" value={whole(o.overdue.totalBaseMinor)} note={o.overdue.count ? `${o.overdue.count} not marked paid` : "Nothing overdue"} noteTone={o.overdue.count ? "red" : "green"} detail="Past the due date" />
        <StatCard label="Active" value={String(o.activeCount)} note={o.activeCount === 1 ? "Subscription" : "Subscriptions"} detail={`${o.subscriptions.length - o.activeCount} paused, cancelled or completed`} />
      </div>

      {/* side by side only when the table has room to fit without scrolling; stacked (timeline first) otherwise */}
      <div className="grid grid-cols-1 gap-cards @min-[100rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <Card>
          <CardHeader
            title="Upcoming"
            subtitle={`${shown.length} payments · ${whole(shownTotal)}`}
            aside={
              <PillSwitch
                label="Window"
                value={String(windowDays)}
                options={[30, 60, 90].map((d) => ({ value: String(d), label: `${d} days`, href: hrefWith("/payments", keep, { window: String(d) }) }))}
              />
            }
          />
          {shown.length === 0 ? (
            <EmptyState title="Nothing due">No active payments fall due in the next {windowDays} days.</EmptyState>
          ) : (
            <ol className="grid-fill [--min:20rem] [row-gap:0]">
              {shown.map((x: Occurrence) => (
                <li key={`${x.subscriptionId}-${x.dueDate}`} className="flex min-h-14 items-center gap-3 border-b border-line/70 py-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line font-display font-bold text-ink">{x.vendor.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0 flex-1">
                    <span className="clamp-2 font-medium leading-snug text-ink">{x.vendor}</span>
                    <span className="block whitespace-nowrap text-xs text-muted">
                      {x.category} · {fmtShortDate(x.dueDate)}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num whitespace-nowrap font-mono text-sm font-semibold text-ink">{formatMoney(x.amountBaseMinor, base)}</span>
                    <Badge tone={x.overdue ? "red" : x.dueSoon ? "amber" : "neutral"}>{dueLabel(x.daysUntil)}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader title="Subscriptions and payments" subtitle="Mark paid records an expense and moves the next due date on." />
          <DataTable
            caption="Subscriptions and payments"
            columns={columns}
            rows={o.subscriptions}
            rowKey={(s) => s.id}
            empty={{ title: "No subscriptions yet", body: can.create ? "Add hosting, software and other regular costs to see what's coming up." : undefined }}
          />
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">Reminders show here and on Home as amber badges. Email reminders arrive with notifications in Phase 5.</p>
    </>
  );
}
