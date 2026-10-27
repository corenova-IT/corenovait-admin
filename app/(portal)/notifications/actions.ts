"use server";

import { revalidatePath } from "next/cache";
import { actorForAction, errorMessage } from "@/lib/auth/session";
import * as n from "@/lib/dal/notifications";

/** Self-service: these only ever act on the signed-in person's own notifications and setting. */
export type NoteState = { ok?: string; error?: string };

export async function markAllRead(_prev: NoteState, _fd: FormData): Promise<NoteState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    const count = await n.markAllNotificationsRead(a.actor);
    revalidatePath("/", "layout");
    return { ok: count ? `Marked ${count} as read.` : "Nothing unread." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function setEmailNotifications(_prev: NoteState, fd: FormData): Promise<NoteState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  const on = fd.get("notifyEmail") === "on";
  try {
    await n.setEmailPreference(a.actor, on);
    revalidatePath("/notifications");
    return { ok: on ? "You'll get these by email too." : "Email notifications are off. They still appear here." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
