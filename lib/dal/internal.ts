import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { schema, type Db, type Tx } from "@/lib/db";
import { ACTIONS, PRIVILEGED_MODULES, emptyPermMap, type ModulePerm, type PermMap } from "@/lib/permissions";
import { RuleError } from "./guard";

/** Helpers shared by the DAL modules. Never call these from outside lib/dal. */
const { users, userPermissions, presetPermissions } = schema;

type PermRecord = typeof userPermissions.$inferSelect | typeof presetPermissions.$inferSelect;

export function rowsToPermMap(rows: PermRecord[]): PermMap {
  const map = emptyPermMap();
  for (const r of rows) {
    map[r.module] = { view: r.canView, create: r.canCreate, edit: r.canEdit, delete: r.canDelete, export: r.canExport, scope: r.scope };
  }
  return map;
}

/** Audit-friendly list of the modules that grant anything. */
export function permSnapshot(map: PermMap) {
  return Object.entries(map)
    .filter(([, p]) => ACTIONS.some((a) => p[a]))
    .map(([module, p]) => ({ module, ...p }));
}

export async function loadUserPerms(db: Db | Tx, userId: string): Promise<PermMap> {
  return rowsToPermMap(await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)));
}

export async function loadPresetPerms(db: Db | Tx, presetId: string): Promise<PermMap> {
  return rowsToPermMap(await db.select().from(presetPermissions).where(eq(presetPermissions.presetId, presetId)));
}

/** Any action implies view; rows with nothing granted are dropped. */
export function normalisePerms(map: PermMap): Array<[keyof PermMap, ModulePerm]> {
  return (Object.entries(map) as Array<[keyof PermMap, ModulePerm]>)
    .map(([m, p]) => [m, { ...p, view: p.view || p.create || p.edit || p.delete || p.export }] as [keyof PermMap, ModulePerm])
    .filter(([, p]) => p.view);
}

const toRow = (m: keyof PermMap, p: ModulePerm) => ({
  module: m,
  canView: p.view,
  canCreate: p.create,
  canEdit: p.edit,
  canDelete: p.delete,
  canExport: p.export,
  scope: p.scope,
});

export async function writeUserPerms(tx: Tx, userId: string, map: PermMap) {
  await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
  const rows = normalisePerms(map).map(([m, p]) => ({ userId, ...toRow(m, p) }));
  if (rows.length) await tx.insert(userPermissions).values(rows);
}

export async function writePresetPerms(tx: Tx, presetId: string, map: PermMap) {
  await tx.delete(presetPermissions).where(eq(presetPermissions.presetId, presetId));
  const rows = normalisePerms(map).map(([m, p]) => ({ presetId, ...toRow(m, p) }));
  if (rows.length) await tx.insert(presetPermissions).values(rows);
}

/** Admins, and anyone who can touch finances, transactions, team, settings or the audit log, must use two-factor. */
export function needsMfa(presetId: string, map: PermMap): boolean {
  return presetId === "admin" || PRIVILEGED_MODULES.some((m) => ACTIONS.some((a) => map[m][a]));
}

/** Give a user a preset's permissions (a copy, so later edits to them stay separate). */
export async function copyPresetToUser(tx: Tx, userId: string, presetId: string) {
  const map = await loadPresetPerms(tx, presetId);
  await writeUserPerms(tx, userId, map);
  await tx.update(users).set({ presetId, mfaRequired: needsMfa(presetId, map) }).where(eq(users.id, userId));
}

/**
 * Last-admin guard. Locks every active admin row (so two admins can't demote
 * each other at the same moment) and refuses if `userId` is the only one left.
 */
export async function assertNotLastAdmin(tx: Tx, userId: string) {
  const admins = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.presetId, "admin"), eq(users.status, "active")))
    .for("update");
  if (admins.some((a) => a.id === userId) && admins.length <= 1) {
    throw new RuleError("Add another admin first. The portal must always keep at least one active admin.");
  }
}

export async function deleteSessions(tx: Db | Tx, userId: string, exceptSessionId?: string) {
  await tx
    .delete(schema.sessions)
    .where(exceptSessionId ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, exceptSessionId)) : eq(schema.sessions.userId, userId));
}

export async function presetNames(db: Db | Tx, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select().from(schema.rolePresets).where(inArray(schema.rolePresets.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Convert lib/money's bigint results for BIGINT(mode number) columns. */
export function toSafeNumber(v: bigint): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new RuleError("That amount is too large.");
  return Number(v);
}

/** lib/money's parseRate returns the rate × 10^8; DECIMAL(18,8) wants a string. */
export function rateToDecimal(scaled: bigint): string {
  const whole = scaled / 100_000_000n;
  const frac = (scaled % 100_000_000n).toString().padStart(8, "0");
  return `${whole}.${frac}`;
}
