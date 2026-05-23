"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { getAllSessionIdsOfUser, getKVSession, deleteKVSession } from "@/utils/kv-session";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { UAParser } from 'ua-parser-js';
import { SessionWithMeta } from "@/types";
import { v } from "@/lib/validation";

function isValidSession(session: unknown): session is SessionWithMeta {
  if (!session || typeof session !== 'object') return false;
  const sessionObj = session as Record<string, unknown>;
  return 'createdAt' in sessionObj && typeof sessionObj.createdAt === 'number';
}

export const getSessionsAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withRateLimit(
      async () => {
        const session = await getSessionFromCookie();

        if (!session?.user?.id) {
          throw new ActionError("NOT_AUTHORIZED", "Unauthorized");
        }

        const sessionIds = await getAllSessionIdsOfUser(session.user.id);
        const sessions = await Promise.all(
          sessionIds.map(async ({ key, absoluteExpiration }) => {
            const sessionId = key.split(":")[2]; // Format is "session:userId:sessionId"
            const sessionData = await getKVSession(sessionId, session.user.id);
            if (!sessionData) return null;

            // Parse user agent on the server
            const result = new UAParser(sessionData.userAgent ?? '').getResult();

            return {
              ...sessionData,
              isCurrentSession: sessionId === session.id,
              expiration: absoluteExpiration,
              createdAt: sessionData.createdAt ?? 0,
              parsedUserAgent: {
                ua: result.ua,
                browser: {
                  name: result.browser.name,
                  version: result.browser.version,
                  major: result.browser.major
                },
                device: {
                  model: result.device.model,
                  type: result.device.type,
                  vendor: result.device.vendor
                },
                engine: {
                  name: result.engine.name,
                  version: result.engine.version
                },
                os: {
                  name: result.os.name,
                  version: result.os.version
                }
              },
            } as SessionWithMeta;
          })
        );

        // Filter out any null sessions and sort by creation date
        return sessions
          .filter(isValidSession)
          .sort((a, b) => b.createdAt - a.createdAt);
      },
      RATE_LIMITS.SETTINGS
    );
  });

export const deleteSessionAction = actionClient
  .inputSchema(v.object({
    sessionId: v.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            "Not authenticated"
          );
        }

        await deleteKVSession(input.sessionId, session.user.id);

        return { success: true };
      },
      RATE_LIMITS.DELETE_SESSION
    );
  });
