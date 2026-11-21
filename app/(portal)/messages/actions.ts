"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { actorForAction, errorMessage } from "@/lib/auth/session";
import { hasPerm } from "@/lib/dal/guard";
import * as chat from "@/lib/dal/scoped-chat";

/** Messages for partners and employees. Permission first, then the form, then the data-access layer. */
export type MessageState = { ok?: string; error?: string };

const uuid = z.string().uuid();

/** Their own module's "create" permission, checked before the form is even read. */
async function scopedActor() {
  const a = await actorForAction();
  if (!a.actor) return a;
  const ok = hasPerm(a.actor, "stream_partner", "create") || hasPerm(a.actor, "employee", "create");
  return ok ? a : { error: "You don't have permission to do that." as const };
}

export async function startConversation(_prev: MessageState, fd: FormData): Promise<MessageState> {
  const g = await scopedActor();
  if (!g.actor) return { error: g.error };
  const other = uuid.safeParse(fd.get("withId"));
  if (!other.success) return { error: "That no longer exists." };
  let id: string;
  try {
    id = await chat.startScopedDm(g.actor, other.data);
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect(`/messages?c=${id}`);
}

export async function sendMessage(_prev: MessageState, fd: FormData): Promise<MessageState> {
  const g = await scopedActor();
  if (!g.actor) return { error: g.error };
  const channel = uuid.safeParse(fd.get("channelId"));
  if (!channel.success) return { error: "That no longer exists." };
  try {
    await chat.sendScopedMessage(g.actor, channel.data, String(fd.get("body") ?? ""));
    revalidatePath("/messages");
    return { ok: "Sent." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
