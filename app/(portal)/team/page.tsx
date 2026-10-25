import { PageHeader } from "@/components/ui/PageHeader";
import { TeamView } from "@/components/team/TeamView";
import { requirePerm } from "@/lib/auth/session";
import { listTeam } from "@/lib/dal/team";
import { MODULES } from "@/lib/permissions";
import { applyPreset, inviteMember, resendInvite, resetSessions, resetTwoFactor, savePermissions, savePreset, saveDetails, setActive } from "./actions";

export const metadata = { title: "Team and permissions" };

export default async function TeamPage() {
  const actor = await requirePerm("team");
  const { members, presets } = await listTeam(actor);

  return (
    <>
      <PageHeader title="Team and permissions" subtitle={`${members.length} people · ${MODULES.length} modules · admin only`} />
      <TeamView
        members={members}
        presets={presets}
        canManage={actor.isAdmin}
        currentUserId={actor.userId}
        actions={{ inviteMember, resendInvite, saveDetails, applyPreset, savePermissions, setActive, resetSessions, resetTwoFactor, savePreset }}
      />
    </>
  );
}
