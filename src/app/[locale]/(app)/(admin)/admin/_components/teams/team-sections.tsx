import { listTeamApiKeys, listTeamInvitations, listTeamMembers } from "@/lib/admin/teams";
import { requireAdmin } from "@/utils/auth";
import { TeamApiKeys } from "./team-api-keys";
import { TeamInvitations } from "./team-invitations";
import { TeamMembersTable } from "./team-members-table";

// Split from the page because the roster read is the expensive one — up to 500 memberships, each
// resolving a role name: the header and billing cards paint first and these three stream in behind
// their own Suspense boundary.
export async function TeamSections({
  teamId,
  teamName,
  memberCount,
}: {
  teamId: string;
  teamName: string;
  memberCount: number;
}) {
  // The data layer authorizes nowhere, and this is its own entry point into it, cached by the
  // guard the page already passed.
  await requireAdmin();

  const [members, invitations, apiKeys] = await Promise.all([
    listTeamMembers(teamId),
    listTeamInvitations(teamId),
    listTeamApiKeys(teamId),
  ]);

  return (
    <div className="grid gap-6">
      <TeamMembersTable
        teamId={teamId}
        teamName={teamName}
        members={members}
        memberCount={memberCount}
      />
      <TeamInvitations invitations={invitations} />
      <TeamApiKeys apiKeys={apiKeys} />
    </div>
  );
}
