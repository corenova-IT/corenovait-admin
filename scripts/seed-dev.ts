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
  // the "Marketing staff" preset: staff defaults plus logging their own marketing activity
  { email: "marketing@example.test", name: "Emery Test", title: "Marketing", preset: "marketing_staff", status: "active" },
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

    const work = await seedWork(db, schema, {
      today,
      admin,
      people: {
        alex: admin,
        blair: ids["admin.two@example.test"],
        casey: ids["web.dev@example.test"],
        devon: ids["design@example.test"],
        emery: ids["marketing@example.test"],
      },
    });

    const chat = await seedChat(db, schema, {
      people: {
        alex: admin,
        blair: ids["admin.two@example.test"],
        casey: ids["web.dev@example.test"],
        devon: ids["design@example.test"],
        emery: ids["marketing@example.test"],
      },
    });
    await writeAudit(db, null, {
      action: "create",
      entity: "income_entries",
      summary: `Sample data: ${income.length} income entries, ${expenses.length} expenses, ${subs.length} subscriptions, ${marketing.activities} marketing activities in ${marketing.campaigns} campaigns, ${work.events} events, ${work.tasks} tasks, ${chat.messages} chat messages (is_sample)`,
    });

    console.log("\nSample data loaded (development only):");
    console.log("  Sign in at http://localhost:3000/login with any of:");
    for (const p of PEOPLE.filter((x) => x.status === "active")) console.log(`    ${p.email.padEnd(26)} ${p.preset.replace("_", " ")}`);
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

// ---------------------------------------------------------------- calendar and tasks sample
/**
 * Five weeks either side of today: a weekly stand-up, sprint planning, client
 * calls, deadlines and an offsite; and about forty tasks across the team, some
 * overdue, some due this week, some done, with checklists and comments.
 */
async function seedWork(
  db: ReturnType<typeof import("../lib/db").getDb>,
  schema: typeof import("../lib/db").schema,
  opts: { today: string; admin: string; people: { alex: string; blair: string; casey: string; devon: string; emery: string } }
) {
  const { addDays } = await import("../lib/dates");
  const { zonedToUtc } = await import("../lib/zoned");
  const tz = "Australia/Sydney";
  const r = rng(4004);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const P = opts.people;
  const everyone = [P.alex, P.blair, P.casey, P.devon, P.emery];
  const weekday = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const at = (d: string, hhmm: string) => zonedToUtc(`${d}T${hhmm}`, tz);

  type Ev = typeof schema.events.$inferInsert;
  const evs: Ev[] = [];
  const att: Array<{ eventId: string; userId: string }> = [];
  const add = (e: Omit<Ev, "id" | "isSample">, who: string[]) => {
    const id = randomUUID();
    evs.push({ id, isSample: true, ...e });
    for (const u of new Set(who)) att.push({ eventId: id, userId: u });
  };

  for (let d = addDays(opts.today, -35); d <= addDays(opts.today, 35); d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd === 0)
      add({ title: "Team stand-up (sample)", type: "meeting", startsAt: at(d, "09:30"), endsAt: at(d, "09:45"), videoUrl: "https://meet.example.test/standup", reminderMinutes: 10, createdBy: P.alex }, everyone);
    if (wd === 2 && Math.floor((Date.parse(d) / 86_400_000) / 7) % 2 === 0)
      add({ title: "Sprint planning (sample)", type: "meeting", startsAt: at(d, "14:00"), endsAt: at(d, "15:00"), location: "Meeting room", reminderMinutes: 30, createdBy: P.devon }, [P.alex, P.casey, P.devon]);
    if (wd < 5 && r() < 0.45) {
      const start = pick(["10:00", "11:00", "13:30", "15:00"]);
      const end = start === "13:30" ? "14:00" : `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00`;
      add(
        { title: `Call with ${pick(COMPANIES)} (sample)`, type: "meeting", startsAt: at(d, start), endsAt: at(d, end), location: r() < 0.5 ? "Phone" : "", videoUrl: r() < 0.5 ? "https://meet.example.test/client" : "", reminderMinutes: 10, createdBy: pick([P.alex, P.devon, P.emery]) },
        [P.alex, pick([P.devon, P.emery, P.casey])]
      );
    }
  }
  // the staff member's own day, so "My Day" has something on it
  add({ title: "Daily check-in (sample)", type: "meeting", startsAt: at(opts.today, "11:00"), endsAt: at(opts.today, "11:15"), videoUrl: "https://meet.example.test/checkin", reminderMinutes: 0, createdBy: P.casey }, [P.casey, P.devon]);
  add({ title: "Design review with Devon (sample)", type: "meeting", startsAt: at(addDays(opts.today, 2), "15:00"), endsAt: at(addDays(opts.today, 2), "15:45"), createdBy: P.casey }, [P.casey, P.devon]);
  for (const [offset, title] of [[4, "Website launch: Example Dental (sample)"], [12, "Quarterly BAS due (sample)"], [-6, "Proposal sent: Sample Gym (sample)"]] as const)
    add({ title, type: "deadline", allDay: true, startsAt: at(addDays(opts.today, offset), "00:00"), endsAt: at(addDays(opts.today, offset + 1), "00:00"), createdBy: P.alex }, [P.alex, P.devon]);
  add({ title: "Planning offsite (sample)", type: "other", allDay: true, startsAt: at(addDays(opts.today, 18), "00:00"), endsAt: at(addDays(opts.today, 20), "00:00"), location: "Example Retreat, Blue Mountains", createdBy: P.alex }, everyone);
  await db.insert(schema.events).values(evs);
  await db.insert(schema.eventAttendees).values(att);

  const TASKS: Array<[string, string, string[]]> = [
    ["Update the Example Dental home page", "website", ["Hero copy", "New photos", "Check on mobile"]],
    ["Send the Sample Gym proposal", "client", []],
    ["Fix contact form spam", "website", ["Add rate limit", "Test the email"]],
    ["Draft October newsletter", "marketing", ["Topics", "Draft", "Review"]],
    ["Prepare BAS figures", "finance", []],
    ["Design new service icons", "design", ["Sketch", "Vector", "Export"]],
    ["Follow up Demo Physio quote", "client", []],
    ["Write case study: Placeholder Cafe", "marketing", ["Interview notes", "Draft"]],
    ["Renew the SSL certificate", "internal", []],
    ["Onboard Sample Salon", "client", ["Kick-off call", "Access", "Brand files"]],
    ["Clean up the shared drive", "internal", []],
    ["Logo options for Fictional Builders", "design", ["Three concepts", "Feedback round"]],
    ["Set up analytics for Mock Legal", "website", []],
    ["Plan LinkedIn posts for November", "marketing", []],
    ["Chase overdue invoice: Northwind", "finance", []],
    ["Speed up the portfolio page", "website", ["Image sizes", "Lazy loading"]],
    ["Price list review", "internal", []],
    ["Photo shoot brief", "design", []],
  ];
  const assignees: Array<string | null> = [P.casey, P.casey, P.devon, P.emery, P.alex, P.devon, null];
  type Tk = typeof schema.tasks.$inferInsert;
  const tasks: Tk[] = [];
  const comments: Array<typeof schema.taskComments.$inferInsert> = [];
  let n = 0;
  for (const round of [0, 1]) {
    for (const [title, label, check] of TASKS) {
      if (round === 1 && r() < 0.35) continue;
      n++;
      const assigneeId = pick(assignees);
      const status = pick(["todo", "todo", "in_progress", "in_progress", "review", "done", "done"] as const);
      const due = r() < 0.15 ? null : addDays(opts.today, Math.floor(r() * 30) - 10);
      const id = randomUUID();
      const done = status === "done";
      tasks.push({
        id,
        title: round ? `${title} (part 2, sample)` : `${title} (sample)`,
        description: r() < 0.6 ? "Sample task. Details, links and notes go here." : null,
        status,
        priority: pick(["low", "medium", "medium", "medium", "high", "urgent"] as const),
        assigneeId,
        dueDate: due,
        labels: r() < 0.3 ? [label, "client"].filter((v, i, a) => a.indexOf(v) === i) : [label],
        checklist: check.map((text, i) => ({ id: `${n}-${i}`, text, done: done || r() < 0.4 })),
        completedAt: done ? zonedToUtc(addDays(opts.today, -Math.floor(r() * 7)), tz) : null,
        isSample: true,
        createdBy: assigneeId && r() < 0.3 ? assigneeId : opts.admin,
      });
      if (r() < 0.4)
        for (let c = 0; c < 1 + Math.floor(r() * 3); c++)
          comments.push({ id: randomUUID(), taskId: id, authorId: pick(everyone), body: pick(["Started on this.", "Waiting on the client for files.", "Looks good to me.", "Can we push this to next week?", "Done the first part, see the checklist.", "Sent for review."]) });
    }
  }
  // a few guaranteed for the staff member's "My Day": overdue, today, this week
  for (const [title, offset, priority] of [["Reply to client feedback (sample)", -2, "high"], ["Publish blog post (sample)", 0, "medium"], ["Check broken links (sample)", 3, "low"]] as const)
    tasks.push({ id: randomUUID(), title, status: "todo", priority, assigneeId: P.casey, dueDate: addDays(opts.today, offset), labels: ["website"], checklist: [], isSample: true, createdBy: opts.admin });
  await db.insert(schema.tasks).values(tasks);
  if (comments.length) await db.insert(schema.taskComments).values(comments);
  return { events: evs.length, tasks: tasks.length };
}

// ---------------------------------------------------------------- chat and notifications sample
/**
 * #general, #projects, #marketing and an archived #old-website, three direct
 * messages, a few days of messages (some unread for Casey, with @mentions),
 * and a handful of notifications so the bell has something to show.
 */
async function seedChat(
  db: ReturnType<typeof import("../lib/db").getDb>,
  schema: typeof import("../lib/db").schema,
  opts: { people: { alex: string; blair: string; casey: string; devon: string; emery: string } }
) {
  const P = opts.people;
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  const channel = (name: string, topic: string, extra: Partial<typeof schema.chatChannels.$inferInsert> = {}) => ({ id: randomUUID(), kind: "channel" as const, name, topic, isSample: true, createdBy: P.alex, ...extra });
  const general = channel("general", "Company-wide chat", { isDefault: true });
  const projects = channel("projects", "Client work in progress");
  const marketing = channel("marketing", "Campaigns, leads and posts");
  const old = channel("old-website", "The 2025 site rebuild", { archivedAt: ago(60 * 24 * 20) });
  const dm = (a: string, b: string) => ({ id: randomUUID(), kind: "dm" as const, dmKey: [a, b].sort().join(":"), isSample: true, createdBy: a });
  const alexCasey = dm(P.alex, P.casey);
  const devonCasey = dm(P.devon, P.casey);
  const alexBlair = dm(P.alex, P.blair);
  await db.insert(schema.chatChannels).values([general, projects, marketing, old, alexCasey, devonCasey, alexBlair]);

  const everyone = Object.values(P);
  // Casey last read #general and Devon's DM a couple of hours ago, so they have unread messages
  const read = (channelId: string, userId: string) => ({ channelId, userId, lastReadAt: userId === P.casey && (channelId === general.id || channelId === devonCasey.id || channelId === projects.id) ? ago(150) : new Date(now) });
  await db.insert(schema.chatMembers).values([
    ...everyone.map((u) => read(general.id, u)),
    ...[P.alex, P.casey, P.devon].map((u) => read(projects.id, u)),
    ...[P.alex, P.devon, P.emery].map((u) => read(marketing.id, u)),
    ...[P.alex, P.devon].map((u) => read(old.id, u)),
    ...[P.alex, P.casey].map((u) => read(alexCasey.id, u)),
    ...[P.devon, P.casey].map((u) => read(devonCasey.id, u)),
    ...[P.alex, P.blair].map((u) => read(alexBlair.id, u)),
  ]);

  const script: Array<[string, string, number, string]> = [
    [general.id, P.alex, 60 * 50, "Morning all. Stand-up is moved to 9:45 today (sample)."],
    [general.id, P.blair, 60 * 49, "Thanks, see you then."],
    [general.id, P.devon, 60 * 26, "The new office wifi password is on the noticeboard."],
    [general.id, P.emery, 60 * 25, "Reminder: the LinkedIn post goes out at 11. Likes and shares welcome!"],
    [general.id, P.alex, 120, "@casey can you take a look at the contact form spam when you get a minute?"],
    [general.id, P.devon, 90, "Lunch order going in at 12:30 if anyone wants in."],
    [general.id, P.emery, 45, "Two new enquiries from the dental campaign this morning."],
    [projects.id, P.devon, 60 * 30, "Example Dental home page: hero copy approved, waiting on photos."],
    [projects.id, P.casey, 60 * 29, "I'll do the mobile pass once the photos land."],
    [projects.id, P.alex, 100, "Client asked if we can launch on the 4th. @devon @casey does that still work?"],
    [projects.id, P.devon, 80, "Works for me if the photos arrive by Friday."],
    [marketing.id, P.emery, 60 * 20, "Cold-call list for this week is in the Marketing page."],
    [marketing.id, P.devon, 60 * 19, "Nice. I'll take the referrals."],
    [marketing.id, P.alex, 60 * 3, "Response rate on Tuesday mornings is way ahead. Let's book more calls then."],
    [old.id, P.devon, 60 * 24 * 30, "Final files are archived on the drive."],
    [alexCasey.id, P.alex, 60 * 6, "Hi Casey, thanks for picking up the analytics set-up."],
    [alexCasey.id, P.casey, 60 * 5, "No problem, should be done tomorrow."],
    [devonCasey.id, P.devon, 60 * 4, "Design review moved to Friday 3pm, sent you an invite."],
    [devonCasey.id, P.devon, 30, "Also: can you send me the staging link?"],
    [alexBlair.id, P.blair, 60 * 8, "Can we talk pricing for the Sample Gym proposal tomorrow?"],
    [alexBlair.id, P.alex, 60 * 7, "Yes, 10am works."],
  ];
  const rows = script.map(([channelId, authorId, minutes, body]) => ({ id: randomUUID(), channelId, authorId, body, isSample: true, createdAt: ago(minutes), updatedAt: ago(minutes) }));
  await db.insert(schema.chatMessages).values(rows);

  const notes: Array<typeof schema.notifications.$inferInsert> = [
    { userId: P.casey, type: "chat_mention", title: "Alex Example mentioned you in #general", body: "@casey can you take a look at the contact form spam when you get a minute?", href: `/chat?c=${general.id}`, dedupeKey: `sample:mention:casey`, createdAt: ago(120) },
    { userId: P.casey, type: "task_assigned", title: "New task for you: Check broken links (sample)", body: "Alex Example assigned it to you.", href: "/tasks?assignee=me", dedupeKey: "sample:assigned:casey", createdAt: ago(300) },
    { userId: P.casey, type: "meeting_reminder", title: "At 11:00: Daily check-in (sample)", body: "https://meet.example.test/checkin", href: "/calendar?view=agenda", dedupeKey: "sample:meeting:casey", createdAt: ago(20), readAt: null },
    { userId: P.alex, type: "payment_due", title: "Due soon: Sample Cloud Hosting", body: "A payment you look after is coming up.", href: "/payments", dedupeKey: "sample:payment:alex", createdAt: ago(600) },
    { userId: P.alex, type: "task_due", title: "Due tomorrow: Prepare BAS figures (sample)", body: "A task assigned to you is due soon.", href: "/tasks?assignee=me", dedupeKey: "sample:due:alex", createdAt: ago(900), readAt: ago(800) },
  ];
  // already handled, so the scheduler doesn't email the samples
  await db.insert(schema.notifications).values(notes.map((x) => ({ ...x, emailSkipped: true })));
  return { messages: rows.length };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
