import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** Phase 2A: the ledger, streams, countries and representatives, against real MySQL. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let fin: typeof import("@/lib/dal/finance");
let rev: typeof import("@/lib/dal/revenue");
let ids: { admin: string; staff: string; manager: string; repUser: string };
let streamIds: Record<string, number>;
const DENIED = /permission|two-factor|session/i;

const perm = (scope: "own" | "assigned" | "all", extra: Partial<Record<"create" | "edit" | "delete" | "export", boolean>> = {}) => ({
  view: true,
  create: false,
  edit: false,
  delete: false,
  export: false,
  ...extra,
  scope,
});

beforeAll(async () => {
  t = await setupTestDatabase();
  fin = await import("@/lib/dal/finance");
  rev = await import("@/lib/dal/revenue");
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
    manager: (await createPerson(t, { email: "manager@example.test", preset: "manager", totp: true })).id,
    repUser: (await createPerson(t, { email: "rep@example.test" })).id,
  };
  streamIds = Object.fromEntries((await t.db.select().from(t.schema.streams)).map((s) => [s.name, s.id]));
});
afterAll(() => t?.cleanup());

const admin = () => actorFor(t, ids.admin);
const income = (over: Record<string, unknown> = {}) => ({
  entryDate: "2026-09-15",
  streamId: streamIds["Upwork"],
  countryCode: "GB",
  client: "Example Client",
  amount: "1000.00",
  currency: "GBP",
  fxRate: "1.95",
  status: "paid" as const,
  ...over,
});

describe("staff without finance access", () => {
  it("can't read, add, change, delete, export or import anything in the ledger, streams, countries or representatives", async () => {
    const a = await admin();
    const entry = await fin.createIncome(a, income());
    const exp = await fin.createExpense(a, { expenseDate: "2026-09-01", category: "Software", amount: "50", currency: "AUD" });
    const repId = await rev.saveRep(a, null, { name: "Rep A", commissionPercent: "10" });
    const staff = await actorFor(t, ids.staff);
    const tries: Array<[string, () => Promise<unknown>]> = [
      ["lookups", () => fin.financeLookups(staff)],
      ["list income", () => fin.listIncome(staff)],
      ["list expenses", () => fin.listExpenses(staff)],
      ["get income", () => fin.getIncome(staff, entry)],
      ["get expense", () => fin.getExpense(staff, exp)],
      ["create income", () => fin.createIncome(staff, income())],
      ["update income", () => fin.updateIncome(staff, entry, income({ amount: "1" }))],
      ["delete income", () => fin.deleteIncome(staff, entry)],
      ["create expense", () => fin.createExpense(staff, { expenseDate: "2026-09-01", category: "X", amount: "1", currency: "AUD" })],
      ["update expense", () => fin.updateExpense(staff, exp, { expenseDate: "2026-09-01", category: "X", amount: "1", currency: "AUD" })],
      ["delete expense", () => fin.deleteExpense(staff, exp)],
      ["export income", () => fin.exportIncomeCsv(staff, {})],
      ["export expenses", () => fin.exportExpensesCsv(staff, {})],
      ["import income", () => fin.importIncomeCsv(staff, "date,stream,country,amount,currency\n2026-01-01,Upwork,GB,1,GBP")],
      ["import expenses", () => fin.importExpensesCsv(staff, "date,category,amount,currency\n2026-01-01,X,1,AUD")],
      ["streams", () => rev.streamSummaries(staff)],
      ["stream detail", () => rev.streamDetail(staff, streamIds["Upwork"])],
      ["countries", () => rev.countrySummaries(staff)],
      ["country detail", () => rev.countryDetail(staff, "GB")],
      ["reps", () => rev.repSummaries(staff)],
      ["rep detail", () => rev.repDetail(staff, repId)],
      ["save rep", () => rev.saveRep(staff, null, { name: "X", commissionPercent: "5" })],
      ["payout", () => rev.recordPayout(staff, { representativeId: repId, paidDate: "2026-09-01", amount: "1", currency: "AUD" })],
      ["linkable users", () => rev.linkableUsers(staff)],
    ];
    for (const [name, fn] of tries) await expect(fn(), name).rejects.toThrow(DENIED);
    const [row] = await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, entry));
    expect(row.amountMinor).toBe(100000);
  });
});

describe("money and currency", () => {
  it("stores whole cents, converts with the exact rate, and totals in the base currency", async () => {
    const a = await admin();
    const before = (await fin.listIncome(a, { client: undefined, q: "RoundingCo" } as never)).totalBaseMinor;
    expect(before).toBe(0);
    // 333.33 GBP x 1.955 = 651.66015 -> 651.66 AUD ; 0.01 GBP x 1.5 = 0.015 -> 0.02 (half away from zero)
    await fin.createIncome(a, income({ client: "RoundingCo", amount: "333.33", fxRate: "1.955" }));
    await fin.createIncome(a, income({ client: "RoundingCo", amount: "0.01", fxRate: "1.5" }));
    const { rows, totalBaseMinor } = await fin.listIncome(a, { q: "RoundingCo" });
    expect(rows.map((r) => r.amountBaseMinor).sort()).toEqual([2, 65166]);
    expect(totalBaseMinor).toBe(65168);
  });

  it("rejects bad amounts and rates with a plain message", async () => {
    const a = await admin();
    await expect(fin.createIncome(a, income({ amount: "12.345" }))).rejects.toThrow(/amount like/);
    await expect(fin.createIncome(a, income({ fxRate: "0" }))).rejects.toThrow(/rate/i);
    await expect(fin.createIncome(a, income({ currency: "pounds" }))).rejects.toThrow(/3-letter/);
    await expect(fin.createIncome(a, income({ streamId: 9999 }))).rejects.toThrow(/stream/);
    await expect(fin.createIncome(a, income({ countryCode: "FR" }))).rejects.toThrow(/country/);
  });

  it("averages whole cents rounding half away from zero", () => {
    expect(rev.divRound(10, 4)).toBe(3); // 2.5 -> 3
    expect(rev.divRound(10, 3)).toBe(3);
    expect(rev.divRound(-10, 4)).toBe(-3);
    expect(rev.divRound(5, 0)).toBe(0);
    expect(rev.percentToRate("12.5")).toBe("0.1250");
    expect(rev.percentToRate("100")).toBe("1.0000");
    expect(rev.percentToRate("0.25%")).toBe("0.0025");
    expect(() => rev.percentToRate("101")).toThrow(/100%/);
    expect(() => rev.percentToRate("1.234")).toThrow(/percentage/);
  });
});

describe("filters, search and sorting", () => {
  it("filters by stream, country, status, representative and date, and searches text", async () => {
    const a = await admin();
    const repId = await rev.saveRep(a, null, { name: "Filter Rep", commissionPercent: "5" });
    await fin.createIncome(a, income({ client: "Zeta Filter Ltd", streamId: streamIds["Fiverr"], countryCode: "AU", currency: "AUD", fxRate: "1", status: "overdue", entryDate: "2026-03-02", representativeId: repId }));
    const one = (f: Record<string, unknown>) => fin.listIncome(a, { q: "Zeta Filter", ...f }).then((r) => r.total);
    expect(await one({})).toBe(1);
    expect(await one({ stream: streamIds["Fiverr"] })).toBe(1);
    expect(await one({ stream: streamIds["Upwork"] })).toBe(0);
    expect(await one({ country: "AU", status: "overdue", rep: repId })).toBe(1);
    expect(await one({ rep: "none" })).toBe(0);
    expect(await one({ from: "2026-03-01", to: "2026-03-31" })).toBe(1);
    expect(await one({ from: "2026-04-01" })).toBe(0);
    // LIKE wildcards in a search are literal
    expect((await fin.listIncome(a, { q: "%" })).total).toBe(0);
  });

  it("sorts by amount and paginates on the server", async () => {
    const a = await admin();
    const all = await fin.listIncome(a, { sort: "amount", dir: "desc" }, 2);
    expect(all.rows).toHaveLength(2);
    expect(all.rows[0].amountBaseMinor!).toBeGreaterThanOrEqual(all.rows[1].amountBaseMinor!);
    const p2 = await fin.listIncome(a, { sort: "amount", dir: "desc", page: 2 }, 2);
    expect(p2.rows[0].id).not.toBe(all.rows[0].id);
  });
});

describe("scope", () => {
  it("own sees only their entries, assigned also sees deals credited to their rep record, all sees everything", async () => {
    const a = await admin();
    const team = await import("@/lib/dal/team");
    const owner = await createPerson(t, { email: "owner@example.test" });
    const basePerms = (await actorFor(t, owner.id)).perms;
    await team.setPermissions(a, { userId: owner.id, perms: { ...basePerms, transactions: perm("own", { create: true, edit: true, delete: true, export: true }) } });
    const repBase = (await actorFor(t, ids.repUser)).perms;
    await team.setPermissions(a, {
      userId: ids.repUser,
      perms: { ...repBase, transactions: perm("assigned"), streams: perm("assigned"), representatives: perm("assigned") },
    });
    const repId = await rev.saveRep(a, null, { name: "Linked Rep", commissionPercent: "10", userId: ids.repUser });
    const credited = await fin.createIncome(a, income({ client: "Scope Credited", representativeId: repId }));
    const adminOnly = await fin.createIncome(a, income({ client: "Scope AdminOnly" }));

    const o = await actorFor(t, owner.id);
    const mine = await fin.createIncome(o, income({ client: "Scope Mine" }));
    expect((await fin.listIncome(o, { q: "Scope" })).rows.map((r) => r.id)).toEqual([mine]);
    expect(await fin.getIncome(o, adminOnly)).toBeNull();
    await expect(fin.updateIncome(o, adminOnly, income())).rejects.toThrow(/isn't yours/);
    await expect(fin.deleteIncome(o, adminOnly)).rejects.toThrow(/isn't yours/);

    const r = await actorFor(t, ids.repUser);
    expect((await fin.listIncome(r, { q: "Scope" })).rows.map((x) => x.id)).toEqual([credited]);
    const reps = await rev.repSummaries(r);
    expect(reps.rows.map((x) => x.name)).toEqual(["Linked Rep"]);
    const streamsForRep = await rev.streamSummaries(r, "all");
    expect(streamsForRep.totalBaseMinor).toBe(195000); // only the credited entry, 1000 GBP x 1.95

    const all = await fin.listIncome(a, { q: "Scope" });
    expect(all.rows.map((x) => x.id).sort()).toEqual([credited, adminOnly, mine].sort());

    // exports respect scope too: the owner exports only their own row
    const ownerExport = await fin.exportIncomeCsv(o, { q: "Scope" });
    expect(ownerExport.rows).toBe(1);
    expect(ownerExport.csv).toContain("Scope Mine");
    expect(ownerExport.csv).not.toContain("Scope AdminOnly");
  });
});

describe("representatives and commission", () => {
  it("earns commission on paid deals only, at the rate when credited, and tracks payouts", async () => {
    const a = await admin();
    const repId = await rev.saveRep(a, null, { name: "Commission Rep", commissionPercent: "10" });
    // 1000 GBP x 1.95 = 1950.00 AUD paid -> 195.00 commission
    await fin.createIncome(a, income({ representativeId: repId, status: "paid" }));
    // pending deals earn nothing yet
    await fin.createIncome(a, income({ representativeId: repId, status: "pending" }));
    // 333.33 AUD at 10% = 33.333 -> 33.33 (per-entry rounding)
    await fin.createIncome(a, income({ representativeId: repId, currency: "AUD", fxRate: "1", amount: "333.33" }));
    // later rate change doesn't rewrite the past
    await rev.saveRep(a, repId, { name: "Commission Rep", commissionPercent: "20" });
    // a new deal after the change earns 20%: 100 AUD -> 20.00
    await fin.createIncome(a, income({ representativeId: repId, currency: "AUD", fxRate: "1", amount: "100" }));
    await rev.recordPayout(a, { representativeId: repId, paidDate: "2026-10-01", amount: "100", currency: "AUD" });

    const d = (await rev.repDetail(a, repId))!;
    expect(d.dealsCount).toBe(4);
    expect(d.commissionEarnedBaseMinor).toBe(19500 + 3333 + 2000);
    expect(d.commissionPaidBaseMinor).toBe(10000);
    expect(d.commissionOwedBaseMinor).toBe(19500 + 3333 + 2000 - 10000);
    expect(d.payouts).toHaveLength(1);

    const audit = await import("@/lib/dal/audit");
    const log = await audit.listAudit(a, { entity: "rep_payouts" });
    expect(log.rows[0].action).toBe("create");
    await rev.deletePayout(a, d.payouts[0].id);
    expect((await rev.repDetail(a, repId))!.commissionPaidBaseMinor).toBe(0);
  });
});

describe("audit trail", () => {
  it("records before and after for edits and deletes of expenses", async () => {
    const a = await admin();
    const id = await fin.createExpense(a, { expenseDate: "2026-08-01", category: "Hosting", vendor: "Audit Host", amount: "10", currency: "AUD" });
    await fin.updateExpense(a, id, { expenseDate: "2026-08-01", category: "Hosting", vendor: "Audit Host", amount: "12.50", currency: "AUD" });
    await fin.deleteExpense(a, id);
    const audit = await import("@/lib/dal/audit");
    const rows = (await audit.listAudit(a, { entity: "expenses" })).rows.filter((r) => r.entity_id === id);
    expect(rows.map((r) => r.action)).toEqual(["delete", "update", "create"]);
    expect((rows[1].before as Record<string, unknown>).amountMinor).toBe(1000);
    expect((rows[1].after as Record<string, unknown>).amountMinor).toBe(1250);
    expect((rows[0].before as Record<string, unknown>).vendor).toBe("Audit Host");
  });
});

describe("CSV", () => {
  it("exports what the filters show, safe for spreadsheets, and logs the export", async () => {
    const a = await admin();
    await fin.createIncome(a, income({ client: "=HYPERLINK(\"http://evil\")", amount: "42.10" }));
    const out = await fin.exportIncomeCsv(a, { q: "HYPERLINK" });
    const table = parseCsv(out.csv);
    expect(table[0]).toEqual([...fin.INCOME_CSV_HEADER, "amount_aud"]);
    expect(table[1][3]).toBe("'=HYPERLINK(\"http://evil\")"); // neutralised
    expect(table[1][5]).toBe("42.10");
    expect(table[1][12]).toBe("82.10"); // 42.10 x 1.95 = 82.095 -> 82.10
    const audit = await import("@/lib/dal/audit");
    expect((await audit.listAudit(a, { action: "export" })).rows[0].summary).toMatch(/1 income rows/);
  });

  it("imports all rows or none, matching streams, countries and reps by name", async () => {
    const a = await admin();
    const bad = await fin.importIncomeCsv(
      a,
      "Date,Stream,Country,Client,Amount,Currency,FX Rate,Status\n2026-07-01,Upwork,GB,Good Row,10,GBP,1.95,paid\n2026-07-02,Nope,ZZ,Bad Row,abc,GBP,1.95,paid\n"
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/Row 3: no revenue stream called "Nope"/);
    expect((await fin.listIncome(a, { q: "Good Row" })).total).toBe(0); // nothing saved

    const good = await fin.importIncomeCsv(
      a,
      "﻿date,stream,country,client,amount,currency,fx_rate,status,representative\r\n2026-07-01,upwork,United Kingdom,\"Import, One\",\"1,250.50\",GBP,1.95,paid,\r\n2026-07-02,Fiverr,AU,Import Two,99,AUD,1,pending,Commission Rep\r\n"
    );
    expect(good).toEqual({ ok: true, created: 2 });
    const rows = (await fin.listIncome(a, { q: "Import" })).rows;
    expect(rows.find((r) => r.client === "Import, One")?.amountMinor).toBe(125050);
    expect(rows.find((r) => r.client === "Import Two")?.representativeName).toBe("Commission Rep");

    const exp = await fin.importExpensesCsv(a, "date,category,vendor,amount,currency,recurring\n2026-07-01,Software,Imported Vendor,19.99,AUD,yes\n");
    expect(exp).toEqual({ ok: true, created: 1 });
    expect((await fin.listExpenses(a, { q: "Imported Vendor", recurring: "yes" })).total).toBe(1);
  });

  it("refuses files without the required columns", async () => {
    const a = await admin();
    await expect(fin.importIncomeCsv(a, "foo,bar\n1,2\n")).rejects.toThrow(/missing: date, stream, country, amount, currency/);
  });
});

describe("attachments", () => {
  it("stores a receipt through the upload rules and links it to the expense", async () => {
    const a = await admin();
    const id = await fin.createExpense(a, { expenseDate: "2026-08-01", category: "Hosting", amount: "10", currency: "AUD" }, { name: "receipt.pdf", bytes: Buffer.from("%PDF-1.4 receipt") });
    const row = await fin.getExpense(a, id);
    expect(row?.receiptFileId).toBeTruthy();
    await expect(
      fin.createExpense(a, { expenseDate: "2026-08-01", category: "Hosting", amount: "10", currency: "AUD" }, { name: "evil.pdf", bytes: Buffer.from("<script>") })
    ).rejects.toThrow(/PDF, PNG, JPG or WebP/);
  });
});
