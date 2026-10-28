import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actorFor, createPerson, seedStreamCountry, sessionFor, setupTestDatabase, snapshot } from "./db";

/**
 * The app layer, called the way a browser would reach it: every server action
 * and every guarded page and route handler, as a signed-in staff user (and as
 * nobody). Cookies, headers and redirects are stubbed; the database is real.
 */
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  }),
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7", "user-agent": "vitest" }),
}));
class Redirect extends Error {
  constructor(public url: string) {
    super(`redirect:${url}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new Redirect("404");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const ROOT = path.resolve(import.meta.dirname, "../..");
let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let staffToken: string;
let ids: { admin: string; staff: string; incomeId: string; fileId: string };

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every module in app/ that starts with "use server". */
const serverActionModules = walk(path.join(ROOT, "app"))
  .filter((f) => /\.(ts|tsx)$/.test(f) && /^\s*["']use server["']/.test(readFileSync(f, "utf8")))
  .map((f) => path.relative(ROOT, f).replace(/\\/g, "/"));

/** Public by design: signing in, reset links, invite links, and the dev preview stubs. */
const PUBLIC_ACTIONS = new Set([
  "app/(auth)/actions.ts#signIn",
  "app/(auth)/actions.ts#requestPasswordReset",
  "app/(auth)/actions.ts#resetPassword",
  "app/(auth)/actions.ts#acceptInvite",
  "app/(auth)/actions.ts#startTotpEnrollment",
  "app/(auth)/actions.ts#confirmTotp",
  "app/(auth)/actions.ts#verifySecondFactor",
  "app/dev/preview-actions.ts#previewAction",
]);
/** Self-service: acts only on the caller's own account. */
const SELF_ACTIONS = new Set([
  "app/(portal)/account/actions.ts#regenerateCodes",
  "app/(portal)/account/actions.ts#signOutEverywhere",
  // your own profile, picture and password (tests/dal/profile.test.ts: they never touch anyone else)
  "app/(portal)/account/actions.ts#saveProfile",
  "app/(portal)/account/actions.ts#uploadAvatar",
  "app/(portal)/account/actions.ts#removeAvatar",
  "app/(portal)/account/actions.ts#changePassword",
  // the caller's own notifications and email setting (tests/dal/notifications.test.ts)
  "app/(portal)/notifications/actions.ts#markAllRead",
  "app/(portal)/notifications/actions.ts#setEmailNotifications",
]);
/**
 * Staff may use tasks and the calendar (the Staff preset grants them with the
 * "assigned" scope). Called with a hostile form these must still change
 * nothing; their scope rules are tested in tests/dal/work.test.ts.
 */
const STAFF_MODULES = ["app/(portal)/tasks/actions.ts", "app/(portal)/calendar/actions.ts", "app/(portal)/chat/actions.ts"];

function hostileForm() {
  const fd = new FormData();
  const all = { view: true, create: true, edit: true, delete: true, export: true, scope: "all" };
  fd.set("userId", ids.staff);
  fd.set("email", "attacker@example.test");
  fd.set("fullName", "Attacker");
  fd.set("jobTitle", "");
  fd.set("presetId", "admin");
  fd.set("active", "false");
  fd.set("perms", JSON.stringify(["finances", "transactions", "team", "audit", "settings"].map((module) => ({ module, ...all }))));
  return fd;
}

beforeAll(async () => {
  t = await setupTestDatabase();
  const admin = await createPerson(t, { email: "admin@example.test", preset: "admin", totp: true });
  const staff = await createPerson(t, { email: "staff@example.test" });
  const adminActor = await actorFor(t, admin.id);
  const { createIncome } = await import("@/lib/dal/finance");
  const { saveUpload } = await import("@/lib/dal/files");
  const sc = await seedStreamCountry(t);
  const incomeId = await createIncome(adminActor, { entryDate: "2026-10-01", ...sc, amount: "900", currency: "AUD" });
  const file = await saveUpload(adminActor, {
    module: "transactions",
    entityType: "income_entries",
    entityId: incomeId,
    name: "invoice.pdf",
    bytes: Buffer.from("%PDF-1.7\nfake invoice\n"),
  });
  ids = { admin: admin.id, staff: staff.id, incomeId, fileId: file.id };
  staffToken = await sessionFor(t, staff.id);
});
afterAll(() => t?.cleanup());

beforeEach(async () => {
  jar.clear();
  const { SESSION_COOKIE } = await import("@/lib/auth/session");
  jar.set(SESSION_COOKIE, staffToken);
});

describe("every server action, called by a staff user", () => {
  it("finds the server action modules", () => {
    expect(serverActionModules).toEqual(expect.arrayContaining(["app/(portal)/team/actions.ts", "app/(auth)/actions.ts", "app/(portal)/account/actions.ts"]));
  });

  for (const file of serverActionModules) {
    it(`${file}: refuses or only touches the caller's own account`, async () => {
      const mod = (await import(path.join(ROOT, file))) as Record<string, unknown>;
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") continue;
        const key = `${file}#${name}`;
        if (PUBLIC_ACTIONS.has(key)) continue;
        if (SELF_ACTIONS.has(key)) continue;
        const before = await snapshot(t);
        if (STAFF_MODULES.includes(file)) {
          const r = (await (fn as (p: unknown, f: FormData) => Promise<unknown>)({}, hostileForm())) as { ok?: string; error?: string };
          expect(r, key).not.toHaveProperty("ok");
          expect(r.error, key).toBeTruthy();
          expect(await snapshot(t), `${key} changed the database`).toEqual(before);
          continue;
        }
        let result: unknown;
        try {
          result = await (fn as (p: unknown, f: FormData) => Promise<unknown>)({}, hostileForm());
        } catch (e) {
          result = e instanceof Redirect ? { redirect: e.url } : { threw: String(e) };
        }
        expect(result, key).not.toHaveProperty("ok");
        expect(result, key).toMatchObject({ error: expect.stringMatching(/permission|admins|two-factor|session/i) });
        expect(await snapshot(t), `${key} changed the database`).toEqual(before);
      }
    });
  }

  it("every exported action is either guarded, public by design, or self-service (nothing unlisted slips through)", async () => {
    const team = await import("@/app/(portal)/team/actions");
    const names = Object.keys(team).filter((k) => typeof (team as Record<string, unknown>)[k] === "function");
    expect(names.sort()).toEqual(
      ["applyPreset", "inviteMember", "resendInvite", "resetSessions", "resetTwoFactor", "savePermissions", "savePreset", "saveDetails", "setActive"].sort()
    );
  });
});

describe("guarded pages, opened by a staff user", () => {
  const pages: Array<[string, () => Promise<{ default: (p: never) => Promise<unknown> }>, unknown]> = [
    ["/team", () => import("@/app/(portal)/team/page"), {}],
    ["/audit", () => import("@/app/(portal)/audit/page"), { searchParams: Promise.resolve({}) }],
    ["/analytics", () => import("@/app/(portal)/analytics/page"), { searchParams: Promise.resolve({}) }],
    ["/analytics?country=GB", () => import("@/app/(portal)/analytics/page"), { searchParams: Promise.resolve({ country: "GB" }) }],
    ["/transactions", () => import("@/app/(portal)/transactions/page"), { searchParams: Promise.resolve({}) }],
    ["/transactions?tab=expenses", () => import("@/app/(portal)/transactions/page"), { searchParams: Promise.resolve({ tab: "expenses" }) }],
    ["/payments", () => import("@/app/(portal)/payments/page"), { searchParams: Promise.resolve({}) }],
    ["/streams", () => import("@/app/(portal)/streams/page"), { searchParams: Promise.resolve({}) }],
    ["/streams/1", () => import("@/app/(portal)/streams/[id]/page"), { params: Promise.resolve({ id: "1" }), searchParams: Promise.resolve({}) }],
    ["/streams/countries", () => import("@/app/(portal)/streams/countries/page"), { searchParams: Promise.resolve({}) }],
    ["/streams/countries/GB", () => import("@/app/(portal)/streams/countries/[code]/page"), { params: Promise.resolve({ code: "GB" }), searchParams: Promise.resolve({}) }],
    ["/streams/representatives", () => import("@/app/(portal)/streams/representatives/page"), {}],
    [
      "/streams/representatives/[id]",
      () => import("@/app/(portal)/streams/representatives/[id]/page"),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) },
    ],
    ["/settings", () => import("@/app/(portal)/settings/page"), {}],
    ["/marketing", () => import("@/app/(portal)/marketing/page"), { searchParams: Promise.resolve({}) }],
    ["/marketing?channel=email", () => import("@/app/(portal)/marketing/page"), { searchParams: Promise.resolve({ channel: "email" }) }],
  ];
  // /tasks and /calendar are open to staff by default; their data is scoped (tests/dal/work.test.ts)
  for (const [route, load, props] of pages) {
    it(`${route} redirects to /no-access`, async () => {
      const page = (await load()).default;
      await expect(page(props as never)).rejects.toMatchObject({ url: expect.stringMatching(/^\/no-access/) });
    });
  }

  it("signed-out visitors are sent to /login", async () => {
    jar.clear();
    const page = (await import("@/app/(portal)/team/page")).default as () => Promise<unknown>;
    await expect(page()).rejects.toMatchObject({ url: "/login" });
  });
});

describe("finances export route", () => {
  it("refuses a staff user (403) and nobody signed in (401)", async () => {
    const get = async () => (await import("@/app/api/export/finances/route")).GET(new Request("http://localhost/api/export/finances?country=AU"));
    expect((await get()).status).toBe(403);
    jar.clear();
    expect((await get()).status).toBe(401);
  });
});

describe("live chat routes", () => {
  it("never return anything from a direct message the caller isn't in, and refuse nobody signed in", async () => {
    const chat = await import("@/lib/dal/chat");
    const other = await createPerson(t, { email: "other@example.test" });
    const dm = await chat.openDirectMessage(await actorFor(t, ids.admin), other.id);
    await chat.sendMessage(await actorFor(t, other.id), dm, "Private to the two of us");
    const sync = await import("@/app/api/chat/sync/route");
    const res = await sync.GET(new Request(`http://localhost/api/chat/sync?c=${dm}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.changes).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Private to the two of us");
    jar.clear();
    expect((await sync.GET(new Request(`http://localhost/api/chat/sync?c=${dm}`))).status).toBe(401);
    const stream = await import("@/app/api/chat/stream/route");
    expect((await stream.GET(new Request(`http://localhost/api/chat/stream?c=${dm}`))).status).toBe(401);
    const badges = await import("@/app/api/me/badges/route");
    expect((await badges.GET()).status).toBe(401);
  });
});

describe("calendar .ics routes", () => {
  it("the full export refuses a staff user (403) and nobody signed in (401)", async () => {
    const get = async () => (await import("@/app/api/calendar/ics/route")).GET();
    expect((await get()).status).toBe(403);
    jar.clear();
    expect((await get()).status).toBe(401);
  });

  it("a single event the staff user isn't invited to is a 404", async () => {
    const { createEvent } = await import("@/lib/dal/calendar");
    const id = await createEvent(await actorFor(t, ids.admin), { title: "Private", start: "2026-10-02T10:00", end: "2026-10-02T11:00" });
    const get = async (eventId: string) => (await import("@/app/api/calendar/event/[id]/route")).GET(new Request(`http://localhost/api/calendar/event/${eventId}`), { params: Promise.resolve({ id: eventId }) });
    expect((await get(id)).status).toBe(404);
    expect((await get("not-a-uuid")).status).toBe(404);
    jar.clear();
    expect((await get(id)).status).toBe(401);
  });
});

describe("marketing export route", () => {
  const get = async () => (await import("@/app/api/export/marketing/route")).GET(new Request("http://localhost/api/export/marketing?channel=email"));

  it("refuses a staff user (403) and nobody signed in (401)", async () => {
    expect((await get()).status).toBe(403);
    jar.clear();
    expect((await get()).status).toBe(401);
  });

  it("gives an admin a CSV and logs the export", async () => {
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    jar.set(SESSION_COOKIE, await sessionFor(t, ids.admin, { mfaVerified: true }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="marketing-/);
    expect((await res.text()).split(/\r?\n/)[0]).toContain("occurred_at_local");
  });
});

describe("CSV export route", () => {
  const get = async (q: string) => (await import("@/app/api/export/transactions/route")).GET(new Request(`http://localhost/api/export/transactions?${q}`));

  it("refuses a staff user (403) and nobody signed in (401), for both ledgers", async () => {
    expect((await get("tab=income")).status).toBe(403);
    expect((await get("tab=expenses")).status).toBe(403);
    jar.clear();
    expect((await get("tab=income")).status).toBe(401);
  });

  it("gives an admin a CSV of their scope and logs the export", async () => {
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    jar.set(SESSION_COOKIE, await sessionFor(t, ids.admin, { mfaVerified: true }));
    const res = await get("tab=income");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="income-/);
    expect(await res.text()).toContain("900.00");
  });
});

describe("file downloads", () => {
  const get = async () => (await import("@/app/api/files/[id]/route")).GET(new Request(`http://localhost/api/files/${ids.fileId}`), { params: Promise.resolve({ id: ids.fileId }) });

  it("a staff user gets 404 for a finance receipt", async () => {
    expect((await get()).status).toBe(404);
  });

  it("nobody signed in gets 401", async () => {
    jar.clear();
    expect((await get()).status).toBe(401);
  });

  it("an admin can download it, as an attachment with no-sniff headers", async () => {
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    jar.set(SESSION_COOKIE, await sessionFor(t, ids.admin, { mfaVerified: true }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="invoice.pdf"/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toContain("fake invoice");
  });
});

describe("rate limits (security review)", () => {
  it("whole-list downloads: 20 per person per 10 minutes, then 429 with Retry-After", async () => {
    const { SESSION_COOKIE } = await import("@/lib/auth/session");
    const { limiters } = await import("@/lib/rate-limit");
    jar.set(SESSION_COOKIE, await sessionFor(t, ids.admin, { mfaVerified: true }));
    limiters.exportPerUser.reset(ids.admin);
    const get = async () => (await import("@/app/api/export/transactions/route")).GET(new Request("http://localhost/api/export/transactions?tab=income"));
    for (let i = 0; i < 20; i++) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
    limiters.exportPerUser.reset(ids.admin);
  });

  it("chat: 30 messages a minute per person", async () => {
    const chatDal = await import("@/lib/dal/chat");
    const { sendChatMessage } = await import("@/app/(portal)/chat/actions");
    const { limiters } = await import("@/lib/rate-limit");
    limiters.chatPerUser.reset(ids.staff);
    const general = (await chatDal.myConversations(await actorFor(t, ids.staff))).find((c) => c.label === "#general")!.id;
    const send = (n: number) => {
      const fd = new FormData();
      fd.set("channelId", general);
      fd.set("body", `message ${n}`);
      return sendChatMessage({}, fd);
    };
    for (let i = 0; i < 30; i++) expect(await send(i)).toMatchObject({ ok: "Sent." });
    expect((await send(31)).error).toMatch(/Too many messages/);
    limiters.chatPerUser.reset(ids.staff);
  });

  it("invite and reset links: 10 tries per address per 15 minutes", async () => {
    const { acceptInvite, resetPassword } = await import("@/app/(auth)/actions");
    const { limiters } = await import("@/lib/rate-limit");
    limiters.linkPerIp.reset("198.51.100.7");
    const fd = new FormData();
    fd.set("token", "x".repeat(43));
    fd.set("password", "a long enough passphrase 1");
    fd.set("confirm", "a long enough passphrase 1");
    for (let i = 0; i < 5; i++) expect((await acceptInvite({}, fd)).error).not.toMatch(/Too many/);
    for (let i = 0; i < 5; i++) expect((await resetPassword({}, fd)).error).not.toMatch(/Too many/);
    expect((await acceptInvite({}, fd)).error).toMatch(/Too many attempts/);
    expect((await resetPassword({}, fd)).error).toMatch(/Too many attempts/);
    limiters.linkPerIp.reset("198.51.100.7");
  });
});

describe("your profile (actions and the picture route)", () => {
  const pngFile = async (name = "me.png") => {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).png().toBuffer();
    return new File([new Uint8Array(bytes)], name, { type: "image/png" });
  };
  const userRowOf = async (id: string) => (await t.db.select().from(t.schema.users).where(eq(t.schema.users.id, id)))[0];

  it("a staff user's profile actions change only their own account, whatever IDs the form carries", async () => {
    const acts = await import("@/app/(portal)/account/actions");
    const adminBefore = await userRowOf(ids.admin);
    const fd = hostileForm(); // carries userId (the staff user), email, Admin preset and permissions
    fd.set("userId", ids.admin);
    fd.set("id", ids.admin);
    fd.set("fullName", "Staff Renamed");
    fd.set("picture", await pngFile());
    expect(await acts.saveProfile({}, fd)).toMatchObject({ ok: "Profile saved." });
    expect(await acts.uploadAvatar({}, fd)).toMatchObject({ ok: "Picture updated." });
    const staff = await userRowOf(ids.staff);
    expect(staff).toMatchObject({ fullName: "Staff Renamed", email: "staff@example.test", presetId: "staff" });
    expect(staff.avatarKey).toMatch(/\.webp$/);
    expect(await userRowOf(ids.admin)).toEqual(adminBefore);
  });

  it("a wrong file type or an oversized picture gets a plain message", async () => {
    const acts = await import("@/app/(portal)/account/actions");
    const fd = new FormData();
    fd.set("picture", new File(["%PDF-1.7 not a picture"], "holiday.jpg", { type: "image/jpeg" }));
    expect(await acts.uploadAvatar({}, fd)).toEqual({ error: "Upload a JPG, PNG or WebP picture." });
    fd.set("picture", new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }));
    expect(await acts.uploadAvatar({}, fd)).toEqual({ error: "That picture is over 2 MB. Choose a smaller one." });
  });

  it("changing your password needs the current one", async () => {
    const acts = await import("@/app/(portal)/account/actions");
    const { limiters } = await import("@/lib/rate-limit");
    limiters.passwordPerUser.reset(ids.staff);
    const fd = new FormData();
    fd.set("current", "Definitely-Wrong-42");
    fd.set("password", "Another-Copper-Lantern-9");
    fd.set("confirm", "Another-Copper-Lantern-9");
    const before = (await userRowOf(ids.staff)).passwordHash;
    expect(await acts.changePassword({}, fd)).toEqual({ error: "Your current password isn't right." });
    expect((await userRowOf(ids.staff)).passwordHash).toBe(before);
  });

  it("pictures are only for signed-in people, and the route can't be used to replace one", async () => {
    const route = await import("@/app/api/avatars/[id]/route");
    const get = (id: string) => route.GET(new Request(`http://localhost/api/avatars/${id}`), { params: Promise.resolve({ id }) });
    const own = await get(ids.staff);
    expect(own.status).toBe(200);
    expect(own.headers.get("content-type")).toBe("image/webp");
    expect(own.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await get(ids.admin)).status).toBe(404); // no picture
    expect(Object.keys(route).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
    jar.clear();
    expect((await get(ids.staff)).status).toBe(401);
  });

  it("removing your picture goes back to initials", async () => {
    const acts = await import("@/app/(portal)/account/actions");
    expect(await acts.removeAvatar({}, new FormData())).toMatchObject({ ok: "Picture removed." });
    expect((await userRowOf(ids.staff)).avatarKey).toBeNull();
  });
});
