import "server-only";
import { and, asc, count, desc, eq, gte, inArray, sql, sum, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import type { AppModule } from "@/lib/permissions";
import { actorRef, writeAudit } from "./audit";
import { baseCurrency, moneyFields, moneyValues } from "./finance";
import { AccessDenied, RuleError, hasPerm, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";

/**
 * Revenue by stream, by country and by representative, plus representative
 * records and their payout log. All totals are in the base currency (whole
 * cents); per-currency totals are kept for the country pages.
 */
const { incomeEntries, streams, countries, representatives, repPayouts, users } = schema;

// ---------------------------------------------------------------- shared helpers
export const PERIODS = ["12m", "ytd", "all"] as const;
export type Period = (typeof PERIODS)[number];
export const periodSchema = z.enum(PERIODS).optional().catch(undefined);

/** First day included for a period, as YYYY-MM-DD (UTC calendar). */
export function periodStart(period: Period = "12m", today = new Date()): string | undefined {
  if (period === "all") return undefined;
  if (period === "ytd") return `${today.getUTCFullYear()}-01-01`;
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
  return d.toISOString().slice(0, 10);
}

/** The 12 month keys (YYYY-MM) ending with the current month. */
export function lastTwelveMonths(today = new Date()): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11 + i, 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Integer division rounded half away from zero (for averages of whole cents). */
export function divRound(total: number, n: number): number {
  if (n === 0) return 0;
  const t = BigInt(total);
  const d = BigInt(n);
  const q = t / d;
  const r = t % d;
  const away = (r < 0n ? -r : r) * 2n >= d;
  return Number(away ? q + (t < 0n ? -1n : 1n) : q);
}

const repIdsFor = (db: Db | Tx, userId: string) =>
  db.select({ id: representatives.id }).from(representatives).where(eq(representatives.userId, userId));

/** Which income rows a module's reports may include, by that module's scope. */
function incomeScopeFor(db: Db | Tx, actor: Actor, module: AppModule): SQL | undefined {
  return scopeWhere(actor, module, {
    owner: incomeEntries.createdBy,
    assignedTo: (uid) => inArray(incomeEntries.representativeId, repIdsFor(db, uid)),
  });
}

const n = (v: unknown) => Number(v ?? 0);
const monthKey = sql<string>`date_format(${incomeEntries.entryDate}, '%Y-%m')`;

async function monthly(db: Db | Tx, where: SQL | undefined, months: string[]) {
  const rows = await db
    .select({ month: monthKey, total: sum(incomeEntries.amountBaseMinor), deals: count() })
    .from(incomeEntries)
    .where(and(where, gte(incomeEntries.entryDate, `${months[0]}-01`)))
    .groupBy(monthKey);
  const map = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => ({ month: m, totalBaseMinor: n(map.get(m)?.total), deals: n(map.get(m)?.deals) }));
}

async function topClients(db: Db | Tx, where: SQL | undefined, limit = 5) {
  const rows = await db
    .select({ client: incomeEntries.client, total: sum(incomeEntries.amountBaseMinor), deals: count() })
    .from(incomeEntries)
    .where(where)
    .groupBy(incomeEntries.client)
    .orderBy(desc(sum(incomeEntries.amountBaseMinor)))
    .limit(limit);
  return rows.map((r) => ({ client: r.client || "(no client name)", totalBaseMinor: n(r.total), deals: n(r.deals) }));
}

// ---------------------------------------------------------------- streams
export async function streamSummaries(actor: Actor, period: Period = "12m") {
  requirePerm(actor, "streams", "view");
  const db = getDb();
  const months = lastTwelveMonths();
  const from = periodStart(period);
  const scope = incomeScopeFor(db, actor, "streams");
  const where = and(scope, from ? gte(incomeEntries.entryDate, from) : undefined);
  const [list, totals, series, base] = await Promise.all([
    db.select().from(streams).orderBy(asc(streams.sort), asc(streams.name)),
    db
      .select({ streamId: incomeEntries.streamId, total: sum(incomeEntries.amountBaseMinor), deals: count() })
      .from(incomeEntries)
      .where(where)
      .groupBy(incomeEntries.streamId),
    db
      .select({ streamId: incomeEntries.streamId, month: monthKey, total: sum(incomeEntries.amountBaseMinor) })
      .from(incomeEntries)
      .where(and(scope, gte(incomeEntries.entryDate, `${months[0]}-01`)))
      .groupBy(incomeEntries.streamId, monthKey),
    baseCurrency(db),
  ]);
  const grand = totals.reduce((a, t) => a + n(t.total), 0);
  const rows = list.map((s) => {
    const t = totals.find((x) => x.streamId === s.id);
    const revenue = n(t?.total);
    const deals = n(t?.deals);
    return {
      id: s.id,
      name: s.name,
      active: s.active,
      revenueBaseMinor: revenue,
      deals,
      averageBaseMinor: divRound(revenue, deals),
      sharePct: grand ? Math.round((revenue / grand) * 1000) / 10 : 0,
      trend: months.map((m) => n(series.find((x) => x.streamId === s.id && x.month === m)?.total)),
    };
  });
  return { rows, totalBaseMinor: grand, baseCurrency: base, months };
}

export async function streamDetail(actor: Actor, id: number, period: Period = "12m") {
  requirePerm(actor, "streams", "view");
  const db = getDb();
  const [stream] = await db.select().from(streams).where(eq(streams.id, id));
  if (!stream) return null;
  const from = periodStart(period);
  const scope = and(incomeScopeFor(db, actor, "streams"), eq(incomeEntries.streamId, id));
  const where = and(scope, from ? gte(incomeEntries.entryDate, from) : undefined);
  const months = lastTwelveMonths();
  const [[agg], byCountry, clients, series, base] = await Promise.all([
    db.select({ total: sum(incomeEntries.amountBaseMinor), deals: count() }).from(incomeEntries).where(where),
    db
      .select({ code: countries.code, name: countries.name, total: sum(incomeEntries.amountBaseMinor), deals: count() })
      .from(incomeEntries)
      .innerJoin(countries, eq(countries.code, incomeEntries.countryCode))
      .where(where)
      .groupBy(countries.code, countries.name)
      .orderBy(desc(sum(incomeEntries.amountBaseMinor))),
    topClients(db, where),
    monthly(db, scope, months),
    baseCurrency(db),
  ]);
  const revenue = n(agg.total);
  const deals = n(agg.deals);
  return {
    stream: { id: stream.id, name: stream.name, active: stream.active },
    revenueBaseMinor: revenue,
    deals,
    averageBaseMinor: divRound(revenue, deals),
    byCountry: byCountry.map((c) => ({ code: c.code, name: c.name, totalBaseMinor: n(c.total), deals: n(c.deals) })),
    topClients: clients,
    monthly: series,
    baseCurrency: base,
  };
}

// ---------------------------------------------------------------- countries
export async function countrySummaries(actor: Actor, period: Period = "12m") {
  requirePerm(actor, "countries", "view");
  const db = getDb();
  const from = periodStart(period);
  const where = and(incomeScopeFor(db, actor, "countries"), from ? gte(incomeEntries.entryDate, from) : undefined);
  const [list, totals, byCurrency, base] = await Promise.all([
    db.select().from(countries).orderBy(asc(countries.sort)),
    db
      .select({ code: incomeEntries.countryCode, total: sum(incomeEntries.amountBaseMinor), deals: count() })
      .from(incomeEntries)
      .where(where)
      .groupBy(incomeEntries.countryCode),
    db
      .select({ code: incomeEntries.countryCode, currency: incomeEntries.currency, total: sum(incomeEntries.amountMinor) })
      .from(incomeEntries)
      .where(where)
      .groupBy(incomeEntries.countryCode, incomeEntries.currency),
    baseCurrency(db),
  ]);
  const grand = totals.reduce((a, t) => a + n(t.total), 0);
  return {
    baseCurrency: base,
    totalBaseMinor: grand,
    rows: list.map((c) => {
      const t = totals.find((x) => x.code === c.code);
      const revenue = n(t?.total);
      const deals = n(t?.deals);
      return {
        code: c.code,
        name: c.name,
        revenueBaseMinor: revenue,
        deals,
        averageBaseMinor: divRound(revenue, deals),
        sharePct: grand ? Math.round((revenue / grand) * 1000) / 10 : 0,
        byCurrency: byCurrency
          .filter((x) => x.code === c.code)
          .map((x) => ({ currency: x.currency, totalMinor: n(x.total) }))
          .sort((a, b) => b.totalMinor - a.totalMinor),
      };
    }),
  };
}

export async function countryDetail(actor: Actor, code: string, period: Period = "12m") {
  requirePerm(actor, "countries", "view");
  const db = getDb();
  const [country] = await db.select().from(countries).where(eq(countries.code, code.toUpperCase()));
  if (!country) return null;
  const from = periodStart(period);
  const scope = and(incomeScopeFor(db, actor, "countries"), eq(incomeEntries.countryCode, country.code));
  const where = and(scope, from ? gte(incomeEntries.entryDate, from) : undefined);
  const months = lastTwelveMonths();
  const [[agg], byStream, byCurrency, clients, series, base] = await Promise.all([
    db.select({ total: sum(incomeEntries.amountBaseMinor), deals: count() }).from(incomeEntries).where(where),
    db
      .select({ id: streams.id, name: streams.name, total: sum(incomeEntries.amountBaseMinor), deals: count() })
      .from(incomeEntries)
      .innerJoin(streams, eq(streams.id, incomeEntries.streamId))
      .where(where)
      .groupBy(streams.id, streams.name)
      .orderBy(desc(sum(incomeEntries.amountBaseMinor))),
    db
      .select({ currency: incomeEntries.currency, total: sum(incomeEntries.amountMinor), base: sum(incomeEntries.amountBaseMinor) })
      .from(incomeEntries)
      .where(where)
      .groupBy(incomeEntries.currency),
    topClients(db, where),
    monthly(db, scope, months),
    baseCurrency(db),
  ]);
  const revenue = n(agg.total);
  const deals = n(agg.deals);
  return {
    country: { code: country.code, name: country.name },
    revenueBaseMinor: revenue,
    deals,
    averageBaseMinor: divRound(revenue, deals),
    byStream: byStream.map((s) => ({ id: s.id, name: s.name, totalBaseMinor: n(s.total), deals: n(s.deals) })),
    byCurrency: byCurrency.map((c) => ({ currency: c.currency, totalMinor: n(c.total), totalBaseMinor: n(c.base) })).sort((a, b) => b.totalMinor - a.totalMinor),
    topClients: clients,
    monthly: series,
    baseCurrency: base,
  };
}

// ---------------------------------------------------------------- representatives
function repScope(actor: Actor): SQL | undefined {
  return scopeWhere(actor, "representatives", { owner: representatives.createdBy, assignedTo: (uid) => eq(representatives.userId, uid) });
}

/**
 * Commission is earned on PAID income only, at the rate stored on each entry
 * (the rep's rate when the deal was credited), rounded per entry to whole
 * cents half away from zero. Owed = earned - paid out. All in base currency.
 */
const earnedExpr = sql<string>`coalesce(sum(case when ${incomeEntries.status} = 'paid' then round(${incomeEntries.amountBaseMinor} * coalesce(${incomeEntries.commissionRate}, ${representatives.commissionRate})) else 0 end), 0)`;

async function repStats(db: Db | Tx, repIds: string[]) {
  if (!repIds.length) return new Map<string, { deals: number; revenue: number; earned: number; paid: number }>();
  const [deals, payouts] = await Promise.all([
    db
      .select({ id: representatives.id, deals: count(incomeEntries.id), revenue: sum(incomeEntries.amountBaseMinor), earned: earnedExpr })
      .from(representatives)
      .leftJoin(incomeEntries, eq(incomeEntries.representativeId, representatives.id))
      .where(inArray(representatives.id, repIds))
      .groupBy(representatives.id),
    db
      .select({ id: repPayouts.representativeId, paid: sum(repPayouts.amountBaseMinor) })
      .from(repPayouts)
      .where(inArray(repPayouts.representativeId, repIds))
      .groupBy(repPayouts.representativeId),
  ]);
  return new Map(
    repIds.map((id) => {
      const d = deals.find((x) => x.id === id);
      return [id, { deals: n(d?.deals), revenue: n(d?.revenue), earned: n(d?.earned), paid: n(payouts.find((p) => p.id === id)?.paid) }];
    })
  );
}

export type RepSummary = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  commissionRate: string;
  userId: string | null;
  userName: string | null;
  active: boolean;
  deals: number;
  revenueBaseMinor: number;
  commissionEarnedBaseMinor: number;
  commissionPaidBaseMinor: number;
  commissionOwedBaseMinor: number;
};

export async function repSummaries(actor: Actor): Promise<{ rows: RepSummary[]; baseCurrency: string }> {
  requirePerm(actor, "representatives", "view");
  const db = getDb();
  const [list, base] = await Promise.all([
    db
      .select({ r: representatives, userName: users.fullName })
      .from(representatives)
      .leftJoin(users, eq(users.id, representatives.userId))
      .where(repScope(actor))
      .orderBy(desc(representatives.active), asc(representatives.name)),
    baseCurrency(db),
  ]);
  const stats = await repStats(db, list.map((x) => x.r.id));
  return {
    baseCurrency: base,
    rows: list.map(({ r, userName }) => {
      const s = stats.get(r.id)!;
      return {
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        commissionRate: r.commissionRate,
        userId: r.userId,
        userName,
        active: r.active,
        deals: s.deals,
        revenueBaseMinor: s.revenue,
        commissionEarnedBaseMinor: s.earned,
        commissionPaidBaseMinor: s.paid,
        commissionOwedBaseMinor: s.earned - s.paid,
      };
    }),
  };
}

export async function repDetail(actor: Actor, id: string) {
  requirePerm(actor, "representatives", "view");
  const db = getDb();
  const [row] = await db
    .select({ r: representatives, userName: users.fullName })
    .from(representatives)
    .leftJoin(users, eq(users.id, representatives.userId))
    .where(and(eq(representatives.id, id), repScope(actor)));
  if (!row) return null;
  const [stats, deals, payouts, base] = await Promise.all([
    repStats(db, [id]),
    db
      .select({
        id: incomeEntries.id,
        entryDate: incomeEntries.entryDate,
        client: incomeEntries.client,
        streamName: streams.name,
        status: incomeEntries.status,
        amountMinor: incomeEntries.amountMinor,
        currency: incomeEntries.currency,
        amountBaseMinor: incomeEntries.amountBaseMinor,
        commissionRate: sql<string>`coalesce(${incomeEntries.commissionRate}, ${representatives.commissionRate})`,
        commissionBaseMinor: sql<string>`case when ${incomeEntries.status} = 'paid' then round(${incomeEntries.amountBaseMinor} * coalesce(${incomeEntries.commissionRate}, ${representatives.commissionRate})) else 0 end`,
      })
      .from(incomeEntries)
      .innerJoin(streams, eq(streams.id, incomeEntries.streamId))
      .innerJoin(representatives, eq(representatives.id, incomeEntries.representativeId))
      .where(eq(incomeEntries.representativeId, id))
      .orderBy(desc(incomeEntries.entryDate))
      .limit(100),
    db.select().from(repPayouts).where(eq(repPayouts.representativeId, id)).orderBy(desc(repPayouts.paidDate), desc(repPayouts.createdAt)),
    baseCurrency(db),
  ]);
  const s = stats.get(id)!;
  return {
    rep: { ...row.r, userName: row.userName },
    deals: deals.map((d) => ({ ...d, amountBaseMinor: n(d.amountBaseMinor), commissionBaseMinor: n(d.commissionBaseMinor) })),
    payouts: payouts.map((p) => ({ ...p, amountBaseMinor: n(p.amountBaseMinor) })),
    dealsCount: s.deals,
    revenueBaseMinor: s.revenue,
    commissionEarnedBaseMinor: s.earned,
    commissionPaidBaseMinor: s.paid,
    commissionOwedBaseMinor: s.earned - s.paid,
    baseCurrency: base,
  };
}

/** "12.5" (percent) -> "0.1250" for DECIMAL(5,4). Up to 2 decimals, 0 to 100. */
export function percentToRate(input: string): string {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim().replace(/%$/, ""));
  if (!m) throw new RuleError("Enter the commission as a percentage, like 10 or 12.5.");
  const hundredths = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  if (hundredths > 10_000) throw new RuleError("Commission can't be more than 100%.");
  return `${Math.floor(hundredths / 10_000)}.${String(hundredths % 10_000).padStart(4, "0")}`;
}

export const repInput = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(120),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email address.").max(254)]).optional(),
  phone: z.string().trim().max(40).optional(),
  commissionPercent: z.string().trim().min(1, "Enter the commission percentage."),
  userId: z.union([z.literal(""), z.string().uuid()]).optional(),
  active: z.boolean().default(true),
});
export type RepInput = z.input<typeof repInput>;

/** People a representative can be linked to (so "assigned" scope shows them their own deals). */
export async function linkableUsers(actor: Actor) {
  if (!hasPerm(actor, "representatives", "create") && !hasPerm(actor, "representatives", "edit")) throw new AccessDenied();
  const rows = await getDb()
    .select({ id: users.id, name: users.fullName, email: users.email })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(asc(users.fullName));
  return rows;
}

export async function saveRep(actor: Actor, id: string | null, input: RepInput): Promise<string> {
  requirePerm(actor, "representatives", id ? "edit" : "create");
  const parsed = repInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  const v = parsed.data;
  const values = {
    name: v.name,
    email: v.email || null,
    phone: v.phone || null,
    commissionRate: percentToRate(v.commissionPercent),
    userId: v.userId || null,
    active: v.active,
  };
  const db = getDb();
  if (values.userId) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, values.userId));
    if (!u) throw new RuleError("That person no longer exists.");
  }
  return db.transaction(async (tx) => {
    if (!id) {
      const newId = crypto.randomUUID();
      await tx.insert(representatives).values({ id: newId, ...values, createdBy: actor.userId });
      const [after] = await tx.select().from(representatives).where(eq(representatives.id, newId));
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "representatives", entityId: newId, after });
      return newId;
    }
    const [before] = await tx.select().from(representatives).where(eq(representatives.id, id)).for("update");
    if (!before || !rowAllowed(actor, "representatives", { ownerId: before.createdBy, assigneeId: before.userId })) {
      throw new AccessDenied("That representative doesn't exist or isn't yours to change.");
    }
    await tx.update(representatives).set(values).where(eq(representatives.id, id));
    const [after] = await tx.select().from(representatives).where(eq(representatives.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "representatives", entityId: id, before, after });
    return id;
  });
}

export const payoutInput = z.object({
  representativeId: z.string().uuid(),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was paid."),
  ...moneyFields,
  reference: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(2000).optional(),
});
export type PayoutInput = z.input<typeof payoutInput>;

async function repInScope(db: Db | Tx, actor: Actor, repId: string) {
  const [rep] = await db.select().from(representatives).where(eq(representatives.id, repId));
  if (!rep || !rowAllowed(actor, "representatives", { ownerId: rep.createdBy, assigneeId: rep.userId })) {
    throw new AccessDenied("That representative doesn't exist or isn't yours to change.");
  }
  return rep;
}

export async function recordPayout(actor: Actor, input: PayoutInput): Promise<string> {
  requirePerm(actor, "representatives", "create");
  const parsed = payoutInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the payout and try again.");
  const v = parsed.data;
  const db = getDb();
  await repInScope(db, actor, v.representativeId);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(repPayouts).values({
      id,
      representativeId: v.representativeId,
      paidDate: v.paidDate,
      ...moneyValues(v),
      reference: v.reference,
      notes: v.notes || null,
      createdBy: actor.userId,
    });
    const [after] = await tx.select().from(repPayouts).where(eq(repPayouts.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "rep_payouts", entityId: id, after });
  });
  return id;
}

export async function deletePayout(actor: Actor, id: string) {
  requirePerm(actor, "representatives", "delete");
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(repPayouts).where(eq(repPayouts.id, id)).for("update");
    if (!before) throw new RuleError("That payout no longer exists.");
    await repInScope(tx, actor, before.representativeId);
    await tx.delete(repPayouts).where(eq(repPayouts.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "rep_payouts", entityId: id, before });
  });
}
