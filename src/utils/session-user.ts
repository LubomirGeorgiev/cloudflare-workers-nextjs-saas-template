import "server-only";

import { getDB } from "@/db";
import {
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRole,
} from "@/db/schema";
import { filterActiveTeamPermissions } from "@/lib/teams/permissions";

export async function getUserFromDB(userId: string) {
  const db = getDB();
  return await db.query.userTable.findFirst({
    where: { id: userId },
    columns: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      emailVerified: true,
      avatar: true,
      preferredLocale: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function getUserTeamsWithPermissions(userId: string) {
  const db = getDB();

  const userTeamMemberships = await db.query.teamMembershipTable.findMany({
    where: { userId: userId },
    with: {
      team: true,
    },
  });

  const customRoleIds = Array.from(new Set(
    userTeamMemberships
      .filter((membership) => !membership.isSystemRole)
      .map((membership) => membership.roleId),
  ));
  const customRoles = customRoleIds.length === 0
    ? []
    : await db.query.teamRoleTable.findMany({
        where: { id: { in: customRoleIds } },
      });
  const customRoleById = new Map(customRoles.map((role) => [role.id, role]));

  return userTeamMemberships.map((membership) => {
    let roleName = "";
    let permissions: string[] = [];

    // System role IDs carry the role name, and permissions come from the fixed role contract.
    if (membership.isSystemRole) {
      roleName = membership.roleId;
      const systemRolePermissions = Object.hasOwn(SYSTEM_ROLE_PERMISSIONS, membership.roleId)
        ? SYSTEM_ROLE_PERMISSIONS[membership.roleId as SystemRole]
        : [];
      permissions = [...systemRolePermissions];
    } else {
      const role = customRoleById.get(membership.roleId);

      if (role) {
        roleName = role.name;
        // Custom role permissions are stored as JSON in D1.
        permissions = filterActiveTeamPermissions(role.permissions as string[]);
      }
    }

    return {
      id: membership.teamId,
      name: membership.team.name,
      slug: membership.team.slug,
      role: {
        id: membership.roleId,
        name: roleName,
        isSystemRole: !!membership.isSystemRole,
      },
      permissions,
      // Carried in the session so entitlements/gating can read the team plan without a DB hit.
      planId: membership.team.subscriptionPlanId ?? null,
      subscriptionStatus: membership.team.subscriptionStatus ?? null,
    };
  });
}
