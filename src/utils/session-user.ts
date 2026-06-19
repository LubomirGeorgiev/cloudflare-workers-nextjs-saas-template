import "server-only";

import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  TEAM_PERMISSIONS,
} from "@/db/schema";

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
      createdAt: true,
      updatedAt: true,
      currentCredits: true,
      lastCreditRefreshAt: true,
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

  return Promise.all(
    userTeamMemberships.map(async (membership) => {
      let roleName = "";
      let permissions: string[] = [];

      // System role IDs carry the role name, and permissions come from the fixed role contract.
      if (membership.isSystemRole) {
        roleName = membership.roleId;

        if (membership.roleId === SYSTEM_ROLES_ENUM.OWNER || membership.roleId === SYSTEM_ROLES_ENUM.ADMIN) {
          permissions = Object.values(TEAM_PERMISSIONS);
        } else if (membership.roleId === SYSTEM_ROLES_ENUM.MEMBER) {
          permissions = [
            TEAM_PERMISSIONS.ACCESS_DASHBOARD,
            TEAM_PERMISSIONS.CREATE_COMPONENTS,
            TEAM_PERMISSIONS.EDIT_COMPONENTS,
          ];
        } else if (membership.roleId === SYSTEM_ROLES_ENUM.GUEST) {
          permissions = [
            TEAM_PERMISSIONS.ACCESS_DASHBOARD,
          ];
        }
      } else {
        const role = await db.query.teamRoleTable.findFirst({
          where: { id: membership.roleId },
        });

        if (role) {
          roleName = role.name;
          // Custom role permissions are stored as JSON in D1.
          permissions = role.permissions as string[];
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
      };
    })
  );
}
