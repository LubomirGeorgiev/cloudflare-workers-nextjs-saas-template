import "server-only";

import { eq } from "drizzle-orm";

import { getDB } from "@/db";
import { apiKeyTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import {
  listConnectedAppsForUser,
  revokeConnectedAppForUser,
  type ConnectedApp,
} from "@/lib/oauth/connected-apps";
import { deleteTeamMembership } from "@/lib/teams/team-members";
import { createCustomRoleNameResolver } from "@/lib/teams/team-roles";
import { requireAdmin } from "@/utils/auth";
import { deleteApiKeyCache } from "@/utils/kv-api-key";

// Same projection as the owner-facing list plus the team a key is scoped to: an admin looking at
// one user needs to see personal and team keys side by side, which no single user surface shows.
export interface AdminApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: string[];
  teamId: string | null;
  teamName: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export interface AdminTeamMembership {
  membershipId: string;
  teamId: string;
  teamName: string;
  teamSlug: string;
  roleId: string;
  /** Set only for a custom role; system roles are labelled from `roleId` at the render site. */
  roleName: string | null;
  isSystemRole: boolean;
  isActive: boolean;
  joinedAt: Date | null;
}

interface AdminUserCredentials {
  connectedApps: ConnectedApp[];
  apiKeys: AdminApiKeySummary[];
  teams: AdminTeamMembership[];
}

// Everything revocable that hangs off one account, in one read. The OAuth half is a KV scan, so
// this is deliberately a single call the page can put behind its own Suspense boundary.
export async function getUserCredentials({ userId }: { userId: string }): Promise<AdminUserCredentials> {
  await requireAdmin();

  const [connectedApps, apiKeys, teams] = await Promise.all([
    listConnectedAppsForUser({ userId }),
    listUserApiKeys(userId),
    listUserTeamMemberships(userId),
  ]);

  return { connectedApps, apiKeys, teams };
}

// Revoked rows stay in D1 as history but never surface, matching the owner-facing list: a revoked
// key is not something anyone can act on.
async function listUserApiKeys(userId: string): Promise<AdminApiKeySummary[]> {
  const rows = await getDB().query.apiKeyTable.findMany({
    where: { userId, revokedAt: { isNull: true } },
    columns: {
      id: true,
      name: true,
      keyPrefix: true,
      last4: true,
      scopes: true,
      teamId: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    with: { team: { columns: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return rows.map(({ team, ...key }) => ({ ...key, teamName: team?.name ?? null }));
}

async function listUserTeamMemberships(userId: string): Promise<AdminTeamMembership[]> {
  const db = getDB();

  const memberships = await db.query.teamMembershipTable.findMany({
    where: { userId },
    columns: {
      id: true,
      teamId: true,
      roleId: true,
      isSystemRole: true,
      isActive: true,
      joinedAt: true,
    },
    with: { team: { columns: { name: true, slug: true } } },
  });

  const rows = memberships.map((membership) => ({
    ...membership,
    isSystemRole: Boolean(membership.isSystemRole),
  }));
  const resolveRoleName = await createCustomRoleNameResolver(rows);

  return rows.map((membership) => {
    const { isSystemRole } = membership;

    return {
      membershipId: membership.id,
      teamId: membership.teamId,
      teamName: membership.team.name,
      teamSlug: membership.team.slug,
      roleId: membership.roleId,
      roleName: resolveRoleName(membership),
      isSystemRole,
      isActive: Boolean(membership.isActive),
      joinedAt: membership.joinedAt,
    };
  });
}

export async function revokeUserConnectedApp({
  userId,
  grantId,
}: {
  userId: string;
  grantId: string;
}): Promise<{ success: true }> {
  await requireAdmin();

  await revokeConnectedAppForUser({ grantId, userId });

  return { success: true };
}

// Returns the key's team so the caller can invalidate the team page too: a team-scoped key is
// listed on both admin pages, and either one can revoke it.
export async function revokeUserApiKey({
  userId,
  keyId,
}: {
  userId: string;
  keyId: string;
}): Promise<{ success: true; teamId: string | null }> {
  await requireAdmin();

  const db = getDB();

  const key = await db.query.apiKeyTable.findFirst({
    where: { id: keyId },
    columns: { id: true, userId: true, keyHash: true, revokedAt: true, teamId: true },
  });

  // The owner is part of the request, not just the key id: it keeps a stale page from revoking a
  // key that no longer belongs to the user being viewed.
  if (!key || key.userId !== userId) {
    throw new ActionError("NOT_FOUND", { key: "Client.Settings.ApiKeys.errorKeyNotFound" });
  }

  if (!key.revokedAt) {
    await db.update(apiKeyTable).set({ revokedAt: new Date() }).where(eq(apiKeyTable.id, keyId));
  }

  // D1 is authoritative from here; dropping the snapshot is what makes revocation take effect
  // before the cache TTL would have expired it (still ≤60s of KV propagation).
  await deleteApiKeyCache({ keyHash: key.keyHash });

  return { success: true, teamId: key.teamId };
}

export async function removeUserFromTeam({
  userId,
  teamId,
}: {
  userId: string;
  teamId: string;
}) {
  await requireAdmin();

  return deleteTeamMembership({ teamId, userId });
}
