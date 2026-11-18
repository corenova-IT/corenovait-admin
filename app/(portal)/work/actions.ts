"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as work from "@/lib/dal/employee-work";
import { TASK_STATUSES } from "@/lib/work";

/** An employee moves their own tasks along. Permission first, then the form, then the data-access layer. */
export type WorkState = { ok?: string; error?: string };

export async function setTaskStatus(_prev: WorkState, fd: FormData): Promise<WorkState> {
  const g = await actorWithPerm("employee", "edit");
  if (!g.actor) return { error: g.error };
  const parsed = z.object({ id: z.string().uuid(), status: z.enum(TASK_STATUSES) }).safeParse({ id: fd.get("id"), status: fd.get("status") });
  if (!parsed.success) return { error: "That no longer exists." };
  try {
    await work.setMyWorkTaskStatus(g.actor, parsed.data.id, parsed.data.status);
    revalidatePath("/work");
    return { ok: "Saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
