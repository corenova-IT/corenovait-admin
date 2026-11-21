import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Tx } from "@/lib/db";
import { parseMoneyToMinor } from "@/lib/money";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, requireAdmin, requirePerm, type Actor } from "./guard";
import { toSafeNumber } from "./internal";
import { NotFound, moneyRowsWhere, notHiddenFrom, partnerScope } from "./scope";

/**
 * Taxes and fees on an income entry: the platform's cut (Upwork, Fiverr...), a withdrawal tax, VAT or a transfer
 * charge, and any "other" deduction with its own label. Amounts are in the entry's own currency, and together
 * they can't be more than the payment. What is left is "after taxes and fees".
 *
 * Who may set them: the partner whose stream AND country the entry is in (that's "the stream team deals with it";
 * they can change nothing else about an income entry), or an admin (for any entry they can see: not one under a
 * project the Owner hid from them). Every change is logged with before and after.
 *
 * Real tax and fee rates change and aren't looked up automatically: the team enters the actual amounts.
 */
const { incomeEntries, incomeDeductions } = schema;

export const DEDUCTION_KINDS = ["platform", "withdrawal", "vat_transfer", "other"] as const;
export const DEDUCTION_LABELS: Record<(typeof DEDUCTION_KINDS)[number], string> = {
  platform: "Platform fee (Upwork, Fiverr…)",
  withdrawal: "Withdrawal tax",
  vat_transfer: "VAT or transfer charge",
  other: "Other",
};
const MAX_ITEMS = 20;

export const deductionItem = z.object({
  kind: z.enum(DEDUCTION_KINDS),
  label: z.string().trim().max(80, "Use 80 characters or fewer for the name.").default(""),
  amount: z.string().trim().min(1, "Enter an amount."),
});
export type DeductionInput = z.input<typeof deductionItem>;
export type DeductionRow = { id: string; kind: (typeof DEDUCTION_KINDS)[number]; label: string; amountMinor: number };

/** Which entries this caller may touch: a partner's own stream+country, or any entry an admin can see. */
function entryAccess(tx: Tx, actor: Actor) {
  assertCaller(actor);
  if (actor.isAdmin) {
    requireAdmin(actor);
    return notHiddenFrom(tx, actor, incomeEntries.projectId);
  }
  if (actor.presetId !== "stream_partner") throw new AccessDenied();
  requirePerm(actor, "stream_partner", "edit");
  partnerScope(actor);
  return and(moneyRowsWhere(actor, { streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(tx, actor, incomeEntries.projectId));
}

const toRows = (rows: Array<typeof incomeDeductions.$inferSelect>): DeductionRow[] => rows.map((r) => ({ id: r.id, kind: r.kind, label: r.label, amountMinor: r.amountMinor }));

/** Replaces an entry's taxes and fees with exactly this list (an empty list clears them). */
export async function setDeductions(actor: Actor, incomeEntryId: string, items: DeductionInput[]): Promise<{ deductionsMinor: number }> {
  if (items.length > MAX_ITEMS) throw new RuleError(`Add up to ${MAX_ITEMS} deductions.`);
  const parsed = items.map((i) => {
    const r = deductionItem.safeParse(i);
    if (!r.success) throw new RuleError(r.error.issues[0]?.message ?? "Check the deductions and try again.");
    if (r.data.kind === "other" && !r.data.label) throw new RuleError("Give each \"other\" deduction a name, like Bank charge.");
    let minor: number;
    try {
      minor = toSafeNumber(parseMoneyToMinor(r.data.amount));
    } catch {
      throw new RuleError("Use a valid amount for each deduction.");
    }
    if (!(minor > 0)) throw new RuleError("Each deduction must be more than zero. Remove the ones you don't need.");
    return { kind: r.data.kind, label: r.data.kind === "other" ? r.data.label : "", amountMinor: minor };
  });
  return getDb().transaction(async (tx) => {
    const [entry] = await tx.select().from(incomeEntries).where(and(eq(incomeEntries.id, incomeEntryId), entryAccess(tx, actor))).for("update");
    if (!entry) throw new NotFound();
    const total = parsed.reduce((a, p) => a + p.amountMinor, 0);
    if (total > entry.amountMinor) throw new RuleError("Taxes and fees can't be more than the payment itself.");
    const before = toRows(await tx.select().from(incomeDeductions).where(eq(incomeDeductions.incomeEntryId, incomeEntryId)).orderBy(asc(incomeDeductions.createdAt)));
    await tx.delete(incomeDeductions).where(eq(incomeDeductions.incomeEntryId, incomeEntryId));
    if (parsed.length) await tx.insert(incomeDeductions).values(parsed.map((p) => ({ incomeEntryId, ...p, createdBy: actor.userId })));
    await tx.update(incomeEntries).set({ deductionsMinor: total }).where(eq(incomeEntries.id, incomeEntryId));
    const same = before.length === parsed.length && before.every((b, i) => b.kind === parsed[i].kind && b.label === parsed[i].label && b.amountMinor === parsed[i].amountMinor);
    if (!same) {
      // logged under income_entries (with the project) so the Owner's hiding rules for audit rows apply to it too
      await writeAudit(tx, actorRef(actor), {
        action: "update",
        entity: "income_entries",
        entityId: incomeEntryId,
        summary: "Taxes and fees changed on an income entry",
        before: { projectId: entry.projectId, currency: entry.currency, deductionsMinor: entry.deductionsMinor, deductions: before.map(({ kind, label, amountMinor }) => ({ kind, label, amountMinor })) },
        after: { projectId: entry.projectId, currency: entry.currency, deductionsMinor: total, deductions: parsed },
      });
    }
    return { deductionsMinor: total };
  });
}
