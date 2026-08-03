import "server-only";

import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  SYSTEM_ROLE_PERMISSIONS,
  TEAM_PERMISSIONS,
} from "@/db/schema";
import { filterActiveTeamPermissions } from "@/lib/teams/permissions";
import { requireTeamPermission } from "@/utils/team-auth";

// Owner is held by exactly one membership and is never handed out by an invitation
// (`resolveInvitationRole` rejects it), so it is reported as not assignable rather than hidden —
// a caller reading a member's `roleId: "owner"` still needs to find it here.
const NON_ASSIGNABLE_SYSTEM_ROLES: readonly string[] = [SYSTEM_ROLES_ENUM.OWNER];

interface TeamRoleSummary {
  roleId: string;
  name: string | null;
  isSystemRole: boolean;
  /** Whether this role can be passed as `roleId` when inviting someone. */
  isAssignable: boolean;
  permissions: string[];
}

// Every role id `createTeamInvitation` accepts, in one read. System roles are code-defined and
// identical on every team; custom roles are per-team rows, so their ids are unguessable without
// this listing — which is the whole reason it exists.
export async function listTeamRoles(teamId: string): Promise<TeamRoleSummary[]> {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_DASHBOARD);

  const customRoles = await getDB().query.teamRoleTable.findMany({
    where: { teamId },
  });

  const systemRoles: TeamRoleSummary[] = Object.entries(SYSTEM_ROLE_PERMISSIONS)
    .map(([roleId, permissions]) => ({
      roleId,
      // System roles carry no stored name; clients label them from the id, as the dashboard does.
      name: null,
      isSystemRole: true,
      isAssignable: !NON_ASSIGNABLE_SYSTEM_ROLES.includes(roleId),
      permissions: [...permissions],
    }));

  return [
    ...systemRoles,
    ...customRoles.map((role) => ({
      roleId: role.id,
      name: role.name,
      isSystemRole: false,
      isAssignable: true,
      permissions: filterActiveTeamPermissions(role.permissions),
    })),
  ];
}
