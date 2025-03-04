import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { headers } from "next/headers";

import { getUserFromDB } from "@/utils/auth";
import { getIP } from "./get-IP";

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
  user: KVSessionUser;
  country?: string;
  city?: string;
  continent?: string;
  ip?: string | null;
  userAgent?: string | null;
  authenticationType?: "passkey" | "password" | "google-oauth";
  passkeyCredentialId?: string;
}

export async function getKV() {
  const { env } = getCloudflareContext();
  return env.NEXT_CACHE_WORKERS_KV;
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
  passkeyCredentialId
}: CreateKVSessionParams): Promise<KVSession> {
  const { cf } = getCloudflareContext();
  const headersList = await headers();
  const kv = await getKV();

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
    passkeyCredentialId
  };

  // TODO We should limit the number of sessions per user to 10
  // If we have more than 10 sessions, we should delete the oldest session

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

  const sessionStr = await kv.get(getSessionKey(userId, sessionId));
  if (!sessionStr) return null;

  return JSON.parse(sessionStr) as KVSession;
}

export async function updateKVSession(sessionId: string, userId: string, expiresAt: Date): Promise<KVSession | null> {
  const session = await getKVSession(sessionId, userId);
  if (!session) return null;

  const updatedUser = await getUserFromDB(userId);

  if (!updatedUser) {
    throw new Error("User not found");
  }

  const updatedSession: KVSession = {
    ...session,
    expiresAt: expiresAt.getTime(),
    user: updatedUser
  };

  const kv = await getKV();
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
  await kv.delete(getSessionKey(userId, sessionId));
}

export async function getAllSessionIdsOfUser(userId: string) {
  const kv = await getKV();
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
  const newUserData = await getUserFromDB(userId);

  if (!newUserData) return;

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
        }),
        { expirationTtl: ttlInSeconds }
      );
    }
  }
}
