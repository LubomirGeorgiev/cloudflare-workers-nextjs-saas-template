import "server-only";

import {
  CURRENT_OAUTH_GRANT_CACHE_VERSION,
  OAUTH_GRANT_GENERATION_TTL_SECONDS,
} from "@/constants";
import { PERSONAL_AUDIENCE, type ApiPrincipal } from "@/lib/api/principal";
import { toApiScopes, type ApiScope } from "@/lib/api/scopes";
import type { OAuthBearerProps } from "@/lib/oauth/bearer-props";
import {
  deleteGrantSnapshot,
  getGrantGenerationKey,
  getPrincipalCacheKV,
  loadPrincipalIdentity,
  putGrantSnapshot,
  readGrantSnapshot,
  reviveUserDates,
} from "@/utils/kv-principal-cache";
import type { KVSession } from "@/utils/kv-session";
import { createRandomId } from "@/utils/random-token";

interface CachedOAuthGrant {
  version: number;
  userId: string;
  user: KVSession["user"];
  teams: KVSession["teams"];
}

function isUsableSnapshot(cached: CachedOAuthGrant | null): cached is CachedOAuthGrant {
  return Boolean(
    cached &&
      cached.version === CURRENT_OAUTH_GRANT_CACHE_VERSION &&
      cached.userId &&
      cached.user,
  );
}

// The provider has already validated the token and decrypted its props by the time this runs, so
// the only job left is turning a grant into the same principal shape a cookie session produces.
// The snapshot is cached for OAUTH_GRANT_CACHE_TTL_SECONDS and dropped early by
// `purgeUserPrincipalCaches` on a session refresh, or by `deleteOAuthGrantCache` on revocation.
export async function getOAuthGrantPrincipal(props: OAuthBearerProps): Promise<ApiPrincipal | null> {
  if (!props.userId) {
    return null;
  }

  // A token minted before the exchange callback ran (or one deliberately downscoped to nothing)
  // must not fall back to "unrestricted" — an empty scope list can do nothing, `null` can do all.
  // Fail closed on the way in: a scope the catalog no longer knows about grants nothing.
  const scopes = toApiScopes(props.scopes ?? []);

  // Read before the D1 rebuild below, never after: a purge landing in between then stamps this
  // snapshot with the superseded generation, which the next read rejects. The other order would
  // stamp pre-purge identity as current.
  let generation: string | null = null;

  if (props.grantId) {
    const read = await readGrantSnapshot<CachedOAuthGrant>({
      grantId: props.grantId,
      userId: props.userId,
    });
    generation = read.generation;

    if (isUsableSnapshot(read.snapshot) && read.snapshot.userId === props.userId) {
      return toPrincipal({ cached: read.snapshot, props, scopes });
    }
  }

  const identity = await loadPrincipalIdentity(props.userId);

  if (!identity) {
    return null;
  }

  const snapshot: CachedOAuthGrant = {
    version: CURRENT_OAUTH_GRANT_CACHE_VERSION,
    userId: props.userId,
    user: identity.user,
    teams: identity.teams,
  };

  if (props.grantId) {
    await putGrantSnapshot({ grantId: props.grantId, snapshot, generation });
  }

  return toPrincipal({ cached: snapshot, props, scopes });
}

function toPrincipal({
  cached,
  props,
  scopes,
}: {
  cached: CachedOAuthGrant;
  props: OAuthBearerProps;
  scopes: ApiScope[];
}): ApiPrincipal {
  return {
    kind: "oauth-grant",
    userId: cached.userId,
    user: reviveUserDates(cached.user),
    teams: cached.teams,
    scopes,
    // A grant is always approved by a person for their account; consent has no team dimension.
    audience: PERSONAL_AUDIENCE,
    grantId: props.grantId,
    clientId: props.clientId,
  };
}

// Called when a grant is revoked so the next request rebuilds (and finds nothing to rebuild from).
// Targeted at the one grant, unlike the generation stamp, which invalidates all of a user's.
export async function deleteOAuthGrantCache({ grantId }: { grantId: string }): Promise<void> {
  await deleteGrantSnapshot({ grantId });
}

// One blind write, so two concurrent purges cannot lose each other's work and a snapshot rebuild
// racing this one is stamped with the generation it read — stale by comparison, not accepted.
export async function purgeUserGrantCache(userId: string): Promise<void> {
  const kv = await getPrincipalCacheKV();

  await kv.put(getGrantGenerationKey(userId), createRandomId(), {
    expirationTtl: OAUTH_GRANT_GENERATION_TTL_SECONDS,
  });
}
