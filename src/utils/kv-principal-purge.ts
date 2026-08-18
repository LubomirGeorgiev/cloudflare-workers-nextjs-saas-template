import "server-only";

import { purgeUserApiKeyCache } from "@/utils/kv-api-key";
import { purgeUserGrantCache } from "@/utils/kv-oauth-grant";

// Its own module because both credential modules already import `kv-principal-cache.ts`; putting
// this coordinator there would import them back and close a cycle.

// The single user-level purge entry point, called from the session refresh: every bearer credential
// caches the same identity a session does, so refreshing sessions without dropping these snapshots
// leaves API-key and OAuth callers reading stale data for the rest of the cache TTL.
export async function purgeUserPrincipalCaches(userId: string): Promise<void> {
  await Promise.all([
    purgeUserApiKeyCache(userId),
    purgeUserGrantCache(userId),
  ]);
}
