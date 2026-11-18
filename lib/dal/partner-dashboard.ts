import "server-only";
import { and, asc, eq, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { daysBetween } from "@/lib/dates";
import type { Actor } from "./guard";
import { companyToday } from "./payments";
import { moneyRowsWhere, notHiddenFrom, partnerScope, streamRowsWhere } from "./scope";

/**
 * "My dashboard": a Stream partner's own revenue, costs, net, upcoming payments and tasks.
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
const { incomeEntries, expenses, subscriptions, tasks, streams, settings } = schema;

export type StreamFigures = {
  streamId: number;
  stream: string;
  revenueMonthBaseMinor: number;
  revenueTotalBaseMinor: number;
  pendingBaseMinor: number;
  costsMonthBaseMinor: number;
  costsTotalBaseMinor: number;
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

export async function myDashboard(actor: Actor): Promise<DashboardData> {
  const scope = partnerScope(actor);
  const db = getDb();
  const [settingsRow] = await db.select({ base: settings.baseCurrency }).from(settings).where(eq(settings.id, 1));
  const baseCurrency = settingsRow?.base ?? "AUD";
  const today = await companyToday(db);
  const monthStart = `${today.slice(0, 7)}-01`;

  const empty = { revenueMonthBaseMinor: 0, revenueTotalBaseMinor: 0, pendingBaseMinor: 0, costsMonthBaseMinor: 0, costsTotalBaseMinor: 0, netMonthBaseMinor: 0, netTotalBaseMinor: 0 };
  const base: DashboardData = { baseCurrency, today, monthLabel: today.slice(0, 7), hasData: scope.hasData, perStream: [], overall: empty, upcomingPayments: [], dueWithin30DaysBaseMinor: 0, tasks: { open: 0, overdue: 0, upcoming: [] } };
  if (!scope.hasData) return base;

  const streamNames = new Map((await db.select({ id: streams.id, name: streams.name }).from(streams).orderBy(asc(streams.sort), asc(streams.name))).filter((s) => scope.streamIds.includes(s.id)).map((s) => [s.id, s.name]));

  const incomeWhere = and(moneyRowsWhere(actor, { streamId: incomeEntries.streamId, countryCode: incomeEntries.countryCode }), notHiddenFrom(db, actor, incomeEntries.projectId));
  const expenseWhere = and(moneyRowsWhere(actor, { streamId: expenses.streamId, countryCode: expenses.countryCode }), isNull(expenses.archivedAt));
  const subWhere = and(moneyRowsWhere(actor, { streamId: subscriptions.streamId, countryCode: subscriptions.countryCode }), eq(subscriptions.status, "active"));
  const taskWhere = and(streamRowsWhere(actor, { streamId: tasks.streamId }), notHiddenFrom(db, actor, tasks.projectId), isNull(tasks.archivedAt));

  const incAmount = sql`${incomeEntries.amountBaseMinor}`;
  const expAmount = sql`${expenses.amountBaseMinor}`;
  const [incomeRows, expenseRows, subRows, [taskCounts], upcomingTasks] = await Promise.all([
    db
      .select({
        streamId: incomeEntries.streamId,
        paidMonth: sumIf(incAmount, sql`${incomeEntries.status} = 'paid' and ${incomeEntries.entryDate} >= ${monthStart}`),
        paidAll: sumIf(incAmount, sql`${incomeEntries.status} = 'paid'`),
        pending: sumIf(incAmount, sql`${incomeEntries.status} <> 'paid'`),
      })
      .from(incomeEntries)
      .where(incomeWhere)
      .groupBy(incomeEntries.streamId),
    db
      .select({
        streamId: expenses.streamId,
        month: sumIf(expAmount, sql`${expenses.expenseDate} >= ${monthStart}`),
        all: sql<string>`coalesce(sum(${expAmount}), 0)`,
      })
      .from(expenses)
      .where(expenseWhere)
      .groupBy(expenses.streamId),
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
    const f = {
      revenueMonthBaseMinor: num(inc?.paidMonth),
      revenueTotalBaseMinor: num(inc?.paidAll),
      pendingBaseMinor: num(inc?.pending),
      costsMonthBaseMinor: num(exp?.month),
      costsTotalBaseMinor: num(exp?.all),
    };
    return { streamId, stream, ...f, netMonthBaseMinor: f.revenueMonthBaseMinor - f.costsMonthBaseMinor, netTotalBaseMinor: f.revenueTotalBaseMinor - f.costsTotalBaseMinor };
  });
  const overall = perStream.reduce(
    (a, s) => ({
      revenueMonthBaseMinor: a.revenueMonthBaseMinor + s.revenueMonthBaseMinor,
      revenueTotalBaseMinor: a.revenueTotalBaseMinor + s.revenueTotalBaseMinor,
      pendingBaseMinor: a.pendingBaseMinor + s.pendingBaseMinor,
      costsMonthBaseMinor: a.costsMonthBaseMinor + s.costsMonthBaseMinor,
      costsTotalBaseMinor: a.costsTotalBaseMinor + s.costsTotalBaseMinor,
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
