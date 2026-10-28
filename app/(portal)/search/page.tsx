import Link from "next/link";
import { IconSearch } from "@/components/icons";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { searchEverything } from "@/lib/dal/search";
import { SEARCH_MIN } from "@/lib/search";

export const metadata = { title: "Search" };

/** Results from the top-bar search, grouped by page. Only pages (and rows) the person can see are searched. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const actor = await requireUser();
  const raw = (await searchParams).q;
  const { q, groups } = await searchEverything(actor, typeof raw === "string" ? raw : "");
  const total = groups.reduce((n, g) => n + g.hits.length, 0);

  return (
    <>
      <PageHeader title="Search" subtitle={q.length < SEARCH_MIN ? "Type at least two letters in the search box above." : total ? `Results for “${q}” in the pages you can see` : `Nothing found for “${q}”`} />
      {q.length >= SEARCH_MIN && groups.length === 0 && (
        <Card>
          <EmptyState icon={<IconSearch size={22} />} title="No matches">
            Try a shorter word, a client or vendor name, or part of a message.
          </EmptyState>
        </Card>
      )}
      <div className="grid grid-cols-1 gap-cards @min-[64rem]:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.id}>
            <CardHeader
              title={g.label}
              subtitle={`${g.hits.length}${g.moreHref ? "+" : ""} ${g.hits.length === 1 && !g.moreHref ? "match" : "matches"}`}
              aside={
                g.moreHref ? (
                  <Link href={g.moreHref} className="text-sm font-semibold text-accent-text hover:underline">
                    See all
                  </Link>
                ) : undefined
              }
            />
            <ul className="flex flex-col divide-y divide-line">
              {g.hits.map((h) => (
                <li key={h.key}>
                  <Link href={h.href} className="flex min-h-12 flex-col justify-center rounded-xl px-2 py-2.5 hover:bg-surface-2">
                    <span className="leading-snug text-ink [overflow-wrap:anywhere]">{h.title}</span>
                    <span className="clamp-2 text-sm text-muted [overflow-wrap:anywhere]">{h.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
