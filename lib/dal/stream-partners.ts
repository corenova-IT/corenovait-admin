import "server-only";
import { asc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { partnerScope } from "./scope";

/**
 * A Partner's own view of their assignment. Everything here is decided by
 * lib/dal/scope.ts: this file never reads a company table on its own.
 */
const { streams, countries } = schema;

export type MyAssignments = {
  streams: Array<{ id: number; name: string }>;
  countries: Array<{ code: string; name: string }>;
  /** false until both a stream and a country are assigned: nothing is shown until then */
  hasData: boolean;
};

/** Which streams and countries the signed-in Partner runs (names only, no figures). */
export async function myAssignments(actor: Parameters<typeof partnerScope>[0]): Promise<MyAssignments> {
  const scope = partnerScope(actor);
  const db = getDb();
  const [s, c] = await Promise.all([
    scope.streamIds.length ? db.select({ id: streams.id, name: streams.name }).from(streams).where(inArray(streams.id, scope.streamIds)).orderBy(asc(streams.name)) : [],
    scope.countryCodes.length ? db.select({ code: countries.code, name: countries.name }).from(countries).where(inArray(countries.code, scope.countryCodes)).orderBy(asc(countries.name)) : [],
  ]);
  return { streams: s, countries: c, hasData: scope.hasData };
}
