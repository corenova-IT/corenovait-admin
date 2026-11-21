import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { hasPerm, type Actor } from "./guard";
import { moneyRowsWhere, notHiddenFrom, partnerScope } from "./scope";

const { expenses } = schema;

/**
 * May this person download a document attached to this expense? The partner whose stream and country it is in (while
 * it isn't archived), and an admin who can see transactions (not for a project the Owner hid from them). Anyone
 * else, or a missing expense, gets "no" and the route answers 404.
 */
export async function partnerExpenseFileVisible(actor: Actor, expenseId: string): Promise<boolean> {
  const db = getDb();
  if (actor.isAdmin) {
    if (!hasPerm(actor, "transactions", "view")) return false;
    const [row] = await db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.id, expenseId), notHiddenFrom(db, actor, expenses.projectId)));
    return !!row;
  }
  if (actor.presetId !== "stream_partner" || !hasPerm(actor, "stream_partner", "view")) return false;
  partnerScope(actor);
  const [row] = await db.select({ id: expenses.id }).from(expenses).where(and(eq(expenses.id, expenseId), moneyRowsWhere(actor, { streamId: expenses.streamId, countryCode: expenses.countryCode }), isNull(expenses.archivedAt)));
  return !!row;
}
