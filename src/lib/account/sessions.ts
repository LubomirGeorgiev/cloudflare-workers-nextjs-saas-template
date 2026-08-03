import "server-only";

import { ActionError } from "@/lib/action-error";
import type { SessionWithMeta } from "@/types";
import { getCurrentSession } from "@/utils/auth";
import { parseUserAgent } from "@/utils/parse-user-agent";
import { deleteKVSession, getAllSessionIdsOfUser, getKVSession } from "@/utils/kv-session";

export async function getUserSessions(): Promise<SessionWithMeta[]> {
  const session = await getCurrentSession();

  if (!session?.user?.id) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Settings.Sessions.errorUnauthorized" });
  }

  const sessionIds = await getAllSessionIdsOfUser(session.user.id);
  const sessions = await Promise.all(
    sessionIds.map(async ({ key, absoluteExpiration }): Promise<SessionWithMeta | null> => {
      const sessionId = key.split(":")[2]; // Format is "session:userId:sessionId"
      const sessionData = await getKVSession(sessionId, session.user.id);
      if (!sessionData) {
        return null;
      }

      return {
        ...sessionData,
        isCurrentSession: sessionId === session.id,
        expiration: absoluteExpiration,
        createdAt: sessionData.createdAt ?? 0,
        parsedUserAgent: parseUserAgent(sessionData.userAgent),
      };
    })
  );

  // A session KV entry can vanish between the id listing and its read; newest first.
  return sessions
    .filter((session) => session !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Scoped by the caller's own user id, so a foreign session id can only ever delete nothing.
export async function revokeUserSession({ sessionId }: { sessionId: string }) {
  const session = await getCurrentSession();

  if (!session) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
  }

  await deleteKVSession(sessionId, session.user.id);

  return { success: true };
}
