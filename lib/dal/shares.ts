import "server-only";
import { eq, inArray } from "drizzle-orm";
import { schema, type Db, type Tx } from "@/lib/db";

/**
 * Partner shares on income entries. An entry filed under a project gets a copy
 * of the project's partner shares (income_shares), so a later change to the
 * project's shares only affects entries filed or moved afterwards, unless the
 * Owner chooses to apply it to the existing ones.
 *
 * This file only talks to the database (no permission checks): callers do those.
 */
const { incomeShares, projectPartners, incomeEntries } = schema;

/** Replace one entry's shares with the project's current ones (none when it has no project). */
export async function snapshotShares(db: Db | Tx, entryId: string, projectId: string | null): Promise<void> {
  await db.delete(incomeShares).where(eq(incomeShares.incomeEntryId, entryId));
  if (!projectId) return;
  const partners = await db.select().from(projectPartners).where(eq(projectPartners.projectId, projectId));
  if (partners.length) {
    await db.insert(incomeShares).values(partners.map((p) => ({ incomeEntryId: entryId, representativeId: p.representativeId, shareRate: p.shareRate })));
  }
}

/** Re-copy the project's current shares onto every entry already in it. Returns how many entries. */
export async function resnapshotProject(db: Db | Tx, projectId: string): Promise<number> {
  const entries = await db.select({ id: incomeEntries.id }).from(incomeEntries).where(eq(incomeEntries.projectId, projectId));
  if (!entries.length) return 0;
  const ids = entries.map((e) => e.id);
  await db.delete(incomeShares).where(inArray(incomeShares.incomeEntryId, ids));
  const partners = await db.select().from(projectPartners).where(eq(projectPartners.projectId, projectId));
  if (partners.length) {
    const rows = ids.flatMap((incomeEntryId) => partners.map((p) => ({ incomeEntryId, representativeId: p.representativeId, shareRate: p.shareRate })));
    // in slices so a project with thousands of entries doesn't build one enormous statement
    for (let i = 0; i < rows.length; i += 500) await db.insert(incomeShares).values(rows.slice(i, i + 500));
  }
  return ids.length;
}
