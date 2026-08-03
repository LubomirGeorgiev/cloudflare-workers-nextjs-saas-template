import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import type { KVSession } from "@/utils/kv-session";
import { mapInBatches } from "@/utils/map-in-batches";
import { getUserFromDB, getUserTeamsWithPermissions } from "@/utils/session-user";

// Shared by the two bearer-credential snapshot caches (`apikey:` and `oauthgrant:`): both live in
// the same KV namespace as sessions, both cache the same user shape, and both need a per-user
// index to be purgeable, so that machinery lives here instead of once per credential kind.

interface PrincipalCache {
  /** Snapshot entry itself, keyed by the credential id (an API key hash, or a grant id). */
  snapshotPrefix: string;
  /** `userId:id` index, so a permission change can purge a user's snapshots without a full scan. */
  userIndexPrefix: string;
}

export const API_KEY_CACHE: PrincipalCache = {
  snapshotPrefix: APP_KV_PREFIXES.apiKey,
  userIndexPrefix: APP_KV_PREFIXES.apiKeyUser,
};

export const OAUTH_GRANT_CACHE: PrincipalCache = {
  snapshotPrefix: APP_KV_PREFIXES.oauthGrant,
  userIndexPrefix: APP_KV_PREFIXES.oauthGrantUser,
};

// Mirrors TEAM_SESSION_REFRESH_BATCH_SIZE: KV fan-out for one user's credentials stays bounded.
const PRINCIPAL_PURGE_BATCH_SIZE = 5;

async function getPrincipalCacheKV() {
  const { env } = await getCloudflareContext();

  if (!env.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  return env.NEXT_INC_CACHE_KV;
}

export function getSnapshotKey({ cache, id }: { cache: PrincipalCache; id: string }): string {
  return `${cache.snapshotPrefix}${id}`;
}

function getUserIndexKey(
  { cache, userId, id }: { cache: PrincipalCache; userId: string; id: string },
): string {
  return `${cache.userIndexPrefix}${userId}:${id}`;
}

// The caller owns the snapshot shape (each credential kind stores different fields), so the cast
// is theirs to justify with an `isUsableSnapshot` check — this only removes the KV handle,
// key-building, and JSON round-trip that both callers would otherwise repeat.
export async function readPrincipalSnapshot<T>(
  { cache, id }: { cache: PrincipalCache; id: string },
): Promise<T | null> {
  const kv = await getPrincipalCacheKV();
  const stored = await kv.get(getSnapshotKey({ cache, id }));

  return stored ? JSON.parse(stored) as T : null;
}

// The index entry carries the same TTL as the snapshot on purpose: a stale entry only ever costs
// one extra delete, while a missing one would leave a snapshot unreachable by a user-wide purge.
export async function putPrincipalSnapshot({
  cache,
  id,
  userId,
  snapshot,
  ttlSeconds,
}: {
  cache: PrincipalCache;
  id: string;
  userId: string;
  snapshot: unknown;
  ttlSeconds: number;
}): Promise<void> {
  const kv = await getPrincipalCacheKV();

  // Ordering invariant: index entry before snapshot. A failure between the two must leave the
  // harmless state — an index entry pointing at nothing (purge just deletes a missing key), never
  // a live snapshot no user-wide purge can reach.
  await kv.put(getUserIndexKey({ cache, userId, id }), id, {
    expirationTtl: ttlSeconds,
  });

  await kv.put(getSnapshotKey({ cache, id }), JSON.stringify(snapshot), {
    expirationTtl: ttlSeconds,
  });
}

export async function deletePrincipalSnapshot({
  cache,
  id,
  userId,
}: {
  cache: PrincipalCache;
  id: string;
  userId?: string;
}): Promise<void> {
  const kv = await getPrincipalCacheKV();

  // Mirror image of the put ordering: snapshot first, so a failure leaves at worst an index entry
  // whose snapshot is already gone, never a live snapshot orphaned by its deleted index entry.
  await kv.delete(getSnapshotKey({ cache, id }));

  if (userId) {
    await kv.delete(getUserIndexKey({ cache, userId, id }));
  }
}

async function purgeUserCache(
  { cache, userId }: { cache: PrincipalCache; userId: string },
): Promise<void> {
  const kv = await getPrincipalCacheKV();
  const indexPrefix = `${cache.userIndexPrefix}${userId}:`;
  const indexed = await kv.list({ prefix: indexPrefix });

  const ids = indexed.keys
    .map((entry) => entry.name.slice(indexPrefix.length))
    .filter(Boolean);

  await mapInBatches({
    items: ids,
    batchSize: PRINCIPAL_PURGE_BATCH_SIZE,
    fn: (id) => deletePrincipalSnapshot({ cache, id, userId }),
  });
}

// The single user-level purge entry point, called from the session refresh: every bearer credential
// caches the same identity a session does, so refreshing sessions without dropping these snapshots
// leaves API-key and OAuth callers reading stale data for the rest of the cache TTL.
export async function purgeUserPrincipalCaches(userId: string): Promise<void> {
  await Promise.all([
    purgeUserCache({ cache: API_KEY_CACHE, userId }),
    purgeUserCache({ cache: OAUTH_GRANT_CACHE, userId }),
  ]);
}

interface PrincipalIdentity {
  user: KVSession["user"];
  teams: KVSession["teams"];
}

// The rebuild-on-miss read both snapshot caches share. Only the identity is shared: expiry, usage
// stamps, and audience stay with each credential kind, whose policies genuinely differ.
export async function loadPrincipalIdentity(userId: string): Promise<PrincipalIdentity | null> {
  // Independent reads keyed by the same user; a missing user short-circuits the caller.
  const [user, teams] = await Promise.all([
    getUserFromDB(userId),
    getUserTeamsWithPermissions(userId),
  ]);

  return user ? { user, teams } : null;
}

/** KV round-trips JSON, so the Date columns the rest of the app expects come back as strings. */
export function reviveUserDates(user: KVSession["user"]): KVSession["user"] {
  return {
    ...user,
    createdAt: user.createdAt ? new Date(user.createdAt) : user.createdAt,
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : user.updatedAt,
    emailVerified: user.emailVerified ? new Date(user.emailVerified) : user.emailVerified,
  };
}
