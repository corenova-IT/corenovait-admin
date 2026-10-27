import Link from "next/link";
import { MonthBars } from "@/components/charts/MonthBars";
import { ActivityRowActions, LogActivity, type ActivityLookups, type ActivityView } from "@/components/marketing/ActivityForms";
import { AddCampaign, CampaignActions } from "@/components/marketing/CampaignForms";
import { Heatmap } from "@/components/marketing/Heatmap";
import { ExportLink } from "@/components/transactions/LedgerActions";
import { Badge } from "@/components/ui/Badge";
import { ButtonLink, Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable, Pagination, type Column } from "@/components/ui/DataTable";
import { Field, Select } from "@/components/ui/Field";
import { FitText } from "@/components/ui/FitText";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { StatCard } from "@/components/ui/StatCard";
import { requirePerm } from "@/lib/auth/session";
import { hasSampleData } from "@/lib/dal/finance";
import { hasPerm } from "@/lib/dal/guard";
import { campaignResults, canManageCampaigns, listActivities, marketingFilters, marketingLookups, marketingSummary, type ActivityRow } from "@/lib/dal/marketing";
import { addMonths } from "@/lib/dates";
import { fmtMonth, fmtShortDate, hrefWith } from "@/lib/format";
import { CAMPAIGN_STATUS_LABEL, CHANNEL_LABEL, CHANNELS, INSIGHT_MIN, OUTCOME_LABEL, OUTCOME_TONE, type Channel } from "@/lib/marketing";
import { formatMoney } from "@/lib/money";
import { fmtLocalDateTime, hourRange, toLocalInput } from "@/lib/zoned";
import { deleteActivity, deleteCampaign, saveActivity, saveCampaign } from "./actions";

export const metadata = { title: "Marketing" };

const PATH = "/marketing";

/** column spans for the five-card KPI row (same layout as Finances) */
const KPI = {
  third: "@min-[52rem]:col-span-2 @min-[80rem]:col-span-1",
  half: "@min-[52rem]:col-span-3 @min-[80rem]:col-span-1",
  last: "@min-[34rem]:col-span-2 @min-[52rem]:col-span-3 @min-[80rem]:col-span-1",
};
const monthLong = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-AU", { month: "long", year: "numeric", timeZone: "UTC" });

/** "+12.5%" / "−3 pts" with a tone, or the steady "No prior period". */
function changeNote(v: number | null, unit: "%" | " pts" = "%"): { note: string; tone: "green" | "red" | "neutral" } {
  if (v === null) return { note: "No prior period", tone: "neutral" };
  return { note: `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}${unit}`, tone: v > 0 ? "green" : v < 0 ? "red" : "neutral" };
}

function InsightCard({ label, value, detail, empty }: { label: string; value: string | null; detail: React.ReactNode; empty: string }) {
  return (
    <article className="glass @container flex h-full min-w-0 flex-col card-pad">
      <p className="label-mono">{label}</p>
      {value ? (
        <>
          <FitText className="kpi-number glow-text mt-3 font-bold text-ink">{value}</FitText>
          <p className="mt-3 text-sm leading-snug text-ink-2">{detail}</p>
        </>
      ) : (
        <>
          <p className="title-card mt-3 font-bold text-ink-2">Not enough activity yet</p>
          <p className="mt-2 text-sm leading-snug text-muted">{empty}</p>
        </>
      )}
    </article>
  );
}

export default async function MarketingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requirePerm("marketing");
  const sp = await searchParams;
  const f = marketingFilters.parse(sp);
  const [s, lookups, camps, list, sample] = await Promise.all([marketingSummary(actor, f), marketingLookups(actor), campaignResults(actor), listActivities(actor, f), hasSampleData(actor)]);
  const base = s.baseCurrency;
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });
  const can = {
    create: hasPerm(actor, "marketing", "create"),
    edit: hasPerm(actor, "marketing", "edit"),
    delete: hasPerm(actor, "marketing", "delete"),
    export: hasPerm(actor, "marketing", "export"),
    campaigns: canManageCampaigns(actor, "create"),
    campaignEdit: canManageCampaigns(actor, "edit"),
    campaignDelete: canManageCampaigns(actor, "delete"),
  };
  const scope = actor.perms.marketing.scope;
  const keep = { channel: f.channel, campaign: f.campaign, month: f.month, owner: f.owner };
  const filtered = Object.values(keep).some(Boolean);
  const periodLabel = f.month ? monthLong(f.month) : "Last 12 months";
  const scopeNote = scope === "all" ? "All activity" : scope === "assigned" ? "Your activity and activity logged for you" : "Your activity";
  // sparklines: complete months only, so the month in progress doesn't look like a drop
  const done = s.monthly.filter((m) => m.month < s.today.slice(0, 7));
  const partial = s.monthly[s.monthly.length - 1]?.month === s.today.slice(0, 7);
  const formLookups: ActivityLookups = { ...lookups, selfId: actor.userId };
  const months = Array.from({ length: 24 }, (_, i) => addMonths(`${s.today.slice(0, 7)}-01`, -i).slice(0, 7));

  const t = s.totals;
  const contacts = changeNote(s.change.contacts);
  const touches = changeNote(s.change.touches);
  const rate = changeNote(s.change.ratePoints, " pts");
  const won = changeNote(s.change.won);
  const value = changeNote(s.change.wonValue);
  const insights = s.insights;

  const channelColumns: Column<(typeof s.byChannel)[number]>[] = [
    { key: "channel", header: "Channel", cell: (r) => <span className="font-medium text-ink">{CHANNEL_LABEL[r.channel]}</span> },
    { key: "contacts", header: "Contacts", align: "right", hideBelow: "md", cell: (r) => <span className="num font-mono">{r.contacts.toLocaleString("en-AU")}</span> },
    { key: "touches", header: "Touches", align: "right", cell: (r) => <span className="num font-mono">{r.touches.toLocaleString("en-AU")}</span> },
    { key: "responded", header: "Responses", align: "right", hideBelow: "lg", cell: (r) => <span className="num font-mono text-ink-2">{r.responded.toLocaleString("en-AU")}</span> },
    {
      key: "rate",
      header: "Response rate",
      cell: (r) => (
        <span className="flex items-center gap-3">
          <span className="num w-14 shrink-0 text-right font-mono font-semibold">{r.ratePct === null ? "–" : `${r.ratePct}%`}</span>
          <span className="hidden h-1.5 w-full min-w-12 max-w-32 rounded-full bg-surface-2 sm:block" aria-hidden="true">
            <span className="block h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, r.ratePct ?? 0)}%` }} />
          </span>
        </span>
      ),
    },
    { key: "meetings", header: "Meetings", align: "right", hideBelow: "lg", cell: (r) => <span className="num font-mono text-ink-2">{r.meetings}</span> },
    { key: "won", header: "Deals won", align: "right", cell: (r) => <span className="num font-mono">{r.won}</span> },
    { key: "value", header: `Value (${base})`, align: "right", hideBelow: "sm", cell: (r) => <span className="num whitespace-nowrap font-mono">{r.wonValueBaseMinor ? whole(r.wonValueBaseMinor) : "–"}</span> },
  ];

  const view = (r: ActivityRow): ActivityView => ({
    id: r.id,
    occurredLocal: toLocalInput(r.occurredAt, s.timezone),
    channel: r.channel as Channel,
    campaignId: r.campaignId,
    contactName: r.contactName,
    contactCompany: r.contactCompany,
    outcome: r.outcome,
    dealValueMinor: r.dealValueMinor,
    dealCurrency: r.dealCurrency,
    dealFxRateToBase: r.dealFxRateToBase,
    ownerId: r.ownerId,
    notes: r.notes,
  });
  const activityColumns: Column<(typeof list.rows)[number]>[] = [
    { key: "when", header: "When", cell: (r) => <span className="whitespace-nowrap font-mono text-sm text-ink-2">{fmtLocalDateTime(r.occurredAt, s.timezone)}</span> },
    {
      key: "contact",
      header: "Contact",
      cell: (r) => (
        <div className="min-w-[9rem]">
          <p className="clamp-2 font-medium leading-snug text-ink">{r.contactName}</p>
          {r.contactCompany && <p className="clamp-2 text-sm text-muted">{r.contactCompany}</p>}
        </div>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      hideBelow: "md",
      cell: (r) => (
        <div className="min-w-[7rem]">
          <p className="text-ink-2">{CHANNEL_LABEL[r.channel as Channel]}</p>
          {r.campaignName && <p className="clamp-2 text-xs text-muted">{r.campaignName}</p>}
        </div>
      ),
    },
    {
      key: "outcome",
      header: "Outcome",
      cell: (r) => (
        <span className="flex flex-col items-start gap-1">
          <Badge tone={OUTCOME_TONE[r.outcome]}>{OUTCOME_LABEL[r.outcome]}</Badge>
          {r.dealValueBaseMinor != null && <span className="num whitespace-nowrap font-mono text-xs text-ink-2">{whole(r.dealValueBaseMinor)}</span>}
        </span>
      ),
    },
    { key: "owner", header: "Owner", hideBelow: "lg", cell: (r) => <span className="text-sm text-ink-2">{r.ownerName || "—"}</span> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <ActivityRowActions
          row={view(r)}
          label={`${r.contactName}, ${fmtLocalDateTime(r.occurredAt, s.timezone)}`}
          lookups={formLookups}
          canEdit={can.edit && r.canChange}
          canDelete={can.delete && r.canChange}
          save={saveActivity}
          remove={deleteActivity}
        />
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Marketing"
        subtitle={`${periodLabel} · ${scopeNote} · times in ${s.timezone}`}
        sample={sample}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {can.export && <ExportLink href={hrefWith("/api/export/marketing", keep, {})} />}
            {can.campaigns && <AddCampaign action={saveCampaign} />}
            {can.create && <LogActivity lookups={formLookups} action={saveActivity} initialOpen={sp.new === "1"} />}
          </div>
        }
      />

      <Card className="mb-[var(--space-gap)]">
        <form method="get" action={PATH} className="grid gap-4 @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-[repeat(4,minmax(0,1fr))_auto] @min-[60rem]:items-end">
          <Field label="Channel" htmlFor="f-channel">
            <Select id="f-channel" name="channel" defaultValue={f.channel ?? ""}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABEL[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campaign" htmlFor="f-campaign">
            <Select id="f-campaign" name="campaign" defaultValue={f.campaign ?? ""}>
              <option value="">All campaigns</option>
              <option value="none">No campaign</option>
              {lookups.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Month" htmlFor="f-month">
            <Select id="f-month" name="month" defaultValue={f.month ?? ""}>
              <option value="">Last 12 months</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLong(m)}
                </option>
              ))}
            </Select>
          </Field>
          {lookups.canChooseOwner ? (
            <Field label="Owner" htmlFor="f-owner">
              <Select id="f-owner" name="owner" defaultValue={f.owner ?? ""}>
                <option value="">Everyone</option>
                {lookups.owners.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name || u.email}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="flex flex-col justify-end">
              <p className="text-sm text-muted">Showing {scopeNote.toLowerCase()}.</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">Apply</Button>
            {filtered && (
              <ButtonLink href={PATH} variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>

      {/* five cards: 1 -> 2 (+1 wide) -> 3 + 2 -> 5 across, by the width of the content area, so none sits alone */}
      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[52rem]:grid-cols-6 @min-[80rem]:grid-cols-5">
        <StatCard
          className={KPI.third}
          label="Contacts reached"
          value={t.contacts.toLocaleString("en-AU")}
          note={contacts.note}
          noteTone={contacts.tone}
          detail="Unique: each company once (or person, if no company)"
          trend={done.map((m) => m.contacts)}
        />
        <StatCard className={KPI.third} label="Touches" value={t.touches.toLocaleString("en-AU")} note={touches.note} noteTone={touches.tone} detail="Every call, email, referral and message logged" trend={done.map((m) => m.touches)} />
        <StatCard
          className={KPI.third}
          label="Response rate"
          value={t.ratePct === null ? "No activity" : `${t.ratePct}%`}
          note={rate.note}
          noteTone={rate.tone}
          detail={`${t.responded.toLocaleString("en-AU")} of ${t.touches.toLocaleString("en-AU")} touches got a reply, meeting or decision`}
          trend={done.map((m) => (m.touches ? Math.round((m.responded / m.touches) * 1000) : 0))}
        />
        <StatCard className={KPI.half} label="Deals won" value={t.won.toLocaleString("en-AU")} note={won.note} noteTone={won.tone} detail="Activities marked deal won" trend={done.map((m) => m.won)} />
        <StatCard className={KPI.last} label="Revenue from marketing" value={whole(t.wonValueBaseMinor)} note={value.note} noteTone={value.tone} detail={`Value of deals won, in ${base}`} trend={done.map((m) => m.wonValueBaseMinor)} />
      </div>

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[48rem]:grid-cols-3">
        <InsightCard
          label="Best day"
          value={insights.day?.label ?? null}
          detail={insights.day && <>{insights.day.ratePct}% of {insights.day.touches} touches got a response, vs {t.ratePct}% overall</>}
          empty={`Needs at least ${INSIGHT_MIN.day} touches on one weekday in this view.`}
        />
        <InsightCard
          label="Best time"
          value={insights.hour ? hourRange(Number(insights.hour.label)) : null}
          detail={insights.hour && <>{insights.hour.ratePct}% of {insights.hour.touches} touches got a response, vs {t.ratePct}% overall</>}
          empty={`Needs at least ${INSIGHT_MIN.hour} touches in one hour of the day in this view.`}
        />
        <InsightCard
          label="Best month"
          value={insights.month ? monthLong(insights.month.month) : null}
          detail={
            insights.month && (
              <>
                {insights.month.won} {insights.month.won === 1 ? "deal" : "deals"} won ({whole(insights.month.wonValueBaseMinor)}){insights.month.ratePct !== null ? `, ${insights.month.ratePct}% response rate` : ""}
              </>
            )
          }
          empty="Shows the month with the most deals won once one is logged."
        />
      </div>

      <Card className="mb-[var(--space-gap)]">
        <CardHeader title="Channel performance" subtitle={`${periodLabel} · contacts are unique per channel · response rate = touches that got a reply, meeting or decision ÷ touches`} />
        {t.touches === 0 ? (
          <EmptyState title="No activity in this view">{can.create ? "Use Log activity to record calls, emails and referrals." : "Try a wider month or clear the filters."}</EmptyState>
        ) : (
          <DataTable caption="Channel performance" columns={channelColumns} rows={s.byChannel} rowKey={(r) => r.channel} />
        )}
      </Card>

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Deals won by month" subtitle={`${fmtMonth(s.monthly[0].month, true)} – ${fmtMonth(s.monthly[s.monthly.length - 1].month, true)}${partial ? " · this month so far" : ""}`} />
          <MonthBars data={s.monthly.map((m) => ({ month: m.month, value: m.won }))} unit="deals" label="Deals won by month" />
        </Card>
        <Card className="@container">
          <CardHeader title="Campaigns" subtitle={scope === "all" ? "Results from all activity" : "Results from activity you can see"} />
          {camps.length === 0 ? (
            <p className="text-sm text-muted">{can.campaigns ? "No campaigns yet. Use New campaign to start one." : "No campaigns yet."}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {camps.map((c) => (
                <li key={c.id} className="flex min-h-14 items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Link href={hrefWith(PATH, { ...keep, page: undefined }, { campaign: c.id })} className="clamp-2 font-medium leading-snug text-ink hover:underline">
                        {c.name}
                      </Link>
                      <Badge tone={c.status === "active" ? "green" : c.status === "finished" ? "neutral" : "amber"}>{CAMPAIGN_STATUS_LABEL[c.status]}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {[c.channel ? CHANNEL_LABEL[c.channel] : "Mixed", c.startDate ? `${fmtShortDate(c.startDate)}${c.endDate ? ` – ${fmtShortDate(c.endDate)}` : " onwards"}` : null].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 font-mono text-xs text-ink-2">
                      {c.contacts} contacts · {c.touches} touches · {c.ratePct === null ? "–" : `${c.ratePct}%`} · {c.won} won{c.wonValueBaseMinor ? ` · ${whole(c.wonValueBaseMinor)}` : ""}
                    </p>
                  </div>
                  {(can.campaignEdit || can.campaignDelete) && (
                    <CampaignActions
                      campaign={{ id: c.id, name: c.name, channel: c.channel, status: c.status, startDate: c.startDate, endDate: c.endDate, description: c.description }}
                      canEdit={can.campaignEdit}
                      canDelete={can.campaignDelete}
                      save={saveCampaign}
                      remove={deleteCampaign}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mb-[var(--space-gap)]">
        <CardHeader title="When people respond" subtitle={`Response rate by weekday and hour · ${periodLabel}`} />
        <Heatmap heat={s.heat} timezone={s.timezone} />
      </Card>

      <Card>
        <CardHeader title="Activity log" subtitle={`${list.total.toLocaleString("en-AU")} ${list.total === 1 ? "activity" : "activities"} · ${periodLabel}`} />
        <DataTable
          caption="Marketing activity"
          columns={activityColumns}
          rows={list.rows}
          rowKey={(r) => r.id}
          empty={{ title: "Nothing logged in this view", body: can.create ? "Use Log activity to record a call, email or referral." : "Try a wider month or clear the filters." }}
        />
        <Pagination page={list.page} pageSize={list.pageSize} total={list.total} hrefFor={(p) => hrefWith(PATH, keep, { page: p > 1 ? String(p) : undefined })} />
      </Card>
    </>
  );
}
