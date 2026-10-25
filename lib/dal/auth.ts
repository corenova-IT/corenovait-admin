import "server-only";
import { and, count, eq, gt, isNull, lt, or } from "drizzle-orm";
import { getDb, schema, type Tx } from "@/lib/db";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "@/lib/auth/crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/hash";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  normaliseRecoveryCode,
  otpauthUri,
  verifyTotp,
} from "@/lib/auth/totp";
import { SESSION_IDLE_MINUTES, SESSION_MAX_HOURS } from "@/lib/env";
import { passwordProblems } from "@/lib/password";
import { actorRef, writeAudit } from "./audit";
import { AccessDenied, RuleError, assertCaller, issueActor, type Actor } from "./guard";
import { copyPresetToUser, deleteSessions, loadUserPerms } from "./internal";

/**
 * Sign-in, sessions, two-factor and email-link tokens. These run before a
 * full Actor exists, so they take a session token or a link token instead.
 */
const { users, sessions, authTokens, recoveryCodes, rolePresets } = schema;

export const LOCKOUT_AFTER = 5;
export const LOCKOUT_MINUTES = 15;
const INVITE_DAYS = 7;
const RESET_MINUTES = 60;
const TOUCH_EVERY_MS = 60_000;

const minutesFrom = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
type Ctx = { ip?: string | null; userAgent?: string | null };
const who = (u: { id: string; email: string }) => ({ userId: u.id, email: u.email });

// ------------------------------------------------------------------ sessions
async function createSession(tx: Tx, userId: string, ctx: Ctx, mfaVerified: boolean): Promise<string> {
  const token = randomToken();
  const now = new Date();
  await tx.insert(sessions).values({
    id: sha256Hex(token),
    userId,
    lastSeenAt: now,
    expiresAt: minutesFrom(now, SESSION_MAX_HOURS * 60),
    mfaVerifiedAt: mfaVerified ? now : null,
    ip: ctx.ip?.slice(0, 45) ?? null,
    userAgent: ctx.userAgent?.slice(0, 255) ?? null,
  });
  return token;
}

export type SessionState =
  | { status: "ok"; actor: Actor }
  | { status: "mfa_verify"; userId: string; email: string; mfaRequired: boolean }
  | { status: "mfa_setup"; userId: string; email: string; mfaRequired: boolean }
  | { status: "ended"; reason: "none" | "idle" | "expired" | "inactive" };

/** Looks up the cookie's session, enforces idle and absolute timeouts, and builds the Actor. */
export async function resolveSession(token: string | null | undefined, now = new Date()): Promise<SessionState> {
  if (!token || token.length > 200) return { status: "ended", reason: "none" };
  const db = getDb();
  const id = sha256Hex(token);
  const [row] = await db
    .select({ s: sessions, u: users, presetName: rolePresets.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(rolePresets, eq(rolePresets.id, users.presetId))
    .where(eq(sessions.id, id))
    .limit(1);
  if (!row) return { status: "ended", reason: "none" };
  const { s, u } = row;

  if (s.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return { status: "ended", reason: "expired" };
  }
  if (now.getTime() - s.lastSeenAt.getTime() > SESSION_IDLE_MINUTES * 60_000) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return { status: "ended", reason: "idle" };
  }
  if (u.status !== "active") {
    await deleteSessions(db, u.id);
    return { status: "ended", reason: "inactive" };
  }
  if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }

  const mfaEnabled = u.totpEnabledAt != null && u.totpSecretEnc != null;
  if ((u.mfaRequired || mfaEnabled) && !s.mfaVerifiedAt) {
    const pending = { userId: u.id, email: u.email, mfaRequired: u.mfaRequired };
    return mfaEnabled ? { status: "mfa_verify", ...pending } : { status: "mfa_setup", ...pending };
  }

  const perms = await loadUserPerms(db, u.id);
  return {
    status: "ok",
    actor: issueActor({
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      jobTitle: u.jobTitle,
      presetId: u.presetId,
      presetName: row.presetName,
      isAdmin: u.presetId === "admin",
      mfaRequired: u.mfaRequired,
      mfaEnabled,
      mfaVerified: s.mfaVerifiedAt != null,
      sessionId: id,
      perms,
    }),
  };
}

export async function endSession(token: string | null | undefined, reason: string) {
  if (!token) return;
  const db = getDb();
  const id = sha256Hex(token);
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  await db.delete(sessions).where(eq(sessions.id, id));
  if (row) {
    await writeAudit(db, who(row), { action: "sign_out", entity: "auth", summary: reason === "signed_out" ? "Signed out" : `Signed out (${reason})` });
  }
}

/** "Sign out of all devices" on the Security page. */
export async function endAllMySessions(actor: Actor) {
  assertCaller(actor);
  const db = getDb();
  await deleteSessions(db, actor.userId);
  await writeAudit(db, actorRef(actor), { action: "sessions_reset", entity: "users", entityId: actor.userId, summary: "Signed out of all devices" });
}

/** Housekeeping: drop sessions that can no longer be used. */
export async function purgeExpiredSessions(now = new Date()) {
  const idleCutoff = minutesFrom(now, -SESSION_IDLE_MINUTES);
  await getDb()
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, now), lt(sessions.lastSeenAt, idleCutoff)));
}

// ------------------------------------------------------------------ sign-in
export type SignInResult =
  | { ok: true; token: string; next: "home" | "mfa_verify" | "mfa_setup" }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "locked"; minutes: number };

/**
 * Password check with account lockout: 5 wrong passwords in a row lock the
 * account for 15 minutes. Unknown, invited and deactivated accounts get the
 * same "invalid" answer and take the same time, so nothing reveals which
 * emails exist.
 */
export async function signInWithPassword(emailRaw: string, password: string, ctx: Ctx, now = new Date()): Promise<SignInResult> {
  const email = emailRaw.trim().toLowerCase();
  const db = getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, email)).limit(1).for("update");
    if (u?.lockedUntil && u.lockedUntil > now) {
      await verifyPassword(null, password);
      return { ok: false, reason: "locked", minutes: Math.ceil((u.lockedUntil.getTime() - now.getTime()) / 60_000) } as const;
    }
    const usable = u && u.status === "active" && u.passwordHash;
    const good = usable ? await verifyPassword(u.passwordHash, password) : await verifyPassword(null, password);
    if (!u || !usable || !good) {
      if (u && usable) {
        const fails = u.failedLogins + 1;
        if (fails >= LOCKOUT_AFTER) {
          await tx.update(users).set({ failedLogins: 0, lockedUntil: minutesFrom(now, LOCKOUT_MINUTES) }).where(eq(users.id, u.id));
          await writeAudit(tx, who(u), { action: "lockout", entity: "auth", entityId: u.id, summary: `Locked for ${LOCKOUT_MINUTES} minutes after ${LOCKOUT_AFTER} wrong passwords` }, ctx.ip);
          return { ok: false, reason: "locked", minutes: LOCKOUT_MINUTES } as const;
        }
        await tx.update(users).set({ failedLogins: fails }).where(eq(users.id, u.id));
      }
      return { ok: false, reason: "invalid" } as const;
    }
    await tx.update(users).set({ failedLogins: 0, lockedUntil: null, lastSignInAt: now }).where(eq(users.id, u.id));
    const token = await createSession(tx, u.id, ctx, false);
    await writeAudit(tx, who(u), { action: "sign_in", entity: "auth", summary: "Signed in with password" }, ctx.ip);
    const mfaEnabled = u.totpEnabledAt != null;
    const next = mfaEnabled ? "mfa_verify" : u.mfaRequired ? "mfa_setup" : "home";
    return { ok: true, token, next } as const;
  });
}

// ------------------------------------------------------------------ two-factor
async function pendingSessionUser(token: string) {
  const state = await resolveSession(token);
  if (state.status === "ended") throw new AccessDenied("Your session has ended. Sign in again.");
  const userId = state.status === "ok" ? state.actor.userId : state.userId;
  return { state, userId };
}

/**
 * Starts (or restarts) authenticator setup and returns the secret to show
 * once. Someone who has TOTP on but hasn't passed it this session can't
 * replace it: they have to verify first or use a recovery code.
 */
export async function beginTotpSetup(token: string): Promise<{ secret: string; uri: string }> {
  const { state, userId } = await pendingSessionUser(token);
  if (state.status === "mfa_verify") throw new AccessDenied("Enter your current code first.");
  const db = getDb();
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  const secret = generateTotpSecret();
  await db.update(users).set({ totpPendingEnc: encryptSecret(secret) }).where(eq(users.id, userId));
  return { secret, uri: otpauthUri(secret, u.email) };
}

async function issueRecoveryCodes(tx: Tx, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await tx.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256Hex(c) })));
  return codes;
}

/** Confirms setup with a code from the app. Returns the recovery codes (shown once). */
export async function confirmTotpSetup(token: string, code: string, now = new Date()): Promise<string[]> {
  const { state, userId } = await pendingSessionUser(token);
  if (state.status === "mfa_verify") throw new AccessDenied("Enter your current code first.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!u.totpPendingEnc) throw new RuleError("Setup timed out. Start again to get a new QR code.");
    const secret = decryptSecret(u.totpPendingEnc);
    const step = verifyTotp(secret, code, { now: now.getTime() });
    if (step === null) throw new RuleError("That code didn't work. Check the time on your phone and use the newest code.");
    await tx
      .update(users)
      .set({ totpSecretEnc: u.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: now, totpLastStep: step })
      .where(eq(users.id, userId));
    const codes = await issueRecoveryCodes(tx, userId);
    await tx.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, sha256Hex(token)));
    // other sessions must pass the new factor too
    await deleteSessions(tx, userId, sha256Hex(token));
    await writeAudit(tx, who(u), { action: "mfa_enabled", entity: "users", entityId: userId, summary: "Authenticator app set up" });
    return codes;
  });
}

export type SecondFactorResult = { ok: true; usedRecoveryCode: boolean; recoveryCodesLeft: number };

/** The sign-in step after the password: a 6-digit TOTP code or a one-time recovery code. */
export async function verifySecondFactor(token: string, input: string, now = new Date()): Promise<SecondFactorResult> {
  const { state, userId } = await pendingSessionUser(token);
  if (state.status !== "mfa_verify") throw new RuleError("There's no code to check right now.");
  const db = getDb();
  const sessionId = sha256Hex(token);
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    const trimmed = input.trim().replace(/\s/g, "");
    let usedRecoveryCode = false;

    if (/^\d{6}$/.test(trimmed)) {
      if (!u.totpSecretEnc) throw new RuleError("Two-factor isn't set up for this account.");
      const step = verifyTotp(decryptSecret(u.totpSecretEnc), trimmed, { now: now.getTime(), lastStep: u.totpLastStep });
      if (step === null) throw new RuleError("That code didn't work. Check the time on your phone and use the newest code.");
      await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, userId));
    } else {
      const code = normaliseRecoveryCode(trimmed);
      if (!code) throw new RuleError("Enter the 6-digit code from your app, or a recovery code like 7KQ4-M2XP.");
      const [hit] = await tx
        .select({ id: recoveryCodes.id })
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256Hex(code)), isNull(recoveryCodes.usedAt)))
        .for("update");
      if (!hit) throw new RuleError("That recovery code isn't valid or was already used.");
      await tx.update(recoveryCodes).set({ usedAt: now }).where(eq(recoveryCodes.id, hit.id));
      usedRecoveryCode = true;
      await writeAudit(tx, who(u), { action: "recovery_code_used", entity: "users", entityId: userId, summary: "Signed in with a recovery code" });
    }
    await tx.update(sessions).set({ mfaVerifiedAt: now }).where(eq(sessions.id, sessionId));
    const [{ n }] = await tx
      .select({ n: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return { ok: true, usedRecoveryCode, recoveryCodesLeft: n };
  });
}

export async function recoveryCodesLeft(actor: Actor): Promise<number> {
  assertCaller(actor);
  const [{ n }] = await getDb()
    .select({ n: count() })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, actor.userId), isNull(recoveryCodes.usedAt)));
  return n;
}

export async function regenerateRecoveryCodes(actor: Actor): Promise<string[]> {
  assertCaller(actor);
  if (!actor.mfaEnabled || !actor.mfaVerified) throw new RuleError("Set up two-factor first.");
  return getDb().transaction(async (tx) => {
    const codes = await issueRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, actorRef(actor), { action: "recovery_codes_regenerated", entity: "users", entityId: actor.userId, summary: "New recovery codes issued; old ones stopped working" });
    return codes;
  });
}

// ------------------------------------------------------------------ email links
async function issueLinkToken(tx: Tx, userId: string, purpose: "invite" | "reset", minutes: number): Promise<string> {
  await tx.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)));
  const token = randomToken();
  await tx.insert(authTokens).values({ id: sha256Hex(token), userId, purpose, expiresAt: minutesFrom(new Date(), minutes) });
  return token;
}

export async function createInviteToken(tx: Tx, userId: string) {
  return issueLinkToken(tx, userId, "invite", INVITE_DAYS * 24 * 60);
}

/** Returns a reset token only for active accounts with a password. The caller emails it. */
export async function createPasswordResetToken(emailRaw: string): Promise<{ email: string; token: string } | null> {
  const email = emailRaw.trim().toLowerCase();
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u || u.status !== "active" || !u.passwordHash) return null;
  const token = await db.transaction((tx) => issueLinkToken(tx, u.id, "reset", RESET_MINUTES));
  return { email: u.email, token };
}

/** For the link landing pages: who is this link for, if it's still usable? */
export async function peekLinkToken(token: string, purpose: "invite" | "reset", now = new Date()) {
  if (!token || token.length > 200) return null;
  const [row] = await getDb()
    .select({ email: users.email, fullName: users.fullName, status: users.status })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .where(and(eq(authTokens.id, sha256Hex(token)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  if (purpose === "invite" && row.status !== "invited") return null;
  if (purpose === "reset" && row.status !== "active") return null;
  return { email: row.email, fullName: row.fullName };
}

async function consumeLinkToken(tx: Tx, token: string, purpose: "invite" | "reset", now: Date) {
  const [t] = await tx
    .select()
    .from(authTokens)
    .where(and(eq(authTokens.id, sha256Hex(token)), eq(authTokens.purpose, purpose)))
    .for("update");
  if (!t || t.usedAt || t.expiresAt <= now) throw new RuleError("That link has expired or was already used. Ask for a new one.");
  await tx.update(authTokens).set({ usedAt: now }).where(eq(authTokens.id, t.id));
  const [u] = await tx.select().from(users).where(eq(users.id, t.userId)).for("update");
  return u;
}

function checkPassword(password: string, email: string) {
  const problems = passwordProblems(password, email);
  if (problems.length) throw new RuleError(problems.join(" "));
}

/** Sets the new password and signs the person out everywhere. */
export async function completePasswordReset(token: string, password: string, ctx: Ctx, now = new Date()) {
  return getDb().transaction(async (tx) => {
    const u = await consumeLinkToken(tx, token, "reset", now);
    if (!u || u.status !== "active") throw new RuleError("That link has expired or was already used. Ask for a new one.");
    checkPassword(password, u.email);
    await tx
      .update(users)
      .set({ passwordHash: await hashPassword(password), passwordChangedAt: now, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, u.id));
    await deleteSessions(tx, u.id);
    await writeAudit(tx, who(u), { action: "password_reset", entity: "users", entityId: u.id, summary: "Password reset by email link" }, ctx.ip);
  });
}

/** Activates an invited account, then signs it in (two-factor setup comes next if required). */
export async function acceptInvite(token: string, password: string, ctx: Ctx, now = new Date()): Promise<SignInResult & { ok: true }> {
  return getDb().transaction(async (tx) => {
    const u = await consumeLinkToken(tx, token, "invite", now);
    if (!u || u.status !== "invited") throw new RuleError("That invite has expired or was already used. Ask an admin to send a new one.");
    checkPassword(password, u.email);
    await tx
      .update(users)
      .set({ status: "active", passwordHash: await hashPassword(password), passwordChangedAt: now, lastSignInAt: now })
      .where(eq(users.id, u.id));
    await writeAudit(tx, who(u), { action: "invite_accepted", entity: "users", entityId: u.id, summary: "Invite accepted; account active" }, ctx.ip);
    const session = await createSession(tx, u.id, ctx, false);
    return { ok: true, token: session, next: u.mfaRequired ? "mfa_setup" : "home" } as const;
  });
}

// ------------------------------------------------------------------ operator tools (scripts only)
/** npm run seed:admin. Refuses once any active admin exists. */
export async function bootstrapFirstAdmin(input: { email: string; password: string; fullName: string }) {
  const email = input.email.trim().toLowerCase();
  checkPassword(input.password, email);
  return getDb().transaction(async (tx) => {
    const admins = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.presetId, "admin"), eq(users.status, "active")))
      .for("update");
    if (admins.length) throw new RuleError("An admin already exists. Invite further admins from the Team page.");
    const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (clash) throw new RuleError("That email already has an account.");
    const id = crypto.randomUUID();
    await tx.insert(users).values({
      id,
      email,
      fullName: input.fullName.slice(0, 120),
      status: "active",
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
    });
    await copyPresetToUser(tx, id, "admin");
    await writeAudit(tx, null, { action: "create", entity: "users", entityId: id, summary: `First admin ${email} created by the seed script` });
    return id;
  });
}

/**
 * Last-resort recovery when an admin has lost both their authenticator and
 * their recovery codes and no other admin can help. Run on the server only
 * (npm run reset-2fa). They set up a new authenticator at next sign-in.
 */
export async function operatorResetTwoFactor(emailRaw: string) {
  const email = emailRaw.trim().toLowerCase();
  return getDb().transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.email, email)).for("update");
    if (!u) throw new RuleError("No account has that email.");
    await tx.update(users).set({ totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, u.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
    await deleteSessions(tx, u.id);
    await writeAudit(tx, null, { action: "mfa_reset", entity: "users", entityId: u.id, summary: `Two-factor reset for ${email} from the server command line` });
  });
}
