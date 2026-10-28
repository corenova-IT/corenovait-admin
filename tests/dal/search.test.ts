import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, todayIn } from "@/lib/dates";
import { actorFor, createPerson, seedStreamCountry, setupTestDatabase } from "./db";

/** Phase 6: the top-bar search only looks in pages, and rows, the person can see. */
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let search: typeof import("@/lib/dal/search");
let ids: { admin: string; a: string; b: string };
const as = (id: string) => actorFor(t, id);
const groupIds = async (id: string, q = "zephyr") => (await search.searchEverything(await as(id), q)).groups.map((g) => g.id).sort();
const titles = async (id: string, group: string) => (await search.searchEverything(await as(id), "zephyr")).groups.find((g) => g.id === group)?.hits.map((h) => h.title).sort() ?? [];

beforeAll(async () => {
  t = await setupTestDatabase();
  search = await import("@/lib/dal/search");
  const [fin, pay, tk, cal, chat] = await Promise.all([import("@/lib/dal/finance"), import("@/lib/dal/payments"), import("@/lib/dal/tasks"), import("@/lib/dal/calendar"), import("@/lib/dal/chat")]);
  ids = {
    admin: (await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true })).id,
    a: (await createPerson(t, { email: "a@example.test" })).id,
    b: (await createPerson(t, { email: "b@example.test" })).id,
  };
  const admin = await as(ids.admin);
  const { streamId, countryCode } = await seedStreamCountry(t);
  await fin.createIncome(admin, { entryDate: "2026-09-15", streamId, countryCode, client: "Zephyr Dental", amount: "1000.00", currency: "GBP", fxRate: "1.95", status: "paid" });
  await fin.createExpense(admin, { expenseDate: "2026-09-01", category: "Software", vendor: "Zephyr Hosting", amount: "50", currency: "AUD" });
  await pay.saveSubscription(admin, null, { vendor: "Zephyr Cloud", category: "Hosting", amount: "19.00", currency: "AUD", billingCycle: "monthly", nextDueDate: addDays(todayIn("Australia/Sydney"), 3), reminderDays: 5 });
  await tk.createTask(admin, { title: "Zephyr onboarding", assigneeId: ids.a });
  await tk.createTask(admin, { title: "Zephyr pricing (admins only)" });
  await cal.createEvent(admin, { title: "Zephyr kick-off", type: "meeting", start: "2026-11-02T10:00", end: "2026-11-02T11:00", attendeeIds: [ids.a] });
  await cal.createEvent(admin, { title: "Zephyr board review", type: "meeting", start: "2026-11-03T10:00", end: "2026-11-03T11:00" });
  // #general for everyone, and a DM between the admin and Blair that Alex must never find
  const general = (await chat.myConversations(admin)).find((c) => c.label === "#general")!.id;
  await chat.myConversations(await as(ids.a));
  await chat.sendMessage(admin, general, "Zephyr launch is on Monday");
  const dm = await chat.openDirectMessage(admin, ids.b);
  await chat.sendMessage(admin, dm, "Zephyr salary review, keep this between us");
});
afterAll(() => t?.cleanup());

describe("top-bar search", () => {
  it("staff get results only from pages they can open: no finance, payments, people or audit log", async () => {
    expect(await groupIds(ids.a)).toEqual(["calendar", "chat", "tasks"]);
    expect(await groupIds(ids.admin)).toEqual(["calendar", "chat", "expenses", "income", "payments", "tasks"]);
  });

  it("follows each page's scope: staff find their own tasks and events only", async () => {
    expect(await titles(ids.a, "tasks")).toEqual(["Zephyr onboarding"]);
    expect(await titles(ids.a, "calendar")).toEqual(["Zephyr kick-off"]);
    expect(await titles(ids.admin, "tasks")).toEqual(["Zephyr onboarding", "Zephyr pricing (admins only)"]);
  });

  it("chat: only conversations you're in, so nobody finds someone else's direct messages", async () => {
    const forA = (await search.searchEverything(await as(ids.a), "zephyr")).groups.find((g) => g.id === "chat")!.hits;
    expect(forA.map((h) => h.detail)).toEqual(["Zephyr launch is on Monday"]);
    expect((await search.searchEverything(await as(ids.a), "salary")).groups).toEqual([]);
    const forB = (await search.searchEverything(await as(ids.b), "salary")).groups.find((g) => g.id === "chat")!.hits;
    expect(forB[0].title).toMatch(/in Direct message with/);
  });

  it("people and the audit log are only searched for those who can open those pages", async () => {
    expect(await groupIds(ids.admin, "b@example")).toContain("team");
    expect(await groupIds(ids.a, "b@example")).not.toContain("team");
    expect(await groupIds(ids.admin, "admin@example")).toContain("audit");
    expect(await groupIds(ids.a, "admin@example")).toEqual([]);
  });

  it("ignores one-letter searches and treats % and _ as plain text", async () => {
    expect((await search.searchEverything(await as(ids.admin), "z")).groups).toEqual([]);
    expect((await search.searchEverything(await as(ids.admin), "%%")).groups).toEqual([]);
    expect((await search.searchEverything(await as(ids.admin), "__")).groups).toEqual([]);
  });
});
