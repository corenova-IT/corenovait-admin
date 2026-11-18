import "server-only";
import { assertRealEmailInProduction } from "@/lib/sample-guard";
import { asc, eq } from "drizzle-orm";
import { avatarUrl } from "@/lib/avatar";
import { getDb, schema } from "@/lib/db";
import type { PermMap } from "@/lib/permissions";
import { actorRef, writeAudit } from "./audit";
import { applyAssignments, guardedAssign, releaseAssignments } from "./assignments";
import { createInviteToken } from "./auth";
import { RuleError, requireAdmin, requirePerm, type Actor } from "./guard";
import {
  SCOPED_PRESETS,
  assertNotLastAdmin,
  copyPresetToUser,
  deleteSessions,
  loadPresetPerms,
  loadUserPerms,
  needsMfa,
  permSnapshot,
  rowsToPermMap,
  writePresetPerms,
  writeUserPerms,
} from "./internal";

/** Team and permissions. Reading needs team:view; every change needs an admin with two-factor done. */
const { users, userPermissions, rolePresets, presetPermissions, recoveryCodes } = schema;

export type TeamMember = {
  id: string;
  email: string;
  name: string;
  jobTitle: string;
  avatarUrl: string | null;
  presetId: string;
  /** the one main admin (see lib/dal/visibility.ts) */
  isOwner: boolean;
  status: "active" | "invited" | "deactivated";
  mfaRequired: boolean;
  mfaEnabled: boolean;
  lockedUntil: string | null;
  lastSignIn: string | null;
  perms: PermMap;
};

export type TeamPreset = { id: string; name: string; description: string; perms: PermMap; editable: boolean; memberCount: number };

/**
 * The Stream partner and Employee presets are fixed: what they can open comes from the preset alone,
 * and which rows they see comes from lib/dal/scope.ts. Handing one of them a company-wide module
 * (transactions, payments, tasks…) would make older code return rows outside their streams.
 */
const LOCKED_PRESETS = new Set(["admin", "custom", ...SCOPED_PRESETS]);
/** Employees need a partner and projects (a later phase); until then nobody can be given the role. */
const EMPLOYEE_LATER = "The Employee role isn't available yet.";
const isScopedModule = (m: string) => m === "stream_partner" || m === "employee";

/**
 * The owner's account is out of reach of every other admin (they could otherwise
 * lock the owner out or strip the owner's view of the revenue), and the owner
 * can't demote or deactivate themselves: an owner who isn't an admin is no owner.
 */
function guardOwner(actor: Actor, target: { id: string; isOwner: boolean }, change: "role" | "other") {
  if (!target.isOwner) return;
  if (actor.userId !== target.id) throw new RuleError("Only the owner can change the owner's account.");
  if (change === "role") throw new RuleError("The owner has to stay an admin.");
}

export async function listTeam(actor: Actor): Promise<{ members: TeamMember[]; presets: TeamPreset[] }> {
  requirePerm(actor, "team", "view");
  const db = getDb();
  const [people, perms, presets, pperms] = await Promise.all([
    db.select().from(users).orderBy(asc(users.fullName), asc(users.email)),
    db.select().from(userPermissions),
    db.select().from(rolePresets).orderBy(asc(rolePresets.sort)),
    db.select().from(presetPermissions),
  ]);
  const members: TeamMember[] = people.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.fullName,
    jobTitle: u.jobTitle,
    avatarUrl: avatarUrl(u.id, u.avatarKey ? u.avatarUpdatedAt : null),
    presetId: u.presetId,
    isOwner: u.isOwner,
    status: u.status,
    mfaRequired: u.mfaRequired,
    mfaEnabled: u.totpEnabledAt != null,
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    lastSignIn: u.lastSignInAt?.toISOString() ?? null,
    perms: rowsToPermMap(perms.filter((p) => p.userId === u.id)),
  }));
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.presetId, (counts.get(m.presetId) ?? 0) + 1);
  return {
    members,
    presets: presets.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      perms: rowsToPermMap(pperms.filter((r) => r.presetId === p.id)),
      editable: !LOCKED_PRESETS.has(p.id),
      memberCount: counts.get(p.id) ?? 0,
    })),
  };
}

async function loadTarget(userId: string) {
  const [u] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!u) throw new RuleError("That person no longer exists. Refresh the page.");
  return u;
}

export async function inviteUser(
  actor: Actor,
  input: { email: string; fullName: string; jobTitle: string; presetId: string; streamIds?: number[]; countryCodes?: string[] }
): Promise<{ userId: string; email: string; name: string; token: string }> {
  requireAdmin(actor);
  const email = input.email.trim().toLowerCase();
  if (input.presetId === "custom") throw new RuleError("Invite with a preset, then customise their permissions.");
  if (input.presetId === "employee") throw new RuleError(EMPLOYEE_LATER);
  const wantsAssignments = (input.streamIds?.length ?? 0) > 0 || (input.countryCodes?.length ?? 0) > 0;
  if (wantsAssignments && input.presetId !== "stream_partner") throw new RuleError("Streams and countries are only for stream partners.");
  try {
    assertRealEmailInProduction(email);
  } catch (e) {
    throw new RuleError((e as Error).message);
  }
  const db = getDb();
  return guardedAssign(() => db.transaction(async (tx) => {
    const [preset] = await tx.select().from(rolePresets).where(eq(rolePresets.id, input.presetId));
    if (!preset) throw new RuleError("Choose a role.");
    const [clash] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (clash) throw new RuleError("That email already has an account.");
    const userId = crypto.randomUUID();
    await tx.insert(users).values({ id: userId, email, fullName: input.fullName, jobTitle: input.jobTitle, status: "invited", invitedBy: actor.userId });
    await copyPresetToUser(tx, userId, preset.id);
    const token = await createInviteToken(tx, userId);
    await writeAudit(tx, actorRef(actor), {
      action: "invite",
      entity: "users",
      entityId: userId,
      summary: `Invited ${email} as ${preset.name}`,
      after: { email, fullName: input.fullName, jobTitle: input.jobTitle, preset: preset.id },
    });
    if (preset.id === "stream_partner") {
      await applyAssignments(tx, actor, { id: userId, email }, { streamIds: input.streamIds ?? [], countryCodes: input.countryCodes ?? [] });
    }
    return { userId, email, name: input.fullName, token };
  }));
}

export async function resendInvite(actor: Actor, userId: string) {
  requireAdmin(actor);
  const u = await loadTarget(userId);
  if (u.status !== "invited") throw new RuleError("They've already accepted their invite.");
  return getDb().transaction(async (tx) => {
    const token = await createInviteToken(tx, userId);
    await writeAudit(tx, actorRef(actor), { action: "invite", entity: "users", entityId: userId, summary: `Invite re-sent to ${u.email}` });
    return { email: u.email, name: u.fullName, token };
  });
}

export async function setDetails(actor: Actor, input: { userId: string; fullName: string; jobTitle: string }) {
  requireAdmin(actor);
  const u = await loadTarget(input.userId);
  guardOwner(actor, u, "other");
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ fullName: input.fullName, jobTitle: input.jobTitle }).where(eq(users.id, u.id));
    await writeAudit(tx, actorRef(actor), {
      action: "update",
      entity: "users",
      entityId: u.id,
      before: { full_name: u.fullName, job_title: u.jobTitle },
      after: { full_name: input.fullName, job_title: input.jobTitle },
    });
  });
}

export async function applyPreset(actor: Actor, input: { userId: string; presetId: string }) {
  requireAdmin(actor);
  if (input.presetId === "custom") throw new RuleError("Edit the permission grid to make a custom role.");
  if (input.presetId === "employee") throw new RuleError(EMPLOYEE_LATER);
  const u = await loadTarget(input.userId);
  guardOwner(actor, u, "role");
  await getDb().transaction(async (tx) => {
    const [preset] = await tx.select().from(rolePresets).where(eq(rolePresets.id, input.presetId));
    if (!preset) throw new RuleError("Choose a role.");
    if (u.presetId === "admin" && preset.id !== "admin") await assertNotLastAdmin(tx, u.id);
    const before = permSnapshot(await loadUserPerms(tx, u.id));
    // someone who stops being a stream partner no longer holds streams or countries (logged)
    if (u.presetId === "stream_partner" && preset.id !== "stream_partner") await releaseAssignments(tx, actor, { id: u.id, email: u.email });
    await copyPresetToUser(tx, u.id, preset.id);
    await writeAudit(tx, actorRef(actor), {
      action: "permissions",
      entity: "users",
      entityId: u.id,
      summary: `Role set to ${preset.name}`,
      before: { preset: u.presetId, perms: before },
      after: { preset: preset.id, perms: permSnapshot(await loadUserPerms(tx, u.id)) },
    });
  });
}

export async function setPermissions(actor: Actor, input: { userId: string; perms: PermMap }) {
  requireAdmin(actor);
  const u = await loadTarget(input.userId);
  guardOwner(actor, u, "role");
  if ((SCOPED_PRESETS as readonly string[]).includes(u.presetId)) {
    throw new RuleError("A stream partner's or employee's permissions are fixed. Change their role instead.");
  }
  const grantsScopedModule = Object.entries(input.perms).some(([m, p]) => isScopedModule(m) && (p.view || p.create || p.edit || p.delete || p.export));
  if (grantsScopedModule) throw new RuleError("The stream partner and employee pages can only come from those roles.");
  await getDb().transaction(async (tx) => {
    if (u.presetId === "admin") await assertNotLastAdmin(tx, u.id);
    const before = permSnapshot(await loadUserPerms(tx, u.id));
    await writeUserPerms(tx, u.id, input.perms);
    const after = await loadUserPerms(tx, u.id);
    await tx.update(users).set({ presetId: "custom", mfaRequired: needsMfa("custom", after) }).where(eq(users.id, u.id));
    await writeAudit(tx, actorRef(actor), {
      action: "permissions",
      entity: "users",
      entityId: u.id,
      summary: "Custom permissions set",
      before: { preset: u.presetId, perms: before },
      after: { preset: "custom", perms: permSnapshot(after) },
    });
  });
}

export async function setActive(actor: Actor, input: { userId: string; active: boolean }) {
  requireAdmin(actor);
  if (!input.active && input.userId === actor.userId) throw new RuleError("You can't deactivate your own account.");
  const u = await loadTarget(input.userId);
  guardOwner(actor, u, input.active ? "other" : "role");
  await getDb().transaction(async (tx) => {
    if (!input.active) {
      if (u.presetId === "admin") await assertNotLastAdmin(tx, u.id);
      await tx.update(users).set({ status: "deactivated" }).where(eq(users.id, u.id));
      await deleteSessions(tx, u.id);
    } else {
      await tx
        .update(users)
        .set({ status: u.passwordHash ? "active" : "invited", failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, u.id));
    }
    await writeAudit(tx, actorRef(actor), {
      action: input.active ? "activate" : "deactivate",
      entity: "users",
      entityId: u.id,
      summary: `${input.active ? "Reactivated" : "Deactivated"} ${u.email}`,
      before: { status: u.status },
      after: { status: input.active ? (u.passwordHash ? "active" : "invited") : "deactivated" },
    });
  });
}

export async function resetSessions(actor: Actor, userId: string) {
  requireAdmin(actor);
  const u = await loadTarget(userId);
  guardOwner(actor, u, "other");
  await getDb().transaction(async (tx) => {
    await deleteSessions(tx, u.id);
    await writeAudit(tx, actorRef(actor), { action: "sessions_reset", entity: "users", entityId: u.id, summary: `Ended every session for ${u.email}` });
  });
}

/** For a lost authenticator: they set up a new one at their next sign-in. */
export async function resetTwoFactor(actor: Actor, userId: string) {
  requireAdmin(actor);
  if (userId === actor.userId) throw new RuleError("Use the Security page to move two-factor to a new phone.");
  const u = await loadTarget(userId);
  guardOwner(actor, u, "other");
  await getDb().transaction(async (tx) => {
    await tx.update(users).set({ totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null }).where(eq(users.id, u.id));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, u.id));
    await deleteSessions(tx, u.id);
    await writeAudit(tx, actorRef(actor), { action: "mfa_reset", entity: "users", entityId: u.id, summary: `Two-factor reset for ${u.email}` });
  });
}

/** Editing a preset updates everyone currently on it (custom users are left alone). */
export async function updatePreset(actor: Actor, input: { presetId: string; perms: PermMap }) {
  requireAdmin(actor);
  if (LOCKED_PRESETS.has(input.presetId)) throw new RuleError("The Admin and Custom presets can't be edited.");
  await getDb().transaction(async (tx) => {
    const [preset] = await tx.select().from(rolePresets).where(eq(rolePresets.id, input.presetId));
    if (!preset) throw new RuleError("That preset no longer exists.");
    const before = permSnapshot(await loadPresetPerms(tx, preset.id));
    await writePresetPerms(tx, preset.id, input.perms);
    const onPreset = await tx.select({ id: users.id }).from(users).where(eq(users.presetId, preset.id));
    for (const m of onPreset) await copyPresetToUser(tx, m.id, preset.id);
    await writeAudit(tx, actorRef(actor), {
      action: "preset",
      entity: "role_presets",
      entityId: preset.id,
      summary: `${preset.name} preset edited (${onPreset.length} people updated)`,
      before,
      after: permSnapshot(await loadPresetPerms(tx, preset.id)),
    });
  });
}
