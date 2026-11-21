import "server-only";
import { and, eq, inArray, isNull, notExists, or, sql, type SQL } from "drizzle-orm";
import type { MySqlColumn } from "drizzle-orm/mysql-core";
import { schema, type Db, type Tx } from "@/lib/db";
import { AccessDenied, RuleError, assertCaller, callerOk, type Actor } from "./guard";
import { can } from "@/lib/permissions";

/**
 * THE shared scoped-query helper for Partners and Employees.
 *
 * The permission matrix only says which ACTIONS these roles have (view / create / edit on
 * their own module). WHICH ROWS they may touch is decided here, once, and nowhere else:
 *
 *   - Money rows (income, expenses, subscriptions, employee pay): the row's stream AND its
 *     country must both be assigned to the partner. A row with no stream or no country
 *     never matches, so company-wide rows stay admin-only.
 *   - Non-money rows (projects, tasks): the stream must match, and the partner must have
 *     at least one country assigned (no countries = no data at all).
 *   - A project the Owner hid from the partner disappears with everything filed under it.
 *   - Writes never trust the form: stream and country are checked against the assignment.
 *
 * Every function here is built so it can only ever REMOVE rows from a query, never add any,
 * and so that "nothing assigned" yields `false` (an empty result), never "no filter".
 * Any lib/dal file that reads company tables for these roles must import from this file;
 * tests/dal/stream-partners.test.ts checks that.
 */
const { projectHiddenFrom } = schema;

/** "That no longer exists." A missing row and a row that isn't yours look exactly the same. */
export class NotFound extends RuleError {
  constructor() {
    super("That no longer exists.");
    this.name = "NotFound";
  }
}

const NOTHING = sql`false`;

export type PartnerScope = { streamIds: number[]; countryCodes: string[]; hasData: boolean };

/** True for a signed-in Partner (by preset; a custom role can never be one). */
export function isStreamPartner(actor: Actor): boolean {
  return actor.presetId === "stream_partner" && actor.scoped?.kind === "stream_partner";
}

/**
 * The caller's streams and countries. Throws unless they are a Partner who has
 * passed two-factor. `hasData` is false when either list is empty: that is the one place
 * the "no countries assigned = nothing" rule lives.
 */
export function partnerScope(actor: Actor): PartnerScope {
  assertCaller(actor);
  if (!isStreamPartner(actor) || !can(actor.perms, "stream_partner", "view")) throw new AccessDenied();
  const s = actor.scoped;
  if (!s || s.kind !== "stream_partner") throw new AccessDenied();
  return { streamIds: [...s.streamIds], countryCodes: [...s.countryCodes], hasData: s.streamIds.length > 0 && s.countryCodes.length > 0 };
}

export type Assignment = { streamIds: readonly number[]; countryCodes: readonly string[] };

/**
 * The same two rules for a GIVEN assignment (not the signed-in caller). The admin Partners pages use these
 * to show an admin exactly what a partner's assignment covers, so the rule lives here once and the
 * partner's own view and the admin's view of that partner can never drift apart.
 */
export function moneyRowsFor(p: Assignment, cols: { streamId: MySqlColumn; countryCode: MySqlColumn }): SQL {
  if (!p.streamIds.length || !p.countryCodes.length) return NOTHING;
  return and(inArray(cols.streamId, [...p.streamIds]), inArray(cols.countryCode, [...p.countryCodes])) ?? NOTHING;
}
export function streamRowsFor(p: Assignment, cols: { streamId: MySqlColumn }): SQL {
  if (!p.streamIds.length || !p.countryCodes.length) return NOTHING;
  return inArray(cols.streamId, [...p.streamIds]);
}

/** Money rows: `stream_id IN (assigned) AND country_code IN (assigned)`. */
export function moneyRowsWhere(actor: Actor, cols: { streamId: MySqlColumn; countryCode: MySqlColumn }): SQL {
  return moneyRowsFor(partnerScope(actor), cols);
}

/** Projects and tasks: `stream_id IN (assigned)`, and only if at least one country is assigned. */
export function streamRowsWhere(actor: Actor, cols: { streamId: MySqlColumn }): SQL {
  return streamRowsFor(partnerScope(actor), cols);
}

/**
 * Removes anything filed under a project the Owner hid from this person. `projectCol` is the
 * column holding the project id (income_entries.project_id, tasks.project_id, projects.id…).
 * Rows with no project stay. undefined for the Owner (who is never a partner anyway).
 */
export function notHiddenFrom(db: Db | Tx, actor: Actor, projectCol: MySqlColumn): SQL | undefined {
  if (actor.isOwner) return undefined;
  return or(
    isNull(projectCol),
    notExists(
      db
        .select({ one: sql`1` })
        .from(projectHiddenFrom)
        .where(and(eq(projectHiddenFrom.projectId, projectCol), eq(projectHiddenFrom.userId, actor.userId)))
    )
  );
}

/** For writes: the stream must be one of theirs (and they must have a country). Missing and not-yours look the same. */
export function assertStreamAllowed(actor: Actor, streamId: number): void {
  const p = partnerScope(actor);
  if (!p.hasData || !p.streamIds.includes(streamId)) throw new NotFound();
}

/** For writes on money rows: the country must be one of theirs. */
export function assertCountryAllowed(actor: Actor, countryCode: string | null | undefined): void {
  const p = partnerScope(actor);
  if (!p.hasData || !countryCode || !p.countryCodes.includes(countryCode)) throw new NotFound();
}

/** An employee's own projects only (a row with no project never matches). */
export function employeeProjectsWhere(actor: Actor, projectCol: MySqlColumn): SQL {
  assertCaller(actor);
  if (actor.presetId !== "employee" || actor.scoped?.kind !== "employee" || !can(actor.perms, "employee", "view")) throw new AccessDenied();
  const ids = actor.scoped.projectIds;
  return ids.length ? (inArray(projectCol, ids) ?? NOTHING) : NOTHING;
}

/** True when the caller is a scoped role that has finished sign-in (used to keep scoped roles out of company-wide code). */
export function isScopedActor(actor: Actor): boolean {
  return callerOk(actor) && actor.scoped !== null;
}
