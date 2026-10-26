"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as pay from "@/lib/dal/payments";

/** Payments and subscriptions. Permission first, then the form, then the data-access layer. */
export type PayState = { ok?: string; error?: string };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): PayState => {
  revalidatePath("/payments");
  revalidatePath("/home");
  revalidatePath("/transactions");
  return { ok };
};

export async function saveSubscription(_prev: PayState, fd: FormData): Promise<PayState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("payments", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: "That payment couldn't be found. Refresh and try again." };
  try {
    await pay.saveSubscription(g.actor, id || null, {
      vendor: str(fd, "vendor"),
      category: str(fd, "category"),
      description: str(fd, "description"),
      amount: str(fd, "amount"),
      currency: str(fd, "currency"),
      fxRate: str(fd, "fxRate") || "1",
      billingCycle: (str(fd, "billingCycle") || "monthly") as "monthly",
      nextDueDate: str(fd, "nextDueDate"),
      reminderDays: str(fd, "reminderDays") || "3",
      paidFrom: str(fd, "paidFrom"),
      responsibleUserId: str(fd, "responsibleUserId") || null,
      countryCode: str(fd, "countryCode") || null,
      notes: str(fd, "notes"),
    });
    return done(id ? "Payment saved." : "Payment added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

const statusSchema = z.object({ id: uuid, status: z.enum(["active", "paused", "cancelled"]) });

export async function setStatus(_prev: PayState, fd: FormData): Promise<PayState> {
  const g = await actorWithPerm("payments", "edit");
  if (!g.actor) return { error: g.error };
  const v = statusSchema.safeParse({ id: fd.get("id"), status: fd.get("status") });
  if (!v.success) return { error: "Something went wrong. Refresh and try again." };
  try {
    await pay.setSubscriptionStatus(g.actor, v.data.id, v.data.status);
    return done(v.data.status === "active" ? "Resumed." : v.data.status === "paused" ? "Paused." : "Cancelled.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function markPaid(_prev: PayState, fd: FormData): Promise<PayState> {
  const g = await actorWithPerm("payments", "edit");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That payment couldn't be found. Refresh and try again." };
  try {
    const r = await pay.markSubscriptionPaid(g.actor, id.data, { paidDate: str(fd, "paidDate") || undefined });
    return done(r.nextDueDate ? `Marked as paid and added to expenses. Next due ${r.nextDueDate}.` : "Marked as paid and added to expenses. This one-off payment is complete.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteSubscription(_prev: PayState, fd: FormData): Promise<PayState> {
  const g = await actorWithPerm("payments", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That payment couldn't be found. Refresh and try again." };
  try {
    await pay.deleteSubscription(g.actor, id.data);
    return done("Payment deleted. Expenses already recorded from it are kept.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
