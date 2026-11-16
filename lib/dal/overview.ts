import "server-only";
import { asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { baseCurrency } from "./finance";
import { requireOwner, type Actor } from "./guard";
import { earnedExpr, outstandingSum, paidSum, periodStart, repStats, shareEarnedExpr, shareExpectedExpr, type Period } from "./revenue";

/**
 * The Owner's overview: all revenue across streams, projects and partners in one
 * place, with what partners earned and what the company keeps. Owner only, and the
 * Owner sees everything (including projects hidden from other people).
 *
 * Revenue is PAID income; outstanding is pending + overdue. Partner shares and
 * commission are earned on PAID income at the rates copied onto each entry. All in
 * the base currency, whole cents. Entries are counted by their date, so the period
 * applies to income, shares and commission alike; "paid out" and "owed" are all-time
 * because payouts aren't tied to a period.
 */
const { incomeEntries, incomeShares, projects, projectPartners, streams, representatives } = schema;

const n = (v: unknown) => Number(v ?? 0);

export type OverviewRow = {
  key: string;
  streamId: number;
  stream: string;
  /** null = income not filed under any project */
  projectId: string | null;
  project: string | null;
  paidBaseMinor: number;
  outstandingBaseMinor: number;
  deals: number;
  partnerSharesBaseMinor: number;
  partnerCount: number;
  /** paid income less partner shares and commission on it */
  companyBaseMinor: number;
};

export type OverviewPartner = {
  id: string;
  name: string;
  projects: number;
  earnedBaseMinor: number;
  expectedBaseMinor: number;
  /** all time */
  paidOutBaseMinor: number;
  /** all time: earned (commission + shares) less paid out */
  owedBaseMinor: number;
  hasLogin: boolean;
};

export type OwnerOverview = {
  baseCurrency: string;
  period: Period;
  paidBaseMinor: number;
  outstandingBaseMinor: number;
  partnerSharesBaseMinor: number;
  commissionBaseMinor: number;
  companyBaseMinor: number;
  rows: OverviewRow[];
  partners: OverviewPartner[];
  /** everyone who could be previewed (the "what would this person see?" picker) */
  people: Array<{ id: string; name: string; email: string; role: string; status: "invited" | "active" | "deactivated"; isOwner: boolean }>;
};

export async function ownerOverview(actor: Actor, period: Period = "12m"): Promise<OwnerOverview> {
  requireOwner(actor);
  const db = getDb();
  const from = periodStart(period);
  const inPeriod = from ? gte(incomeEntries.entryDate, from) : undefined;

  const [base, totals, byProject, sharesByProject, partnersByProject, commission, repShares, partnerLinks, people] = await Promise.all([
    baseCurrency(db),
    db.select({ paid: paidSum, outstanding: outstandingSum }).from(incomeEntries).where(inPeriod),
    db
      .select({
        streamId: streams.id,
        stream: streams.name,
        streamSort: streams.sort,
        projectId: projects.id,
        project: projects.name,
        paid: paidSum,
        outstanding: outstandingSum,
        deals: sql<string>`count(${incomeEntries.id})`,
      })
      .from(incomeEntries)
      .innerJoin(streams, eq(streams.id, incomeEntries.streamId))
      .leftJoin(projects, eq(projects.id, incomeEntries.projectId))
      .where(inPeriod)
      .groupBy(streams.id, streams.name, streams.sort, projects.id, projects.name),
    db
      .select({ projectId: incomeEntries.projectId, earned: shareEarnedExpr })
      .from(incomeShares)
      .innerJoin(incomeEntries, eq(incomeEntries.id, incomeShares.incomeEntryId))
      .where(inPeriod)
      .groupBy(incomeEntries.projectId),
    db.select({ projectId: projectPartners.projectId, partners: sql<string>`count(*)` }).from(projectPartners).groupBy(projectPartners.projectId),
    // commission credited to representatives on paid deals in the period
    db
      .select({ earned: earnedExpr })
      .from(incomeEntries)
      .innerJoin(representatives, eq(representatives.id, incomeEntries.representativeId))
      .where(inPeriod),
    db
      .select({
        id: incomeShares.representativeId,
        earned: shareEarnedExpr,
        expected: shareExpectedExpr,
        projects: sql<string>`count(distinct ${incomeEntries.projectId})`,
      })
      .from(incomeShares)
      .innerJoin(incomeEntries, eq(incomeEntries.id, incomeShares.incomeEntryId))
      .where(inPeriod)
      .groupBy(incomeShares.representativeId),
    db
      .select({ id: representatives.id, name: representatives.name, hasLogin: sql<number>`${representatives.userId} is not null`, projects: sql<string>`count(${projectPartners.projectId})` })
      .from(representatives)
      .innerJoin(projectPartners, eq(projectPartners.representativeId, representatives.id))
      .groupBy(representatives.id, representatives.name, representatives.userId),
    db
      .select({ id: schema.users.id, name: schema.users.fullName, email: schema.users.email, role: schema.rolePresets.name, status: schema.users.status, isOwner: schema.users.isOwner })
      .from(schema.users)
      .innerJoin(schema.rolePresets, eq(schema.rolePresets.id, schema.users.presetId))
      .orderBy(asc(schema.users.fullName), asc(schema.users.email)),
  ]);

  const shareOf = (projectId: string | null) => n(sharesByProject.find((s) => s.projectId === projectId)?.earned);
  const rows: OverviewRow[] = [...byProject]
    // by stream, then projects by name, with "no project" last in each stream
    .sort((a, b) => a.streamSort - b.streamSort || a.stream.localeCompare(b.stream) || Number(a.projectId === null) - Number(b.projectId === null) || (a.project ?? "").localeCompare(b.project ?? ""))
    .map((r) => {
      const shares = r.projectId ? shareOf(r.projectId) : 0;
      return {
        key: `${r.streamId}-${r.projectId ?? "none"}`,
        streamId: r.streamId,
        stream: r.stream,
        projectId: r.projectId,
        project: r.project,
        paidBaseMinor: n(r.paid),
        outstandingBaseMinor: n(r.outstanding),
        deals: n(r.deals),
        partnerSharesBaseMinor: shares,
        partnerCount: r.projectId ? n(partnersByProject.find((p) => p.projectId === r.projectId)?.partners) : 0,
        companyBaseMinor: 0, // filled below, once commission is allocated
      };
    });

  const paid = n(totals[0]?.paid);
  const shares = rows.reduce((a, r) => a + r.partnerSharesBaseMinor, 0);
  const commissionEarned = n(commission[0]?.earned);

  // per-row company figure = paid less partner shares; commission is a company-wide figure, subtracted once in the headline
  for (const r of rows) r.companyBaseMinor = r.paidBaseMinor - r.partnerSharesBaseMinor;

  const repIds = partnerLinks.map((p) => p.id);
  const stats = await repStats(db, actor, repIds);
  const partners: OverviewPartner[] = partnerLinks
    .map((p) => {
      const s = stats.get(p.id);
      const inRange = repShares.find((x) => x.id === p.id);
      return {
        id: p.id,
        name: p.name,
        projects: n(p.projects),
        earnedBaseMinor: n(inRange?.earned),
        expectedBaseMinor: n(inRange?.expected),
        paidOutBaseMinor: s?.paid ?? 0,
        owedBaseMinor: s ? s.earned + s.shareEarned - s.paid : 0,
        hasLogin: !!p.hasLogin,
      };
    })
    .sort((a, b) => b.earnedBaseMinor - a.earnedBaseMinor || a.name.localeCompare(b.name));

  return {
    baseCurrency: base,
    period,
    paidBaseMinor: paid,
    outstandingBaseMinor: n(totals[0]?.outstanding),
    partnerSharesBaseMinor: shares,
    commissionBaseMinor: commissionEarned,
    companyBaseMinor: paid - shares - commissionEarned,
    rows,
    partners,
    people,
  };
}
