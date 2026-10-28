import "server-only";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { can, type AppAction, type AppModule, type PermMap } from "@/lib/permissions";

/**
 * Who is calling. Only lib/dal/auth.ts creates these (from a database session),
 * and every data-access function rejects an Actor it didn't issue, so a page
 * can't hand-craft `{ perms: everything }`.
 */
export type Actor = Readonly<{
  userId: string;
  email: string;
  fullName: string;
  jobTitle: string;
  /** profile picture, or null for the initials */
  avatarUrl: string | null;
  presetId: string;
  presetName: string;
  isAdmin: boolean;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  /** this session passed the TOTP / recovery-code step */
  mfaVerified: boolean;
  sessionId: string;
  perms: PermMap;
}>;

const issued = new WeakSet<object>();

export function issueActor(a: Actor): Actor {
  const frozen = Object.freeze({ ...a, perms: Object.freeze(a.perms) });
  issued.add(frozen);
  return frozen;
}

export class AccessDenied extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "AccessDenied";
  }
}

/** A plain-language rule failure (last admin, expired link…) that is safe to show. */
export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

/** Two-factor done if their role needs it (or they turned it on). */
export function callerOk(actor: Actor): boolean {
  if (!issued.has(actor)) return false;
  if ((actor.mfaRequired || actor.mfaEnabled) && !actor.mfaVerified) return false;
  return true;
}

export function assertCaller(actor: Actor): void {
  if (!issued.has(actor)) throw new AccessDenied("Your session has ended. Sign in again.");
  if (!callerOk(actor)) throw new AccessDenied("Verify your two-factor code, then try again.");
}

/** has_perm(module, action): throws unless the caller may do it. */
export function requirePerm(actor: Actor, module: AppModule, action: AppAction): void {
  assertCaller(actor);
  if (!can(actor.perms, module, action)) throw new AccessDenied();
}

export function hasPerm(actor: Actor, module: AppModule, action: AppAction): boolean {
  return callerOk(actor) && can(actor.perms, module, action);
}

/** Admin-only operations: the Admin preset AND team edit permission AND two-factor done. */
export function requireAdmin(actor: Actor): void {
  requirePerm(actor, "team", "edit");
  if (!actor.isAdmin) throw new AccessDenied("Only admins can do that.");
  if (!actor.mfaVerified) throw new AccessDenied("Verify your two-factor code, then try again.");
}

/**
 * Data scope as a WHERE condition:
 *   all      → no filter
 *   own      → rows the caller created
 *   assigned → rows the caller created OR rows assigned to them
 * `assignedTo` builds the "assigned to this user" condition for the table.
 */
export function scopeWhere(
  actor: Actor,
  module: AppModule,
  cols: { owner: MySqlColumn; assignedTo?: (userId: string) => SQL }
): SQL | undefined {
  const scope = actor.perms[module].scope;
  if (scope === "all") return undefined;
  const own = eq(cols.owner, actor.userId);
  if (scope === "own" || !cols.assignedTo) return own;
  return or(own, cols.assignedTo(actor.userId));
}

/** The same rule for a single row already loaded. */
export function rowAllowed(actor: Actor, module: AppModule, row: { ownerId: string | null; assigneeId?: string | null }): boolean {
  const scope = actor.perms[module].scope;
  if (scope === "all") return true;
  if (row.ownerId === actor.userId) return true;
  return scope === "assigned" && row.assigneeId != null && row.assigneeId === actor.userId;
}

export const whereAll = (...conds: Array<SQL | undefined>) => and(...conds.filter(Boolean)) ?? sql`true`;
