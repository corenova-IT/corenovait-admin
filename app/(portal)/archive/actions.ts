"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as archive from "@/lib/dal/archive";

/** An admin brings an archived item back. Permission first, then the form, then the data-access layer. */
export type ArchiveState = { ok?: string; error?: string };

export async function restoreItem(_prev: ArchiveState, fd: FormData): Promise<ArchiveState> {
  const g = await actorWithPerm("team", "edit");
  if (!g.actor) return { error: g.error };
  const parsed = z.object({ kind: z.enum(["expense", "task", "subscription"]), id: z.string().uuid() }).safeParse({ kind: fd.get("kind"), id: fd.get("id") });
  if (!parsed.success) return { error: "That no longer exists." };
  try {
    if (parsed.data.kind === "expense") await archive.unarchiveExpense(g.actor, parsed.data.id);
    else if (parsed.data.kind === "task") await archive.unarchiveTask(g.actor, parsed.data.id);
    else await archive.unarchiveSubscription(g.actor, parsed.data.id);
    revalidatePath("/", "layout");
    return { ok: "Restored." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
