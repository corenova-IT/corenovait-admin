import "server-only";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, count, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { z } from "zod";
import { hashPassword, verifyPassword } from "@/lib/auth/hash";
import { decryptSecret } from "@/lib/auth/crypto";
import { verifyTotp } from "@/lib/auth/totp";
import { AVATAR_MAX_BYTES, AVATAR_SIZE, avatarUrl } from "@/lib/avatar";
import { getDb, schema } from "@/lib/db";
import { sniffType } from "@/lib/file-types";
import { passwordProblems } from "@/lib/password";
import { actorRef, writeAudit } from "./audit";
import { issueRecoveryCodes } from "./auth";
import { uploadDir } from "./files";
import { RuleError, assertCaller, type Actor } from "./guard";
import { deleteSessions } from "./internal";

/**
 * The signed-in person's own profile. Every function here acts on the
 * caller only (actor.userId): there is no user ID parameter to point at
 * someone else. Email, role and permissions are changed by admins on the
 * Team page, not here.
 */
const { users, recoveryCodes } = schema;
const KEY = /^[a-f0-9]{32}\.webp$/;
const avatarDir = () => path.join(uploadDir(), "avatars");

export async function getMyProfile(actor: Actor) {
  assertCaller(actor);
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, actor.userId));
  const [{ n }] = await db.select({ n: count() }).from(recoveryCodes).where(and(eq(recoveryCodes.userId, actor.userId), isNull(recoveryCodes.usedAt)));
  return {
    email: u.email,
    fullName: u.fullName,
    jobTitle: u.jobTitle,
    phone: u.phone,
    roleName: actor.presetName,
    notifyEmail: u.notifyEmail,
    avatarUrl: avatarUrl(u.id, u.avatarKey ? u.avatarUpdatedAt : null),
    mfaEnabled: u.totpEnabledAt != null,
    mfaRequired: u.mfaRequired,
    recoveryCodesLeft: n,
    passwordChangedAt: u.passwordChangedAt,
  };
}

export const profileInput = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120, "Keep your name under 120 characters."),
  jobTitle: z.string().trim().max(120, "Keep the job title under 120 characters.").default(""),
  phone: z
    .string()
    .trim()
    .max(40, "That phone number is too long.")
    .regex(/^[0-9+()\-.\s]*$/, "Use digits, spaces and + ( ) - only.")
    .default(""),
});
export type ProfileInput = z.input<typeof profileInput>;

/** Name, job title and phone. Audited with the before and after values. */
export async function updateMyProfile(actor: Actor, input: ProfileInput) {
  assertCaller(actor);
  const v = profileInput.parse(input);
  await getDb().transaction(async (tx) => {
    const [u] = await tx.select({ fullName: users.fullName, jobTitle: users.jobTitle, phone: users.phone }).from(users).where(eq(users.id, actor.userId)).for("update");
    const changed = (Object.keys(v) as Array<keyof typeof v>).filter((k) => u[k] !== v[k]);
    if (!changed.length) return;
    await tx.update(users).set(v).where(eq(users.id, actor.userId));
    const pick = (o: typeof v) => Object.fromEntries(changed.map((k) => [k, o[k]]));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "users", entityId: actor.userId, summary: "Updated own profile", before: pick(u), after: pick(v) });
  });
}

/**
 * A new profile picture: JPG, PNG or WebP (checked from the bytes), up to
 * 2 MB. Re-encoded on the server as a 512 px square WebP, which also drops
 * EXIF and every other kind of metadata (location, camera). Stored outside
 * the web root; served only by /api/avatars/[id] to signed-in people.
 */
export async function setMyAvatar(actor: Actor, bytes: Buffer) {
  assertCaller(actor);
  if (bytes.length === 0) throw new RuleError("Choose a picture to upload.");
  if (bytes.length > AVATAR_MAX_BYTES) throw new RuleError("That picture is over 2 MB. Choose a smaller one.");
  const type = sniffType(bytes);
  if (!type || !type.mime.startsWith("image/")) throw new RuleError("Upload a JPG, PNG or WebP picture.");
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate() // turn phone photos the right way up before the orientation tag is dropped
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new RuleError("That picture couldn't be read. Try another JPG, PNG or WebP file.");
  }
  const key = `${randomBytes(16).toString("hex")}.webp`;
  await mkdir(avatarDir(), { recursive: true, mode: 0o700 });
  await writeFile(path.join(avatarDir(), key), out, { mode: 0o600, flag: "wx" });
  const old = await getDb().transaction(async (tx) => {
    const [u] = await tx.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, actor.userId)).for("update");
    await tx.update(users).set({ avatarKey: key, avatarUpdatedAt: new Date() }).where(eq(users.id, actor.userId));
    // what changed, never the picture itself
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "users", entityId: actor.userId, summary: u.avatarKey ? "Changed profile picture" : "Added a profile picture" });
    return u.avatarKey;
  });
  await removeFile(old);
}

export async function removeMyAvatar(actor: Actor) {
  assertCaller(actor);
  const old = await getDb().transaction(async (tx) => {
    const [u] = await tx.select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, actor.userId)).for("update");
    if (!u.avatarKey) return null;
    await tx.update(users).set({ avatarKey: null, avatarUpdatedAt: new Date() }).where(eq(users.id, actor.userId));
    await writeAudit(tx, actorRef(actor), { action: "update", entity: "users", entityId: actor.userId, summary: "Removed profile picture" });
    return u.avatarKey;
  });
  await removeFile(old);
}

async function removeFile(key: string | null) {
  if (!key || !KEY.test(key)) return;
  await unlink(path.join(avatarDir(), key)).catch(() => undefined);
}

/** Anyone signed in may see a colleague's picture (it appears in chat, tasks and the team list). Null when there isn't one. */
export async function readAvatar(actor: Actor, userId: string): Promise<Buffer | null> {
  assertCaller(actor);
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [u] = await getDb().select({ avatarKey: users.avatarKey }).from(users).where(eq(users.id, userId));
  if (!u?.avatarKey || !KEY.test(u.avatarKey)) return null;
  try {
    return await readFile(path.join(avatarDir(), u.avatarKey));
  } catch {
    return null;
  }
}

/** Needs the current password. The new one follows the usual rules; every other session is signed out. */
export async function changeMyPassword(actor: Actor, current: string, next: string) {
  assertCaller(actor);
  const db = getDb();
  const [u] = await db.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, actor.userId));
  if (!current || !(await verifyPassword(u.passwordHash, current))) throw new RuleError("Your current password isn't right.");
  const problems = passwordProblems(next, u.email);
  if (problems.length) throw new RuleError(problems.join(" "));
  if (await verifyPassword(u.passwordHash, next)) throw new RuleError("Choose a password different from your current one.");
  const hash = await hashPassword(next);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(users.id, actor.userId));
    await deleteSessions(tx, actor.userId, actor.sessionId);
    await writeAudit(tx, actorRef(actor), { action: "password_changed", entity: "users", entityId: actor.userId, summary: "Changed own password; other sessions signed out" });
  });
}

/** New recovery codes, after proving it's really you: your password and a current code from your app. */
export async function regenerateMyRecoveryCodes(actor: Actor, password: string, code: string): Promise<string[]> {
  assertCaller(actor);
  if (!actor.mfaEnabled || !actor.mfaVerified) throw new RuleError("Set up two-factor first.");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, actor.userId)).for("update");
    if (!password || !(await verifyPassword(u.passwordHash, password))) throw new RuleError("Your password isn't right.");
    const digits = code.replace(/\s/g, "");
    const step = /^\d{6}$/.test(digits) && u.totpSecretEnc ? verifyTotp(decryptSecret(u.totpSecretEnc), digits, { now: Date.now(), lastStep: u.totpLastStep }) : null;
    if (step === null) throw new RuleError("That code didn't work. Use the newest 6-digit code from your app.");
    await tx.update(users).set({ totpLastStep: step }).where(eq(users.id, actor.userId));
    const codes = await issueRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, actorRef(actor), { action: "recovery_codes_regenerated", entity: "users", entityId: actor.userId, summary: "New recovery codes issued; old ones stopped working" });
    return codes;
  });
}
