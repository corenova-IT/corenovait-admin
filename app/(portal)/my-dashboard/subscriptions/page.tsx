import Link from "next/link";
import { ArchiveButton, MarkPaidForm, SubscriptionForm } from "@/components/partner/PartnerForms";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myFormChoices, mySubscriptions } from "@/lib/dal/partner-writes";
import { fmtDate } from "@/lib/format";
import { formatMoney, minorToInput, rateToInput } from "@/lib/money";
import { archiveSubscription, markSubscriptionPaid, saveSubscription } from "../actions";

export const metadata = { title: "My subscriptions" };

/** A stream partner's subscriptions and renewals. Archiving cancels one; nothing is deleted. */
export default async function MySubscriptionsPage() {
  const actor = await requirePerm("stream_partner");
  const [rows, c] = await Promise.all([mySubscriptions(actor), myFormChoices(actor)]);
  return (
    <>
      <PageHeader title="My subscriptions" subtitle="Subscriptions and renewals in your streams and countries" actions={<Link href="/my-dashboard" className="text-sm text-accent-text hover:underline">Back to my dashboard</Link>} />
      {!c.hasData ? (
        <Card>
          <EmptyState title="Nothing to show yet">You need at least one stream and one country before you can add subscriptions. Ask an admin.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-[var(--space-gap)]">
          <Card>
            <CardHeader title="Add a subscription" />
            <div className="p-5 pt-0">
              <SubscriptionForm c={c} action={saveSubscription} idPrefix="new-sub" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Your subscriptions" subtitle="Soonest due first" />
            {rows.length === 0 ? (
              <EmptyState title="No subscriptions yet">Add your first one above.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <li key={r.id} className="border-b border-line/70 px-5 py-4 last:border-b-0">
                    <details>
                      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-ink">{r.vendor}</span>
                          <span className="ml-2 text-sm text-muted">
                            due {fmtDate(r.nextDueDate)} · {r.billingCycle}
                            {r.status !== "active" ? ` · ${r.status}` : ""}
                          </span>
                        </span>
                        <span className="text-ink">
                          {formatMoney(r.amountMinor, r.currency)}
                          {r.currency !== c.baseCurrency && <span className="ml-1 text-xs text-muted">({formatMoney(r.amountBaseMinor, c.baseCurrency)})</span>}
                        </span>
                      </summary>
                      <div className="mt-4 flex flex-col gap-4">
                        <SubscriptionForm
                          c={c}
                          action={saveSubscription}
                          idPrefix={`sub-${r.id}`}
                          row={{
                            id: r.id,
                            vendor: r.vendor,
                            category: r.category,
                            description: r.description,
                            amount: minorToInput(r.amountMinor),
                            currency: r.currency,
                            fxRateToBase: rateToInput(r.fxRateToBase),
                            billingCycle: r.billingCycle,
                            nextDueDate: r.nextDueDate,
                            reminderDays: r.reminderDays,
                            paidFrom: r.paidFrom,
                            streamId: r.streamId,
                            countryCode: r.countryCode,
                          }}
                        />
                        {r.status === "active" && <MarkPaidForm id={r.id} action={markSubscriptionPaid} />}
                        <ArchiveButton id={r.id} action={archiveSubscription} label="Archive (cancel) this subscription" />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
