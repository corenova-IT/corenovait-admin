"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { userForAction } from "@/lib/auth/session";
import { siteUrl } from "@/lib/env";
import { MODULES, SCOPES } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TeamState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

/**
 * Every action re-checks the caller on the server. The database functions
 * check again (admin + two-factor), so a forged request still fails.
 */
async function adminGuard() {
  const r = await userForAction("team", "edit");
  if (!r.user) return { error: r.error };
  if (!r.user.isAdmin) return { error: "Only admins can manage the team." };
  const supabase = await createClient();
  const { data: ok } = await supabase.rpc("is_admin");
  if (!ok) return { error: "Verify your two-factor code again, then retry." };
  return { supabase, user: r.user };
}

function dbError(err: { message: string; code?: string } | null): string {
  if (!err) return "Something went wrong. Try again.";
  // our database functions raise plain-language messages with these codes
  if (["42501", "22023", "P0002"].includes(err.code ?? "")) return err.message;
  return "That change couldn't be saved. Refresh the page and try again.";
}

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

function parsePerms(raw: FormDataEntryValue | null) {
  try {
    return permsPayload.parse(JSON.parse(String(raw ?? "[]")));
  } catch {
    return null;
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
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const parsed = inviteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] = i.message;
    return { fieldErrors };
  }
  const { email, fullName, jobTitle } = parsed.data;
  if (parsed.data.presetId === "custom") return { fieldErrors: { presetId: "Invite with a preset, then customise their permissions." } };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${siteUrl()}/auth/confirm?next=/set-password`,
  });
  if (error || !data.user) {
    if (/already|registered|exists/i.test(error?.message ?? "")) return { fieldErrors: { email: "That email already has an account." } };
    return { error: "The invite couldn't be sent. Check the email settings in Supabase, then try again." };
  }
  const newId = data.user.id;
  const details = await g.supabase.rpc("admin_set_user_details", { p_user: newId, p_full_name: fullName, p_job_title: jobTitle });
  if (details.error) return { error: dbError(details.error) };
  if (parsed.data.presetId !== "staff") {
    const preset = await g.supabase.rpc("admin_apply_preset", { p_user: newId, p_preset: parsed.data.presetId });
    if (preset.error) return { error: `Invited, but the role couldn't be set: ${dbError(preset.error)}` };
  }
  await g.supabase.rpc("log_event", { p_action: "invite", p_entity: "profiles", p_entity_id: newId, p_summary: `Invited ${email}` });
  revalidatePath("/team");
  return { ok: `Invite sent to ${email}.` };
}

// ---------- details ----------
export async function saveDetails(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const parsed = z
    .object({ userId: uuid, fullName: z.string().trim().min(1, "Enter a name.").max(120), jobTitle: z.string().trim().max(120) })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: { fullName: parsed.error.issues[0].message } };
  const { error } = await g.supabase.rpc("admin_set_user_details", {
    p_user: parsed.data.userId,
    p_full_name: parsed.data.fullName,
    p_job_title: parsed.data.jobTitle,
  });
  if (error) return { error: dbError(error) };
  revalidatePath("/team");
  return { ok: "Details saved." };
}

// ---------- role preset ----------
export async function applyPreset(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const parsed = z.object({ userId: uuid, presetId }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a role." };
  const { error } = await g.supabase.rpc("admin_apply_preset", { p_user: parsed.data.userId, p_preset: parsed.data.presetId });
  if (error) return { error: dbError(error) };
  revalidatePath("/team");
  return { ok: "Role applied. Their permissions now match the preset." };
}

// ---------- custom matrix ----------
export async function savePermissions(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const userId = uuid.safeParse(formData.get("userId"));
  const perms = parsePerms(formData.get("perms"));
  if (!userId.success || !perms) return { error: "Those permissions couldn't be read. Refresh and try again." };
  const { error } = await g.supabase.rpc("admin_set_user_permissions", { p_user: userId.data, p_perms: perms });
  if (error) return { error: dbError(error) };
  revalidatePath("/team");
  return { ok: "Custom permissions saved." };
}

// ---------- deactivate / reactivate ----------
export async function setActive(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const parsed = z.object({ userId: uuid, active: z.enum(["true", "false"]) }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Something went wrong. Try again." };
  const active = parsed.data.active === "true";
  const { error } = await g.supabase.rpc("admin_set_active", { p_user: parsed.data.userId, p_active: active });
  if (error) return { error: dbError(error) };
  // also block (or unblock) sign-in at the Auth level
  const ban = await createAdminClient().auth.admin.updateUserById(parsed.data.userId, {
    ban_duration: active ? "none" : "876000h",
  });
  if (ban.error) return { error: "Access was changed, but sign-in couldn't be updated. Try again." };
  revalidatePath("/team");
  return { ok: active ? "Account reactivated." : "Account deactivated and signed out everywhere." };
}

// ---------- reset sessions ----------
export async function resetSessions(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const userId = uuid.safeParse(formData.get("userId"));
  if (!userId.success) return { error: "Something went wrong. Try again." };
  const { error } = await g.supabase.rpc("admin_reset_sessions", { p_user: userId.data });
  if (error) return { error: dbError(error) };
  revalidatePath("/team");
  return {
    ok:
      userId.data === g.user.userId
        ? "All your sessions were ended. You'll be asked to sign in again."
        : "Their sessions were ended. They'll need to sign in again.",
  };
}

// ---------- edit a preset ----------
export async function savePreset(_prev: TeamState, formData: FormData): Promise<TeamState> {
  const g = await adminGuard();
  if ("error" in g) return { error: g.error };
  const id = presetId.safeParse(formData.get("presetId"));
  const perms = parsePerms(formData.get("perms"));
  if (!id.success || !perms) return { error: "That preset couldn't be read. Refresh and try again." };
  const { error } = await g.supabase.rpc("admin_update_preset", { p_preset: id.data, p_perms: perms });
  if (error) return { error: dbError(error) };
  revalidatePath("/team");
  return { ok: "Preset saved. Everyone on this preset has been updated." };
}
