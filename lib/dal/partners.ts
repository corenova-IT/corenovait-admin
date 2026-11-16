import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { baseCurrency } from "./finance";
import { requirePerm, type Actor } from "./guard";
import { repStats, shareEarnedExpr, shareExpectedExpr } from "./revenue";
import { incomeVisible } from "./visibility";

/**
 * "My earnings": what a partner may see about their own money, and nothing else.
 *
 * Access takes BOTH the "partner" permission and a representative record linked to
 * the caller's login (Representatives -> Portal login). What comes back is only the
 * caller's own share of each project's paid and unpaid income, their own commission,
 * payouts and balance. Never: the gross amount or client of an entry, the invoice,
 * other partners or their shares, the project's total, or the company's share.
 * Projects the Owner hid from the caller are left out like everything else.
 */
const { incomeEntries, incomeShares, projects, projectPartners, streams, representatives, repPayouts } = schema;

export type PartnerEarnings = {
  baseCurrency: string;
  /** false when no representative record is linked to this login yet */
  linked: boolean;
  /** shares + commission on paid income */
  earnedBaseMinor: number;
  /** shares on income that isn't paid yet */
  expectedBaseMinor: number;
  paidOutBaseMinor: number;
  /** earned less paid out */
  owedBaseMinor: number;
  byProject: Array<{ projectId: string; project: string; stream: string; sharePercent: string | null; entries: number; earnedBaseMinor: number; expectedBaseMinor: number }>;
  /** the caller's own share of each recent entry; no client, description or gross amount */
  recent: Array<{ key: string; date: string; kind: "share" | "commission"; project: string | null; status: "pending" | "paid" | "overdue"; ratePercent: string; amountBaseMinor: number }>;
  payouts: Array<{ id: string; date: string; amountBaseMinor: number; reference: string }>;
};

const n = (v: unknown) => Number(v ?? 0);
const pct = (rate: string | null) => (rate == null ? null : String(Math.round(Number(rate) * 10_000) / 100));

export async function partnerEarnings(actor: Actor): Promise<PartnerEarnings> {
  requirePerm(actor, "partner", "view");
  const db = getDb();
  const base = await baseCurrency(db);
  const mine = await db.select({ id: representatives.id, rate: representatives.commissionRate }).from(representatives).where(eq(representatives.userId, actor.userId));
  const empty: PartnerEarnings = { baseCurrency: base, linked: false, earnedBaseMinor: 0, expectedBaseMinor: 0, paidOutBaseMinor: 0, owedBaseMinor: 0, byProject: [], recent: [], payouts: [] };
  if (!mine.length) return empty;
  const repIds = mine.map((r) => r.id);
  const visible = incomeVisible(db, actor);

  const [stats, expected, perProject, shareRows, commissionRows, payoutRows, currentRates] = await Promise.all([
    repStats(db, actor, repIds),
    db
      .select({ expected: shareExpectedExpr })
      .from(incomeShares)
      .innerJoin(incomeEntries, eq(incomeEntries.id, incomeShares.incomeEntryId))
      .where(and(inArray(incomeShares.representativeId, repIds), visible)),
    db
      .select({
        projectId: projects.id,
        project: projects.name,
        stream: streams.name,
        entries: sql<string>`count(*)`,
        earned: shareEarnedExpr,
        expected: shareExpectedExpr,
      })
      .from(incomeShares)
      .innerJoin(incomeEntries, eq(incomeEntries.id, incomeShares.incomeEntryId))
      .innerJoin(projects, eq(projects.id, incomeEntries.projectId))
      .innerJoin(streams, eq(streams.id, projects.streamId))
      .where(and(inArray(incomeShares.representativeId, repIds), visible))
      .groupBy(projects.id, projects.name, streams.name)
      .orderBy(projects.name),
    db
      .select({
        key: sql<string>`concat('s-', ${incomeEntries.id}, '-', ${incomeShares.representativeId})`,
        date: incomeEntries.entryDate,
        project: projects.name,
        status: incomeEntries.status,
        rate: incomeShares.shareRate,
        amount: sql<string>`round(${incomeEntries.amountBaseMinor} * ${incomeShares.shareRate})`,
      })
      .from(incomeShares)
      .innerJoin(incomeEntries, eq(incomeEntries.id, incomeShares.incomeEntryId))
      .leftJoin(projects, eq(projects.id, incomeEntries.projectId))
      .where(and(inArray(incomeShares.representativeId, repIds), visible))
      .orderBy(desc(incomeEntries.entryDate), desc(incomeEntries.createdAt))
      .limit(100),
    db
      .select({
        key: sql<string>`concat('c-', ${incomeEntries.id})`,
        date: incomeEntries.entryDate,
        project: projects.name,
        status: incomeEntries.status,
        rate: sql<string>`coalesce(${incomeEntries.commissionRate}, ${representatives.commissionRate})`,
        amount: sql<string>`round(${incomeEntries.amountBaseMinor} * coalesce(${incomeEntries.commissionRate}, ${representatives.commissionRate}))`,
      })
      .from(incomeEntries)
      .innerJoin(representatives, eq(representatives.id, incomeEntries.representativeId))
      .leftJoin(projects, eq(projects.id, incomeEntries.projectId))
      .where(and(inArray(incomeEntries.representativeId, repIds), visible))
      .orderBy(desc(incomeEntries.entryDate), desc(incomeEntries.createdAt))
      .limit(100),
    db
      .select({ id: repPayouts.id, date: repPayouts.paidDate, amount: repPayouts.amountBaseMinor, reference: repPayouts.reference })
      .from(repPayouts)
      .where(inArray(repPayouts.representativeId, repIds))
      .orderBy(desc(repPayouts.paidDate), desc(repPayouts.createdAt))
      .limit(100),
    db.select({ projectId: projectPartners.projectId, rate: projectPartners.shareRate }).from(projectPartners).where(inArray(projectPartners.representativeId, repIds)),
  ]);

  let earned = 0;
  let paid = 0;
  for (const id of repIds) {
    const s = stats.get(id);
    earned += (s?.earned ?? 0) + (s?.shareEarned ?? 0);
    paid += s?.paid ?? 0;
  }
  const recent = [
    ...shareRows.map((r) => ({ key: r.key, date: r.date, kind: "share" as const, project: r.project, status: r.status, ratePercent: pct(r.rate)!, amountBaseMinor: n(r.amount) })),
    ...commissionRows.map((r) => ({ key: r.key, date: r.date, kind: "commission" as const, project: r.project, status: r.status, ratePercent: pct(r.rate)!, amountBaseMinor: n(r.amount) })),
  ]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 100);

  return {
    baseCurrency: base,
    linked: true,
    earnedBaseMinor: earned,
    expectedBaseMinor: n(expected[0]?.expected),
    paidOutBaseMinor: paid,
    owedBaseMinor: earned - paid,
    byProject: perProject.map((p) => ({
      projectId: p.projectId,
      project: p.project,
      stream: p.stream,
      sharePercent: pct(currentRates.find((c) => c.projectId === p.projectId)?.rate ?? null),
      entries: n(p.entries),
      earnedBaseMinor: n(p.earned),
      expectedBaseMinor: n(p.expected),
    })),
    recent,
    payouts: payoutRows.map((p) => ({ id: p.id, date: p.date, amountBaseMinor: n(p.amount), reference: p.reference })),
  };
}
