import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todayIn } from "@/lib/dates";
import { simplePdf } from "@/lib/pdf";
import { actorFor, createPerson, setupTestDatabase } from "./db";

/**
 * Documents on a partner's expenses: an invoice or receipt they upload, and a simple bill they can have made.
 * Only that partner and admins who can see transactions can download them; everyone else gets "not found".
 */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let pw: typeof import("@/lib/dal/partner-writes");
let files: typeof import("@/lib/dal/files");
let assign: typeof import("@/lib/dal/assignments");
let proj: typeof import("@/lib/dal/projects");
let fin: typeof import("@/lib/dal/finance");
let ids: Record<"owner" | "admin" | "a" | "b" | "staff", string>;
let S: Record<"upwork" | "fiverr", number>;
let hiddenProject: string;

const as = (id: string) => actorFor(t, id);
const today = () => todayIn("Australia/Sydney");
const msg = async (p: Promise<unknown>) => ((await p.then(() => null, (e: Error) => e)) as Error | null)?.message;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake image body")]);
const expense = async (id: string) => (await t.db.select().from(t.schema.expenses).where(eq(t.schema.expenses.id, id)))[0];
const base = () => ({ expenseDate: today(), category: "Software", vendor: "Laptop shop", description: "Laptop", amount: "1200", currency: "AUD", fxRate: "1", streamId: S.upwork, countryCode: "GB" });

beforeAll(async () => {
  t = await setupTestDatabase();
  pw = await import("@/lib/dal/partner-writes");
  files = await import("@/lib/dal/files");
  assign = await import("@/lib/dal/assignments");
  proj = await import("@/lib/dal/projects");
  fin = await import("@/lib/dal/finance");
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
  hiddenProject = await proj.createProject(owner, { streamId: S.upwork, name: "Secret" });
  await proj.setProjectHidden(owner, { projectId: hiddenProject, userId: ids.admin, hidden: true });
});
afterAll(() => t?.cleanup());

describe("a document on an expense", () => {
  it("is stored with the expense, downloadable by that partner and by an admin, and nobody else", async () => {
    const a = await as(ids.a);
    const id = await pw.createMyExpense(a, base(), { name: "Receipt 1.png", bytes: png });
    const row = await expense(id);
    expect(row.receiptFileId).toBeTruthy();
    const meta = (await t.db.select().from(t.schema.files).where(eq(t.schema.files.id, row.receiptFileId!)))[0];
    expect(meta).toMatchObject({ module: "stream_partner", entityType: "expenses", entityId: id, mimeType: "image/png", uploadedBy: ids.a });

    const got = await files.getFileForDownload(a, row.receiptFileId!);
    expect(got?.bytes.equals(png)).toBe(true);
    expect(await files.getFileForDownload(await as(ids.owner), row.receiptFileId!)).not.toBeNull();
    expect(await files.getFileForDownload(await as(ids.admin), row.receiptFileId!)).not.toBeNull();
    // another partner, staff, and an unknown id all look the same: nothing
    expect(await files.getFileForDownload(await as(ids.b), row.receiptFileId!)).toBeNull();
    expect(await files.getFileForDownload(await as(ids.staff), row.receiptFileId!)).toBeNull();
    expect(await files.getFileForDownload(a, crypto.randomUUID())).toBeNull();
  });

  it("is hidden from an admin when the expense is on a project the Owner hid from them", async () => {
    const owner = await as(ids.owner);
    const id = await fin.createExpense(owner, { ...base(), amount: "10", projectId: hiddenProject }, { name: "r.png", bytes: png });
    const fileId = (await expense(id)).receiptFileId;
    expect(fileId).toBeTruthy();
    expect(await files.getFileForDownload(owner, fileId!)).not.toBeNull();
    expect(await files.getFileForDownload(await as(ids.admin), fileId!)).toBeNull();
    // the cost itself is hidden from that admin too: not in their ledger, not openable, not taggable
    const admin = await as(ids.admin);
    expect(JSON.stringify(await fin.listExpenses(admin))).not.toContain(id);
    expect(JSON.stringify(await fin.listExpenses(owner))).toContain(id);
    expect(await msg(fin.createExpense(admin, { ...base(), amount: "5", projectId: hiddenProject }))).toMatch(/choose a project/i);
  });

  it("refuses files that aren't a PDF or image, and empty ones, with plain messages", async () => {
    const a = await as(ids.a);
    expect(await msg(pw.createMyExpense(a, base(), { name: "x.exe", bytes: Buffer.from("MZ not allowed") }))).toMatch(/PDF, PNG, JPG or WebP/);
    expect(await msg(pw.createMyExpense(a, base(), { name: "x.png", bytes: Buffer.alloc(0) }))).toMatch(/empty/);
  });

  it("can be added when editing, and only to their own expense", async () => {
    const a = await as(ids.a);
    const id = await pw.createMyExpense(a, base());
    expect((await expense(id)).receiptFileId).toBeNull();
    await pw.updateMyExpense(a, id, base(), { name: "later.png", bytes: png });
    expect((await expense(id)).receiptFileId).toBeTruthy();
    const b = await as(ids.b);
    expect(await msg(pw.updateMyExpense(b, id, { ...base(), streamId: S.fiverr, countryCode: "AU" }, { name: "x.png", bytes: png }))).toBe("That no longer exists.");
  });

  it("stops being served once the expense is archived (the file and record are kept)", async () => {
    const a = await as(ids.a);
    const id = await pw.createMyExpense(a, base(), { name: "r.png", bytes: png });
    const fileId = (await expense(id)).receiptFileId!;
    await pw.archiveMyExpense(a, id);
    expect(await files.getFileForDownload(a, fileId)).toBeNull();
    expect((await t.db.select().from(t.schema.files).where(eq(t.schema.files.id, fileId))).length).toBe(1);
  });
});

describe("a generated bill", () => {
  it("is a real PDF with the company name, a bill number, the date and the amount, attached and logged", async () => {
    const a = await as(ids.a);
    const id = await pw.createMyExpense(a, { ...base(), vendor: "Office (Sydney) \\ Co", description: "Desk" });
    const r = await pw.generateMyExpenseBill(a, id);
    expect(r.billNumber).toMatch(/^BILL-\d{8}-[0-9A-F]{6}$/);
    const row = await expense(id);
    expect(row.receiptFileId).toBe(r.fileId);
    const got = await files.getFileForDownload(a, r.fileId);
    expect(got).toMatchObject({ mimeType: "application/pdf", name: `${r.billNumber}.pdf` });
    const text = got!.bytes.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("CoreNovaIT");
    expect(text).toContain(r.billNumber);
    expect(text).toContain(today());
    expect(text).toMatch(/1,200.00/);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const log = (await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.entityId, id))).find((x) => /Generated a bill/.test(x.summary ?? ""));
    expect(log).toBeTruthy();
  });

  it("can only be made for their own, un-archived expense", async () => {
    const a = await as(ids.a);
    const id = await pw.createMyExpense(a, base());
    expect(await msg(pw.generateMyExpenseBill(await as(ids.b), id))).toBe("That no longer exists.");
    await pw.archiveMyExpense(a, id);
    expect(await msg(pw.generateMyExpenseBill(a, id))).toBe("That no longer exists.");
    await expect(pw.generateMyExpenseBill(await as(ids.staff), id)).rejects.toThrow();
  });

  it("the PDF writer escapes brackets and non-Latin text and keeps a correct cross-reference table", () => {
    const bytes = simplePdf([{ text: "A (b) \\ c 中", y: 700 }]);
    const s = bytes.toString("latin1");
    expect(s).toContain("(A \\(b\\) \\\\ c ?)");
    const start = Number(/startxref\n(\d+)\n/.exec(s)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const offsets = [...s.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  });
});
