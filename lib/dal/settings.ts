import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, requirePerm, type Actor } from "./guard";

export type CompanySettings = { companyName: string; baseCurrency: string; timezone: string };

const DEFAULTS: CompanySettings = { companyName: "CoreNovaIT", baseCurrency: "AUD", timezone: "Australia/Sydney" };

/** Every signed-in person may read these (they drive formatting). Admins edit the time zone in Settings. */
export async function getCompanySettings(actor: Actor): Promise<CompanySettings> {
  assertCaller(actor);
  const [row] = await getDb().select().from(schema.settings).where(eq(schema.settings.id, 1));
  return row ? { companyName: row.companyName, baseCurrency: row.baseCurrency, timezone: row.timezone } : DEFAULTS;
}

/** Every IANA time zone this server knows, for the Settings picker. */
export function timeZones(): string[] {
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes("UTC") ? zones : [...zones, "UTC"];
}

function validTimeZone(tz: string): boolean {
  if (!timeZones().includes(tz)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * The company time zone: "today" for due dates, the marketing heatmap and
 * insights, and calendar times. Admin only (Settings edit + Admin role +
 * two-factor); audited with before and after.
 */
export async function updateCompanyTimezone(actor: Actor, timezone: string): Promise<void> {
  requirePerm(actor, "settings", "edit");
  if (!actor.isAdmin) throw new AccessDenied("Only admins can change company settings.");
  if (!actor.mfaVerified) throw new AccessDenied("Verify your two-factor code, then try again.");
  const tz = timezone.trim();
  if (!validTimeZone(tz)) throw new RuleError("Choose a time zone from the list, like Australia/Sydney or Europe/London.");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.settings).where(eq(schema.settings.id, 1)).for("update");
    if (before?.timezone === tz) return;
    await tx.update(schema.settings).set({ timezone: tz, updatedAt: new Date(), updatedBy: actor.userId }).where(eq(schema.settings.id, 1));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "settings",
      entityId: "1",
      summary: `Company time zone: ${before?.timezone ?? "—"} → ${tz}`,
      before: { timezone: before?.timezone ?? null },
      after: { timezone: tz },
    });
  });
}
