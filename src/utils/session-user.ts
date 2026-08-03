import "server-only";

import { getDB } from "@/db";
import { ActionError } from "@/lib/action-error";
import { normalizeEmail } from "@/lib/validation";
import {
  isMembershipCurrentlyActive,
  resolveMembershipPermissions,
} from "@/utils/team-membership";
import type { CurrentSession } from "@/types";

// Returns the session user's normalized (trimmed/lowercased) email, or throws the localized
// "no account email" error. Centralizes the guard the invitation flows repeat so the missing-email
// policy fails closed here — never falling open to an empty predicate that would match every row.
export function requireNormalizedSessionEmail(session: CurrentSession): string {
  const email = session.user.email ? normalizeEmail(session.user.email) : null;
  if (!email) {
    throw new ActionError("FORBIDDEN", { key: "Client.Dashboard.Teams.errorNoAccountEmail" });
  }
  return email;
}

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

  // KV team data is a non-authoritative UI hint, but it must still exclude revoked
  // (inactive) or expired memberships so hydration never resurrects access that D1
  // no longer grants. Real authorization decisions go through team-auth.ts / D1.
  const activeMemberships = userTeamMemberships.filter((membership) =>
    isMembershipCurrentlyActive({
      isActive: membership.isActive,
      expiresAt: membership.expiresAt,
    }),
  );

  const customRoleIds = Array.from(new Set(
    activeMemberships
      .filter((membership) => !membership.isSystemRole)
      .map((membership) => membership.roleId),
  ));
  const customRoles = customRoleIds.length === 0
    ? []
    : await db.query.teamRoleTable.findMany({
        where: { id: { in: customRoleIds } },
      });
  const customRoleById = new Map(customRoles.map((role) => [role.id, role]));

  return activeMemberships.map((membership) => {
    const customRole = membership.isSystemRole
      ? null
      : customRoleById.get(membership.roleId) ?? null;

    // resolveMembershipPermissions enforces that a custom role belongs to this
    // membership's team; otherwise it resolves to no permissions.
    const { roleName, permissions } = resolveMembershipPermissions({
      isSystemRole: !!membership.isSystemRole,
      roleId: membership.roleId,
      teamId: membership.teamId,
      customRole,
    });

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
