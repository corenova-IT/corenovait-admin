/**
 * Development-only sample data (run by npm run db:local, or npm run seed:dev).
 * The same clearly fake people as the /dev design preview, plus sample income
 * and expenses (flagged is_sample, so the UI shows a "Sample data" badge).
 *
 * Refuses to run in production or against any database that isn't on this PC.
 * Runs once: if the database already has people, it does nothing.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "./load-env.mjs";

loadEnvFile();

const PEOPLE = [
  { email: "admin.one@example.test", name: "Alex Example", title: "Co-founder", preset: "admin", status: "active" },
  { email: "admin.two@example.test", name: "Blair Sample", title: "Co-founder", preset: "admin", status: "active" },
  { email: "web.dev@example.test", name: "Casey Demo", title: "Web developer", preset: "staff", status: "active" },
  { email: "design@example.test", name: "Devon Placeholder", title: "Designer", preset: "manager", status: "active" },
  { email: "marketing@example.test", name: "Emery Test", title: "Marketing", preset: "staff", status: "invited" },
  { email: "former@example.test", name: "Frankie Fixture", title: "Contractor", preset: "staff", status: "deactivated" },
] as const;

// 12 months of sample revenue in AUD-ish figures, roughly matching the design PDF's shape
const MONTHS = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
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
      await writeAudit(tx, null, { action: "create", entity: "users", summary: "Sample people loaded for local development" });
    });

    const admin = ids["admin.one@example.test"];
    const streams = await db.select().from(schema.streams);
    const repId = randomUUID();
    await db.insert(schema.representatives).values({ id: repId, name: "Riley Referral (sample)", commissionRate: "0.1000", createdBy: admin });

    const income: Array<typeof schema.incomeEntries.$inferInsert> = [];
    MONTHS.forEach((m, i) => {
      const growth = 1 + i * 0.04;
      const plan = [
        { country: "GB", currency: "GBP", rate: "1.95000000", amount: Math.round(9_500 * growth) },
        { country: "AU", currency: "AUD", rate: "1.00000000", amount: Math.round(22_000 * growth) },
        { country: "OTHER", currency: "USD", rate: "1.52000000", amount: Math.round(3_400 * growth) },
      ];
      plan.forEach((row, j) => {
        const stream = streams[(i + j) % streams.length];
        income.push({
          id: randomUUID(),
          entryDate: `${m}-${String(5 + j * 8).padStart(2, "0")}`,
          streamId: stream.id,
          countryCode: row.country,
          client: CLIENTS[(i + j) % CLIENTS.length],
          description: `Sample ${stream.name} project`,
          amountMinor: row.amount * 100,
          currency: row.currency,
          fxRateToBase: row.rate,
          invoiceRef: `SAMPLE-${m.replace("-", "")}-${j + 1}`,
          status: i === MONTHS.length - 1 && j === 0 ? "pending" : i === MONTHS.length - 2 && j === 1 ? "overdue" : "paid",
          representativeId: stream.name === "Individual representatives" ? repId : null,
          commissionRate: stream.name === "Individual representatives" ? "0.1000" : null,
          isSample: true,
          createdBy: admin,
        });
      });
    });
    await db.insert(schema.incomeEntries).values(income);

    const expenses: Array<typeof schema.expenses.$inferInsert> = [];
    MONTHS.forEach((m) => {
      // country null = a shared cost; tagged ones follow the UK / AUS switch on Home
      for (const [category, vendor, amount, recurring, countryCode] of [
        ["Hosting", "Sample Cloud Hosting", 119_000, true, null],
        ["Software", "Sample Design Suite", 102_000, true, null],
        ["Payroll", "Contractor payments (sample)", 1_120_000, false, "AU"],
        ["Software", "Sample Prototyping Tool", 64_000, true, "GB"],
      ] as const) {
        expenses.push({
          id: randomUUID(),
          expenseDate: `${m}-20`,
          category,
          vendor,
          description: "Sample expense",
          amountMinor: amount,
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
      ["2026-03-31", "2026-06-30", "2026-09-30"].map((paidDate, i) => ({
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
    const { addDays, todayIn } = await import("../lib/dates");
    const today = todayIn("Australia/Sydney");
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
    await writeAudit(db, null, {
      action: "create",
      entity: "income_entries",
      summary: `Sample data: ${income.length} income entries, ${expenses.length} expenses and ${subs.length} subscriptions (is_sample)`,
    });

    console.log("\nSample data loaded (development only):");
    console.log("  Sign in at http://localhost:3000/login with any of:");
    for (const p of PEOPLE.filter((x) => x.status === "active")) console.log(`    ${p.email.padEnd(26)} ${p.preset}`);
    console.log(`  Password for all of them (local only, shown once): ${devPassword}`);
    console.log("  Admins and the manager set up two-factor on first sign-in; web.dev@example.test is plain staff.");
    console.log("  Lost it? npm run db:local -- --reset\n");
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
