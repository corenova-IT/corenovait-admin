"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as shifts from "@/lib/dal/shifts";

/** An admin corrects any employee's shift. Permission first, then the form, then the data-access layer. */
export type EmployeeAdminState = { ok?: string; error?: string };

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

export async function correctShift(_prev: EmployeeAdminState, fd: FormData): Promise<EmployeeAdminState> {
  const g = await actorWithPerm("team", "edit");
  if (!g.actor) return { error: g.error };
  const id = z.string().uuid().safeParse(fd.get("shiftId"));
  if (!id.success) return { error: "That shift no longer exists." };
  try {
    await shifts.correctShift(g.actor, id.data, { clockIn: str(fd, "clockIn"), clockOut: str(fd, "clockOut"), note: str(fd, "note") });
    revalidatePath("/employees", "layout");
    return { ok: "Shift corrected and logged." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
