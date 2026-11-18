import { PageHeader } from "@/components/ui/PageHeader";
import { TeamView } from "@/components/team/TeamView";
import { requirePerm } from "@/lib/auth/session";
import { assignmentOverview } from "@/lib/dal/assignments";
import { hasSampleData } from "@/lib/dal/finance";
import { listTeam } from "@/lib/dal/team";
import { MODULES } from "@/lib/permissions";
import { applyPreset, inviteMember, resendInvite, resetSessions, resetTwoFactor, saveAssignments, savePermissions, savePreset, saveDetails, setActive } from "./actions";

export const metadata = { title: "Team and permissions" };

const NO_ASSIGNMENTS = { options: { streams: [], countries: [] }, byUser: {} };

export default async function TeamPage() {
  const actor = await requirePerm("team");
  const [{ members, presets }, sample] = await Promise.all([listTeam(actor), hasSampleData(actor)]);
  // streams and countries can only be given out by an admin
  const { options, byUser } = actor.isAdmin ? await assignmentOverview(actor) : NO_ASSIGNMENTS;

  return (
    <>
      <PageHeader title="Team and permissions" subtitle={`${members.length} people · ${MODULES.length} modules · admin only`} sample={sample} />
      <TeamView
        members={members}
        presets={presets}
        canManage={actor.isAdmin}
        currentUserId={actor.userId}
        assignOptions={options}
        assignments={byUser}
        actions={{ inviteMember, saveAssignments, resendInvite, saveDetails, applyPreset, savePermissions, setActive, resetSessions, resetTwoFactor, savePreset }}
      />
    </>
  );
}
