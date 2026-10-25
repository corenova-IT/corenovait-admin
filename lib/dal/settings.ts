import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { assertCaller, type Actor } from "./guard";

export type CompanySettings = { companyName: string; baseCurrency: string; timezone: string };

const DEFAULTS: CompanySettings = { companyName: "CoreNovaIT", baseCurrency: "AUD", timezone: "Australia/Sydney" };

/** Every signed-in person may read these (they drive formatting). Editing arrives with the Settings page. */
export async function getCompanySettings(actor: Actor): Promise<CompanySettings> {
  assertCaller(actor);
  const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.id, 1));
  return row ? { companyName: row.companyName, baseCurrency: row.baseCurrency, timezone: row.timezone } : DEFAULTS;
}
