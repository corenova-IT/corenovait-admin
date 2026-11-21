import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * Taxes and fees on income, and the revenue overview: a partner sees only their own streams and countries,
 * admins see everything except what the Owner hid, deductions are validated and logged, expenses can be tagged
 * to a project, and profit is after taxes, fees and every cost (counted once).
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let ded: typeof import("@/lib/dal/income-deductions");
let money: typeof import("@/lib/dal/project-money");
let fin: typeof import("@/lib/dal/finance");
let pw: typeof import("@/lib/dal/partner-writes");
let pp: typeof import("@/lib/dal/partner-projects");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let ids: Record<"owner" | "admin" | "a" | "b" | "staff", string>;
let S: Record<"upwork" | "fiverr", number>;
let P: { mine: string; hidden: string; theirs: string };
let E: { paid: string; paid2: string; pending: string; hidden: string; theirs: string };

const as = (id: string) => actorFor(t, id);
const today = () => todayIn("Australia/Sydney");
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const entry = async (id: string) => (await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, id)))[0];
const auditFor = (id: string) => t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));

beforeAll(async () => {
  t = await setupTestDatabase();
  ded = await import("@/lib/dal/income-deductions");
  money = await import("@/lib/dal/project-money");
  fin = await import("@/lib/dal/finance");
  pw = await import("@/lib/dal/partner-writes");
  pp = await import("@/lib/dal/partner-projects");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  ids = {
    owner: (await createPerson(t, { email: "owner@example.test", preset: "admin", totp: true })).id,
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    a: (await createPerson(t, { email: "a@example.test", preset: "stream_partner" })).id,
    b: (await createPerson(t, { email: "b@example.test", preset: "stream_partner" })).id,
    staff: (await createPerson(t, { email: "staff@example.test" })).id,
  };
  await t.db.update(t.schema.users).set({ isOwner: true }).where(eq(t.schema.users.id, ids.owner));
  const rows = await t.db.select().from(t.schema.streams);
  S = { upwork: rows.find((r) => r.name === "Upwork")!.id, fiverr: rows.find((r) => r.name === "Fiverr")!.id };
  const owner = await as(ids.owner);
  await assign.setAssignments(owner, { userId: ids.a, streamIds: [S.upwork], countryCodes: ["GB"] });
  await assign.setAssignments(owner, { userId: ids.b, streamIds: [S.fiverr], countryCodes: ["AU"] });
  P = {
    mine: await pp.createMyProject(await as(ids.a), { streamId: S.upwork, name: "Mine" }),
    hidden: await proj.createProject(owner, { streamId: S.upwork, name: "Secret" }),
    theirs: await pp.createMyProject(await as(ids.b), { streamId: S.fiverr, name: "Theirs" }),
  };
  await proj.setProjectHidden(owner, { projectId: P.hidden, userId: ids.admin, hidden: true });
  await proj.setProjectHidden(owner, { projectId: P.hidden, userId: ids.a, hidden: true });
  const inc = (over: Record<string, unknown>) => ({ entryDate: today(), streamId: S.upwork, countryCode: "GB", client: "C", amount: "1000", currency: "AUD", fxRate: "1", status: "paid" as const, ...over });
  const mk = async (over: Record<string, unknown>) => (await t.db.select().from(t.schema.incomeEntries).where(eq(t.schema.incomeEntries.id, await fin.createIncome(owner, inc(over)) as unknown as string)))[0]?.id;
  const id = async (over: Record<string, unknown>) => {
    const r = (await fin.createIncome(owner, inc(over))) as unknown;
    return typeof r === "string" ? r : (r as { id: string }).id;
  };
  void mk;
  E = {
    paid: await id({ projectId: P.mine }),
    paid2: await id({ projectId: P.mine, amount: "500", currency: "GBP", fxRate: "2" }),
    pending: await id({ projectId: P.mine, amount: "300", status: "pending" }),
    hidden: await id({ projectId: P.hidden, amount: "7000" }),
    theirs: await id({ projectId: P.theirs, amount: "5000", streamId: S.fiverr, countryCode: "AU" }),
  };
});
afterAll(() => t?.cleanup());

describe("taxes and fees on one payment", () => {
  it("a partner sets them on their own payment: stored in the payment's currency, total kept, change logged", async () => {
    const a = await as(ids.a);
    const r = await ded.setDeductions(a, E.paid, [
      { kind: "platform", amount: "100" },
      { kind: "withdrawal", amount: "20.50" },
      { kind: "vat_transfer", amount: "9.50" },
      { kind: "other", label: "Bank charge", amount: "5" },
    ]);
    expect(r.deductionsMinor).toBe(13_500);
    expect(await entry(E.paid)).toMatchObject({ deductionsMinor: 13_500, netBaseMinor: 86_500 });
    const items = await t.db.select().from(t.schema.incomeDeductions).where(eq(t.schema.incomeDeductions.incomeEntryId, E.paid));
    expect(items.map((i) => [i.kind, i.label, i.amountMinor]).sort()).toEqual([["other", "Bank charge", 500], ["platform", "", 10_000], ["vat_transfer", "", 950], ["withdrawal", "", 2050]]);
    const log = (await auditFor(E.paid)).find((x) => x.action === "update")!;
    expect(log).toMatchObject({ action: "update", summary: "Taxes and fees changed on an income entry" });
  });

  it("uses the payment's own rate for the base-currency figure", async () => {
    await ded.setDeductions(await as(ids.a), E.paid2, [{ kind: "platform", amount: "50" }]);
    expect(await entry(E.paid2)).toMatchObject({ deductionsMinor: 5000, netBaseMinor: 90_000 }); // (500-50) GBP x 2
  });

  it("replaces the list, and an empty list clears it", async () => {
    const a = await as(ids.a);
    await ded.setDeductions(a, E.paid, [{ kind: "platform", amount: "10" }]);
    expect(await entry(E.paid)).toMatchObject({ deductionsMinor: 1000 });
    await ded.setDeductions(a, E.paid, []);
    expect(await entry(E.paid)).toMatchObject({ deductionsMinor: 0, netBaseMinor: 100_000 });
    expect(await t.db.select().from(t.schema.incomeDeductions).where(eq(t.schema.incomeDeductions.incomeEntryId, E.paid))).toHaveLength(0);
  });

  it("rejects bad input with plain messages", async () => {
    const a = await as(ids.a);
    expect(await msg(ded.setDeductions(a, E.paid, [{ kind: "platform", amount: "1001" }]))).toMatch(/more than the payment|can't be more/i);
    expect(await msg(ded.setDeductions(a, E.paid, [{ kind: "other", amount: "5" }]))).toMatch(/name/i);
    expect(await msg(ded.setDeductions(a, E.paid, [{ kind: "platform", amount: "0" }]))).toMatch(/more than zero/i);
    expect(await msg(ded.setDeductions(a, E.paid, [{ kind: "platform", amount: "abc" }]))).toMatch(/valid amount/i);
    expect(await entry(E.paid)).toMatchObject({ deductionsMinor: 0 });
  });

  it("a partner can't touch another partner's payment, a hidden project's payment, or anything as staff or a stranger", async () => {
    const a = await as(ids.a);
    expect(await msg(ded.setDeductions(a, E.theirs, [{ kind: "platform", amount: "1" }]))).toBe("That no longer exists.");
    expect(await msg(ded.setDeductions(a, E.hidden, [{ kind: "platform", amount: "1" }]))).toBe("That no longer exists.");
    expect(await msg(ded.setDeductions(a, crypto.randomUUID(), [{ kind: "platform", amount: "1" }]))).toBe("That no longer exists.");
    await expect(ded.setDeductions(await as(ids.staff), E.paid, [])).rejects.toThrow();
  });

  it("an admin can set them, but not on a project the Owner hid from that admin", async () => {
    const admin = await as(ids.admin);
    await ded.setDeductions(admin, E.theirs, [{ kind: "platform", amount: "500" }]);
    expect(await entry(E.theirs)).toMatchObject({ deductionsMinor: 50_000 });
    expect(await msg(ded.setDeductions(admin, E.hidden, [{ kind: "platform", amount: "1" }]))).toBe("That no longer exists.");
    await ded.setDeductions(await as(ids.owner), E.hidden, [{ kind: "platform", amount: "70" }]);
    expect(await entry(E.hidden)).toMatchObject({ deductionsMinor: 7000 });
  });
});

describe("the revenue overview", () => {
  it("a partner sees their own project: total, taxes and fees, after, cost and profit (paid income only)", async () => {
    const a = await as(ids.a);
    await ded.setDeductions(a, E.paid, [{ kind: "platform", amount: "100" }]); // 100.00 AUD off 1000 AUD
    await fin.createExpense(await as(ids.owner), { expenseDate: today(), category: "Software", vendor: "Tool", amount: "40", currency: "AUD", fxRate: "1", streamId: S.upwork, countryCode: "GB", projectId: P.mine });
    const m = await money.myProjectMoney(a);
    const row = m.rows.find((r) => r.projectId === P.mine)!;
    // paid: 1000 AUD + 500 GBP x 2 = 2000 AUD; deducted: 100 AUD + 50 GBP x 2 = 200 AUD; pending 300 is separate
    expect(row).toMatchObject({ grossBaseMinor: 200_000, deductionsBaseMinor: 20_000, netBaseMinor: 180_000, pendingBaseMinor: 30_000, costBaseMinor: 4000, profitBaseMinor: 176_000 });
    expect(row.currencies.map((c) => c.currency).sort()).toEqual(["AUD", "GBP"]);
    expect(m.totals).toMatchObject({ grossBaseMinor: 200_000, deductionsBaseMinor: 20_000, netBaseMinor: 180_000, expensesBaseMinor: 4000, profitBaseMinor: 176_000 });
  });

  it("shows a partner nothing of other partners' streams or of a project the Owner hid", async () => {
    const m = await money.myProjectMoney(await as(ids.a));
    const text = JSON.stringify(m);
    expect(m.rows.map((r) => r.name)).not.toContain("Theirs");
    expect(m.rows.map((r) => r.name)).not.toContain("Secret");
    expect(m.entries.map((e) => e.id)).not.toContain(E.theirs);
    expect(m.entries.map((e) => e.id)).not.toContain(E.hidden);
    expect(text).not.toContain("Theirs");
    expect(text).not.toContain("Secret");
    expect(text).not.toContain(E.theirs);
    expect(m.totals.grossBaseMinor).toBe(200_000);
    // the other partner sees only theirs
    const b = await money.myProjectMoney(await as(ids.b));
    expect(b.rows.map((r) => r.name)).toEqual(["Theirs"]);
    expect(b.totals).toMatchObject({ grossBaseMinor: 500_000, deductionsBaseMinor: 50_000, netBaseMinor: 450_000 });
  });

  it("isn't available to staff or an employee-less stranger", async () => {
    await expect(money.myProjectMoney(await as(ids.staff))).rejects.toThrow(/permission/i);
    await expect(money.adminProjectMoney(await as(ids.a))).rejects.toThrow();
  });

  it("an admin sees everything they're allowed to, and can narrow by stream or partner", async () => {
    const owner = await money.adminProjectMoney(await as(ids.owner));
    expect(owner.rows.map((r) => r.name).sort()).toEqual(["Mine", "Secret", "Theirs"].sort());
    const admin = await money.adminProjectMoney(await as(ids.admin));
    expect(admin.rows.map((r) => r.name)).not.toContain("Secret");
    const fiverr = await money.adminProjectMoney(await as(ids.owner), { stream: S.fiverr });
    expect(fiverr.rows.map((r) => r.name)).toEqual(["Theirs"]);
    const byPartner = await money.adminProjectMoney(await as(ids.owner), { partner: ids.a });
    expect(byPartner.rows.map((r) => r.name).sort()).toEqual(["Mine", "Secret"]);
    expect(byPartner.options.partners.map((p) => p.id).sort()).toEqual([ids.a, ids.b].sort());
  });

  it("income outside the chosen dates isn't counted", async () => {
    const m = await money.myProjectMoney(await as(ids.a), { from: "2020-01-01", to: "2020-01-31" });
    expect(m.totals).toMatchObject({ grossBaseMinor: 0, netBaseMinor: 0, profitBaseMinor: 0 });
  });
});

describe("tagging an expense to a project", () => {
  it("a partner can tag only a project in their own stream, and the stream must match", async () => {
    const a = await as(ids.a);
    const base = { expenseDate: today(), category: "Software", vendor: "Laptop", amount: "10", currency: "AUD", fxRate: "1", streamId: S.upwork, countryCode: "GB" };
    await expect(pw.createMyExpense(a, { ...base, projectId: P.mine })).resolves.toBeTruthy();
    expect(await msg(pw.createMyExpense(a, { ...base, projectId: P.theirs }))).toBe("That no longer exists.");
    expect(await msg(pw.createMyExpense(a, { ...base, projectId: P.hidden }))).toBe("That no longer exists.");
  });

  it("an admin's expense takes the project's stream, and a different stream is refused", async () => {
    const owner = await as(ids.owner);
    const base = { expenseDate: today(), category: "Software", vendor: "V", amount: "10", currency: "AUD", fxRate: "1" };
    const id = (await fin.createExpense(owner, { ...base, projectId: P.theirs })) as unknown;
    const row = (await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, typeof id === "string" ? id : (id as { id: string }).id)))[0];
    expect(row).toMatchObject({ projectId: P.theirs, streamId: S.fiverr });
    expect(await msg(fin.createExpense(owner, { ...base, projectId: P.mine, streamId: S.fiverr }))).toMatch(/different stream/i);
    expect(await msg(fin.createExpense(owner, { ...base, projectId: crypto.randomUUID() }))).toMatch(/choose a project/i);
  });
});
