import "server-only";
import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  SYSTEM_ROLE_PERMISSIONS,
  TEAM_PERMISSIONS,
  type SystemRole,
} from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { getActiveTeamMembership } from "@/utils/team-membership";
import type { KVSession } from "@/utils/kv-session";
import { filterActiveTeamPermissions } from "@/lib/teams/permissions";

const DEFAULT_INVITATION_ROLE_ID = SYSTEM_ROLES_ENUM.MEMBER;

interface ResolvedInvitationRole {
  roleId: string;
  isSystemRole: boolean;
  permissions: string[];
}

// Resolves the role an invitation grants into a concrete permission set, shared by the invite
// and accept flows so both derive membership permissions identically. Owner is never grantable
// via invitation.
export async function resolveInvitationRole({
  db,
  teamId,
  roleId,
  isSystemRole,
}: {
  db: ReturnType<typeof getDB>;
  teamId: string;
  roleId: string;
  isSystemRole: boolean;
}): Promise<ResolvedInvitationRole> {
  if (isSystemRole) {
    if (roleId === SYSTEM_ROLES_ENUM.OWNER) {
      throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorOwnerViaInvite" });
    }

    const permissions = Object.hasOwn(SYSTEM_ROLE_PERMISSIONS, roleId)
      ? SYSTEM_ROLE_PERMISSIONS[roleId as SystemRole]
      : undefined;

    if (!permissions) {
      throw new ActionError("BAD_REQUEST", { key: "Client.Dashboard.Teams.errorInvalidRole" });
    }

    return {
      roleId,
      isSystemRole: true,
      permissions: [...permissions],
    };
  }

  const role = await db.query.teamRoleTable.findFirst({
    where: {
      id: roleId,
      teamId,
    },
  });

  if (!role) {
    throw new ActionError("NOT_FOUND", { key: "Client.Dashboard.Teams.errorRoleNotFound" });
  }

  return {
    roleId: role.id,
    isSystemRole: false,
    permissions: filterActiveTeamPermissions(role.permissions),
  };
}

// Ensures the inviter may assign the target role: they must hold role-assignment permission and
// cannot grant any permission they do not themselves hold (no privilege escalation). The default
// member role is always assignable by anyone allowed to invite.
export async function requirePermissionToAssignRole({
  session,
  teamId,
  role,
}: {
  session: KVSession;
  teamId: string;
  role: ResolvedInvitationRole;
}) {
  if (role.isSystemRole && role.roleId === DEFAULT_INVITATION_ROLE_ID) {
    return;
  }

  // Authoritative check against current D1 membership, not the stale KV session snapshot.
  const membership = await getActiveTeamMembership({ teamId, userId: session.user.id });
  const permissions = new Set(membership?.permissions ?? []);
  const canAssignRoles = permissions.has(TEAM_PERMISSIONS.ASSIGN_ROLES)
    || permissions.has(TEAM_PERMISSIONS.CHANGE_MEMBER_ROLES);

  if (!canAssignRoles) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorNoPermissionAssignRole" });
  }

  const canGrantRolePermissions = role.permissions.every((permission) => permissions.has(permission));

  if (!canGrantRolePermissions) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorCannotAssignPermissions" });
  }
}
