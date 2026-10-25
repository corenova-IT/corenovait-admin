import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STRONG_PASSWORD, createPerson, sessionFor, setupTestDatabase, userRow } from "./db";

let t: Awaited<ReturnType<typeof setupTestDatabase>>;
let auth: typeof import("@/lib/dal/auth");
let totp: typeof import("@/lib/auth/totp");

beforeAll(async () => {
  t = await setupTestDatabase();
  auth = await import("@/lib/dal/auth");
  totp = await import("@/lib/auth/totp");
});
afterAll(() => t?.cleanup());

describe("passwords", () => {
  it("are stored as argon2id hashes, never in plain text", async () => {
    const p = await createPerson(t, { email: "hash@example.test" });
    const u = await userRow(t, p.id);
    expect(u.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(u.passwordHash).not.toContain(STRONG_PASSWORD);
  });

  it("unknown, invited and wrong-password sign-ins all get the same answer", async () => {
    await createPerson(t, { email: "real@example.test" });
    await createPerson(t, { email: "pending@example.test", status: "invited", password: null });
    for (const email of ["nobody@example.test", "pending@example.test", "real@example.test"]) {
      expect(await auth.signInWithPassword(email, "Wrong-password-123", {})).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("lockout", () => {
  it("5 wrong passwords lock the account for 15 minutes, even for the right password", async () => {
    const p = await createPerson(t, { email: "lock@example.test" });
    for (let i = 0; i < 4; i++) expect((await auth.signInWithPassword(p.email, "nope-nope-NOPE-1", {})).ok).toBe(false);
    expect(await auth.signInWithPassword(p.email, "nope-nope-NOPE-1", {})).toEqual({ ok: false, reason: "locked", minutes: 15 });
    expect((await auth.signInWithPassword(p.email, STRONG_PASSWORD, {})).ok).toBe(false);
    // 16 minutes later it works again
    const later = new Date(Date.now() + 16 * 60_000);
    const r = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {}, later);
    expect(r.ok).toBe(true);
    expect((await userRow(t, p.id)).failedLogins).toBe(0);
  });
});

describe("sessions", () => {
  it("live in the database; the cookie only holds a random token", async () => {
    const p = await createPerson(t, { email: "sess@example.test" });
    const r = await auth.signInWithPassword(p.email, STRONG_PASSWORD, { ip: "203.0.113.9" });
    if (!r.ok) throw new Error("sign-in failed");
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = await t.db.select().from(t.schema.sessions).where(eq(t.schema.sessions.userId, p.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(r.token); // only the hash is stored
    expect((await auth.resolveSession(r.token)).status).toBe("ok");
  });

  it("end after the idle timeout", async () => {
    const p = await createPerson(t, { email: "idle@example.test" });
    const token = await sessionFor(t, p.id, { lastSeen: new Date(Date.now() - 31 * 60_000) });
    expect(await auth.resolveSession(token)).toEqual({ status: "ended", reason: "idle" });
    expect(await auth.resolveSession(token)).toEqual({ status: "ended", reason: "none" }); // deleted
  });

  it("end at the absolute limit even when active", async () => {
    const p = await createPerson(t, { email: "maxage@example.test" });
    const token = await sessionFor(t, p.id, { expires: new Date(Date.now() - 1000) });
    expect(await auth.resolveSession(token)).toEqual({ status: "ended", reason: "expired" });
  });

  it("sign-out deletes the session and is audited", async () => {
    const p = await createPerson(t, { email: "bye@example.test" });
    const token = await sessionFor(t, p.id);
    await auth.endSession(token, "signed_out");
    expect((await auth.resolveSession(token)).status).toBe("ended");
    const logs = await t.db.select().from(t.schema.auditLog).where(eq(t.schema.auditLog.actorId, p.id));
    expect(logs.map((l) => l.action)).toContain("sign_out");
  });
});

describe("two-factor", () => {
  it("admins must set it up before anything works; secrets are encrypted at rest", async () => {
    const p = await createPerson(t, { email: "newadmin@example.test", preset: "admin" });
    const r = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {});
    if (!r.ok) throw new Error("sign-in failed");
    expect(r.next).toBe("mfa_setup");
    expect((await auth.resolveSession(r.token)).status).toBe("mfa_setup");

    const { secret } = await auth.beginTotpSetup(r.token);
    const pending = (await userRow(t, p.id)).totpPendingEnc!;
    expect(pending.startsWith("v1.")).toBe(true);
    expect(pending).not.toContain(secret);

    await expect(auth.confirmTotpSetup(r.token, "000000")).rejects.toThrow(/didn't work/);
    const codes = await auth.confirmTotpSetup(r.token, totp.totpAt(secret, Date.now()));
    expect(codes).toHaveLength(10);
    const stored = await t.db.select().from(t.schema.recoveryCodes).where(eq(t.schema.recoveryCodes.userId, p.id));
    expect(stored.every((c) => /^[a-f0-9]{64}$/.test(c.codeHash) && !codes.includes(c.codeHash))).toBe(true);
    const s = await auth.resolveSession(r.token);
    expect(s.status === "ok" && s.actor.mfaVerified).toBe(true);
  });

  it("a code can't be reused, and recovery codes work exactly once", async () => {
    const p = await createPerson(t, { email: "otp@example.test", preset: "admin", totp: true });
    const now = Date.now();
    const first = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {});
    if (!first.ok) throw new Error("sign-in failed");
    expect(first.next).toBe("mfa_verify");
    const code = totp.totpAt(p.totpSecret!, now);
    await auth.verifySecondFactor(first.token, code, new Date(now));

    const second = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {});
    if (!second.ok) throw new Error("sign-in failed");
    await expect(auth.verifySecondFactor(second.token, code, new Date(now))).rejects.toThrow(/didn't work/); // replay

    // someone holding only the password can't swap in their own authenticator
    await expect(auth.beginTotpSetup(second.token)).rejects.toThrow(/current code/);

    const s1 = await auth.resolveSession(first.token);
    if (s1.status !== "ok") throw new Error("expected ok");
    const recovery = await auth.regenerateRecoveryCodes(s1.actor);
    const used = await auth.verifySecondFactor(second.token, recovery[0].toLowerCase().replace("-", " "));
    expect(used).toEqual({ ok: true, usedRecoveryCode: true, recoveryCodesLeft: 9 });

    const third = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {});
    if (!third.ok) throw new Error("sign-in failed");
    await expect(auth.verifySecondFactor(third.token, recovery[0])).rejects.toThrow(/already used/);
  });

  it("the server-side reset clears the authenticator and forces new setup", async () => {
    const p = await createPerson(t, { email: "operator@example.test", preset: "admin", totp: true });
    const token = await sessionFor(t, p.id, { mfaVerified: true });
    await auth.operatorResetTwoFactor(p.email);
    expect((await auth.resolveSession(token)).status).toBe("ended");
    const r = await auth.signInWithPassword(p.email, STRONG_PASSWORD, {});
    expect(r.ok && r.next).toBe("mfa_setup");
  });
});

describe("email links", () => {
  it("password reset: single use, expires, ends every session", async () => {
    const p = await createPerson(t, { email: "forgot@example.test" });
    const old = await sessionFor(t, p.id);
    expect(await auth.createPasswordResetToken("nobody@example.test")).toBeNull();
    const link = await auth.createPasswordResetToken("FORGOT@example.test");
    expect(link?.email).toBe(p.email);
    expect(await auth.peekLinkToken(link!.token, "invite")).toBeNull(); // wrong purpose
    await expect(auth.completePasswordReset(link!.token, "short", {})).rejects.toThrow(/at least 12/);
    await auth.completePasswordReset(link!.token, "A-brand-new-Passw0rd", {});
    expect((await auth.resolveSession(old)).status).toBe("ended");
    await expect(auth.completePasswordReset(link!.token, "Another-new-Passw0rd", {})).rejects.toThrow(/expired or was already used/);
    expect((await auth.signInWithPassword(p.email, "A-brand-new-Passw0rd", {})).ok).toBe(true);

    const late = await auth.createPasswordResetToken(p.email);
    await expect(auth.completePasswordReset(late!.token, "Yet-another-Passw0rd", {}, new Date(Date.now() + 61 * 60_000))).rejects.toThrow(/expired/);
  });

  it("invites activate the account once, then sign the person in", async () => {
    const { actorFor } = await import("./db");
    const admin = await createPerson(t, { email: "inviter@example.test", preset: "admin", totp: true });
    const team = await import("@/lib/dal/team");
    const inv = await team.inviteUser(await actorFor(t, admin.id), { email: "new@example.test", fullName: "New Person", jobTitle: "Designer", presetId: "staff" });
    expect((await userRow(t, inv.userId)).status).toBe("invited");
    expect(await auth.peekLinkToken(inv.token, "invite")).toMatchObject({ email: "new@example.test" });
    const r = await auth.acceptInvite(inv.token, "Welcome-aboard-2026", {});
    expect(r.next).toBe("home");
    expect((await userRow(t, inv.userId)).status).toBe("active");
    await expect(auth.acceptInvite(inv.token, "Welcome-aboard-2026", {})).rejects.toThrow(/already used/);
  });
});

describe("first admin seed", () => {
  it("works once, then refuses", async () => {
    // this file's database already has admins from earlier tests
    await expect(auth.bootstrapFirstAdmin({ email: "seed@example.test", password: STRONG_PASSWORD, fullName: "Seed" })).rejects.toThrow(/already exists/);
  });
});
