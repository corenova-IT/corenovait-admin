/**
 * Development-only sample data (run by npm run db:local, or npm run seed:dev).
 * The same clearly fake people as the /dev design preview, plus sample income
 * and expenses (flagged is_sample, so the UI shows a "Sample data" badge).
 *
 * Refuses to run in production or against any database that isn't on this PC.
 * Runs once: if the database already has people, it does nothing.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const PEOPLE = [
  { email: "admin.one@example.test", name: "Alex Example", title: "Co-founder", preset: "admin", status: "active" },
  { email: "admin.two@example.test", name: "Blair Sample", title: "Co-founder", preset: "admin", status: "active" },
  { email: "web.dev@example.test", name: "Casey Demo", title: "Web developer", preset: "staff", status: "active" },
  { email: "design@example.test", name: "Devon Placeholder", title: "Designer", preset: "manager", status: "active" },
  // staff plus marketing with the "own" scope (granted below): sees only the activity they log
  { email: "marketing@example.test", name: "Emery Test", title: "Marketing", preset: "staff", status: "active" },
  { email: "sales@example.test", name: "Gray Sample", title: "Sales", preset: "staff", status: "invited" },
  { email: "former@example.test", name: "Frankie Fixture", title: "Contractor", preset: "staff", status: "deactivated" },
] as const;

const CLIENTS = ["Northwind Sample Co", "Example Retail Pty", "Placeholder Labs", "Demo Dental Group", "Fictional Freight Ltd", "Sample Studio"];

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed:dev never runs in production.");
  const url = process.env.DATABASE_URL ?? "";
  const host = /^mysql:\/\/(?:[^@/]*@)?([^:/]+)/.exec(url)?.[1];
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error("seed:dev only runs against a database on this PC (127.0.0.1 or localhost).");

  const { getDb, schema, closeDb } = await import("../lib/db");
  const { copyPresetToUser } = await import("../lib/dal/internal");
  const { writeAudit } = await import("../lib/dal/audit");
  const { hashPassword } = await import("../lib/auth/hash");
  const db = getDb();

  try {
    const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    if (existing.length) {
      console.log("Sample data is already loaded. To start over: npm run db:local -- --reset");
      return;
    }

    // one throwaway password for every sample account that can sign in, shown once in this terminal
    const devPassword = `Local-${randomBytes(6).toString("base64url")}-9a`;
    const hash = await hashPassword(devPassword);
    const ids: Record<string, string> = {};

    await db.transaction(async (tx) => {
      for (const p of PEOPLE) {
        const id = randomUUID();
        ids[p.email] = id;
        await tx.insert(schema.users).values({
          id,
          email: p.email,
          fullName: p.name,
          jobTitle: p.title,
          status: p.status,
          passwordHash: p.status === "invited" ? null : hash,
          passwordChangedAt: p.status === "invited" ? null : new Date(),
          lastSignInAt: p.status === "active" ? new Date() : null,
        });
        await copyPresetToUser(tx, id, p.preset);
      }
      // what an admin would do on the Team page: give the marketing person their own activity log
      const { loadUserPerms, writeUserPerms } = await import("../lib/dal/internal");
      const emery = ids["marketing@example.test"];
      const perms = await loadUserPerms(tx, emery);
      perms.marketing = { view: true, create: true, edit: true, delete: true, export: false, scope: "own" };
      await writeUserPerms(tx, emery, perms);
      await tx.update(schema.users).set({ presetId: "custom" }).where(eq(schema.users.id, emery));
      await writeAudit(tx, null, { action: "create", entity: "users", summary: "Sample people loaded for local development" });
    });

    // 24 months up to today (company time): the last 12 roughly match the design PDF's shape, the
    // 12 before them are a smaller year, so the "vs prior year" changes have something to compare with
    const { addDays, addMonths, monthsBetween, todayIn } = await import("../lib/dates");
    const today = todayIn("Australia/Sydney");
    const MONTHS = monthsBetween(addMonths(`${today.slice(0, 7)}-01`, -23), today);
    const RECENT = 12;
    // a day in the month, never later than today (the current month is still running)
    const dayIn = (m: string, day: number) => {
      const d = `${m}-${String(day).padStart(2, "0")}`;
      return d > today ? today : d;
    };

    const admin = ids["admin.one@example.test"];
    const streams = await db.select().from(schema.streams);
    const repId = randomUUID();
    await db.insert(schema.representatives).values({ id: repId, name: "Riley Referral (sample)", commissionRate: "0.1000", createdBy: admin });

    const income: Array<typeof schema.incomeEntries.$inferInsert> = [];
    MONTHS.forEach((m, k) => {
      // i: position in the last 12 months (negative for the year before), scaled down ~20% a year earlier
      const i = k - (MONTHS.length - RECENT);
      const trend = i < 0 ? 0.8 * (1 + (i + RECENT) * 0.04) : 1 + i * 0.04;
      const growth = trend * (1 + 0.06 * Math.sin(k * 1.3));
      const plan = [
        { country: "GB", currency: "GBP", rate: "1.95000000", amount: Math.round(9_500 * growth) },
        { country: "AU", currency: "AUD", rate: "1.00000000", amount: Math.round(22_000 * growth) },
        { country: "OTHER", currency: "USD", rate: "1.52000000", amount: Math.round(3_400 * growth) },
      ];
      plan.forEach((row, j) => {
        const stream = streams[(k + j) % streams.length];
        income.push({
          id: randomUUID(),
          entryDate: dayIn(m, 5 + j * 8),
          streamId: stream.id,
          countryCode: row.country,
          client: CLIENTS[(k + j) % CLIENTS.length],
          description: `Sample ${stream.name} project`,
          amountMinor: row.amount * 100,
          currency: row.currency,
          fxRateToBase: row.rate,
          invoiceRef: `SAMPLE-${m.replace("-", "")}-${j + 1}`,
          status: i === RECENT - 1 && j === 0 ? "pending" : i === RECENT - 2 && j === 2 ? "overdue" : "paid",
          representativeId: stream.name === "Individual representatives" ? repId : null,
          commissionRate: stream.name === "Individual representatives" ? "0.1000" : null,
          isSample: true,
          createdBy: admin,
        });
      });
    });
    await db.insert(schema.incomeEntries).values(income);

    const expenses: Array<typeof schema.expenses.$inferInsert> = [];
    MONTHS.forEach((m, k) => {
      const scale = k < MONTHS.length - RECENT ? 0.9 : 1;
      // country null = a shared cost; tagged ones follow the UK / AUS switch on Home
      for (const [category, vendor, amount, recurring, countryCode] of [
        ["Hosting", "Sample Cloud Hosting", 119_000, true, null],
        ["Software", "Sample Design Suite", 102_000, true, null],
        ["Payroll", "Contractor payments (sample)", 1_120_000, false, "AU"],
        ["Software", "Sample Prototyping Tool", 64_000, true, "GB"],
      ] as const) {
        expenses.push({
          id: randomUUID(),
          expenseDate: dayIn(m, 20),
          category,
          vendor,
          description: "Sample expense",
          amountMinor: Math.round(amount * scale),
          currency: "AUD",
          fxRateToBase: "1.00000000",
          isRecurring: recurring,
          countryCode,
          isSample: true,
          createdBy: admin,
        });
      }
    });
    await db.insert(schema.expenses).values(expenses);
    await db.insert(schema.repPayouts).values(
      // quarterly payouts on the last day of three of the recent months
      [4, 7, 10].map((n) => addDays(`${MONTHS[MONTHS.length - RECENT + n]}-01`, -1)).map((paidDate, i) => ({
        id: randomUUID(),
        representativeId: repId,
        paidDate,
        amountMinor: [180_000, 210_000, 240_000][i],
        currency: "AUD",
        fxRateToBase: "1.00000000",
        reference: `SAMPLE-PAYOUT-Q${i + 1}`,
        isSample: true,
        createdBy: admin,
      }))
    );
    // the design's "upcoming expenses and subscriptions", due a few days from whenever this runs
    const subs: Array<typeof schema.subscriptions.$inferInsert> = (
      [
        ["Sample Cloud Hosting", "Hosting", 119_000, "AUD", "1.00000000", "monthly", 3, null],
        ["Sample Design Suite", "Software", 102_000, "AUD", "1.00000000", "monthly", 4, null],
        ["Contractor payments (sample)", "Payroll", 1_120_000, "AUD", "1.00000000", "monthly", 6, "AU"],
        ["Sample Prototyping Tool", "Software", 33_000, "GBP", "1.95000000", "monthly", 7, "GB"],
        ["Domain renewals (sample)", "Domains", 52_000, "AUD", "1.00000000", "yearly", 15, null],
        ["Sample Database Hosting", "Database", 29_000, "AUD", "1.00000000", "monthly", 20, null],
      ] as const
    ).map(([vendor, category, amountMinor, currency, fxRateToBase, billingCycle, inDays, countryCode]) => ({
      id: randomUUID(),
      vendor,
      category,
      amountMinor,
      currency,
      fxRateToBase,
      billingCycle,
      nextDueDate: addDays(today, inDays),
      reminderDays: 7,
      paidFrom: "Company card (sample)",
      responsibleUserId: admin,
      countryCode,
      isSample: true,
      createdBy: admin,
    }));
    await db.insert(schema.subscriptions).values(subs);

    const marketing = await seedMarketing(db, schema, {
      months: MONTHS,
      today,
      owners: [
        { id: admin, weight: 0.5 },
        { id: ids["design@example.test"], weight: 1 },
        { id: ids["marketing@example.test"], weight: 1.6 },
      ],
    });
    await writeAudit(db, null, {
      action: "create",
      entity: "income_entries",
      summary: `Sample data: ${income.length} income entries, ${expenses.length} expenses, ${subs.length} subscriptions, ${marketing.activities} marketing activities in ${marketing.campaigns} campaigns (is_sample)`,
    });

    console.log("\nSample data loaded (development only):");
    console.log("  Sign in at http://localhost:3000/login with any of:");
    for (const p of PEOPLE.filter((x) => x.status === "active")) console.log(`    ${p.email.padEnd(26)} ${p.email.startsWith("marketing") ? "staff + own marketing activity" : p.preset}`);
    console.log(`  Password for all of them (local only, shown once): ${devPassword}`);
    console.log("  Admins and the manager set up two-factor on first sign-in; web.dev@example.test is plain staff.");
    console.log("  Lost it? npm run db:local -- --reset\n");
  } finally {
    await closeDb();
  }
}

// ---------------------------------------------------------------- marketing sample
/** Same numbers on every run, so the pages and the layout test look the same each time. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Sam", "Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Quinn", "Avery", "Rowan", "Harper", "Reese", "Drew", "Parker", "Sky"];
const LAST = ["Example", "Sample", "Demo", "Placeholder", "Testwood", "Fixture", "Mockford", "Stubbs", "Dummy", "Trial"];
const COMPANIES = ["Example Dental", "Sample Plumbing Co", "Demo Physio", "Placeholder Cafe", "Fictional Builders", "Mock Legal", "Sample Salon", "Test Trades Pty", "Demo Accounting", "Example Florists", "Sample Gym", "Placeholder Clinic"];

/**
 * 24 months of clearly fake marketing activity with patterns worth finding:
 * referrals and direct contact reply far more often than social posts;
 * Tuesday to Thursday mornings do best; February and March are strong.
 */
async function seedMarketing(
  db: ReturnType<typeof import("../lib/db").getDb>,
  schema: typeof import("../lib/db").schema,
  opts: { months: string[]; today: string; owners: Array<{ id: string; weight: number }> }
) {
  const { addDays } = await import("../lib/dates");
  const { zonedToUtc } = await import("../lib/zoned");
  const tz = "Australia/Sydney";
  const r = rng(20261027);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const m = opts.months;
  const admin = opts.owners[0].id;

  // campaigns placed on the same rolling 24 months as the rest of the sample
  const at = (i: number, end = false) => (end ? addDays(`${m[Math.min(i + 1, m.length - 1)]}-01`, -1) : `${m[i]}-01`);
  const camps = [
    { name: "Dental clinics email (sample)", channel: "email", from: 2, to: 6, status: "finished" },
    { name: "Referral partners (sample)", channel: "individual_referral", from: 4, to: 12, status: "finished" },
    { name: "UK agencies cold calls (sample)", channel: "cold_call", from: 10, to: 15, status: "finished" },
    { name: "LinkedIn content push (sample)", channel: "social", from: 14, to: 19, status: "paused" },
    { name: "Website redesign offer (sample)", channel: "email", from: 18, to: 23, status: "active" },
    { name: "AU trades direct (sample)", channel: "direct", from: 20, to: 23, status: "active" },
  ] as const;
  const campaignRows: Array<typeof schema.campaigns.$inferInsert> = camps.map((c) => ({
    id: randomUUID(),
    name: c.name,
    channel: c.channel,
    status: c.status,
    startDate: at(c.from),
    endDate: c.status === "active" ? null : at(c.to, true),
    description: "Sample campaign",
    isSample: true,
    createdBy: admin,
  }));
  campaignRows.push({ id: randomUUID(), name: "Spring referral drive (sample)", channel: "individual_referral", status: "planned", startDate: addDays(opts.today, 20), endDate: null, description: "Planned, nothing logged yet", isSample: true, createdBy: admin });
  await db.insert(schema.campaigns).values(campaignRows);

  const CHANNEL_MIX: Array<[(typeof schema.marketingActivities.$inferInsert)["channel"], number, number]> = [
    // channel, share of activity, base chance of a response
    ["email", 0.35, 0.14],
    ["cold_call", 0.25, 0.22],
    ["social", 0.14, 0.09],
    ["direct", 0.12, 0.34],
    ["individual_referral", 0.11, 0.5],
    ["other", 0.03, 0.15],
  ];
  const DAY_BOOST = [0.75, 1.5, 1.35, 1.1, 0.7, 0.5, 0.5]; // Mon … Sun
  const HOURS = [8, 9, 9, 10, 10, 10, 11, 11, 12, 13, 14, 14, 15, 15, 16, 17];
  const hourBoost = (h: number) => (h >= 9 && h <= 11 ? 1.35 : h === 14 || h === 15 ? 1.1 : h === 12 || h === 13 ? 0.8 : 0.85);
  const monthBoost = (mm: number) => (mm === 2 || mm === 3 ? 1.2 : mm === 12 || mm === 1 ? 0.8 : 1);
  const now = Date.now();

  const rows: Array<typeof schema.marketingActivities.$inferInsert> = [];
  for (let d = `${m[0]}-01`; d <= opts.today; d = addDays(d, 1)) {
    const weekday = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    if (weekday === 6) continue; // nobody works Sundays
    const k = m.indexOf(d.slice(0, 7));
    const growth = k < 12 ? 0.85 : 1;
    for (const o of opts.owners) {
      const count = Math.floor(r() * 3 * o.weight * (weekday === 5 ? 0.3 : 1));
      for (let i = 0; i < count; i++) {
        let x = r();
        const [channel, , base] = CHANNEL_MIX.find(([, share]) => (x -= share) < 0) ?? CHANNEL_MIX[0];
        const hour = pick(HOURS);
        const occurredAt = zonedToUtc(`${d}T${String(hour).padStart(2, "0")}:${String(Math.floor(r() * 60)).padStart(2, "0")}`, tz);
        if (occurredAt.getTime() > now) continue;
        const chance = Math.min(0.9, base * DAY_BOOST[weekday] * hourBoost(hour) * monthBoost(Number(d.slice(5, 7))) * growth);
        let outcome: (typeof schema.marketingActivities.$inferInsert)["outcome"] = "no_response";
        if (r() < chance) {
          const y = r();
          outcome = y < 0.5 ? "replied" : y < 0.78 ? "meeting" : y < 0.91 ? "deal_won" : "deal_lost";
        }
        const gbp = r() < 0.2;
        const won = outcome === "deal_won";
        const live = campaignRows.find((c, ci) => c.channel === channel && k >= camps[ci]?.from && k <= camps[ci]?.to);
        rows.push({
          id: randomUUID(),
          occurredAt,
          channel,
          campaignId: live && r() < 0.7 ? live.id : null,
          contactName: `${pick(FIRST)} ${pick(LAST)}`,
          contactCompany: r() < 0.8 ? pick(COMPANIES) : "",
          outcome,
          dealValueMinor: won ? Math.round((1500 + r() * 22500) / 50) * 50 * 100 : null,
          dealCurrency: won ? (gbp ? "GBP" : "AUD") : null,
          dealFxRateToBase: won ? (gbp ? "1.95000000" : "1.00000000") : null,
          ownerId: o.id,
          notes: null,
          isSample: true,
          createdBy: o.id,
        });
      }
    }
  }
  for (let i = 0; i < rows.length; i += 500) await db.insert(schema.marketingActivities).values(rows.slice(i, i + 500));
  return { activities: rows.length, campaigns: campaignRows.length };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
