import "server-only";

import { API_KEY_CACHE_TTL_SECONDS, OAUTH_GRANT_CACHE_TTL_SECONDS } from "@/constants";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import type { KVSession } from "@/utils/kv-session";
import { getUserFromDB, getUserTeamsWithPermissions } from "@/utils/session-user";

// Shared by the two bearer-credential snapshot caches (`apikey:` and `oauthgrant:`): both live in
// the same KV namespace as sessions and both cache the same user shape, so the KV handle, key
// building, and rebuild read live here instead of once per credential kind.
//
// Each cache gets its own read/write pair, never one generic pair, because a user-wide purge
// reaches them differently — their bearer paths know different things. An OAuth request carries
// `userId` in its token props, so its snapshots are invalidated by a per-user generation stamp
// every write must state. An API-key request carries only the secret, so it cannot build a per-user
// key without a second round trip; D1 already indexes a user's key hashes, so those snapshots are
// deleted by enumeration instead and carry no stamp at all.
//
// Each purge therefore lives with its credential module (`kv-api-key.ts`, `kv-oauth-grant.ts`), and
// `kv-principal-purge.ts` is the one entry point that runs both.

interface PrincipalCache {
  /** Snapshot entry itself, keyed by the credential id (an API key hash, or a grant id). */
  snapshotPrefix: string;
  ttlSeconds: number;
}

const API_KEY_CACHE: PrincipalCache = {
  snapshotPrefix: APP_KV_PREFIXES.apiKey,
  ttlSeconds: API_KEY_CACHE_TTL_SECONDS,
};

const OAUTH_GRANT_CACHE: PrincipalCache = {
  snapshotPrefix: APP_KV_PREFIXES.oauthGrant,
  ttlSeconds: OAUTH_GRANT_CACHE_TTL_SECONDS,
};

export async function getPrincipalCacheKV() {
  const { env } = await getCloudflareContext();

  if (!env.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  return env.NEXT_INC_CACHE_KV;
}

function getSnapshotKey({ cache, id }: { cache: PrincipalCache; id: string }): string {
  return `${cache.snapshotPrefix}${id}`;
}

export function getApiKeySnapshotKey(keyHash: string): string {
  return getSnapshotKey({ cache: API_KEY_CACHE, id: keyHash });
}

export function getGrantSnapshotKey(grantId: string): string {
  return getSnapshotKey({ cache: OAUTH_GRANT_CACHE, id: grantId });
}

export function getGrantGenerationKey(userId: string): string {
  return `${APP_KV_PREFIXES.oauthGrantGeneration}${userId}`;
}

async function readEntry<T>(key: string): Promise<T | null> {
  const kv = await getPrincipalCacheKV();
  const stored = await kv.get(key);

  return stored ? JSON.parse(stored) as T : null;
}

async function writeEntry(
  { key, body, ttlSeconds }: { key: string; body: unknown; ttlSeconds: number },
): Promise<void> {
  const kv = await getPrincipalCacheKV();

  await kv.put(key, JSON.stringify(body), { expirationTtl: ttlSeconds });
}

async function deleteEntry(key: string): Promise<void> {
  const kv = await getPrincipalCacheKV();

  await kv.delete(key);
}

// The API-key contract. The snapshot is stored exactly as the caller built it: nothing stamps it,
// because `purgeUserApiKeyCache` deletes these entries outright.

export async function readApiKeySnapshot<T>({ keyHash }: { keyHash: string }): Promise<T | null> {
  return readEntry<T>(getApiKeySnapshotKey(keyHash));
}

export async function putApiKeySnapshot<T extends object>(
  { keyHash, snapshot }: { keyHash: string; snapshot: T },
): Promise<void> {
  await writeEntry({
    key: getApiKeySnapshotKey(keyHash),
    body: snapshot,
    ttlSeconds: API_KEY_CACHE.ttlSeconds,
  });
}

export async function deleteApiKeySnapshot({ keyHash }: { keyHash: string }): Promise<void> {
  await deleteEntry(getApiKeySnapshotKey(keyHash));
}

// The grant contract. The stamp is an envelope around the caller's snapshot, not a field mixed into
// it: the cache owns the stamp, the caller owns the payload, and neither can shadow the other.

interface GrantSnapshotEnvelope<T> {
  generation: string | null;
  snapshot: T;
}

interface GrantSnapshotRead<T> {
  /** Null for a missing snapshot AND for one the last purge invalidated — both mean "rebuild". */
  snapshot: T | null;
  /** The stamp a rebuild must carry. Read before D1, so a purge mid-rebuild fails toward a miss. */
  generation: string | null;
}

// No stamp means no purge is still in force. The stamp outlives every snapshot written before it
// (see OAUTH_GRANT_GENERATION_TTL_SECONDS), so anything still alive once it expires was built
// after that purge and is safe to accept — which is what keeps expiry from causing false misses.
function isCurrentGeneration(
  { stamped, generation }: { stamped: string | null | undefined; generation: string | null },
): boolean {
  return generation === null || stamped === generation;
}

// The grant read, which is the snapshot and its user's stamp in one round trip. The caller owns
// the snapshot shape, so the cast is theirs to justify with an `isUsableSnapshot` check; this
// removes the KV handles, key building, JSON round-trip, and the generation comparison.
export async function readGrantSnapshot<T>({
  grantId,
  userId,
}: {
  grantId: string;
  userId: string;
}): Promise<GrantSnapshotRead<T>> {
  const kv = await getPrincipalCacheKV();

  // Independent keys, and the whole point of stamping by user: neither read blocks the other.
  const [stored, generation] = await Promise.all([
    kv.get(getGrantSnapshotKey(grantId)),
    kv.get(getGrantGenerationKey(userId)),
  ]);

  // Partial, because KV also holds entries written in an older shape: one without `snapshot` reads
  // as a miss and rebuilds, rather than handing the caller a half-built value.
  const envelope = stored ? JSON.parse(stored) as Partial<GrantSnapshotEnvelope<T>> : null;
  const snapshot = envelope?.snapshot ?? null;
  const usable = snapshot !== null &&
    isCurrentGeneration({ stamped: envelope?.generation, generation });

  return {
    snapshot: usable ? snapshot : null,
    generation,
  };
}

export async function putGrantSnapshot<T extends object>({
  grantId,
  snapshot,
  generation,
}: {
  grantId: string;
  snapshot: T;
  /**
   * Required, never optional: an entry written without the stamp its reader compares is one no
   * purge can invalidate. Pass the value read before the rebuild; `null` states no purge is in
   * force, which is a decision the caller has to make rather than omit.
   */
  generation: string | null;
}): Promise<void> {
  const envelope: GrantSnapshotEnvelope<T> = { generation, snapshot };

  await writeEntry({
    key: getGrantSnapshotKey(grantId),
    body: envelope,
    ttlSeconds: OAUTH_GRANT_CACHE.ttlSeconds,
  });
}

export async function deleteGrantSnapshot({ grantId }: { grantId: string }): Promise<void> {
  await deleteEntry(getGrantSnapshotKey(grantId));
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
