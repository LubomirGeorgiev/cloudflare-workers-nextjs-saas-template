import "server-only";

import { cache } from "react";

import { getDB } from "@/db";
import {
  SYSTEM_ROLE_PERMISSIONS,
  type SystemRole,
} from "@/db/schema";
import { filterActiveTeamPermissions } from "@/lib/teams/permissions";

// Authoritative, request-scoped view of a user's current membership in one team.
// Derived from D1 (never from the KV session), so revocation/expiry is honored promptly.
interface ActiveTeamMembership {
  teamId: string;
  userId: string;
  roleId: string;
  isSystemRole: boolean;
  roleName: string;
  permissions: string[];
}

// A membership grants access only while it is flagged active and not past its expiry.
// KV session hydration must apply the same test so it can't resurrect revoked access.
export function isMembershipCurrentlyActive({
  isActive,
  expiresAt,
}: {
  isActive: boolean | number;
  expiresAt: Date | null;
}): boolean {
  if (!isActive) {
    return false;
  }

  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return false;
  }

  return true;
}

// Resolves a membership's role name and effective permissions. Custom roles only count
// when the role row actually belongs to the membership's team; anything else is treated
// as "no permission" (empty set) so a mismatched/deleted role never grants access.
export function resolveMembershipPermissions({
  isSystemRole,
  roleId,
  teamId,
  customRole,
}: {
  isSystemRole: boolean;
  roleId: string;
  teamId: string;
  customRole: { name: string; permissions: string[]; teamId: string } | null;
}): { roleName: string; permissions: string[] } {
  if (isSystemRole) {
    const systemRolePermissions = Object.hasOwn(SYSTEM_ROLE_PERMISSIONS, roleId)
      ? SYSTEM_ROLE_PERMISSIONS[roleId as SystemRole]
      : [];

    return { roleName: roleId, permissions: [...systemRolePermissions] };
  }

  if (!customRole || customRole.teamId !== teamId) {
    return { roleName: "", permissions: [] };
  }

  return {
    roleName: customRole.name,
    permissions: filterActiveTeamPermissions(customRole.permissions),
  };
}

// Cached on positional primitives on purpose: React.cache keys by per-argument identity,
// so a fresh `{ teamId, userId }` object literal per call would never dedupe. Primitive
// args make the request-scoped memoization key on (teamId, userId) as intended. The
// exported wrapper below keeps the named-object public signature.
const getActiveTeamMembershipCached = cache(async (
  teamId: string,
  userId: string,
): Promise<ActiveTeamMembership | null> => {
  const db = getDB();

  const membership = await db.query.teamMembershipTable.findFirst({
    where: { teamId, userId },
  });

  if (!membership) {
    return null;
  }

  if (!isMembershipCurrentlyActive({
    isActive: membership.isActive,
    expiresAt: membership.expiresAt,
  })) {
    return null;
  }

  const isSystemRole = !!membership.isSystemRole;

  // Only fetch the custom role row when needed, and scope it to the team so a role from
  // another team can never satisfy this membership.
  const customRole = isSystemRole
    ? null
    : await db.query.teamRoleTable.findFirst({
        where: { id: membership.roleId, teamId },
      });

  const { roleName, permissions } = resolveMembershipPermissions({
    isSystemRole,
    roleId: membership.roleId,
    teamId,
    customRole: customRole ?? null,
  });

  return {
    teamId,
    userId,
    roleId: membership.roleId,
    isSystemRole,
    roleName,
    permissions,
  };
});

// Single authoritative membership lookup for the current request. Deduped to at most one
// D1 lookup per (teamId, userId) via the cached inner function above.
export function getActiveTeamMembership({
  teamId,
  userId,
}: {
  teamId: string;
  userId: string;
}): Promise<ActiveTeamMembership | null> {
  return getActiveTeamMembershipCached(teamId, userId);
}
