import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { NotFound } from "@/lib/dal/scope";
import { oversightRead } from "@/lib/dal/scoped-chat";

export const metadata = { title: "Partner chat" };

/** Admin only, read-only. Each time this page opens, the read is written to the audit log. */
export default async function PartnerChatPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePerm("team");
  if (!actor.isAdmin) redirect("/no-access?module=team");
  const { id } = await params;
  let chat;
  try {
    chat = await oversightRead(actor, id);
  } catch (e) {
    if (e instanceof NotFound) notFound();
    throw e;
  }
  const fmt = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <>
      <PageHeader title={chat.people.join(" and ")} subtitle="Read-only · admins can read conversations with partners and employees" actions={<Link href="/partners/chats" className="text-sm text-accent-text hover:underline">All partner chats</Link>} />
      <Card>
        <CardHeader title="Messages" subtitle="This read has been recorded in the audit log." />
        <ul className="flex flex-col gap-3 px-5 pb-5">
          {chat.messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
          {chat.messages.map((m) => (
            <li key={m.id}>
              <p className="text-xs text-muted">
                {m.author} · {fmt.format(new Date(m.at))}
              </p>
              <p className="whitespace-pre-wrap rounded-[14px] border border-line bg-surface px-3 py-2 text-sm text-ink">{m.deleted ? "Message deleted" : m.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
