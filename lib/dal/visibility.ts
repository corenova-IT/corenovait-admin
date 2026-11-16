import "server-only";
import { and, eq, inArray, isNull, notExists, notInArray, or, sql, type SQL } from "drizzle-orm";
import { schema, type Db, type Tx } from "@/lib/db";
import type { Actor } from "./guard";

/**
 * Who may see which project's money.
 *
 * The Owner sees everything. Everyone else loses every income row that belongs
 * to a project the Owner hid from them (project_hidden_from), whatever their
 * role, module permission or data scope: hiding is applied ON TOP of the usual
 * rules, so it can only ever remove rows, never add any.
 *
 * Every read of income_entries goes through `incomeVisible` (usually via
 * incomeScope in finance.ts / incomeScopeFor in revenue.ts), and every
 * single-row action goes through `projectHiddenFromActor`. A test
 * (tests/dal/revenue-privacy.test.ts) walks every read path.
 */
const { incomeEntries, projectHiddenFrom, auditLog } = schema;

/** The ids of the projects hidden from one person, as a subquery. */
const hiddenIds = (db: Db | Tx, userId: string) =>
  db.select({ id: projectHiddenFrom.projectId }).from(projectHiddenFrom).where(eq(projectHiddenFrom.userId, userId));

/**
 * WHERE condition for queries on income_entries: rows with no project, or whose
 * project isn't hidden from this person. undefined (no restriction) for the Owner.
 */
export function incomeVisible(db: Db | Tx, actor: Actor): SQL | undefined {
  if (actor.isOwner) return undefined;
  return or(
    isNull(incomeEntries.projectId),
    notExists(
      db
        .select({ one: sql`1` })
        .from(projectHiddenFrom)
        .where(and(eq(projectHiddenFrom.projectId, incomeEntries.projectId), eq(projectHiddenFrom.userId, actor.userId)))
    )
  );
}

/** True when this project's money is hidden from this person (always false for the Owner and for "no project"). */
export async function projectHiddenFromActor(db: Db | Tx, actor: Actor, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId || actor.isOwner) return false;
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(projectHiddenFrom)
    .where(and(eq(projectHiddenFrom.userId, actor.userId), eq(projectHiddenFrom.projectId, projectId)))
    .limit(1);
  return !!row;
}

/**
 * Audit rows hold before/after copies of income entries, amounts included, so
 * they follow the same rule. A row is hidden from this person when:
 *   - it's about an income entry that now belongs to a hidden project (this also
 *     covers its history from before it was moved into that project), or
 *   - its recorded copy of the entry names a hidden project (this covers entries
 *     deleted since, and entries moved out of a hidden project), or
 *   - it records the Owner changing who can see a project (owner-only information), or
 *   - it records an invoice file being uploaded for such an entry (file names give things away).
 * undefined (no restriction) for the Owner.
 */
export function auditVisible(db: Db | Tx, actor: Actor): SQL | undefined {
  if (actor.isOwner) return undefined;
  const hidden = hiddenIds(db, actor.userId);
  const recordedNow = sql`json_unquote(json_extract(coalesce(${auditLog.after}, ${auditLog.before}), '$.projectId'))`;
  const recordedBefore = sql`json_unquote(json_extract(${auditLog.before}, '$.projectId'))`;
  const entryNowHidden = inArray(auditLog.entityId, db.select({ id: incomeEntries.id }).from(incomeEntries).where(inArray(incomeEntries.projectId, hidden)));
  const namesHidden = (recorded: SQL) => sql`coalesce(${inArray(recorded, hidden)}, false)`;
  // "Uploaded <invoice file name>" rows: the name can reveal a client or an amount, so an invoice of a hidden
  // project's entry (or of an entry since deleted, whose project can no longer be told) is hidden as well
  const uploadedFor = sql`json_unquote(json_extract(${auditLog.after}, '$.entityId'))`;
  const uploadIsInvoice = sql`coalesce(json_unquote(json_extract(${auditLog.after}, '$.entityType')) = 'income_entries', false)`;
  const invoiceUpload = and(
    sql`${auditLog.entity} = 'files'`,
    uploadIsInvoice,
    or(
      inArray(uploadedFor, db.select({ id: incomeEntries.id }).from(incomeEntries).where(inArray(incomeEntries.projectId, hidden))),
      notInArray(uploadedFor, db.select({ id: incomeEntries.id }).from(incomeEntries))
    )
  );
  return and(
    sql`${auditLog.entity} not in ('projects', 'project_hidden_from')`,
    or(
      sql`${auditLog.entity} <> 'income_entries'`,
      and(sql`not coalesce(${entryNowHidden}, false)`, sql`not ${namesHidden(recordedNow)}`, sql`not ${namesHidden(recordedBefore)}`)
    ),
    sql`not coalesce(${invoiceUpload}, false)`
  );
}
