"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as ded from "@/lib/dal/income-deductions";
import { deductionItemsFromForm } from "@/lib/deduction-form";

export type MoneyState = { ok?: string; error?: string };

/** An admin sets the taxes and fees on any income entry they can see (the DAL checks it again and logs it). */
export async function saveAdminDeductions(_prev: MoneyState, fd: FormData): Promise<MoneyState> {
  const g = await actorWithPerm("transactions", "edit");
  if (!g.actor) return { error: g.error };
  const id = z.string().uuid().safeParse(fd.get("entryId"));
  if (!id.success) return { error: "That no longer exists." };
  try {
    await ded.setDeductions(g.actor, id.data, deductionItemsFromForm(fd));
    revalidatePath("/project-money");
    return { ok: "Taxes and fees saved." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
