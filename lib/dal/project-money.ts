import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { addDays, addMonths } from "@/lib/dates";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { ensureMonthlyPay } from "./employee-pay";
import { requireAdmin, requirePerm, type Actor } from "./guard";
import { nicheNames } from "./niches";
import { companyToday } from "./payments";
import { moneyRowsFor, moneyRowsWhere, notHiddenFrom, partnerScope, streamRowsFor, streamRowsWhere } from "./scope";
import type { DeductionRow } from "./income-deductions";

/**
 * "Revenue overview": what each project earned and cost, for a partner (only their own streams and countries) and
 * for admins (everything, with the usual filters). Per project and in total, in the base currency (each row's stored
 * exchange rate) and, for the payments themselves, in the currency they were paid in:
 *   - total amount: paid income;       - taxes and fees: what was deducted from it;
 *   - after taxes and fees: what was left;
 *   - cost: pay for people on the project (project pay), plus expenses tagged to the project.
 * Profit = after taxes and fees - cost. Monthly salaries aren't tied to a project, so they are NOT in any project's
 * cost; they are in the overall totals ("pay not tied to a project").
 */
const { incomeEntries, incomeDeductions, expenses, projects, streams, users, employeePayRecords: pay, employeePayPlans: plans } = schema;

export const moneyFilters = z.object({
  stream: z.coerce.number().int().positive().optional().catch(undefined),
  country: z.string().regex(/^[A-Z]{2,8}$/).optional().catch(undefined),
  partner: z.string().uuid().optional().catch(undefined),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
});
export type MoneyFilters = z.infer<typeof moneyFilters>;
export type MoneyFiltersInput = z.input<typeof moneyFilters>;

export type CurrencyTotal = { currency: string; grossMinor: number; deductionsMinor: number; netMinor: number };
export type ProjectMoneyRow = {
  projectId: string | null;
  name: string;
  stream: string | null;
  niche: string | null;
  subNiche: string | null;
  leadName: string | null;
  currencies: CurrencyTotal[];
  grossBaseMinor: number;
  pendingBaseMinor: number;
  deductionsBaseMinor: number;
  netBaseMinor: number;
  /** project pay + expenses tagged to this project */
  costBaseMinor: number;
  profitBaseMinor: number;
};
export type MoneyOverview = {
  baseCurrency: string;
  from: string;
  to: string;
  rows: ProjectMoneyRow[];
  totals: {
    grossBaseMinor: number;
    pendingBaseMinor: number;
    deductionsBaseMinor: number;
    netBaseMinor: number;
    expensesBaseMinor: number;
    /** all employee pay (project pay and monthly salaries) */
    payBaseMinor: number;
    /** the part of the pay above that isn't tied to a project (monthly salaries) */
    payNotInProjectsBaseMinor: number;
    profitBaseMinor: number;
  };
};

export type MoneyEntry = {
  id: string;
  projectId: string | null;
  date: string;
  client: string;
  status: "pending" | "paid" | "overdue";
  amountMinor: number;
  currency: string;
  deductionsMinor: number;
  netMinor: number;
  items: DeductionRow[];
};

type Conds = { income: SQL | undefined; expense: SQL | undefined; pay: SQL | undefined; project: SQL | undefined };
const n = (v: unknown) => Number(v ?? 0);

async function range(db: Db | Tx, f: MoneyFilters) {
  const today = await companyToday(db);
  const from = f.from ?? `${today.slice(0, 7)}-01`;
  const to = f.to ?? addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  return { today, from, to: to < from ? from : to };
}

async function compute(db: Db | Tx, conds: Conds, from: string, to: string): Promise<MoneyOverview> {
  const [[s], projectRows] = await Promise.all([
    db.select({ base: schema.settings.baseCurrency }).from(schema.settings).where(eq(schema.settings.id, 1)),
    db
      .select({ id: projects.id, name: projects.name, stream: streams.name, nicheId: projects.nicheId, subId: projects.subNicheId, leadId: projects.leadUserId })
      .from(projects)
      .innerJoin(streams, eq(streams.id, projects.streamId))
      .where(conds.project)
      .orderBy(asc(streams.name), asc(projects.name)),
  ]);
  const baseCurrency = s?.base ?? "AUD";
  const inRange = and(gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, to));
  const paid = sql`${incomeEntries.status} = 'paid'`;
  const [incomeRows, expenseRows, payRows] = await Promise.all([
    db
      .select({
        projectId: incomeEntries.projectId,
        currency: incomeEntries.currency,
        gross: sql<string>`coalesce(sum(case when ${paid} then ${incomeEntries.amountMinor} else 0 end), 0)`,
        ded: sql<string>`coalesce(sum(case when ${paid} then ${incomeEntries.deductionsMinor} else 0 end), 0)`,
        grossBase: sql<string>`coalesce(sum(case when ${paid} then ${incomeEntries.amountBaseMinor} else 0 end), 0)`,
        netBase: sql<string>`coalesce(sum(case when ${paid} then ${incomeEntries.netBaseMinor} else 0 end), 0)`,
        pendingBase: sql<string>`coalesce(sum(case when ${paid} then 0 else ${incomeEntries.amountBaseMinor} end), 0)`,
      })
      .from(incomeEntries)
      .where(and(conds.income, inRange))
      .groupBy(incomeEntries.projectId, incomeEntries.currency),
    db
      .select({ projectId: expenses.projectId, total: sql<string>`coalesce(sum(${expenses.amountBaseMinor}), 0)` })
      .from(expenses)
      .where(and(conds.expense, isNull(expenses.archivedAt), gte(expenses.expenseDate, from), lte(expenses.expenseDate, to)))
      .groupBy(expenses.projectId),
    db
      .select({ projectId: plans.projectId, total: sql<string>`coalesce(sum(${pay.amountBaseMinor}), 0)` })
      .from(pay)
      .innerJoin(plans, eq(plans.id, pay.planId))
      .where(and(conds.pay, isNotNull(pay.costDate), gte(pay.costDate, from), lte(pay.costDate, to)))
      .groupBy(plans.projectId),
  ]);
  const names = await nicheNames(db, [...new Set(projectRows.map((p) => p.nicheId).filter((x): x is number => x !== null))], [...new Set(projectRows.map((p) => p.subId).filter((x): x is number => x !== null))]);
  const leadIds = [...new Set(projectRows.map((p) => p.leadId).filter((x): x is string => !!x))];
  const leads = leadIds.length ? await db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(inArray(users.id, leadIds)) : [];

  const build = (projectId: string | null, meta: Partial<ProjectMoneyRow>): ProjectMoneyRow => {
    const inc = incomeRows.filter((r) => r.projectId === projectId);
    const grossBase = inc.reduce((a, r) => a + n(r.grossBase), 0);
    const netBase = inc.reduce((a, r) => a + n(r.netBase), 0);
    const cost = n(expenseRows.find((r) => r.projectId === projectId)?.total) + (projectId ? n(payRows.find((r) => r.projectId === projectId)?.total) : 0);
    return {
      projectId,
      name: "",
      stream: null,
      niche: null,
      subNiche: null,
      leadName: null,
      currencies: inc.filter((r) => n(r.gross) > 0).map((r) => ({ currency: r.currency, grossMinor: n(r.gross), deductionsMinor: n(r.ded), netMinor: n(r.gross) - n(r.ded) })),
      grossBaseMinor: grossBase,
      pendingBaseMinor: inc.reduce((a, r) => a + n(r.pendingBase), 0),
      deductionsBaseMinor: grossBase - netBase,
      netBaseMinor: netBase,
      costBaseMinor: cost,
      profitBaseMinor: netBase - cost,
      ...meta,
    };
  };
  const rows: ProjectMoneyRow[] = projectRows.map((p) =>
    build(p.id, {
      name: p.name,
      stream: p.stream,
      niche: p.nicheId ? names.niche.get(p.nicheId) ?? null : null,
      subNiche: p.subId ? names.sub.get(p.subId) ?? null : null,
      leadName: p.leadId ? leads.find((l) => l.id === p.leadId)?.name || leads.find((l) => l.id === p.leadId)?.email || null : null,
    })
  );
  // money that isn't on any project we list (income with no project, or on a project outside this view)
  const listed = new Set(projectRows.map((p) => p.id));
  const stray = (id: string | null) => id === null || !listed.has(id);
  const strayIncome = incomeRows.filter((r) => stray(r.projectId));
  if (strayIncome.length || expenseRows.some((r) => stray(r.projectId))) {
    const row = build(null, { name: "No project" });
    const grossBase = strayIncome.reduce((a, r) => a + n(r.grossBase), 0);
    const netBase = strayIncome.reduce((a, r) => a + n(r.netBase), 0);
    const cost = expenseRows.filter((r) => stray(r.projectId)).reduce((a, r) => a + n(r.total), 0);
    rows.push({
      ...row,
      currencies: strayIncome.filter((r) => n(r.gross) > 0).map((r) => ({ currency: r.currency, grossMinor: n(r.gross), deductionsMinor: n(r.ded), netMinor: n(r.gross) - n(r.ded) })),
      grossBaseMinor: grossBase,
      pendingBaseMinor: strayIncome.reduce((a, r) => a + n(r.pendingBase), 0),
      deductionsBaseMinor: grossBase - netBase,
      netBaseMinor: netBase,
      costBaseMinor: cost,
      profitBaseMinor: netBase - cost,
    });
  }
  const sumRows = <K extends keyof ProjectMoneyRow>(k: K) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const expensesAll = expenseRows.reduce((a, r) => a + n(r.total), 0);
  const payAll = payRows.reduce((a, r) => a + n(r.total), 0);
  const payNotInProjects = payRows.filter((r) => r.projectId === null).reduce((a, r) => a + n(r.total), 0);
  const netBaseMinor = sumRows("netBaseMinor");
  return {
    baseCurrency,
    from,
    to,
    rows,
    totals: {
      grossBaseMinor: sumRows("grossBaseMinor"),
      pendingBaseMinor: sumRows("pendingBaseMinor"),
      deductionsBaseMinor: sumRows("deductionsBaseMinor"),
      netBaseMinor,
      expensesBaseMinor: expensesAll,
      payBaseMinor: payAll,
      payNotInProjectsBaseMinor: payNotInProjects,
      profitBaseMinor: netBaseMinor - expensesAll - payAll,
    },
  };
}

async function entries(db: Db | Tx, incomeCond: SQL | undefined, from: string, to: string): Promise<MoneyEntry[]> {
  const rows = await db
    .select({ id: incomeEntries.id, projectId: incomeEntries.projectId, date: incomeEntries.entryDate, client: incomeEntries.client, status: incomeEntries.status, amountMinor: incomeEntries.amountMinor, currency: incomeEntries.currency, deductionsMinor: incomeEntries.deductionsMinor })
    .from(incomeEntries)
    .where(and(incomeCond, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, to)))
    .orderBy(desc(incomeEntries.entryDate), asc(incomeEntries.id))
    .limit(500);
  const items = rows.length ? await db.select().from(incomeDeductions).where(inArray(incomeDeductions.incomeEntryId, rows.map((r) => r.id))).orderBy(asc(incomeDeductions.createdAt)) : [];
  return rows.map((r) => ({ ...r, netMinor: r.amountMinor - r.deductionsMinor, items: items.filter((i) => i.incomeEntryId === r.id).map((i) => ({ id: i.id, kind: i.kind, label: i.label, amountMinor: i.amountMinor })) }));
}

// ---------------------------------------------------------------- a partner's own
export async function myProjectMoney(actor: Actor, raw: MoneyFiltersInput = {}): Promise<MoneyOverview & { entries: MoneyEntry[] }> {
  requirePerm(actor, "stream_partner", "view");
  const scope = partnerScope(actor);
  const db = getDb();
  const f = moneyFilters.parse(raw);
  const { today, from, to } = await range(db, f);
  await ensureMonthlyPay(db, today);
  const incomeCond = and(moneyRowsWhere(actor, { streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(db, actor, incomeEntries.projectId));
  const conds: Conds = {
    income: incomeCond,
    expense: moneyRowsWhere(actor, { streamId: expenses.streamId, countryCode: expenses.countryCode }),
    pay: moneyRowsWhere(actor, { streamId: pay.streamId, countryCode: pay.countryCode }),
    project: and(streamRowsWhere(actor, { streamId: projects.streamId }), notHiddenFrom(db, actor, projects.id)),
  };
  void scope;
  return { ...(await compute(db, conds, from, to)), entries: await entries(db, incomeCond, from, to) };
}

// ---------------------------------------------------------------- the admin's view of everything
export async function adminProjectMoney(actor: Actor, raw: MoneyFiltersInput = {}): Promise<MoneyOverview & { entries: MoneyEntry[]; options: { streams: Array<{ id: number; name: string }>; countries: Array<{ code: string; name: string }>; partners: Array<{ id: string; name: string }> } }> {
  requireAdmin(actor);
  const db = getDb();
  const f = moneyFilters.parse(raw);
  const { today, from, to } = await range(db, f);
  await ensureMonthlyPay(db, today);
  const [streamRows, countryRows, partnerRows, assigned] = await Promise.all([
    db.select({ id: streams.id, name: streams.name }).from(streams).orderBy(asc(streams.sort), asc(streams.name)),
    db.select({ code: schema.countries.code, name: schema.countries.name }).from(schema.countries).orderBy(asc(schema.countries.sort)),
    db.select({ id: users.id, name: users.fullName, email: users.email }).from(users).where(eq(users.presetId, "stream_partner")).orderBy(asc(users.fullName)),
    f.partner
      ? Promise.all([
          db.select({ id: schema.streamPartnerStreams.streamId }).from(schema.streamPartnerStreams).where(eq(schema.streamPartnerStreams.userId, f.partner)),
          db.select({ code: schema.streamPartnerCountries.countryCode }).from(schema.streamPartnerCountries).where(eq(schema.streamPartnerCountries.userId, f.partner)),
        ])
      : Promise.resolve(null),
  ]);
  // a chosen partner means exactly their streams AND countries (the same rule as their own view); stream/country narrow further
  let a: { streamIds: number[]; countryCodes: string[] } | null = null;
  if (assigned) {
    a = { streamIds: assigned[0].map((x) => x.id), countryCodes: assigned[1].map((x) => x.code) };
    if (f.stream) a.streamIds = a.streamIds.filter((x) => x === f.stream);
    if (f.country) a.countryCodes = a.countryCodes.filter((x) => x === f.country);
  }
  const money = (cols: { streamId: SQL.Aliased | any; countryCode: any }) => (a ? moneyRowsFor(a, cols) : and(f.stream ? eq(cols.streamId, f.stream) : undefined, f.country ? eq(cols.countryCode, f.country) : undefined));
  const incomeCond = and(money({ streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(db, actor, incomeEntries.projectId));
  const conds: Conds = {
    income: incomeCond,
    expense: money({ streamId: expenses.streamId, countryCode: expenses.countryCode }),
    pay: money({ streamId: pay.streamId, countryCode: pay.countryCode }),
    project: and(a ? streamRowsFor(a, { streamId: projects.streamId }) : f.stream ? eq(projects.streamId, f.stream) : undefined, notHiddenFrom(db, actor, projects.id)),
  };
  return {
    ...(await compute(db, conds, from, to)),
    entries: await entries(db, incomeCond, from, to),
    options: { streams: streamRows, countries: countryRows, partners: partnerRows.map((p) => ({ id: p.id, name: p.name || p.email })) },
  };
}
