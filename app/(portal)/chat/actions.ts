"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorForAction, actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as chat from "@/lib/dal/chat";
import { limiters, slowDown } from "@/lib/rate-limit";

/** Team chat. Permission first, then the form, then the data-access layer (which checks membership). */
export type ChatState = { ok?: string; error?: string; message?: chat.ChatMessage; channelId?: string; messages?: chat.ChatMessage[]; hasOlder?: boolean };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const NOT_FOUND = "That conversation couldn't be found. Refresh and try again.";

export async function sendChatMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "create");
  if (!g.actor) return { error: g.error };
  const channelId = uuid.safeParse(fd.get("channelId"));
  if (!channelId.success) return { error: NOT_FOUND };
  const rl = limiters.chatPerUser.hit(g.actor.userId);
  if (!rl.ok) return { error: slowDown("messages", rl.retryAfterSec) };
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) {
    const up = limiters.uploadPerUser.hit(g.actor.userId);
    if (!up.ok) return { error: slowDown("uploads", up.retryAfterSec) };
  }
  const attachment = file instanceof File && file.size > 0 ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) } : undefined;
  try {
    const message = await chat.sendMessage(g.actor, channelId.data, str(fd, "body"), attachment);
    return { ok: "Sent.", message };
  } catch (e) {
    return { error: errorMessage(e, "That message couldn't be sent. Try again.") };
  }
}

export async function editChatMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That message couldn't be found." };
  try {
    return { ok: "Saved.", message: await chat.editMessage(g.actor, id.data, str(fd, "body")) };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

/** Your own messages; needs chat edit or delete permission (checked in the data-access layer). */
export async function deleteChatMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "view");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That message couldn't be found." };
  try {
    await chat.deleteMessage(g.actor, id.data);
    return { ok: "Deleted." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function pingTyping(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "create");
  if (!g.actor) return { error: g.error };
  const channelId = uuid.safeParse(fd.get("channelId"));
  if (!channelId.success) return { error: NOT_FOUND };
  try {
    await chat.setTyping(g.actor, channelId.data);
    return {};
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function startDirectMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "create");
  if (!g.actor) return { error: g.error };
  const userId = uuid.safeParse(fd.get("userId"));
  if (!userId.success) return { error: "Choose someone to message." };
  try {
    const channelId = await chat.openDirectMessage(g.actor, userId.data);
    revalidatePath("/chat");
    return { ok: "Opened.", channelId };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function loadOlderMessages(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await actorWithPerm("chat", "view");
  if (!g.actor) return { error: g.error };
  const channelId = uuid.safeParse(fd.get("channelId"));
  if (!channelId.success) return { error: NOT_FOUND };
  try {
    const c = await chat.openConversation(g.actor, channelId.data, { before: str(fd, "before") });
    return { messages: c.messages, hasOlder: c.hasOlder };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------------------------------------------------------------- channels (admins)
async function adminGuard() {
  const a = await actorForAction();
  if (!a.actor) return a;
  if (!chat.isAdminCaller(a.actor)) return { error: "Only admins can manage channels." };
  return a;
}

/** Admins: remove someone else's message in a channel (never a DM). */
export async function removeChatMessage(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await adminGuard();
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That message couldn't be found." };
  try {
    await chat.removeMessageAsAdmin(g.actor, id.data);
    return { ok: "Removed." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function saveChannel(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await adminGuard();
  if (!g.actor) return { error: g.error };
  const id = str(fd, "id");
  if (id && !uuid.safeParse(id).success) return { error: NOT_FOUND };
  try {
    const channelId = await chat.saveChannel(g.actor, id || null, {
      name: str(fd, "name"),
      topic: str(fd, "topic"),
      memberIds: fd.getAll("memberIds").filter((v): v is string => typeof v === "string" && uuid.safeParse(v).success),
    });
    revalidatePath("/chat");
    return { ok: id ? "Channel saved." : "Channel created.", channelId };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function archiveChannel(_prev: ChatState, fd: FormData): Promise<ChatState> {
  const g = await adminGuard();
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: NOT_FOUND };
  try {
    const archived = str(fd, "archived") !== "false";
    await chat.setChannelArchived(g.actor, id.data, archived);
    revalidatePath("/chat");
    return { ok: archived ? "Channel archived." : "Channel restored." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
