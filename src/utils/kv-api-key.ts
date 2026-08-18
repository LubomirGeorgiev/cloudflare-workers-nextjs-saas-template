import "server-only";

import { eq } from "drizzle-orm";
import ms from "ms";

import { CURRENT_API_KEY_CACHE_VERSION } from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable } from "@/db/schema";
import { toApiAudience, type ApiPrincipal } from "@/lib/api/principal";
import { toApiScopes } from "@/lib/api/scopes";
import { looksLikeApiKey } from "@/utils/api-key-format";
import {
  deleteApiKeySnapshot,
  loadPrincipalIdentity,
  putApiKeySnapshot,
  readApiKeySnapshot,
  reviveUserDates,
} from "@/utils/kv-principal-cache";
import type { KVSession } from "@/utils/kv-session";
import { mapInBatches } from "@/utils/map-in-batches";
import { hashToken } from "@/utils/random-token";
import { createBackgroundTouch } from "@/utils/throttled-background-touch";

// `lastUsedAt` is a usage hint, not an audit trail. The snapshot is deliberately NOT rewritten on a
// touch: refreshing its TTL would keep a busy key cached forever and defeat revocation. That makes
// the stored stamp permanently stale within a generation, so it can only rule out the first write —
// the isolate-local throttle below is what bounds a hot key to one write per interval.
export const LAST_USED_UPDATE_INTERVAL_MS = ms("5m");

// Mirrors TEAM_SESSION_REFRESH_BATCH_SIZE: KV fan-out for one user's credentials stays bounded.
const API_KEY_PURGE_BATCH_SIZE = 5;

interface CachedApiKey {
  version: number;
  keyId: string;
  userId: string;
  teamId: string | null;
  /** As stored in D1 and JSON: validated against the catalog only when the principal is built. */
  scopes: string[];
  user: KVSession["user"];
  teams: KVSession["teams"];
  /** Unix ms, or null for a key that never expires. */
  expiresAt: number | null;
  lastUsedAt: number | null;
  /** Never written by this module; a revocation stamp from any writer makes the snapshot unusable. */
  revokedAt?: number | null;
}

// A snapshot is only usable while it matches the current version (permission semantics can change
// under it) and has not passed the key's own expiry. Revocation is represented by the entry's
// absence, so anything carrying a revocation stamp is treated as unusable too.
function isUsableSnapshot(cached: CachedApiKey | null): cached is CachedApiKey {
  if (!cached || cached.version !== CURRENT_API_KEY_CACHE_VERSION) {
    return false;
  }
  if (!cached.keyId || !cached.userId || !cached.user) {
    return false;
  }
  if (typeof cached.revokedAt === "number") {
    return false;
  }

  return cached.expiresAt === null || cached.expiresAt > Date.now();
}

function toPrincipal(cached: CachedApiKey): ApiPrincipal {
  return {
    kind: "api-key",
    userId: cached.userId,
    user: reviveUserDates(cached.user),
    teams: cached.teams,
    // Fail closed: a scope the catalog no longer knows about grants nothing.
    scopes: toApiScopes(cached.scopes),
    // The stored `teamId` is the key's audience: a team key may only ever act on that team.
    audience: toApiAudience(cached.teamId),
    keyId: cached.keyId,
  };
}

const apiKeyUsageTouch = createBackgroundTouch({
  intervalMs: LAST_USED_UPDATE_INTERVAL_MS,
  write: ({ id, now }) =>
    getDB().update(apiKeyTable).set({ lastUsedAt: now }).where(eq(apiKeyTable.id, id)),
});

function touchLastUsedAt({ keyId, lastUsedAt }: { keyId: string; lastUsedAt: number | null }): void {
  // The persisted stamp skips the write another isolate already made; the throttle inside
  // `apiKeyUsageTouch` is what stops every later hit on this stale snapshot from repeating it.
  if (lastUsedAt !== null && Date.now() - lastUsedAt < LAST_USED_UPDATE_INTERVAL_MS) {
    return;
  }

  apiKeyUsageTouch.touch(keyId);
}

export function resetApiKeyUsageThrottleForTests(): void {
  apiKeyUsageTouch.resetForTests();
}

// The bearer hot path. Returns null for anything that is not a currently valid key; it never
// throws for bad input, so callers can map null straight onto 401.
export async function getApiKeyPrincipal(secret: string): Promise<ApiPrincipal | null> {
  if (!looksLikeApiKey(secret)) {
    return null;
  }

  const keyHash = await hashToken(secret);
  const cached = await readApiKeySnapshot<CachedApiKey>({ keyHash });

  if (isUsableSnapshot(cached)) {
    touchLastUsedAt({ keyId: cached.keyId, lastUsedAt: cached.lastUsedAt });
    return toPrincipal(cached);
  }

  const db = getDB();
  const key = await db.query.apiKeyTable.findFirst({
    where: { keyHash },
    columns: {
      id: true,
      userId: true,
      teamId: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
    },
  });

  if (!key || key.revokedAt) {
    return null;
  }
  if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const identity = await loadPrincipalIdentity(key.userId);

  if (!identity) {
    return null;
  }

  const snapshot: CachedApiKey = {
    version: CURRENT_API_KEY_CACHE_VERSION,
    keyId: key.id,
    userId: key.userId,
    teamId: key.teamId,
    scopes: key.scopes,
    user: identity.user,
    teams: identity.teams,
    expiresAt: key.expiresAt ? key.expiresAt.getTime() : null,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.getTime() : null,
  };

  await putApiKeySnapshot({ keyHash, snapshot });
  touchLastUsedAt({ keyId: key.id, lastUsedAt: snapshot.lastUsedAt });

  return toPrincipal(snapshot);
}

export async function deleteApiKeyCache({ keyHash }: { keyHash: string }): Promise<void> {
  await deleteApiKeySnapshot({ keyHash });
}

// D1 is the index the KV key space cannot be: `api_key_user_id_idx` already maps a user to every
// hash their snapshots are keyed by, and a row cannot lose a write to a concurrent one. Revoked
// rows are included deliberately — re-deleting a gone snapshot is free, missing a live one is not.
export async function purgeUserApiKeyCache(userId: string): Promise<void> {
  const keys = await getDB()
    .select({ keyHash: apiKeyTable.keyHash })
    .from(apiKeyTable)
    .where(eq(apiKeyTable.userId, userId));

  await mapInBatches({
    items: keys,
    batchSize: API_KEY_PURGE_BATCH_SIZE,
    fn: ({ keyHash }) => deleteApiKeySnapshot({ keyHash }),
  });
}
