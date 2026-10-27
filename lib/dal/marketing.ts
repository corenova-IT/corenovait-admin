import "server-only";
import { and, asc, count, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { minorToDecimal, toCsv } from "@/lib/csv";
import { addMonths } from "@/lib/dates";
import { CHANNELS, CAMPAIGN_STATUSES, INSIGHT_MIN, OUTCOMES, RESPONDED, ratePct, type Channel } from "@/lib/marketing";
import { parseMoneyToMinor, parseRate } from "@/lib/money";
import { WEEKDAYS, localParts, toLocalInput, zonedToUtc } from "@/lib/zoned";
import { actorRef, writeAudit } from "./audit";
import { baseCurrency } from "./finance";
import { AccessDenied, RuleError, requirePerm, rowAllowed, scopeWhere, type Actor } from "./guard";
import { rateToDecimal, toSafeNumber } from "./internal";

/**
 * Marketing (module "marketing"): campaigns and the activity log, plus the
 * numbers on the Marketing page.
 *
 * Scope: own = activity you logged; assigned = also activity where you are
 * the owner (someone logged it for you); all = everything. Only people with
 * "all" can log activity for someone else or manage campaigns. Every change
 * is audited with the row before and after.
 *
 * Times are stored in UTC. Weekdays, hours and months (heatmap, insights,
 * "by month") are read in the company time zone from Settings.
 */
const { marketingActivities: acts, campaigns, users, settings } = schema;

const n = (v: unknown) => Number(v ?? 0);
const respondedSql = sql`(${acts.outcome} in (${sql.join(
  RESPONDED.map((o) => sql`${o}`),
  sql`, `
)}))`;

export async function companyTimezone(db: Db | Tx = getDb()): Promise<string> {
  const [s] = await db.select({ tz: settings.timezone }).from(settings).where(eq(settings.id, 1));
  return s?.tz ?? "Australia/Sydney";
}

function activityScope(actor: Actor): SQL | undefined {
  return scopeWhere(actor, "marketing", { owner: acts.createdBy, assignedTo: (uid) => eq(acts.ownerId, uid) });
}
const activityAllowed = (actor: Actor, row: { createdBy: string; ownerId: string }) =>
  rowAllowed(actor, "marketing", { ownerId: row.createdBy, assigneeId: row.ownerId });

/** Campaigns are shared by everyone in marketing, so changing them needs the "all" scope. */
function requireCampaignManager(actor: Actor, action: "create" | "edit" | "delete") {
  requirePerm(actor, "marketing", action);
  if (actor.perms.marketing.scope !== "all") throw new AccessDenied("Only people who can see all marketing activity can manage campaigns.");
}
export const canManageCampaigns = (actor: Actor, action: "create" | "edit" | "delete" = "edit") =>
  actor.perms.marketing[action] && actor.perms.marketing.scope === "all";

// ---------------------------------------------------------------- filters and period
const MONTH = /^\d{4}-\d{2}$/;
export const marketingFilters = z.object({
  channel: z.enum(CHANNELS).optional().catch(undefined),
  /** a campaign id, or "none" for activity outside any campaign */
  campaign: z.union([z.literal("none"), z.string().uuid()]).optional().catch(undefined),
  month: z.string().regex(MONTH).optional().catch(undefined),
  owner: z.string().uuid().optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(100_000).optional().catch(1),
});
export type MarketingFilters = z.infer<typeof marketingFilters>;

/**
 * The period on screen: one month when the month filter is set, otherwise
 * the last 12 months up to today (company time). `previous` is the same
 * length immediately before, for the % changes. Bounds are UTC instants; `to`
 * is exclusive.
 */
export function marketingPeriod(f: Pick<MarketingFilters, "month">, today: string, tz: string) {
  const endMonth = f.month ?? today.slice(0, 7);
  const months = f.month ? 1 : 12;
  const first = addMonths(`${endMonth}-01`, 1 - months);
  const after = addMonths(`${endMonth}-01`, 1);
  const prevFirst = addMonths(first, -months);
  const chartFirst = addMonths(`${endMonth}-01`, -11);
  return {
    months,
    from: zonedToUtc(first, tz),
    to: zonedToUtc(after, tz),
    previous: { from: zonedToUtc(prevFirst, tz), to: zonedToUtc(first, tz) },
    /** the 12 months ending with the period, for the chart and sparklines */
    chart: { from: zonedToUtc(chartFirst, tz), to: zonedToUtc(after, tz), first: chartFirst.slice(0, 7) },
    firstMonth: first.slice(0, 7),
    lastMonth: endMonth,
  };
}

/** Everything except the period: scope, channel, campaign and owner. */
function filterWhere(actor: Actor, f: MarketingFilters): Array<SQL | undefined> {
  const conds: Array<SQL | undefined> = [activityScope(actor)];
  if (f.channel) conds.push(eq(acts.channel, f.channel));
  if (f.campaign === "none") conds.push(isNull(acts.campaignId));
  else if (f.campaign) conds.push(eq(acts.campaignId, f.campaign));
  if (f.owner) conds.push(eq(acts.ownerId, f.owner));
  return conds;
}
const between = (from: Date, to: Date) => and(gte(acts.occurredAt, from), lt(acts.occurredAt, to));

// ---------------------------------------------------------------- the numbers
/**
 * Touches = activities logged. Contacts = unique contacts: each company counts
 * once in a period (or each person, when no company was given), compared
 * ignoring case and spaces at the ends. Response rate is per touch.
 */
export const contactKey = sql<string>`lower(trim(case when ${acts.contactCompany} <> '' then ${acts.contactCompany} else ${acts.contactName} end))`;

type Tally = { touches: number; responded: number; won: number; wonValueBaseMinor: number };
const emptyTally = (): Tally => ({ touches: 0, responded: 0, won: 0, wonValueBaseMinor: 0 });
const tallyCols = {
  touches: count(),
  responded: sql<string>`coalesce(sum(${respondedSql}), 0)`,
  won: sql<string>`coalesce(sum(${acts.outcome} = 'deal_won'), 0)`,
  wonValue: sql<string>`coalesce(sum(case when ${acts.outcome} = 'deal_won' then ${acts.dealValueBaseMinor} end), 0)`,
};
/** the same, plus unique contacts (only where rows aren't added up afterwards) */
const tallyWithContacts = { ...tallyCols, contacts: sql<string>`count(distinct ${contactKey})` };
const toTally = (r: { touches: unknown; responded: unknown; won: unknown; wonValue: unknown } | undefined): Tally =>
  r ? { touches: n(r.touches), responded: n(r.responded), won: n(r.won), wonValueBaseMinor: n(r.wonValue) } : emptyTally();
const add = (a: Tally, b: Tally) => {
  a.touches += b.touches;
  a.responded += b.responded;
  a.won += b.won;
  a.wonValueBaseMinor += b.wonValueBaseMinor;
};

/** % change from the previous period, or null when there's nothing to compare with. */
const change = (cur: number, prev: number) => (prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10);

export type Insight = { label: string; ratePct: number; touches: number; responded: number } | null;
type Cell = { touches: number; responded: number };

export async function marketingSummary(actor: Actor, f: MarketingFilters = {}) {
  requirePerm(actor, "marketing", "view");
  const db = getDb();
  const [tz, base] = await Promise.all([companyTimezone(db), baseCurrency(db)]);
  const now = new Date();
  const today = localParts(now, tz).date;
  const p = marketingPeriod(f, today, tz);
  const conds = filterWhere(actor, f);

  // one row per UTC hour: small, and each hour maps to exactly one local weekday/hour/month
  const hourBucket = sql<string>`date_format(${acts.occurredAt}, '%Y-%m-%d %H')`;
  const [buckets, keys, byChannel, [prev]] = await Promise.all([
    db
      .select({ b: hourBucket, ...tallyCols })
      .from(acts)
      .where(and(...conds, between(p.chart.from, p.to)))
      .groupBy(hourBucket),
    // who was contacted in which hour, to count unique contacts per local month and for the period
    db
      .selectDistinct({ b: hourBucket, k: contactKey })
      .from(acts)
      .where(and(...conds, between(p.chart.from, p.to))),
    db
      .select({ channel: acts.channel, ...tallyWithContacts, meetings: sql<string>`coalesce(sum(${acts.outcome} = 'meeting'), 0)`, lost: sql<string>`coalesce(sum(${acts.outcome} = 'deal_lost'), 0)` })
      .from(acts)
      .where(and(...conds, between(p.from, p.to)))
      .groupBy(acts.channel),
    db
      .select(tallyWithContacts)
      .from(acts)
      .where(and(...conds, between(p.previous.from, p.previous.to))),
  ]);

  const local = new Map<string, ReturnType<typeof localParts>>();
  const at = (bucket: string) => {
    let lp = local.get(bucket);
    if (!lp) local.set(bucket, (lp = localParts(new Date(`${bucket.replace(" ", "T")}:00:00Z`), tz)));
    return lp;
  };
  const inPeriod = (bucket: string) => new Date(`${bucket.replace(" ", "T")}:00:00Z`) >= p.from;

  const totals = emptyTally();
  const heat: Cell[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ touches: 0, responded: 0 })));
  const byMonth = new Map<string, Tally>();
  for (const r of buckets) {
    const t = toTally(r);
    const lp = at(r.b);
    const m = byMonth.get(lp.month) ?? emptyTally();
    add(m, t);
    byMonth.set(lp.month, m);
    if (!inPeriod(r.b)) continue; // only the chart reaches back further than the period
    add(totals, t);
    heat[lp.weekday][lp.hour].touches += t.touches;
    heat[lp.weekday][lp.hour].responded += t.responded;
  }
  const monthContacts = new Map<string, Set<string>>();
  const periodContacts = new Set<string>();
  for (const r of keys) {
    const month = at(r.b).month;
    if (!monthContacts.has(month)) monthContacts.set(month, new Set());
    monthContacts.get(month)!.add(r.k);
    if (inPeriod(r.b)) periodContacts.add(r.k);
  }

  const chartMonths = Array.from({ length: 12 }, (_, i) => addMonths(`${p.chart.first}-01`, i).slice(0, 7));
  const monthly = chartMonths.map((month) => ({ month, contacts: monthContacts.get(month)?.size ?? 0, ...(byMonth.get(month) ?? emptyTally()) }));
  const periodMonths = monthly.filter((m) => m.month >= p.firstMonth && m.month <= p.lastMonth);

  // insights: best weekday and hour by response rate (with enough touches), best month by deals won
  const days = heat.map((row) => row.reduce((a, c) => ({ touches: a.touches + c.touches, responded: a.responded + c.responded }), { touches: 0, responded: 0 }));
  const hours = Array.from({ length: 24 }, (_, h) => heat.reduce((a, row) => ({ touches: a.touches + row[h].touches, responded: a.responded + row[h].responded }), { touches: 0, responded: 0 }));
  const best = (cells: Cell[], min: number, label: (i: number) => string): Insight => {
    let pick: Insight = null;
    cells.forEach((c, i) => {
      if (c.touches < min) return;
      const rate = ratePct(c.responded, c.touches)!;
      if (!pick || rate > pick.ratePct || (rate === pick.ratePct && c.touches > pick.touches)) pick = { label: label(i), ratePct: rate, touches: c.touches, responded: c.responded };
    });
    return pick;
  };
  const bestMonth = periodMonths.reduce<(typeof periodMonths)[number] | null>(
    (a, m) => (m.won > 0 && (!a || m.won > a.won || (m.won === a.won && (ratePct(m.responded, m.touches) ?? 0) > (ratePct(a.responded, a.touches) ?? 0))) ? m : a),
    null
  );

  const prevT = { ...toTally(prev), contacts: n(prev?.contacts) };
  const channelRows = CHANNELS.map((channel) => {
    const r = byChannel.find((x) => x.channel === channel);
    const t = toTally(r);
    return { channel, ...t, contacts: n(r?.contacts), meetings: n(r?.meetings), lost: n(r?.lost), ratePct: ratePct(t.responded, t.touches) };
  }).filter((r) => r.channel !== "other" || r.touches > 0);
  const contacts = periodContacts.size;

  return {
    timezone: tz,
    baseCurrency: base,
    today,
    period: { months: p.months, firstMonth: p.firstMonth, lastMonth: p.lastMonth },
    totals: { ...totals, contacts, ratePct: ratePct(totals.responded, totals.touches) },
    previous: { ...prevT, ratePct: ratePct(prevT.responded, prevT.touches) },
    change: {
      contacts: change(contacts, prevT.contacts),
      touches: change(totals.touches, prevT.touches),
      won: change(totals.won, prevT.won),
      wonValue: change(totals.wonValueBaseMinor, prevT.wonValueBaseMinor),
      /** percentage points, not a % of a % */
      ratePoints: totals.touches && prevT.touches ? Math.round((ratePct(totals.responded, totals.touches)! - ratePct(prevT.responded, prevT.touches)!) * 10) / 10 : null,
    },
    byChannel: channelRows,
    monthly,
    heat,
    insights: {
      day: best(days, INSIGHT_MIN.day, (i) => WEEKDAYS[i]),
      hour: best(hours, INSIGHT_MIN.hour, (h) => String(h)),
      month: bestMonth ? { month: bestMonth.month, won: bestMonth.won, wonValueBaseMinor: bestMonth.wonValueBaseMinor, ratePct: ratePct(bestMonth.responded, bestMonth.touches) } : null,
    },
  };
}
export type MarketingSummary = Awaited<ReturnType<typeof marketingSummary>>;

/** Home's marketing card: the last 30 days in the caller's scope. */
export async function marketingSnapshot(actor: Actor) {
  requirePerm(actor, "marketing", "view");
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [[r], base] = await Promise.all([db.select(tallyWithContacts).from(acts).where(and(activityScope(actor), gte(acts.occurredAt, since))), baseCurrency(db)]);
  const t = toTally(r);
  return { ...t, contacts: n(r?.contacts), ratePct: ratePct(t.responded, t.touches), baseCurrency: base };
}

// ---------------------------------------------------------------- campaigns with results
export async function campaignResults(actor: Actor) {
  requirePerm(actor, "marketing", "view");
  const db = getDb();
  const [list, results] = await Promise.all([
    db.select().from(campaigns).orderBy(sql`field(${campaigns.status}, 'active', 'planned', 'paused', 'finished')`, desc(campaigns.startDate), asc(campaigns.name)),
    db
      .select({ campaignId: acts.campaignId, ...tallyWithContacts })
      .from(acts)
      .where(and(activityScope(actor), sql`${acts.campaignId} is not null`))
      .groupBy(acts.campaignId),
  ]);
  return list.map((c) => {
    const r = results.find((x) => x.campaignId === c.id);
    const t = toTally(r);
    return { ...c, ...t, contacts: n(r?.contacts), ratePct: ratePct(t.responded, t.touches) };
  });
}
export type CampaignResult = Awaited<ReturnType<typeof campaignResults>>[number];

// ---------------------------------------------------------------- lookups for the form and filters
export async function marketingLookups(actor: Actor) {
  requirePerm(actor, "marketing", "view");
  const db = getDb();
  const all = actor.perms.marketing.scope === "all";
  const [tz, base, list, people] = await Promise.all([
    companyTimezone(db),
    baseCurrency(db),
    db.select({ id: campaigns.id, name: campaigns.name, status: campaigns.status, channel: campaigns.channel }).from(campaigns).orderBy(asc(campaigns.name)),
    all
      ? db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.status, "active")).orderBy(asc(users.fullName))
      : Promise.resolve([{ id: actor.userId, name: actor.fullName, email: actor.email }]),
  ]);
  return {
    timezone: tz,
    baseCurrency: base,
    nowLocal: toLocalInput(new Date(), tz),
    campaigns: list,
    /** who activity can be logged for: everyone with "all" scope, otherwise just you */
    owners: people,
    canChooseOwner: all,
    canManageCampaigns: canManageCampaigns(actor, "create") || canManageCampaigns(actor, "edit"),
  };
}
export type MarketingLookups = Awaited<ReturnType<typeof marketingLookups>>;

// ---------------------------------------------------------------- the activity log
export const ACTIVITY_PAGE_SIZE = 25;

function activityQuery(db: Db | Tx) {
  return db
    .select({
      id: acts.id,
      occurredAt: acts.occurredAt,
      channel: acts.channel,
      campaignId: acts.campaignId,
      campaignName: campaigns.name,
      contactName: acts.contactName,
      contactCompany: acts.contactCompany,
      outcome: acts.outcome,
      dealValueMinor: acts.dealValueMinor,
      dealCurrency: acts.dealCurrency,
      dealFxRateToBase: acts.dealFxRateToBase,
      dealValueBaseMinor: acts.dealValueBaseMinor,
      ownerId: acts.ownerId,
      ownerName: users.fullName,
      notes: acts.notes,
      createdBy: acts.createdBy,
    })
    .from(acts)
    .leftJoin(campaigns, eq(campaigns.id, acts.campaignId))
    .leftJoin(users, eq(users.id, acts.ownerId));
}
export type ActivityRow = Awaited<ReturnType<ReturnType<typeof activityQuery>["execute"]>>[number];

export async function listActivities(actor: Actor, f: MarketingFilters = {}, pageSize = ACTIVITY_PAGE_SIZE) {
  requirePerm(actor, "marketing", "view");
  const db = getDb();
  const tz = await companyTimezone(db);
  const p = marketingPeriod(f, localParts(new Date(), tz).date, tz);
  const where = and(...filterWhere(actor, f), between(p.from, p.to));
  const page = f.page ?? 1;
  const [rows, [agg]] = await Promise.all([
    activityQuery(db).where(where).orderBy(desc(acts.occurredAt), asc(acts.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ n: count() }).from(acts).where(where),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, mine: r.createdBy === actor.userId || r.ownerId === actor.userId, canChange: activityAllowed(actor, r) })),
    total: agg.n,
    page,
    pageSize,
  };
}

export const activityInput = z.object({
  occurredAt: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Choose the date and time."),
  channel: z.enum(CHANNELS, { message: "Choose a channel." }),
  campaignId: z.string().uuid().nullable().optional(),
  contactName: z.string().trim().min(1, "Enter who you contacted.").max(200),
  contactCompany: z.string().trim().max(200).default(""),
  outcome: z.enum(OUTCOMES, { message: "Choose what happened." }),
  dealValue: z.string().trim().max(30).optional(),
  dealCurrency: z.string().trim().toUpperCase().optional(),
  dealFxRate: z.string().trim().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(5000).optional(),
});
export type ActivityInput = z.input<typeof activityInput>;

async function activityValues(db: Db | Tx, actor: Actor, input: ActivityInput) {
  const parsed = activityInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the activity and try again.");
  const v = parsed.data;
  const tz = await companyTimezone(db);
  const occurredAt = zonedToUtc(v.occurredAt, tz);
  if (occurredAt.getTime() > Date.now() + 15 * 60_000) throw new RuleError("That time is in the future. Log activity once it has happened.");
  if (occurredAt < new Date("2000-01-01T00:00:00Z")) throw new RuleError("Check the date: it's too far in the past.");

  // only people who see all marketing activity may log it for someone else
  const ownerId = v.ownerId || actor.userId;
  if (ownerId !== actor.userId) {
    if (actor.perms.marketing.scope !== "all") throw new AccessDenied("You can only log activity as yourself.");
    const [u] = await db.select({ status: users.status }).from(users).where(eq(users.id, ownerId));
    if (!u || u.status !== "active") throw new RuleError("Choose an active team member as the owner.");
  }
  if (v.campaignId) {
    const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.id, v.campaignId));
    if (!c) throw new RuleError("That campaign no longer exists. Choose another or leave it empty.");
  }

  // a deal value only makes sense on a won deal; it's optional even then
  let deal: { dealValueMinor: number | null; dealCurrency: string | null; dealFxRateToBase: string | null } = { dealValueMinor: null, dealCurrency: null, dealFxRateToBase: null };
  if (v.outcome === "deal_won" && v.dealValue) {
    const currency = v.dealCurrency || (await baseCurrency(db));
    if (!/^[A-Z]{3}$/.test(currency)) throw new RuleError("Use a 3-letter currency code like AUD or GBP.");
    try {
      deal = { dealValueMinor: toSafeNumber(parseMoneyToMinor(v.dealValue)), dealCurrency: currency, dealFxRateToBase: rateToDecimal(parseRate(v.dealFxRate || "1")) };
    } catch (e) {
      throw new RuleError(e instanceof Error ? e.message : "Check the deal value and rate.");
    }
    if (deal.dealValueMinor! <= 0) throw new RuleError("Enter a deal value above zero, or leave it empty.");
  }

  return {
    occurredAt,
    channel: v.channel,
    campaignId: v.campaignId || null,
    contactName: v.contactName,
    contactCompany: v.contactCompany,
    outcome: v.outcome,
    ...deal,
    ownerId,
    notes: v.notes || null,
  };
}

export async function createActivity(actor: Actor, input: ActivityInput): Promise<string> {
  requirePerm(actor, "marketing", "create");
  const db = getDb();
  const values = await activityValues(db, actor, input);
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(acts).values({ id, ...values, createdBy: actor.userId });
    const [after] = await tx.select().from(acts).where(eq(acts.id, id));
    await writeAudit(tx, actorRef(actor), { action: "create", entity: "marketing_activities", entityId: id, after });
  });
  return id;
}

export async function updateActivity(actor: Actor, id: string, input: ActivityInput) {
  requirePerm(actor, "marketing", "edit");
  const db = getDb();
  const values = await activityValues(db, actor, input);
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(acts).where(eq(acts.id, id)).for("update");
    if (!before || !activityAllowed(actor, before)) throw new AccessDenied("That activity doesn't exist or isn't yours to change.");
    // someone without "all" scope can't hand an activity they own over to another person
    if (actor.perms.marketing.scope !== "all" && values.ownerId !== before.ownerId && values.ownerId !== actor.userId) throw new AccessDenied("You can only log activity as yourself.");
    await tx.update(acts).set(values).where(eq(acts.id, id));
    const [after] = await tx.select().from(acts).where(eq(acts.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "marketing_activities", entityId: id, before, after });
  });
}

export async function deleteActivity(actor: Actor, id: string) {
  requirePerm(actor, "marketing", "delete");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(acts).where(eq(acts.id, id)).for("update");
    if (!before || !activityAllowed(actor, before)) throw new AccessDenied("That activity doesn't exist or isn't yours to delete.");
    await tx.delete(acts).where(eq(acts.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "marketing_activities", entityId: id, before });
  });
}

// ---------------------------------------------------------------- campaigns: create, edit, delete
const optDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date.")
  .nullable()
  .optional()
  .or(z.literal("").transform(() => null));
export const campaignInput = z.object({
  name: z.string().trim().min(1, "Give the campaign a name.").max(120),
  channel: z.enum(CHANNELS).nullable().optional().or(z.literal("").transform(() => null)),
  status: z.enum(CAMPAIGN_STATUSES).default("active"),
  startDate: optDate,
  endDate: optDate,
  description: z.string().trim().max(500).default(""),
});
export type CampaignInput = z.input<typeof campaignInput>;

function campaignValues(input: CampaignInput) {
  const parsed = campaignInput.safeParse(input);
  if (!parsed.success) throw new RuleError(parsed.error.issues[0]?.message ?? "Check the campaign and try again.");
  const v = parsed.data;
  if (v.startDate && v.endDate && v.endDate < v.startDate) throw new RuleError("The end date is before the start date.");
  return { name: v.name, channel: (v.channel ?? null) as Channel | null, status: v.status, startDate: v.startDate ?? null, endDate: v.endDate ?? null, description: v.description };
}

async function nameTaken(db: Db | Tx, name: string, exceptId: string | null) {
  const [c] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.name, name));
  return !!c && c.id !== exceptId;
}

export async function saveCampaign(actor: Actor, id: string | null, input: CampaignInput): Promise<string> {
  requireCampaignManager(actor, id ? "edit" : "create");
  const values = campaignValues(input);
  const db = getDb();
  return db.transaction(async (tx) => {
    if (await nameTaken(tx, values.name, id)) throw new RuleError(`There's already a campaign called "${values.name}".`);
    if (!id) {
      const newId = crypto.randomUUID();
      await tx.insert(campaigns).values({ id: newId, ...values, createdBy: actor.userId });
      const [after] = await tx.select().from(campaigns).where(eq(campaigns.id, newId));
      await writeAudit(tx, actorRef(actor), { action: "create", entity: "campaigns", entityId: newId, after });
      return newId;
    }
    const [before] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!before) throw new RuleError("That campaign no longer exists.");
    await tx.update(campaigns).set(values).where(eq(campaigns.id, id));
    const [after] = await tx.select().from(campaigns).where(eq(campaigns.id, id));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "campaigns", entityId: id, before, after });
    return id;
  });
}

export async function deleteCampaign(actor: Actor, id: string) {
  requireCampaignManager(actor, "delete");
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(campaigns).where(eq(campaigns.id, id)).for("update");
    if (!before) throw new RuleError("That campaign no longer exists.");
    // counted across everyone's activity, not just the caller's scope
    const [{ used }] = await tx.select({ used: count() }).from(acts).where(eq(acts.campaignId, id));
    if (used > 0) throw new RuleError(`${before.name} has ${used} logged ${used === 1 ? "activity" : "activities"}, so it can't be deleted. Mark it finished instead.`);
    await tx.delete(campaigns).where(eq(campaigns.id, id));
    await writeAudit(tx, actorRef(actor), { action: "delete", entity: "campaigns", entityId: id, before });
  });
}

// ---------------------------------------------------------------- export
export const ACTIVITY_CSV_HEADER = ["occurred_at_local", "channel", "campaign", "contact", "company", "outcome", "deal_value", "deal_currency", "fx_rate", "owner", "notes"];
const EXPORT_LIMIT = 50_000;

export async function exportActivitiesCsv(actor: Actor, f: MarketingFilters): Promise<{ filename: string; csv: string; rows: number }> {
  requirePerm(actor, "marketing", "export");
  const db = getDb();
  const [tz, base] = await Promise.all([companyTimezone(db), baseCurrency(db)]);
  const p = marketingPeriod(f, localParts(new Date(), tz).date, tz);
  const rows = await activityQuery(db)
    .where(and(...filterWhere(actor, f), between(p.from, p.to)))
    .orderBy(desc(acts.occurredAt), asc(acts.id))
    .limit(EXPORT_LIMIT);
  const csv = toCsv(
    [...ACTIVITY_CSV_HEADER, `deal_value_${base.toLowerCase()}`],
    rows.map((r) => [
      toLocalInput(r.occurredAt, tz).replace("T", " "),
      r.channel,
      r.campaignName ?? "",
      r.contactName,
      r.contactCompany,
      r.outcome,
      r.dealValueMinor == null ? "" : minorToDecimal(r.dealValueMinor),
      r.dealCurrency ?? "",
      r.dealFxRateToBase ?? "",
      r.ownerName ?? "",
      r.notes ?? "",
      r.dealValueBaseMinor == null ? "" : minorToDecimal(r.dealValueBaseMinor),
    ])
  );
  const filename = `marketing-${f.month ?? "last-12-months"}-${localParts(new Date(), tz).date}.csv`;
  const filters = Object.entries({ channel: f.channel, campaign: f.campaign, owner: f.owner }).filter(([, v]) => v);
  await writeAudit(db, actorRef(actor), {
    action: "export",
    entity: "marketing",
    summary: `${filename}: ${rows.length} activities${filters.length ? ` (${filters.map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}`,
  });
  return { filename, csv, rows: rows.length };
}
