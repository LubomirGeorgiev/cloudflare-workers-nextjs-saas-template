import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { headers } from "next/headers";

import { getDB } from "@/db";
import { getUserFromDB, getUserTeamsWithPermissions } from "@/utils/session-user";
import { purgeUserPrincipalCaches } from "@/utils/kv-principal-purge";
import { mapInBatches } from "@/utils/map-in-batches";
import { getIP } from "./get-IP";
import { MAX_SESSIONS_PER_USER } from "@/constants";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";

const SESSION_PREFIX = APP_KV_PREFIXES.session;
// Refreshing a member runs several D1 reads and D1 allows only ~6 concurrent
// queries per invocation, so large teams are processed in small batches.
const TEAM_SESSION_REFRESH_BATCH_SIZE = 5;
// Deleting is one KV call per session, so this batch can be wider than the refresh one above.
const SESSION_DELETE_BATCH_SIZE = 10;
// Bump when KVSession changes so stored KV sessions are refreshed. v7: the user snapshot carries
// `bannedAt`, which `validateSessionToken` refuses on.
export const CURRENT_SESSION_VERSION = 7;

function getSessionKey(userId: string, sessionId: string): string {
  return `${SESSION_PREFIX}${userId}:${sessionId}`;
}

type KVSessionUser = Exclude<Awaited<ReturnType<typeof getUserFromDB>>, undefined>;

export interface KVSession {
  id: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
  user: KVSessionUser & {
    initials?: string;
  };
  country?: string;
  city?: string;
  continent?: string;
  ip?: string | null;
  userAgent?: string | null;
  authenticationType?: "passkey" | "password" | "google-oauth";
  passkeyCredentialId?: string;
  teams?: {
    id: string;
    name: string;
    slug: string;
    role: {
      id: string;
      name: string;
      isSystemRole: boolean;
    };
    permissions: string[];
    planId: string | null;
    subscriptionStatus: string | null;
  }[];
  selectedTeam?: string;
  // Increment CURRENT_SESSION_VERSION when changing persisted session shape.
  version?: number;
}

async function getKV() {
  const { env } = await getCloudflareContext();
  return env.KV_STORE;
}

export interface CreateKVSessionParams extends Omit<KVSession, "id" | "createdAt" | "expiresAt" | "selectedTeam"> {
  sessionId: string;
  expiresAt: Date;
  selectedTeam?: string;
}

export async function createKVSession({
  sessionId,
  userId,
  expiresAt,
  user,
  authenticationType,
  passkeyCredentialId,
  teams,
  selectedTeam
}: CreateKVSessionParams): Promise<KVSession> {
  const { cf } = await getCloudflareContext();
  const headersList = await headers();
  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  const session: KVSession = {
    id: sessionId,
    userId,
    expiresAt: expiresAt.getTime(),
    createdAt: Date.now(),
    country: cf?.country,
    city: cf?.city,
    continent: cf?.continent,
    ip: await getIP(),
    userAgent: headersList.get('user-agent'),
    user,
    authenticationType,
    passkeyCredentialId,
    teams,
    selectedTeam,
    version: CURRENT_SESSION_VERSION
  };

  const existingSessions = await getAllSessionIdsOfUser(userId);

  // Calculate how many sessions we need to delete to make room for the new one
  if (existingSessions.length >= MAX_SESSIONS_PER_USER) {
    // We need to delete enough sessions to get below the limit after adding the new one
    const sessionsToDelete = existingSessions.length - MAX_SESSIONS_PER_USER + 1;

    // Sort sessions by expiration time (oldest first)
    const sortedSessions = [...existingSessions].sort((a, b) => {
      // If a session has no expiration, treat it as oldest
      if (!a.absoluteExpiration) {
        return -1;
      }
      if (!b.absoluteExpiration) {
        return 1;
      }
      return a.absoluteExpiration.getTime() - b.absoluteExpiration.getTime();
    });

    // Delete the oldest sessions
    for (let i = 0; i < sessionsToDelete; i++) {
      const sessionKey = sortedSessions[i]?.key;
      if (!sessionKey) {
        continue;
      }

      const sessionId = sessionKey.split(':')[2];
      if (!sessionId) {
        continue;
      }

      await deleteKVSession(sessionId, userId);
    }
  }

  await kv.put(
    getSessionKey(userId, sessionId),
    JSON.stringify(session),
    {
      expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    }
  );

  return session;
}

export async function getKVSession(sessionId: string, userId: string): Promise<KVSession | null> {
  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  const sessionStr = await kv.get(getSessionKey(userId, sessionId));
  if (!sessionStr) {
    return null;
  }

  const session = JSON.parse(sessionStr) as KVSession

  if (session?.user?.createdAt) {
    session.user.createdAt = new Date(session.user.createdAt);
  }

  if (session?.user?.updatedAt) {
    session.user.updatedAt = new Date(session.user.updatedAt);
  }

  if (session?.user?.emailVerified) {
    session.user.emailVerified = new Date(session.user.emailVerified);
  }

  if (session?.user?.bannedAt) {
    session.user.bannedAt = new Date(session.user.bannedAt);
  }

  return session;
}

export async function updateKVSession(
  sessionId: string,
  userId: string,
  expiresAt: Date,
  userData?: KVSessionUser,
  teams?: KVSession['teams']
): Promise<KVSession | null> {
  const session = await getKVSession(sessionId, userId);
  if (!session) {
    return null;
  }

  // Only fetch user data if not provided
  const updatedUser = userData ?? await getUserFromDB(userId);

  if (!updatedUser) {
    throw new Error("User not found");
  }

  // Only fetch teams data if not provided
  const teamsWithPermissions = teams ?? await getUserTeamsWithPermissions(userId);

  const updatedSession: KVSession = {
    ...session,
    version: CURRENT_SESSION_VERSION,
    expiresAt: expiresAt.getTime(),
    user: updatedUser,
    teams: teamsWithPermissions
  };

  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  await kv.put(
    getSessionKey(userId, sessionId),
    JSON.stringify(updatedSession),
    {
      expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000)
    }
  );

  return updatedSession;
}

export async function deleteKVSession(sessionId: string, userId: string): Promise<void> {
  const session = await getKVSession(sessionId, userId);
  if (!session) {
    return;
  }

  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  await kv.delete(getSessionKey(userId, sessionId));
}

export async function updateKVSessionSelectedTeam(sessionId: string, userId: string, selectedTeam: string | undefined): Promise<KVSession | null> {
  const session = await getKVSession(sessionId, userId);
  if (!session) {
    return null;
  }

  const updatedSession: KVSession = {
    ...session,
    selectedTeam,
  };

  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  // Calculate the remaining TTL from the existing expiration
  const remainingTtl = Math.floor((session.expiresAt - Date.now()) / 1000);

  // Only update if the session hasn't expired
  if (remainingTtl > 0) {
    await kv.put(
      getSessionKey(userId, sessionId),
      JSON.stringify(updatedSession),
      {
        expirationTtl: remainingTtl
      }
    );
  } else {
    // Session has expired, return null
    return null;
  }

  return updatedSession;
}

export async function getAllSessionIdsOfUser(userId: string) {
  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  const sessions = await kv.list({ prefix: getSessionKey(userId, "") });

  return sessions.keys.map((session) => ({
    key: session.name,
    absoluteExpiration: session.expiration ? new Date(session.expiration * 1000) : undefined
  }))
}

export async function updateAllSessionsOfUser(userId: string) {
  // Independent reads (KV session list vs. D1 user row); the missing-user short-circuit below
  // still runs before the team lookup and the session writes.
  const [sessions, newUserData] = await Promise.all([
    getAllSessionIdsOfUser(userId),
    getUserFromDB(userId),
  ]);

  // The one purge site for bearer snapshots, and it runs even for a deleted user: only the session
  // refresh below has nothing left to do. Rebuilds read D1, which already holds the new identity.
  await purgeUserPrincipalCaches(userId);

  if (!newUserData) {
    return;
  }

  const teamsWithPermissions = await getUserTeamsWithPermissions(userId);

  await Promise.all(sessions.map(async (sessionObj) => {
    // Extract sessionId from key (format: "session:userId:sessionId")
    const sessionId = sessionObj.key.split(':')[2];
    if (!sessionId) {
      return;
    }

    // Only update non-expired sessions
    if (sessionObj.absoluteExpiration && sessionObj.absoluteExpiration.getTime() > Date.now()) {
      await updateKVSession(sessionId, userId, sessionObj.absoluteExpiration, newUserData, teamsWithPermissions);
    }
  }));
}

/**
 * Delete every KV session of one user, for the ban path.
 *
 * It deletes; it deliberately does NOT refresh. A refreshed session would still authenticate, and
 * a ban has to end the sessions, not update them. `updateAllSessionsOfUser` is the unban twin.
 *
 * Bounded like every other per-user KV fan-out: a user is capped at MAX_SESSIONS_PER_USER, but
 * the batch keeps this inside the Worker's subrequest budget either way.
 */
export async function deleteAllSessionsOfUser(userId: string): Promise<void> {
  const sessions = await getAllSessionIdsOfUser(userId);
  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  await mapInBatches({
    items: sessions,
    batchSize: SESSION_DELETE_BATCH_SIZE,
    // By key, not by id: `deleteKVSession` re-reads each session first, which is a wasted round
    // trip when the whole point is that none of them may survive.
    fn: (session) => kv.delete(session.key),
  });
}

// Re-fetch every member of a team (no request context needed) and refresh their KV
// sessions so cached team plan/permissions reflect the new subscription state.
// Fans out to many D1/KV operations — run it from the scheduler queue, not inline
// in webhooks or actions.
export async function refreshTeamMemberSessions(teamId: string): Promise<void> {
  const db = getDB();
  const memberships = await db.query.teamMembershipTable.findMany({
    where: { teamId },
    columns: { userId: true },
  });

  await mapInBatches({
    items: memberships,
    batchSize: TEAM_SESSION_REFRESH_BATCH_SIZE,
    // Bearer snapshots are dropped by updateAllSessionsOfUser itself; purging here too would
    // double every member's KV work.
    fn: (membership) => updateAllSessionsOfUser(membership.userId),
  });
}
