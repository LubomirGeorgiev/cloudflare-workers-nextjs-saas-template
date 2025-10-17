import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

import { getUserFromDB, getUserTeamsWithPermissions } from "@/utils/auth";
import { getIP } from "./get-IP";
import { MAX_SESSIONS_PER_USER } from "@/constants";
const SESSION_PREFIX = "session:";

export function getSessionKey(userId: string, sessionId: string): string {
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
  /**
   * Teams data - contains list of teams the user is a member of
   * along with role and permissions data
   */
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
  }[];
  /**
   *  !!!!!!!!!!!!!!!!!!!!!
   *  !!!   IMPORTANT   !!!
   *  !!!!!!!!!!!!!!!!!!!!!
   *
   *  IF YOU MAKE ANY CHANGES TO THIS OBJECT DON'T FORGET TO INCREMENT "CURRENT_SESSION_VERSION" BELOW
   *  IF YOU FORGET, THE SESSION WILL NOT BE UPDATED IN THE DATABASE
   */
  version?: number;
}

/**
 *  !!!!!!!!!!!!!!!!!!!!!
 *  !!!   IMPORTANT   !!!
 *  !!!!!!!!!!!!!!!!!!!!!
 *
 * IF YOU MAKE ANY CHANGES TO THE KVSESSION TYPE ABOVE, YOU NEED TO INCREMENT THIS VERSION.
 * THIS IS HOW WE TRACK WHEN WE NEED TO UPDATE THE SESSIONS IN THE KV STORE.
 */
export const CURRENT_SESSION_VERSION = 3;

export async function getKV() {
  const { env } = getCloudflareContext();
  return env.NEXT_INC_CACHE_KV;
}

export interface CreateKVSessionParams extends Omit<KVSession, "id" | "createdAt" | "expiresAt"> {
  sessionId: string;
  expiresAt: Date;
}

export async function createKVSession({
  sessionId,
  userId,
  expiresAt,
  user,
  authenticationType,
  passkeyCredentialId,
  teams
}: CreateKVSessionParams): Promise<KVSession> {
  const { cf } = getCloudflareContext();
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
    version: CURRENT_SESSION_VERSION
  };

  // Check if user has reached the session limit
  const existingSessions = await getAllSessionIdsOfUser(userId);

  // If user has MAX_SESSIONS_PER_USER or more sessions, delete the oldest one
  if (existingSessions.length >= MAX_SESSIONS_PER_USER) {
    // Sort sessions by expiration time (oldest first)
    const sortedSessions = [...existingSessions].sort((a, b) => {
      // If a session has no expiration, treat it as oldest
      if (!a.absoluteExpiration) return -1;
      if (!b.absoluteExpiration) return 1;
      return a.absoluteExpiration.getTime() - b.absoluteExpiration.getTime();
    });

    // Delete the oldest session
    const oldestSessionKey = sortedSessions?.[0]?.key;
    const oldestSessionId = oldestSessionKey?.split(':')?.[2]; // Extract sessionId from key

    await deleteKVSession(oldestSessionId, userId);
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
  if (!sessionStr) return null;

  const session = JSON.parse(sessionStr) as KVSession

  if (session?.user?.createdAt) {
    session.user.createdAt = new Date(session.user.createdAt);
  }

  if (session?.user?.updatedAt) {
    session.user.updatedAt = new Date(session.user.updatedAt);
  }

  if (session?.user?.lastCreditRefreshAt) {
    session.user.lastCreditRefreshAt = new Date(session.user.lastCreditRefreshAt);
  }

  if (session?.user?.emailVerified) {
    session.user.emailVerified = new Date(session.user.emailVerified);
  }

  return session;
}

export async function updateKVSession(sessionId: string, userId: string, expiresAt: Date): Promise<KVSession | null> {
  const session = await getKVSession(sessionId, userId);
  if (!session) return null;

  const updatedUser = await getUserFromDB(userId);

  if (!updatedUser) {
    throw new Error("User not found");
  }

  // Get updated teams data with permissions
  const teamsWithPermissions = await getUserTeamsWithPermissions(userId);

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
  if (!session) return;

  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  await kv.delete(getSessionKey(userId, sessionId));
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

/**
 * Update all sessions of a user. It can only be called in a server actions and api routes.
 * @param userId
 */
export async function updateAllSessionsOfUser(userId: string) {
  const sessions = await getAllSessionIdsOfUser(userId);
  const kv = await getKV();

  if (!kv) {
    throw new Error("Can't connect to KV store");
  }

  const newUserData = await getUserFromDB(userId);

  if (!newUserData) return;

  // Get updated teams data with permissions
  const teamsWithPermissions = await getUserTeamsWithPermissions(userId);

  for (const sessionObj of sessions) {
    const session = await kv.get(sessionObj.key);
    if (!session) continue;

    const sessionData = JSON.parse(session) as KVSession;

    // Only update non-expired sessions
    if (sessionObj.absoluteExpiration && sessionObj.absoluteExpiration.getTime() > Date.now()) {
      const ttlInSeconds = Math.floor((sessionObj.absoluteExpiration.getTime() - Date.now()) / 1000);

      await kv.put(
        sessionObj.key,
        JSON.stringify({
          ...sessionData,
          user: newUserData,
          teams: teamsWithPermissions,
        }),
        { expirationTtl: ttlInSeconds }
      );
    }
  }
}
