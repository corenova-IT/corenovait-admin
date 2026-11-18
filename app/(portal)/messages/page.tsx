import Link from "next/link";
import { SendMessageForm, StartConversationForm } from "@/components/partner/MessageForms";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";
import { requireUser } from "@/lib/auth/session";
import { hasPerm } from "@/lib/dal/guard";
import { openScopedConversation, scopedContacts, scopedConversations } from "@/lib/dal/scoped-chat";
import { redirect } from "next/navigation";
import { sendMessage, startConversation } from "./actions";

export const metadata = { title: "Messages" };

/** Messages for stream partners and employees: only the people they are allowed to talk to. */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await requireUser();
  if (!hasPerm(actor, "stream_partner", "view") && !hasPerm(actor, "employee", "view")) redirect("/no-access?module=chat");
  const { c } = await searchParams;
  const [contacts, conversations] = await Promise.all([scopedContacts(actor), scopedConversations(actor)]);
  // a conversation that isn't theirs (or isn't allowed any more) simply isn't there
  const open = c ? await openScopedConversation(actor, c).catch(() => null) : null;
  const fmt = new Intl.DateTimeFormat("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <>
      <PageHeader title="Messages" subtitle="Your conversations" />
      <div className="grid gap-[var(--space-gap)] lg:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-[var(--space-gap)]">
          <Card>
            <CardHeader title="Start a conversation" />
            <div className="p-5 pt-0">
              <StartConversationForm contacts={contacts} action={startConversation} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Conversations" />
            {conversations.length === 0 ? (
              <EmptyState title="No conversations yet">Start one above.</EmptyState>
            ) : (
              <ul className="flex flex-col">
                {conversations.map((x) => (
                  <li key={x.id} className="border-b border-line/70 last:border-b-0">
                    <Link href={`/messages?c=${x.id}`} className="flex items-center gap-2 px-5 py-3 hover:bg-surface-2">
                      <span className="min-w-0 flex-1 font-semibold text-ink">{x.with}</span>
                      {x.online && <Badge tone="green">Online</Badge>}
                      {x.unread > 0 && <Badge tone="amber">{x.unread}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card>
          {open ? (
            <>
              <CardHeader title={open.with} subtitle="Private conversation. Admins can read conversations with partners and employees." />
              <ul className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto px-5 pb-4">
                {open.messages.length === 0 && <li className="text-sm text-muted">No messages yet.</li>}
                {open.messages.map((m) => (
                  <li key={m.id} className={m.mine ? "self-end text-right" : "self-start"}>
                    <p className="text-xs text-muted">
                      {m.mine ? "You" : m.author} · {fmt.format(new Date(m.at))}
                    </p>
                    <p className="whitespace-pre-wrap rounded-[14px] border border-line bg-surface px-3 py-2 text-sm text-ink">{m.deleted ? "Message deleted" : m.body}</p>
                  </li>
                ))}
              </ul>
              <div className="border-t border-line p-5">
                <SendMessageForm channelId={open.id} action={sendMessage} />
              </div>
            </>
          ) : (
            <EmptyState title="Choose a conversation">Pick one on the left, or start a new one.</EmptyState>
          )}
        </Card>
      </div>
    </>
  );
}
