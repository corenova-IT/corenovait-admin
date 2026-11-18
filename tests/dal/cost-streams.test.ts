import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/** An admin can file an expense or subscription under a stream; "mark as paid" keeps the stream. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let admin: Awaited<ReturnType<typeof actorFor>>;
let fin: typeof import("@/lib/dal/finance");
let pay: typeof import("@/lib/dal/payments");
let streamId: number;
let otherStream: number;

const expense = (over: Record<string, unknown> = {}) => ({ expenseDate: "2026-10-01", category: "Software", vendor: "V", amount: "10", currency: "AUD", fxRate: "1", ...over });
const sub = (over: Record<string, unknown> = {}) => ({ vendor: "Tool", category: "Software", amount: "20", currency: "AUD", fxRate: "1", billingCycle: "monthly" as const, nextDueDate: "2026-10-05", ...over });
const expenseRow = async (id: string) => (await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, id)))[0];
const subRow = async (id: string) => (await t.db.select().from(t.schema.subscriptions).where(eq(t.schema.subscriptions.id, id)))[0];

beforeAll(async () => {
  t = await setupTestDatabase();
  fin = await import("@/lib/dal/finance");
  pay = await import("@/lib/dal/payments");
  admin = await actorFor(t, (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id);
  const rows = await t.db.select().from(t.schema.streams);
  streamId = rows.find((r) => r.name === "Upwork")!.id;
  otherStream = rows.find((r) => r.name === "Fiverr")!.id;
});
afterAll(() => t?.cleanup());

describe("expenses and streams", () => {
  it("are company-wide (no stream) unless a stream is chosen", async () => {
    const plain = await fin.createExpense(admin, expense());
    expect((await expenseRow(plain)).streamId).toBeNull();
    const blank = await fin.createExpense(admin, expense({ streamId: "" }));
    expect((await expenseRow(blank)).streamId).toBeNull();
    const filed = await fin.createExpense(admin, expense({ streamId: String(streamId), countryCode: "GB" }));
    expect((await expenseRow(filed)).streamId).toBe(streamId);
  });

  it("refuse a stream that doesn't exist", async () => {
    await expect(fin.createExpense(admin, expense({ streamId: 99999 }))).rejects.toThrow(/choose a stream/i);
  });

  it("keep their stream when an edit doesn't mention it, change it when asked, and clear it when blank", async () => {
    const id = await fin.createExpense(admin, expense({ streamId, countryCode: "GB" }));
    await fin.updateExpense(admin, id, expense({ vendor: "Renamed", countryCode: "GB" }));
    expect((await expenseRow(id)).streamId).toBe(streamId);
    await fin.updateExpense(admin, id, expense({ streamId: otherStream, countryCode: "GB" }));
    expect((await expenseRow(id)).streamId).toBe(otherStream);
    await fin.updateExpense(admin, id, expense({ streamId: "", countryCode: "GB" }));
    expect((await expenseRow(id)).streamId).toBeNull();
  });

  it("record the change in the audit log", async () => {
    const id = await fin.createExpense(admin, expense({ streamId }));
    await fin.updateExpense(admin, id, expense({ streamId: otherStream }));
    const rows = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id));
    const update = rows.find((r) => r.action === "update")!;
    expect((update.before as { streamId: number }).streamId).toBe(streamId);
    expect((update.after as { streamId: number }).streamId).toBe(otherStream);
  });
});

describe("subscriptions and streams", () => {
  it("can be filed under a stream, and paying one files the expense under the same stream and country", async () => {
    const id = await pay.saveSubscription(admin, null, sub({ streamId, countryCode: "GB" }));
    expect((await subRow(id)).streamId).toBe(streamId);
    const { expenseId } = await pay.markSubscriptionPaid(admin, id, { paidDate: "2026-10-05" });
    const paid = await expenseRow(expenseId);
    expect(paid.streamId).toBe(streamId);
    expect(paid.countryCode).toBe("GB");
  });

  it("stay as they are when an edit leaves the stream out, and refuse a bad stream", async () => {
    const id = await pay.saveSubscription(admin, null, sub({ streamId }));
    await pay.saveSubscription(admin, id, sub({ vendor: "Renamed" }));
    expect((await subRow(id)).streamId).toBe(streamId);
    await expect(pay.saveSubscription(admin, id, sub({ streamId: 99999 }))).rejects.toThrow(/choose a stream/i);
    const company = await pay.saveSubscription(admin, null, sub());
    expect((await subRow(company)).streamId).toBeNull();
  });
});
