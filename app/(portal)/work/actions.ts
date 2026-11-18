"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as work from "@/lib/dal/employee-work";
import * as shifts from "@/lib/dal/shifts";
import { fmtMinutes } from "@/lib/hours";
import { TASK_STATUSES } from "@/lib/work";

/** An employee moves their own tasks along. Permission first, then the form, then the data-access layer. */
export type WorkState = { ok?: string; error?: string };

export async function clockIn(_prev: WorkState, _fd: FormData): Promise<WorkState> {
  const g = await actorWithPerm("employee", "create");
  if (!g.actor) return { error: g.error };
  try {
    await shifts.clockIn(g.actor);
    revalidatePath("/work");
    return { ok: "Clocked in." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function clockOut(_prev: WorkState, _fd: FormData): Promise<WorkState> {
  const g = await actorWithPerm("employee", "edit");
  if (!g.actor) return { error: g.error };
  try {
    const r = await shifts.clockOut(g.actor);
    revalidatePath("/work");
    return { ok: `Clocked out. That shift was ${fmtMinutes(r.minutes)}.` };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

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
