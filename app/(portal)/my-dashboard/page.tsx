import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { myAssignments } from "@/lib/dal/stream-partners";

export const metadata = { title: "My dashboard" };

/**
 * A stream partner's own page. Phase 1 only shows which streams and countries they run:
 * the figures arrive in a later phase, and they will all come through lib/dal/scope.ts.
 */
export default async function MyDashboardPage() {
  const actor = await requirePerm("stream_partner");
  const mine = await myAssignments(actor);

  return (
    <>
      <PageHeader title="My dashboard" subtitle="The streams and countries you run" />
      {!mine.hasData ? (
        <Card>
          <EmptyState title="Nothing to show yet">
            {mine.streams.length === 0
              ? "An admin hasn't given you a stream yet. Once they do, and give you at least one country, your numbers will appear here."
              : "An admin hasn't given you a country yet. You'll see your data here as soon as they do."}
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <dl className="grid gap-4 p-5 sm:grid-cols-2">
            <div>
              <dt className="label-mono">Streams</dt>
              <dd className="mt-1 text-ink">{mine.streams.map((s) => s.name).join(", ")}</dd>
            </div>
            <div>
              <dt className="label-mono">Countries</dt>
              <dd className="mt-1 text-ink">{mine.countries.map((c) => c.name).join(", ")}</dd>
            </div>
          </dl>
          <p className="border-t border-line px-5 py-4 text-sm text-muted">Your revenue, costs and tasks will appear on this page soon.</p>
        </Card>
      )}
    </>
  );
}
