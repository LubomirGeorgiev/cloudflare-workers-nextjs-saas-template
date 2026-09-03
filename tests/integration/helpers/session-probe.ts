import { env } from "cloudflare:workers";

import { isBanned } from "@/lib/account/ban";
import { getKVSession, deleteKVSession, type KVSession } from "@/utils/kv-session";

// `validateSessionToken` is file-local in `src/utils/auth.ts` and its public entry needs a request
// cookie, which the Workers test pool has none of. This mirrors the ban branch of that function
// against the real KV store, so the test proves the stored snapshot is what refuses the session.
export async function getCurrentSessionForKey(sessionKey: string): Promise<KVSession | null> {
  const [, userId, sessionId] = sessionKey.split(":");

  if (!userId || !sessionId) {
    return null;
  }

  const session = await getKVSession(sessionId, userId);

  if (!session) {
    return null;
  }

  if (isBanned(session.user)) {
    await deleteKVSession(sessionId, userId);
    await env.KV_STORE.delete(sessionKey);

    return null;
  }

  return session;
}
