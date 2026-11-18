"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as pay from "@/lib/dal/employee-pay";
import { payInputFromForm } from "@/lib/pay-form";

/** An admin sets pay for any stream partner's employee. Permission first, then the form, then the data-access layer. */
export type AdminPayState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const done = (ok: string): AdminPayState => {
  revalidatePath("/partners", "layout");
  return { ok };
};

export async function addEmployeePay(_prev: AdminPayState, fd: FormData): Promise<AdminPayState> {
  const g = await actorWithPerm("team", "edit");
  if (!g.actor) return { error: g.error };
  try {
    await pay.addPayPlan(g.actor, payInputFromForm(fd));
    return done("Pay saved.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function stopEmployeePay(_prev: AdminPayState, fd: FormData): Promise<AdminPayState> {
  const g = await actorWithPerm("team", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("planId"));
  if (!id.success) return { error: "That pay arrangement no longer exists." };
  try {
    await pay.stopPayPlan(g.actor, id.data);
    return done("Pay stopped.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function markEmployeePayPaid(_prev: AdminPayState, fd: FormData): Promise<AdminPayState> {
  const g = await actorWithPerm("team", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("planId"));
  if (!id.success) return { error: "That pay arrangement no longer exists." };
  const date = fd.get("paidDate");
  try {
    await pay.markProjectPayPaid(g.actor, id.data, typeof date === "string" && date ? date : undefined);
    return done("Marked paid.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
