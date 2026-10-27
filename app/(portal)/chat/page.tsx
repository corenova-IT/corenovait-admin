import { ChatApp, type OpenConversation } from "@/components/chat/ChatApp";
import { FormMessage } from "@/components/ui/Field";
import { PageHeader } from "@/components/ui/PageHeader";
import { requirePerm } from "@/lib/auth/session";
import { channelsForAdmin, chatPeople, isAdminCaller, myConversations, openConversation } from "@/lib/dal/chat";
import { hasPerm } from "@/lib/dal/guard";
import { archiveChannel, deleteChatMessage, editChatMessage, loadOlderMessages, pingTyping, saveChannel, sendChatMessage, startDirectMessage } from "./actions";

export const metadata = { title: "Team chat" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const actor = await requirePerm("chat");
  const sp = await searchParams;
  const conversations = await myConversations(actor);
  const wanted = sp.c && conversations.some((c) => c.id === sp.c) ? sp.c : (conversations.find((c) => c.label === "#general")?.id ?? conversations[0]?.id);
  const serverNow = new Date().toISOString();
  const admin = isAdminCaller(actor);
  const [current, people, adminChannels] = await Promise.all([
    wanted ? (openConversation(actor, wanted) as Promise<OpenConversation>) : Promise.resolve(null),
    chatPeople(actor),
    admin ? channelsForAdmin(actor) : Promise.resolve(null),
  ]);
  const can = { post: hasPerm(actor, "chat", "create"), edit: hasPerm(actor, "chat", "edit"), delete: hasPerm(actor, "chat", "edit") || hasPerm(actor, "chat", "delete") };
  const others = people.filter((p) => p.id !== actor.userId);

  return (
    <>
      <PageHeader title="Team chat" subtitle="Channels and direct messages · direct messages are private to the two people in them" />
      {sp.c && sp.c !== wanted && (
        <div className="mb-[var(--space-gap)]">
          <FormMessage tone="info">That conversation doesn&apos;t exist or you&apos;re not in it.</FormMessage>
        </div>
      )}
      <ChatApp
        key={current?.channel.id ?? "none"}
        conversations={conversations}
        current={current}
        people={others}
        serverNow={serverNow}
        can={can}
        admin={adminChannels ? { channels: adminChannels, people } : null}
        actions={{
          send: sendChatMessage,
          edit: editChatMessage,
          remove: deleteChatMessage,
          typing: pingTyping,
          startDm: startDirectMessage,
          older: loadOlderMessages,
          saveChannel,
          archive: archiveChannel,
        }}
      />
    </>
  );
}
