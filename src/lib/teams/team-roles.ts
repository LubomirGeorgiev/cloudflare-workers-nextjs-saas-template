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

// D1 caps bound parameters at SQLite's 100 per statement, and a role id costs one. A listing spans
// as many distinct custom roles as it has memberships, and nothing bounds that, so the lookup
// chunks rather than trust a ceiling no caller promised.
const ROLE_ID_CHUNK_SIZE = 50;

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

interface RoleBearingMembership {
  roleId: string;
  isSystemRole: boolean;
  teamId: string;
}

/**
 * The custom-role name lookup every membership listing needs. Custom role ids are per-team rows,
 * so their names take a second read; system roles carry no stored name and are labelled from the
 * id at the render site, which is why this returns null for them.
 *
 * One read for a whole listing, not one per membership. Carries no authorization: only call it
 * behind one.
 */
export async function createCustomRoleNameResolver(
  memberships: RoleBearingMembership[],
): Promise<(membership: RoleBearingMembership) => string | null> {
  const customRoleIds = Array.from(new Set(
    memberships.filter((membership) => !membership.isSystemRole).map((membership) => membership.roleId),
  ));

  const db = getDB();
  const customRoleById = new Map<string, { id: string; name: string; teamId: string }>();

  for (let start = 0; start < customRoleIds.length; start += ROLE_ID_CHUNK_SIZE) {
    const roles = await db.query.teamRoleTable.findMany({
      where: { id: { in: customRoleIds.slice(start, start + ROLE_ID_CHUNK_SIZE) } },
      columns: { id: true, name: true, teamId: true },
    });

    for (const role of roles) {
      customRoleById.set(role.id, role);
    }
  }

  return (membership) => {
    if (membership.isSystemRole) {
      return null;
    }

    // A custom role names a membership only on its own team. A roleId that points at another
    // team's role has no name here, the same rule `resolveMembershipPermissions` applies.
    const role = customRoleById.get(membership.roleId);

    return role && role.teamId === membership.teamId ? role.name : null;
  };
}
