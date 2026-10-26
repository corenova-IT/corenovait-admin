import "server-only";
import { and, desc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { minorToDecimal, toCsv } from "@/lib/csv";
import { addDays, addMonths, monthsBetween } from "@/lib/dates";
import { actorRef, writeAudit } from "./audit";
import { baseCurrency } from "./finance";
import { requirePerm, scopeWhere, type Actor } from "./guard";
import { companyToday } from "./payments";
import { incomeScopeFor, outstandingSum, paidCount, paidSum, topClients } from "./revenue";

/**
 * Company finances for the Home dashboard and the Analytics page (module "finances").
 *
 * - Revenue = PAID invoices; Outstanding = pending + overdue.
 * - Profit = revenue - expenses. Margin = profit / revenue.
 * - The window is the last 12 calendar months up to today (company time zone),
 *   compared with the 12 months before it.
 * - With a country chosen, revenue is that country's invoices and expenses are
 *   costs tagged to that country; shared (untagged) costs are reported separately.
 */
const { incomeEntries, expenses, streams, countries } = schema;

export const COUNTRY_FILTERS = ["GB", "AU"] as const;
export const countryFilter = z.enum(COUNTRY_FILTERS).optional().catch(undefined);
export type CountryFilter = z.infer<typeof countryFilter>;

const n = (v: unknown) => Number(v ?? 0);
const incMonth = sql<string>`date_format(${incomeEntries.entryDate}, '%Y-%m')`;
const expMonth = sql<string>`date_format(${expenses.expenseDate}, '%Y-%m')`;
const expSum = sql<string>`coalesce(sum(${expenses.amountBaseMinor}), 0)`;

/** Percentage change, one decimal, or null when there's nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

export function marginPct(profit: number, revenue: number): number | null {
  if (revenue === 0) return null;
  return Math.round((profit / revenue) * 1000) / 10;
}

type Filters = { income: SQL | undefined; expense: SQL | undefined; sharedExpense: SQL | undefined };

function filtersFor(db: Db | Tx, actor: Actor, country: CountryFilter): Filters {
  const incScope = incomeScopeFor(db, actor, "finances");
  const expScope = scopeWhere(actor, "finances", { owner: expenses.createdBy });
  return {
    income: and(incScope, country ? eq(incomeEntries.countryCode, country) : undefined),
    expense: and(expScope, country ? eq(expenses.countryCode, country) : undefined),
    sharedExpense: country ? and(expScope, isNull(expenses.countryCode)) : undefined,
  };
}

async function totalsBetween(db: Db | Tx, f: Filters, from: string, to: string) {
  const [[inc], [exp]] = await Promise.all([
    db
      .select({ revenue: paidSum, outstanding: outstandingSum, deals: paidCount })
      .from(incomeEntries)
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, to))),
    db
      .select({ total: expSum })
      .from(expenses)
      .where(and(f.expense, gte(expenses.expenseDate, from), lte(expenses.expenseDate, to))),
  ]);
  const revenue = n(inc.revenue);
  const spent = n(exp.total);
  return { revenueBaseMinor: revenue, outstandingBaseMinor: n(inc.outstanding), deals: n(inc.deals), expensesBaseMinor: spent, profitBaseMinor: revenue - spent };
}
type Totals = Awaited<ReturnType<typeof totalsBetween>>;

const compare = (cur: Totals, prev: Totals) => ({
  current: cur,
  previous: prev,
  change: {
    revenue: pctChange(cur.revenueBaseMinor, prev.revenueBaseMinor),
    expenses: pctChange(cur.expensesBaseMinor, prev.expensesBaseMinor),
    profit: pctChange(cur.profitBaseMinor, prev.profitBaseMinor),
  },
});

/** Last calendar day of a "YYYY-MM" month. */
const monthEnd = (yyyymm: string) => new Date(Date.UTC(Number(yyyymm.slice(0, 4)), Number(yyyymm.slice(5, 7)), 0)).toISOString().slice(0, 10);

export async function financeSummary(actor: Actor, opts: { country?: CountryFilter } = {}) {
  requirePerm(actor, "finances", "view");
  const db = getDb();
  const today = await companyToday(db);
  const f = filtersFor(db, actor, opts.country);

  const thisMonth = today.slice(0, 7);
  const from = addMonths(`${thisMonth}-01`, -11);
  const prevFrom = addMonths(from, -12);
  const prevTo = addMonths(today, -12);
  const months = monthsBetween(from, today);

  // calendar comparisons
  const lastMonth = addMonths(`${thisMonth}-01`, -1).slice(0, 7);
  const q = Math.floor((Number(thisMonth.slice(5, 7)) - 1) / 3);
  const qStart = `${thisMonth.slice(0, 4)}-${String(q * 3 + 1).padStart(2, "0")}-01`;
  const prevQStart = addMonths(qStart, -3);
  const ytdStart = `${thisMonth.slice(0, 4)}-01-01`;

  const [cur, prev, incByMonth, expByMonth, byStream, byCountry, clients, matrix, byCategory, sharedRows, mNow, mPrev, qNow, qPrev, yNow, yPrev, base, streamMonths, countryMonths] = await Promise.all([
    totalsBetween(db, f, from, today),
    totalsBetween(db, f, prevFrom, prevTo),
    db
      .select({ month: incMonth, revenue: paidSum, outstanding: outstandingSum })
      .from(incomeEntries)
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(incMonth),
    db
      .select({ month: expMonth, total: expSum })
      .from(expenses)
      .where(and(f.expense, gte(expenses.expenseDate, from), lte(expenses.expenseDate, today)))
      .groupBy(expMonth),
    db
      .select({ id: streams.id, name: streams.name, total: paidSum, deals: paidCount })
      .from(incomeEntries)
      .innerJoin(streams, eq(streams.id, incomeEntries.streamId))
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(streams.id, streams.name)
      .orderBy(desc(paidSum)),
    db
      .select({ code: countries.code, name: countries.name, sort: countries.sort, total: paidSum, deals: paidCount })
      .from(incomeEntries)
      .innerJoin(countries, eq(countries.code, incomeEntries.countryCode))
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(countries.code, countries.name, countries.sort),
    topClients(db, and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)), 8),
    db
      .select({ streamId: incomeEntries.streamId, code: incomeEntries.countryCode, total: paidSum })
      .from(incomeEntries)
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(incomeEntries.streamId, incomeEntries.countryCode),
    db
      .select({ category: expenses.category, total: expSum })
      .from(expenses)
      .where(and(f.expense, gte(expenses.expenseDate, from), lte(expenses.expenseDate, today)))
      .groupBy(expenses.category)
      .orderBy(desc(expSum)),
    f.sharedExpense
      ? db
          .select({ total: expSum })
          .from(expenses)
          .where(and(f.sharedExpense, gte(expenses.expenseDate, from), lte(expenses.expenseDate, today)))
      : Promise.resolve([{ total: "0" }]),
    totalsBetween(db, f, `${thisMonth}-01`, today),
    totalsBetween(db, f, `${lastMonth}-01`, monthEnd(lastMonth)),
    totalsBetween(db, f, qStart, today),
    totalsBetween(db, f, prevQStart, addDays(qStart, -1)),
    totalsBetween(db, f, ytdStart, today),
    totalsBetween(db, f, addMonths(ytdStart, -12), addMonths(today, -12)),
    baseCurrency(db),
    db
      .select({ id: incomeEntries.streamId, month: incMonth, total: paidSum })
      .from(incomeEntries)
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(incomeEntries.streamId, incMonth),
    db
      .select({ code: incomeEntries.countryCode, month: incMonth, total: paidSum })
      .from(incomeEntries)
      .where(and(f.income, gte(incomeEntries.entryDate, from), lte(incomeEntries.entryDate, today)))
      .groupBy(incomeEntries.countryCode, incMonth),
  ]);

  const monthly = months.map((m) => {
    const i = incByMonth.find((x) => x.month === m);
    const e = expByMonth.find((x) => x.month === m);
    const revenue = n(i?.revenue);
    const spent = n(e?.total);
    return { month: m, revenueBaseMinor: revenue, outstandingBaseMinor: n(i?.outstanding), expensesBaseMinor: spent, profitBaseMinor: revenue - spent };
  });

  const streamTotal = byStream.reduce((a, s) => a + n(s.total), 0);
  const countryTotal = byCountry.reduce((a, c) => a + n(c.total), 0);
  const streamNames = new Map(byStream.map((s) => [s.id, s.name]));

  return {
    today,
    baseCurrency: base,
    country: opts.country ?? null,
    window: { from, to: today, previousFrom: prevFrom, previousTo: prevTo },
    totals: compare(cur, prev),
    marginPct: marginPct(cur.profitBaseMinor, cur.revenueBaseMinor),
    previousMarginPct: marginPct(prev.profitBaseMinor, prev.revenueBaseMinor),
    sharedExpensesExcludedBaseMinor: n(sharedRows[0]?.total),
    monthly,
    byStream: byStream.map((s) => ({
      id: s.id,
      name: s.name,
      totalBaseMinor: n(s.total),
      deals: n(s.deals),
      sharePct: streamTotal ? Math.round((n(s.total) / streamTotal) * 1000) / 10 : 0,
      trend: months.map((m) => n(streamMonths.find((x) => x.id === s.id && x.month === m)?.total)),
    })),
    byCountry: byCountry
      .sort((a, b) => a.sort - b.sort)
      .map((c) => ({
        code: c.code,
        name: c.name,
        totalBaseMinor: n(c.total),
        deals: n(c.deals),
        sharePct: countryTotal ? Math.round((n(c.total) / countryTotal) * 1000) / 10 : 0,
        trend: months.map((m) => n(countryMonths.find((x) => x.code === c.code && x.month === m)?.total)),
      })),
    topClients: clients,
    expensesByCategory: byCategory.map((c) => ({ category: c.category, totalBaseMinor: n(c.total) })),
    streamByCountry: matrix
      .filter((x) => n(x.total) !== 0)
      .map((x) => ({ streamId: x.streamId, streamName: streamNames.get(x.streamId) ?? "", code: x.code, totalBaseMinor: n(x.total) })),
    comparisons: {
      month: { label: "This month vs last month", ...compare(mNow, mPrev) },
      quarter: { label: "This quarter vs last quarter", ...compare(qNow, qPrev) },
      year: { label: "Year to date vs same period last year", ...compare(yNow, yPrev) },
    },
  };
}
export type FinanceSummary = Awaited<ReturnType<typeof financeSummary>>;

/** Monthly figures as CSV (what the Analytics page shows). Needs finances:export; audited. */
export async function exportFinanceCsv(actor: Actor, opts: { country?: CountryFilter } = {}) {
  requirePerm(actor, "finances", "export");
  const s = await financeSummary(actor, opts);
  const cur = s.baseCurrency.toLowerCase();
  const csv = toCsv(
    ["month", `revenue_paid_${cur}`, `outstanding_${cur}`, `expenses_${cur}`, `profit_${cur}`],
    s.monthly.map((m) => [m.month, minorToDecimal(m.revenueBaseMinor), minorToDecimal(m.outstandingBaseMinor), minorToDecimal(m.expensesBaseMinor), minorToDecimal(m.profitBaseMinor)])
  );
  const filename = `finances-${s.country ?? "all"}-${s.today}.csv`;
  await writeAudit(getDb(), actorRef(actor), { action: "export", entity: "finances", summary: `${filename}: monthly revenue, expenses and profit` });
  return { filename, csv };
}

