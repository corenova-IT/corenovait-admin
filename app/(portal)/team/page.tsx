import { PageHeader } from "@/components/ui/PageHeader";
import { TeamView } from "@/components/team/TeamView";
import type { Member, Preset } from "@/components/team/types";
import { requirePerm } from "@/lib/auth/session";
import { MODULES, toPermMap, type PermRow } from "@/lib/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { applyPreset, inviteMember, resetSessions, savePermissions, savePreset, saveDetails, setActive } from "./actions";

export const metadata = { title: "Team and permissions" };

type ProfileRow = { id: string; email: string; full_name: string; job_title: string; preset_id: string; active: boolean; mfa_required: boolean };

export default async function TeamPage() {
  const user = await requirePerm("team");
  const supabase = await createClient();

  const [profiles, userPerms, presets, presetPerms] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, job_title, preset_id, active, mfa_required").order("full_name").returns<ProfileRow[]>(),
    supabase.from("user_permissions").select("user_id, module, can_view, can_create, can_edit, can_delete, can_export, scope").returns<Array<PermRow & { user_id: string }>>(),
    supabase.from("role_presets").select("id, name, description, sort").order("sort"),
    supabase.from("preset_permissions").select("preset_id, module, can_view, can_create, can_edit, can_delete, can_export, scope").returns<Array<PermRow & { preset_id: string }>>(),
  ]);

  // Sign-in and two-factor status live in Supabase Auth, readable only with the service key.
  const authInfo = new Map<string, { lastSignIn: string | null; confirmed: boolean; mfa: boolean }>();
  let authReadable = false;
  if (user.isAdmin && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createAdminClient().auth.admin.listUsers({ perPage: 1000 });
    if (data?.users) {
      authReadable = true;
      for (const u of data.users) {
        authInfo.set(u.id, {
          lastSignIn: u.last_sign_in_at ?? null,
          confirmed: Boolean(u.last_sign_in_at || u.email_confirmed_at),
          mfa: (u.factors ?? []).some((f) => f.factor_type === "totp" && f.status === "verified"),
        });
      }
    }
  }

  const permsByUser = new Map<string, PermRow[]>();
  for (const p of userPerms.data ?? []) permsByUser.set(p.user_id, [...(permsByUser.get(p.user_id) ?? []), p]);

  const members: Member[] = (profiles.data ?? []).map((p) => {
    const a = authInfo.get(p.id);
    return {
      id: p.id,
      email: p.email,
      name: p.full_name,
      jobTitle: p.job_title,
      presetId: p.preset_id,
      status: !p.active ? "deactivated" : a && !a.lastSignIn ? "invited" : "active",
      mfaRequired: p.mfa_required,
      mfaEnabled: authReadable ? (a?.mfa ?? false) : null,
      lastSignIn: a?.lastSignIn ?? null,
      perms: toPermMap(permsByUser.get(p.id)),
    };
  });

  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.presetId, (counts.get(m.presetId) ?? 0) + 1);
  const presetList: Preset[] = (presets.data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    perms: toPermMap((presetPerms.data ?? []).filter((r) => r.preset_id === p.id)),
    editable: p.id !== "admin" && p.id !== "custom",
    memberCount: counts.get(p.id) ?? 0,
  }));

  return (
    <>
      <PageHeader title="Team and permissions" subtitle={`${members.length} people · ${MODULES.length} modules · admin only`} />
      <TeamView
        members={members}
        presets={presetList}
        canManage={user.isAdmin}
        currentUserId={user.userId}
        actions={{ inviteMember, saveDetails, applyPreset, savePermissions, setActive, resetSessions, savePreset }}
      />
    </>
  );
}
