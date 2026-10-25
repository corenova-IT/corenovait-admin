"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { actorForAction, errorMessage } from "@/lib/auth/session";
import type { Actor } from "@/lib/dal/guard";
import * as team from "@/lib/dal/team";
import { inviteEmail, sendMail } from "@/lib/email";
import { MODULES, SCOPES, emptyPermMap, type PermMap } from "@/lib/permissions";

/**
 * Thin wrappers: validate the form with zod, then hand over to lib/dal/team,
 * which checks admin + two-factor and the last-admin rules itself.
 */
export type TeamState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

const uuid = z.string().uuid();
const presetId = z.string().regex(/^[a-z][a-z0-9_-]{1,31}$/);

const permsPayload = z
  .array(
    z.object({
      module: z.enum(MODULES),
      view: z.boolean(),
      create: z.boolean(),
      edit: z.boolean(),
      delete: z.boolean(),
      export: z.boolean(),
      scope: z.enum(SCOPES),
    })
  )
  .max(MODULES.length)
  .refine((rows) => new Set(rows.map((r) => r.module)).size === rows.length, "Each module can appear once");

function parsePerms(raw: FormDataEntryValue | null): PermMap | null {
  try {
    const rows = permsPayload.parse(JSON.parse(String(raw ?? "[]")));
    const map = emptyPermMap();
    for (const { module, ...p } of rows) map[module] = p;
    return map;
  } catch {
    return null;
  }
}

async function run(fn: (actor: Actor) => Promise<string>): Promise<TeamState> {
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    const ok = await fn(a.actor);
    revalidatePath("/team");
    return { ok };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------- invite ----------
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  fullName: z.string().trim().min(1, "Enter their name.").max(120),
  jobTitle: z.string().trim().max(120),
  presetId,
});

export async function inviteMember(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { fieldErrors };
  }
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    const inv = await team.inviteUser(a.actor, parsed.data);
    const mail = await sendMail(inviteEmail(inv.email, inv.name, inv.token, a.actor.fullName || a.actor.email));
    revalidatePath("/team");
    return mail.ok
      ? { ok: `Invite sent to ${inv.email}.` }
      : { error: `${inv.email} was added, but the email couldn't be sent. Check RESEND_API_KEY, then use "Resend invite".` };
  } catch (e) {
    const msg = errorMessage(e);
    return msg === "That email already has an account." ? { fieldErrors: { email: msg } } : { error: msg };
  }
}

export async function resendInvite(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Something went wrong. Try again." };
  const a = await actorForAction();
  if (!a.actor) return { error: a.error };
  try {
    const inv = await team.resendInvite(a.actor, userId.data);
    const mail = await sendMail(inviteEmail(inv.email, inv.name, inv.token, a.actor.fullName || a.actor.email));
    return mail.ok ? { ok: `A new invite is on its way to ${inv.email}. The old link no longer works.` } : { error: "The email couldn't be sent. Check the email settings and try again." };
  } catch (e) {
    return { error: errorMessage(e) };
  }
}

// ---------- details ----------
export async function saveDetails(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const parsed = z
    .object({ userId: uuid, fullName: z.string().trim().min(1, "Enter a name.").max(120), jobTitle: z.string().trim().max(120) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { fullName: parsed.error.issues[0].message } };
  return run((actor) => team.setDetails(actor, parsed.data).then(() => "Details saved."));
}

// ---------- role preset ----------
export async function applyPreset(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const parsed = z.object({ userId: uuid, presetId }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a role." };
  return run((actor) => team.applyPreset(actor, parsed.data).then(() => "Role applied. Their permissions now match the preset."));
}

// ---------- custom matrix ----------
export async function savePermissions(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const userId = uuid.safeParse(formData.get("userId"));
  const perms = parsePerms(formData.get("perms"));
  if (!userId.success || !perms) return { error: "Those permissions couldn't be read. Refresh and try again." };
  return run((actor) => team.setPermissions(actor, { userId: userId.data, perms }).then(() => "Custom permissions saved."));
}

// ---------- deactivate / reactivate ----------
export async function setActive(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const parsed = z.object({ userId: uuid, active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Something went wrong. Try again." };
  const active = parsed.data.active === "true";
  return run((actor) =>
    team
      .setActive(actor, { userId: parsed.data.userId, active })
      .then(() => (active ? "Account reactivated." : "Account deactivated and signed out everywhere."))
  );
}

// ---------- reset sessions ----------
export async function resetSessions(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Something went wrong. Try again." };
  return run(async (actor) => {
    await team.resetSessions(actor, userId.data);
    return userId.data === actor.userId
      ? "All your sessions were ended. You'll be asked to sign in again."
      : "Their sessions were ended. They'll need to sign in again.";
  });
}

// ---------- reset two-factor (lost phone) ----------
export async function resetTwoFactor(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Something went wrong. Try again." };
  return run((actor) =>
    team
      .resetTwoFactor(actor, userId.data)
      .then(() => "Two-factor was reset and they were signed out. They'll set up a new authenticator at their next sign-in.")
  );
}

// ---------- edit a preset ----------
export async function savePreset(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const id = presetId.safeParse(formData.get("presetId"));
  const perms = parsePerms(formData.get("perms"));
  if (!id.success || !perms) return { error: "That preset couldn't be read. Refresh and try again." };
  return run((actor) => team.updatePreset(actor, { presetId: id.data, perms }).then(() => "Preset saved. Everyone on this preset has been updated."));
}
