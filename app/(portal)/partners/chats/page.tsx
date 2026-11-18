import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requirePerm } from "@/lib/auth/session";
import { oversightConversations } from "@/lib/dal/scoped-chat";

export const metadata = { title: "Partner chats" };

/** Admin only: conversations that include a stream partner or employee. Reading one is written to the audit log. */
export default async function PartnerChatsPage() {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const rows = await oversightConversations(actor);
  const fmt = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <>
      <PageHeader title="Partner chats" subtitle="Conversations with stream partners and employees that you are not in" />
      <Card>
        <CardHeader title="Conversations" subtitle="Opening one is recorded in the audit log (who read it and when, never the messages). Conversations between two admins stay private and are not listed." />
        {rows.length === 0 ? (
          <EmptyState title="Nothing to read">No conversations with partners or employees yet, apart from ones you are in.</EmptyState>
        ) : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className="border-b border-line/70 last:border-b-0">
                <Link href={`/partners/chats/${r.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 font-semibold text-ink">{r.people.join(" and ")}</span>
                  <span className="text-sm text-muted">{r.messages} {r.messages === 1 ? "message" : "messages"}</span>
                  <span className="text-sm text-muted">{r.lastAt ? fmt.format(r.lastAt) : "No messages"}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
