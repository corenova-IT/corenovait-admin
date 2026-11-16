import { redirect } from "next/navigation";
import { PERIOD_LABEL, PeriodSwitch } from "@/components/revenue/PeriodSwitch";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { Field, FormMessage, Select } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { errorMessage, requireUser } from "@/lib/auth/session";
import { ownerOverview, type OverviewPartner, type OverviewRow } from "@/lib/dal/overview";
import { previewAccess, type AccessPreview } from "@/lib/dal/preview";
import { periodSchema } from "@/lib/dal/revenue";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Owner overview" };

const UUID = /^[0-9a-f-]{36}$/;

/** Owner only: all revenue across streams, projects and partners, and a check of what any person would see. */
export default async function OwnerOverviewPage({ searchParams }: { searchParams: Promise<{ period?: string; as?: string }> }) {
  const actor = await requireUser();
  if (!actor.isOwner) redirect("/no-access?module=streams");
  const sp = await searchParams;
  const period = periodSchema.parse(sp.period) ?? "12m";
  const asId = typeof sp.as === "string" && UUID.test(sp.as) ? sp.as : "";
  const data = await ownerOverview(actor, period);
  const base = data.baseCurrency;
  const whole = (minor: number) => formatMoney(minor, base, { cents: false });

  let preview: AccessPreview | null = null;
  let previewError = "";
  if (asId) {
    try {
      preview = await previewAccess(actor, asId);
    } catch (e) {
      previewError = errorMessage(e, "That preview couldn't be loaded. Try again.");
    }
  }

  return (
    <>
      <PageHeader
        title="Owner overview"
        subtitle={`All streams, projects and partners · ${PERIOD_LABEL[period]} · in ${base}`}
        actions={<PeriodSwitch path="/streams/overview" value={period} />}
      />

      <div className="mb-[var(--space-gap)] grid grid-cols-1 gap-cards @min-[34rem]:grid-cols-2 @min-[60rem]:grid-cols-4">
        <StatCard label="Revenue" value={whole(data.paidBaseMinor)} note="Paid" detail="All streams and projects" />
        <StatCard
          label="Outstanding"
          value={whole(data.outstandingBaseMinor)}
          note={data.outstandingBaseMinor > 0 ? "Not yet paid" : "All paid"}
          noteTone={data.outstandingBaseMinor > 0 ? "amber" : "green"}
          detail="Pending + overdue invoices"
        />
        <StatCard label="Partner shares" value={whole(data.partnerSharesBaseMinor)} detail="Earned by partners on paid income" />
        <StatCard
          label="Company keeps"
          value={whole(data.companyBaseMinor)}
          note={data.paidBaseMinor > 0 ? `${Math.round((data.companyBaseMinor / data.paidBaseMinor) * 1000) / 10}% of revenue` : undefined}
          detail={data.commissionBaseMinor > 0 ? `After partner shares and ${whole(data.commissionBaseMinor)} commission` : "After partner shares"}
        />
      </div>

      <div className="flex flex-col gap-[var(--space-gap)]">
        <Card>
          <CardHeader title="By stream and project" subtitle="Paid and outstanding income, partner shares and what's left for the company" />
          <DataTable<OverviewRow>
            caption="Revenue by stream and project"
            columns={[
              {
                key: "what",
                header: "Stream · project",
                cell: (r) => (
                  <div>
                    <p className="font-medium text-ink [overflow-wrap:anywhere]">{r.project ?? "No project"}</p>
                    <p className="text-sm text-muted">
                      {r.stream}
                      {r.partnerCount > 0 && ` · ${r.partnerCount} ${r.partnerCount === 1 ? "partner" : "partners"}`}
                    </p>
                  </div>
                ),
              },
              { key: "paid", header: "Paid", align: "right", cell: (r) => <span className="num font-mono">{whole(r.paidBaseMinor)}</span> },
              {
                key: "outstanding",
                header: "Outstanding",
                align: "right",
                hideBelow: "md",
                cell: (r) => <span className={r.outstandingBaseMinor > 0 ? "num font-mono text-warning" : "num font-mono text-muted"}>{whole(r.outstandingBaseMinor)}</span>,
              },
              { key: "shares", header: "Partners", align: "right", hideBelow: "sm", cell: (r) => <span className="num font-mono">{r.partnerSharesBaseMinor ? whole(r.partnerSharesBaseMinor) : "—"}</span> },
              { key: "company", header: "Company", align: "right", cell: (r) => <span className="num font-mono">{whole(r.companyBaseMinor)}</span> },
            ]}
            rows={data.rows}
            rowKey={(r) => r.key}
            empty={{ title: "No income in this period", body: "Try a longer period." }}
          />
        </Card>

        <Card>
          <CardHeader title="Partners" subtitle="Earned and still to come are for the period; paid out and owed are all time" />
          <DataTable<OverviewPartner>
            caption="Partners and what they are owed"
            columns={[
              {
                key: "name",
                header: "Partner",
                cell: (p) => (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink [overflow-wrap:anywhere]">{p.name}</span>
                    {!p.hasLogin && <Badge tone="amber">No login yet</Badge>}
                  </div>
                ),
              },
              { key: "projects", header: "Projects", align: "right", hideBelow: "sm", cell: (p) => <span className="font-mono">{p.projects}</span> },
              { key: "earned", header: "Earned", align: "right", cell: (p) => <span className="num font-mono">{whole(p.earnedBaseMinor)}</span> },
              { key: "expected", header: "Still to come", align: "right", hideBelow: "md", cell: (p) => <span className="num font-mono text-muted">{whole(p.expectedBaseMinor)}</span> },
              { key: "paid", header: "Paid out", align: "right", hideBelow: "lg", cell: (p) => <span className="num font-mono">{whole(p.paidOutBaseMinor)}</span> },
              {
                key: "owed",
                header: "Owed",
                align: "right",
                cell: (p) => (p.owedBaseMinor > 0 ? <Badge tone="amber">{whole(p.owedBaseMinor)}</Badge> : <span className="num font-mono text-muted">{whole(p.owedBaseMinor)}</span>),
              },
            ]}
            rows={data.partners}
            rowKey={(p) => p.id}
            empty={{ title: "No partners yet", body: "Add partners to a project under Projects → Partners & shares." }}
          />
        </Card>

        <Card>
          <CardHeader title="What would this person see?" subtitle="Pick anyone to see what they'd see, next to everything you see. Nothing is changed and you don't sign in as them." />
          {/* a plain GET form: the choice lives in the address, so it works without JavaScript */}
          <form method="get" action="/streams/overview" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="period" value={period} />
            <Field label="Person" htmlFor="preview-as" className="min-w-56 flex-1">
              <Select id="preview-as" name="as" defaultValue={asId} required>
                <option value="" disabled>
                  Choose a person…
                </option>
                {data.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.name || p.email) + ` · ${p.role}${p.isOwner ? " (owner)" : ""}${p.status === "active" ? "" : ` · ${p.status}`}`}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit">Show what they see</Button>
          </form>
          {previewError && (
            <div className="mt-4">
              <FormMessage tone="error">{previewError}</FormMessage>
            </div>
          )}
          {preview && <PreviewResult preview={preview} />}
        </Card>
      </div>
      <p className="mt-4 text-sm text-muted">
        Revenue counts paid income. Partner shares and commission are earned when income is marked paid, at the rates copied onto each entry. Only you can open this page.
      </p>
    </>
  );
}

function PreviewResult({ preview }: { preview: AccessPreview }) {
  const base = preview.baseCurrency;
  const money = (minor: number) => formatMoney(minor, base, { cents: false });
  const total = preview.everything.paidBaseMinor;
  const share = (minor: number) => (total > 0 ? ` (${Math.round((minor / total) * 100)}% of the ${money(total)} you see)` : "");
  return (
    <div className="mt-6 flex flex-col gap-5 border-t border-line pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl font-bold text-ink [overflow-wrap:anywhere]">{preview.person.name || preview.person.email}</h3>
        <Badge tone={preview.person.role === "Admin" ? "red" : "neutral"}>{preview.person.role}</Badge>
        {preview.person.isOwner && <Badge tone="amber">Owner</Badge>}
        {preview.person.status !== "active" && <Badge>{preview.person.status}</Badge>}
      </div>

      <section aria-labelledby="pv-pages">
        <h4 id="pv-pages" className="label-mono mb-2">
          Pages they can open
        </h4>
        {preview.pages.length ? (
          <ul className="flex flex-wrap gap-2">
            {preview.pages.map((p) => (
              <li key={p}>
                <Badge>{p}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">None.</p>
        )}
      </section>

      <section aria-labelledby="pv-money">
        <h4 id="pv-money" className="label-mono mb-2">
          The money they'd see
        </h4>
        <dl className="grid gap-x-6 gap-y-3 text-[15px] @min-[40rem]:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <dt className="text-muted">Everything (what you see)</dt>
          <dd className="num font-mono text-ink">
            {money(preview.everything.paidBaseMinor)} paid · {money(preview.everything.outstandingBaseMinor)} outstanding · {preview.everything.entries} entries
          </dd>
          {preview.ledger && (
            <>
              <dt className="text-muted">Their Transactions</dt>
              <dd className="num font-mono text-ink">
                {money(preview.ledger.paidBaseMinor)} paid{share(preview.ledger.paidBaseMinor)} · {money(preview.ledger.outstandingBaseMinor)} outstanding · {preview.ledger.entries} entries
              </dd>
            </>
          )}
          {preview.streams && (
            <>
              <dt className="text-muted">Their Revenue streams</dt>
              <dd className="num font-mono text-ink">{money(preview.streams.paidBaseMinor)} paid</dd>
            </>
          )}
          {preview.partner && (
            <>
              <dt className="text-muted">Their My earnings</dt>
              <dd className="num font-mono text-ink">
                {preview.partner.linked
                  ? `${money(preview.partner.earnedBaseMinor)} earned · ${money(preview.partner.expectedBaseMinor)} still to come · ${money(preview.partner.owedBaseMinor)} owed${preview.partner.projects.length ? ` · on ${preview.partner.projects.join(", ")}` : ""}`
                  : "Not linked to a partner record yet, so the page is empty"}
              </dd>
            </>
          )}
          {!preview.ledger && !preview.streams && !preview.partner && (
            <>
              <dt className="text-muted">Their view</dt>
              <dd className="text-ink">No page that shows revenue.</dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="pv-projects">
        <h4 id="pv-projects" className="label-mono mb-2">
          Projects
        </h4>
        {preview.projects.hidden.length === 0 && preview.projects.visible.length === 0 ? (
          <p className="text-sm text-muted">There are no projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[15px]">
            {preview.projects.hidden.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Badge tone="amber">Hidden</Badge>
                <span className="text-ink [overflow-wrap:anywhere]">
                  {h.name} <span className="text-muted">· {h.stream}</span>
                </span>
                <span className="num font-mono text-muted">{money(h.paidBaseMinor)} paid, not shown to them</span>
              </li>
            ))}
            {preview.projects.visible.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2">
                <Badge tone="green">Visible</Badge>
                <span className="text-ink [overflow-wrap:anywhere]">
                  {v.name} <span className="text-muted">· {v.stream}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {preview.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          {preview.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
