"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as rev from "@/lib/dal/revenue";

/** Representatives and their payout log. Permission first, then the form, then the data-access layer. */
export type RepState = { ok?: string; error?: string; overpayment?: { owedBaseMinor: number; amountBaseMinor: number } };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const done = (ok: string): RepState => {
  revalidatePath("/streams", "layout");
  return { ok };
};

export async function saveRep(_prev: RepState, fd: FormData): Promise<RepState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("representatives", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: "That representative couldn't be found. Refresh and try again." };
  try {
    await rev.saveRep(g.actor, id || null, {
      name: str(fd, "name"),
      email: str(fd, "email"),
      phone: str(fd, "phone"),
      commissionPercent: str(fd, "commissionPercent"),
      userId: str(fd, "userId"),
      active: fd.get("active") === "on",
    });
    return done(id ? "Representative saved." : "Representative added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function recordPayout(_prev: RepState, fd: FormData): Promise<RepState> {
  const g = await actorWithPerm("representatives", "create");
  if (!g.actor) return { error: g.error };
  try {
    await rev.recordPayout(
      g.actor,
      {
        representativeId: str(fd, "representativeId"),
        paidDate: str(fd, "paidDate"),
        amount: str(fd, "amount"),
        currency: str(fd, "currency"),
        fxRate: str(fd, "fxRate") || "1",
        reference: str(fd, "reference"),
        notes: str(fd, "notes"),
      },
      { confirmOverpayment: fd.get("confirmOverpayment") === "on" }
    );
    return done("Payout recorded.");
  } catch (e) {
    if (e instanceof rev.OverpaymentNeedsConfirmation) {
      return { error: e.message, overpayment: { owedBaseMinor: e.owedBaseMinor, amountBaseMinor: e.amountBaseMinor } };
    }
    return { error: errorMessage(e) };
  }
}

export async function deletePayout(_prev: RepState, fd: FormData): Promise<RepState> {
  const g = await actorWithPerm("representatives", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That payout couldn't be found. Refresh and try again." };
  try {
    await rev.deletePayout(g.actor, id.data);
    return done("Payout deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
