import "server-only";
import { and, asc, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";
import { getDb, schema, type Db, type Tx } from "@/lib/db";
import { addDays, addMonths, daysBetween } from "@/lib/dates";
import type { Actor } from "./guard";
import { ensureMonthlyPay } from "./employee-pay";
import { companyToday } from "./payments";
import { moneyRowsWhere, notHiddenFrom, partnerScope, streamRowsWhere, type PartnerScope } from "./scope";

/**
 * "My dashboard": a Partner's own revenue, costs, net, upcoming payments and tasks.
 * Every query here is restricted by lib/dal/scope.ts, so a partner only ever sees rows that
 * match an assigned stream AND an assigned country (tasks: the stream), never rows from an
 * archived record, and never anything under a project the Owner hid from them.
 *
 * - Revenue is PAID income only; income not yet paid is shown separately as "still to come".
 * - Every total adds base-currency values (each row's amount times the exchange rate stored on
 *   it), never raw amounts in different currencies. Rows that list a single amount show its
 *   own currency as well as the base value.
 * - Nothing here ever reads the company's share, other partners, or company-wide totals.
 * - Employee pay and the employees panel arrive with the employee tables (a later phase).
 */
const { incomeEntries, expenses, subscriptions, tasks, streams, settings, employeePayRecords: pay } = schema;

export type StreamFigures = {
  streamId: number;
  stream: string;
  revenueMonthBaseMinor: number;
  revenueTotalBaseMinor: number;
  pendingBaseMinor: number;
  /** taxes and fees taken off paid income (platform fees, withdrawal tax, VAT or transfer charges, other) */
  deductionsMonthBaseMinor: number;
  deductionsTotalBaseMinor: number;
  /** all costs: expenses (subscriptions paid are expenses) plus employee pay, each counted once */
  costsMonthBaseMinor: number;
  costsTotalBaseMinor: number;
  /** the employee-pay part of the costs above */
  payMonthBaseMinor: number;
  payTotalBaseMinor: number;
  netMonthBaseMinor: number;
  netTotalBaseMinor: number;
};

export type DashboardData = {
  baseCurrency: string;
  today: string;
  monthLabel: string;
  /** false until at least one stream and one country are assigned */
  hasData: boolean;
  perStream: StreamFigures[];
  overall: Omit<StreamFigures, "streamId" | "stream">;
  upcomingPayments: Array<{
    id: string;
    vendor: string;
    category: string;
    stream: string;
    billingCycle: string;
    nextDueDate: string;
    daysUntilDue: number;
    amountMinor: number;
    currency: string;
    amountBaseMinor: number;
  }>;
  dueWithin30DaysBaseMinor: number;
  tasks: {
    open: number;
    overdue: number;
    upcoming: Array<{ id: string; title: string; stream: string; dueDate: string | null; status: string; priority: string; overdue: boolean }>;
  };
};

const num = (v: unknown) => Number(v ?? 0);
const sumIf = (amount: ReturnType<typeof sql>, cond: ReturnType<typeof sql>) => sql<string>`coalesce(sum(case when ${cond} then ${amount} else 0 end), 0)`;

export type DashboardConds = { income: SQL | undefined; expense: SQL | undefined; subscription: SQL | undefined; task: SQL | undefined; pay: SQL | undefined };

/** The signed-in partner's own dashboard. */
export async function myDashboard(actor: Actor): Promise<DashboardData> {
  const scope = partnerScope(actor);
  const db = getDb();
  return computeDashboard(db, scope, {
    income: and(moneyRowsWhere(actor, { streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(db, actor, incomeEntries.projectId)),
    expense: and(moneyRowsWhere(actor, { streamId: expenses.streamId, countryCode: expenses.countryCode }), isNull(expenses.archivedAt)),
    subscription: and(moneyRowsWhere(actor, { streamId: subscriptions.streamId, countryCode: subscriptions.countryCode }), eq(subscriptions.status, "active")),
    task: and(streamRowsWhere(actor, { streamId: tasks.streamId }), notHiddenFrom(db, actor, tasks.projectId), isNull(tasks.archivedAt)),
    pay: and(moneyRowsWhere(actor, { streamId: pay.streamId, countryCode: pay.countryCode }), isNotNull(pay.costDate)),
  });
}

/**
 * The figures for one assignment under the given row conditions. Exported for lib/dal/admin-partners.ts,
 * which builds the same conditions for a chosen partner (from lib/dal/scope.ts) and adds the admin's own
 * Owner-hidden filters. Never call it with conditions that were not built by lib/dal/scope.ts.
 */
export async function computeDashboard(db: Db | Tx, scope: PartnerScope, conds: DashboardConds, range?: { from: string; to: string }): Promise<DashboardData> {
  const [settingsRow] = await db.select({ base: settings.baseCurrency }).from(settings).where(eq(settings.id, 1));
  const baseCurrency = settingsRow?.base ?? "AUD";
  const today = await companyToday(db);
  await ensureMonthlyPay(db, today); // this month's monthly pay exists before anything is added up
  const monthStart = range?.from ?? `${today.slice(0, 7)}-01`;
  // "this month" stops at the end of this month, so nothing dated later is counted in it
  const monthEnd = range?.to ?? addDays(addMonths(monthStart, 1), -1);

  const empty = { revenueMonthBaseMinor: 0, revenueTotalBaseMinor: 0, pendingBaseMinor: 0, deductionsMonthBaseMinor: 0, deductionsTotalBaseMinor: 0, costsMonthBaseMinor: 0, costsTotalBaseMinor: 0, payMonthBaseMinor: 0, payTotalBaseMinor: 0, netMonthBaseMinor: 0, netTotalBaseMinor: 0 };
  const base: DashboardData = { baseCurrency, today, monthLabel: range ? `${range.from} to ${range.to}` : today.slice(0, 7), hasData: scope.hasData, perStream: [], overall: empty, upcomingPayments: [], dueWithin30DaysBaseMinor: 0, tasks: { open: 0, overdue: 0, upcoming: [] } };
  if (!scope.hasData) return base;

  const streamNames = new Map((await db.select({ id: streams.id, name: streams.name }).from(streams).orderBy(asc(streams.sort), asc(streams.name))).filter((s) => scope.streamIds.includes(s.id)).map((s) => [s.id, s.name]));

  const incomeWhere = conds.income;
  const expenseWhere = conds.expense;
  const subWhere = conds.subscription;
  const taskWhere = conds.task;

  const incAmount = sql`${incomeEntries.amountBaseMinor}`;
  const expAmount = sql`${expenses.amountBaseMinor}`;
  const payAmount = sql`${pay.amountBaseMinor}`;
  const [incomeRows, expenseRows, payRows, subRows, [taskCounts], upcomingTasks] = await Promise.all([
    db
      .select({
        streamId: incomeEntries.streamId,
        paidMonth: sumIf(incAmount, sql`${incomeEntries.status} = 'paid' and ${incomeEntries.entryDate} >= ${monthStart} and ${incomeEntries.entryDate} <= ${monthEnd}`),
        paidAll: sumIf(incAmount, sql`${incomeEntries.status} = 'paid'`),
        pending: sumIf(incAmount, sql`${incomeEntries.status} <> 'paid'`),
        dedMonth: sumIf(sql`${incomeEntries.amountBaseMinor} - ${incomeEntries.netBaseMinor}`, sql`${incomeEntries.status} = 'paid' and ${incomeEntries.entryDate} >= ${monthStart} and ${incomeEntries.entryDate} <= ${monthEnd}`),
        dedAll: sumIf(sql`${incomeEntries.amountBaseMinor} - ${incomeEntries.netBaseMinor}`, sql`${incomeEntries.status} = 'paid'`),
      })
      .from(incomeEntries)
      .where(incomeWhere)
      .groupBy(incomeEntries.streamId),
    db
      .select({
        streamId: expenses.streamId,
        month: sumIf(expAmount, sql`${expenses.expenseDate} >= ${monthStart} and ${expenses.expenseDate} <= ${monthEnd}`),
        all: sql<string>`coalesce(sum(${expAmount}), 0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.streamId),
    db
      .select({
        streamId: pay.streamId,
        month: sumIf(payAmount, sql`${pay.costDate} >= ${monthStart} and ${pay.costDate} <= ${monthEnd}`),
        all: sql<string>`coalesce(sum(${payAmount}), 0)`,
      })
      .from(pay)
      .where(conds.pay)
      .groupBy(pay.streamId),
    db
      .select({
        id: subscriptions.id,
        vendor: subscriptions.vendor,
        category: subscriptions.category,
        streamId: subscriptions.streamId,
        billingCycle: subscriptions.billingCycle,
        nextDueDate: subscriptions.nextDueDate,
        amountMinor: subscriptions.amountMinor,
        currency: subscriptions.currency,
        amountBaseMinor: subscriptions.amountBaseMinor,
      })
      .from(subscriptions)
      .where(subWhere)
      .orderBy(asc(subscriptions.nextDueDate), asc(subscriptions.id))
      .limit(100),
    db
      .select({
        open: sql<string>`coalesce(sum(${tasks.status} <> 'done'), 0)`,
        overdue: sql<string>`coalesce(sum(${tasks.status} <> 'done' and ${tasks.dueDate} < ${today}), 0)`,
      })
      .from(tasks)
      .where(taskWhere),
    db
      .select({ id: tasks.id, title: tasks.title, streamId: tasks.streamId, dueDate: tasks.dueDate, status: tasks.status, priority: tasks.priority })
      .from(tasks)
      .where(and(taskWhere, ne(tasks.status, "done")))
      .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.id))
      .limit(10),
  ]);

  const perStream: StreamFigures[] = [...streamNames].map(([streamId, stream]) => {
    const inc = incomeRows.find((r) => r.streamId === streamId);
    const exp = expenseRows.find((r) => r.streamId === streamId);
    const emp = payRows.find((r) => r.streamId === streamId);
    const f = {
      revenueMonthBaseMinor: num(inc?.paidMonth),
      revenueTotalBaseMinor: num(inc?.paidAll),
      pendingBaseMinor: num(inc?.pending),
      deductionsMonthBaseMinor: num(inc?.dedMonth),
      deductionsTotalBaseMinor: num(inc?.dedAll),
      // expenses and employee pay are separate records, so adding them counts each once
      costsMonthBaseMinor: num(exp?.month) + num(emp?.month),
      costsTotalBaseMinor: num(exp?.all) + num(emp?.all),
      payMonthBaseMinor: num(emp?.month),
      payTotalBaseMinor: num(emp?.all),
    };
    return { streamId, stream, ...f, netMonthBaseMinor: f.revenueMonthBaseMinor - f.deductionsMonthBaseMinor - f.costsMonthBaseMinor, netTotalBaseMinor: f.revenueTotalBaseMinor - f.deductionsTotalBaseMinor - f.costsTotalBaseMinor };
  });
  const overall = perStream.reduce(
    (a, s) => ({
      revenueMonthBaseMinor: a.revenueMonthBaseMinor + s.revenueMonthBaseMinor,
      revenueTotalBaseMinor: a.revenueTotalBaseMinor + s.revenueTotalBaseMinor,
      pendingBaseMinor: a.pendingBaseMinor + s.pendingBaseMinor,
      deductionsMonthBaseMinor: a.deductionsMonthBaseMinor + s.deductionsMonthBaseMinor,
      deductionsTotalBaseMinor: a.deductionsTotalBaseMinor + s.deductionsTotalBaseMinor,
      costsMonthBaseMinor: a.costsMonthBaseMinor + s.costsMonthBaseMinor,
      costsTotalBaseMinor: a.costsTotalBaseMinor + s.costsTotalBaseMinor,
      payMonthBaseMinor: a.payMonthBaseMinor + s.payMonthBaseMinor,
      payTotalBaseMinor: a.payTotalBaseMinor + s.payTotalBaseMinor,
      netMonthBaseMinor: a.netMonthBaseMinor + s.netMonthBaseMinor,
      netTotalBaseMinor: a.netTotalBaseMinor + s.netTotalBaseMinor,
    }),
    empty
  );

  const upcomingPayments = subRows.slice(0, 10).map((s) => ({
    id: s.id,
    vendor: s.vendor,
    category: s.category,
    stream: streamNames.get(s.streamId!) ?? "",
    billingCycle: s.billingCycle,
    nextDueDate: s.nextDueDate,
    daysUntilDue: daysBetween(today, s.nextDueDate),
    amountMinor: s.amountMinor,
    currency: s.currency,
    amountBaseMinor: num(s.amountBaseMinor),
  }));
  const dueWithin30DaysBaseMinor = subRows.filter((s) => daysBetween(today, s.nextDueDate) <= 30).reduce((a, s) => a + num(s.amountBaseMinor), 0);

  return {
    ...base,
    perStream,
    overall,
    upcomingPayments,
    dueWithin30DaysBaseMinor,
    tasks: {
      open: num(taskCounts?.open),
      overdue: num(taskCounts?.overdue),
      upcoming: upcomingTasks.map((t) => ({ id: t.id, title: t.title, stream: streamNames.get(t.streamId!) ?? "", dueDate: t.dueDate, status: t.status, priority: t.priority, overdue: !!t.dueDate && t.dueDate < today })),
    },
  };
}
