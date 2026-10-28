"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RuleError } from "@/lib/dal/guard";
import { limiters, slowDown } from "@/lib/rate-limit";
import { actorWithPerm, errorMessage } from "@/lib/auth/session";
import * as fin from "@/lib/dal/finance";

/**
 * Thin wrappers around lib/dal/finance. Each checks the permission first,
 * then validates the form; the data-access layer re-checks permission and
 * scope, and writes the audit log.
 */
export type LedgerState = { ok?: string; error?: string; errors?: string[] };

const uuid = z.string().uuid();
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};

async function attachmentFrom(fd: FormData, userId: string): Promise<fin.Attachment | undefined> {
  const f = fd.get("attachment");
  if (!f || typeof f === "string" || f.size === 0) return undefined;
  const rl = limiters.uploadPerUser.hit(userId);
  if (!rl.ok) throw new RuleError(slowDown("uploads", rl.retryAfterSec));
  return { name: f.name, bytes: Buffer.from(await f.arrayBuffer()) };
}

const done = (ok: string): LedgerState => {
  revalidatePath("/transactions");
  revalidatePath("/streams", "layout");
  return { ok };
};

// ---------- income ----------
export async function saveIncome(_prev: LedgerState, fd: FormData): Promise<LedgerState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("transactions", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: "That entry couldn't be found. Refresh and try again." };
  const input: fin.IncomeInput = {
    entryDate: str(fd, "entryDate"),
    streamId: str(fd, "streamId"),
    countryCode: str(fd, "countryCode"),
    client: str(fd, "client"),
    description: str(fd, "description"),
    amount: str(fd, "amount"),
    currency: str(fd, "currency"),
    fxRate: str(fd, "fxRate") || "1",
    invoiceRef: str(fd, "invoiceRef"),
    status: (str(fd, "status") || "pending") as "pending",
    representativeId: str(fd, "representativeId") || null,
    notes: str(fd, "notes"),
  };
  try {
    const attachment = await attachmentFrom(fd, g.actor.userId);
    if (id) await fin.updateIncome(g.actor, id, input, attachment);
    else await fin.createIncome(g.actor, input, attachment);
    return done(id ? "Income entry saved." : "Income entry added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteIncome(_prev: LedgerState, fd: FormData): Promise<LedgerState> {
  const g = await actorWithPerm("transactions", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That entry couldn't be found. Refresh and try again." };
  try {
    await fin.deleteIncome(g.actor, id.data);
    return done("Income entry deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------- expenses ----------
export async function saveExpense(_prev: LedgerState, fd: FormData): Promise<LedgerState> {
  const id = str(fd, "id");
  const g = await actorWithPerm("transactions", id ? "edit" : "create");
  if (!g.actor) return { error: g.error };
  if (id && !uuid.safeParse(id).success) return { error: "That expense couldn't be found. Refresh and try again." };
  const input: fin.ExpenseInput = {
    expenseDate: str(fd, "expenseDate"),
    category: str(fd, "category"),
    vendor: str(fd, "vendor"),
    description: str(fd, "description"),
    amount: str(fd, "amount"),
    currency: str(fd, "currency"),
    fxRate: str(fd, "fxRate") || "1",
    isRecurring: fd.get("isRecurring") === "on",
    countryCode: str(fd, "countryCode") || null,
    notes: str(fd, "notes"),
  };
  try {
    const attachment = await attachmentFrom(fd, g.actor.userId);
    if (id) await fin.updateExpense(g.actor, id, input, attachment);
    else await fin.createExpense(g.actor, input, attachment);
    return done(id ? "Expense saved." : "Expense added.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

export async function deleteExpense(_prev: LedgerState, fd: FormData): Promise<LedgerState> {
  const g = await actorWithPerm("transactions", "delete");
  if (!g.actor) return { error: g.error };
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return { error: "That expense couldn't be found. Refresh and try again." };
  try {
    await fin.deleteExpense(g.actor, id.data);
    return done("Expense deleted.");
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------- CSV import ----------
export async function importCsv(_prev: LedgerState, fd: FormData): Promise<LedgerState> {
  const g = await actorWithPerm("transactions", "create");
  if (!g.actor) return { error: g.error };
  const kind = str(fd, "kind") === "expenses" ? "expenses" : "income";
  const file = fd.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { error: "Choose a CSV file to import." };
  const rl = limiters.uploadPerUser.hit(g.actor.userId);
  if (!rl.ok) return { error: slowDown("uploads", rl.retryAfterSec) };
  if (file.size > fin.IMPORT_MAX_BYTES) return { error: "That file is over 1 MB. Split it into smaller files." };
  try {
    const text = await file.text();
    const result = kind === "income" ? await fin.importIncomeCsv(g.actor, text) : await fin.importExpensesCsv(g.actor, text);
    if (!result.ok) return { error: "Nothing was imported. Fix these rows and try again:", errors: result.errors };
    return done(`Imported ${result.created} ${kind === "income" ? "income entries" : "expenses"}.`);
  } catch (e) {
    return { error: errorMessage(e, "That file couldn't be imported.") };
  }
}
