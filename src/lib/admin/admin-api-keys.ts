import "server-only";

import { API_KEY_PREFIX_ADMIN } from "@/constants";
import { getDB } from "@/db";
import {
  apiKeyExpiryFromDays,
  issueApiKey,
  listOwnInternalApiKeys,
  revokeApiKey,
  type ApiKeySummary,
} from "@/lib/api-keys/api-keys";
import { deleteApiKeysByIds } from "@/lib/api-keys/delete-api-keys";
import { ActionError } from "@/lib/action-error";
import { isAdminScope } from "@/lib/api/admin-scopes";
import type { CreateAdminApiKeySchema } from "@/schemas/admin-api-key.schema";
import { requireAdmin } from "@/utils/auth";

// The only door that writes an `admin:*` scope to a credential: it is the one that passes the
// internal catalog to `issueApiKey`. Every other write path passes the public catalog, so it
// refuses these scopes as unknown names without needing to know the internal catalog exists.
//
// `requireAdmin` here is a cookie-session check: this is reachable from the admin panel and nowhere
// else. There is deliberately no REST or MCP operation that mints one of these keys, because that
// would let an admin credential extend its own lifetime without a human at a browser.

/**
 * A personal key (never team-scoped) carrying internal scopes. It is a normal API key in every
 * other respect — it counts against the owner's key limit and is revoked the same way — but it is
 * excluded from the owner-facing listings, so the admin panel is where its owner manages it.
 */
export async function createAdminApiKey(input: CreateAdminApiKeySchema) {
  await requireAdmin();

  // The catalog check lives here, not in the schema: the schema is shared with a client form, and
  // the internal catalog is `server-only`. A public scope is refused too — this door mints internal
  // credentials, and account settings is where a normal key is created.
  const unknown = input.scopes.filter((scope) => !isAdminScope(scope));

  if (unknown.length > 0) {
    throw new ActionError("INPUT_PARSE_ERROR", `Not an internal scope: ${unknown.join(", ")}`);
  }

  return issueApiKey({
    teamId: null,
    name: input.name,
    scopes: input.scopes,
    expiresAt: apiKeyExpiryFromDays(input.expiresInDays),
    isAllowedScope: isAdminScope,
    keyPrefix: API_KEY_PREFIX_ADMIN,
  });
}

/**
 * The caller's own internal keys. These are deliberately absent from account settings and from
 * `GET /api/v1/api-keys`, so this page is where their owner sees and revokes them.
 */
export async function listAdminApiKeys(): Promise<ApiKeySummary[]> {
  await requireAdmin();

  return listOwnInternalApiKeys();
}

export async function revokeAdminApiKey({ keyId }: { keyId: string }): Promise<void> {
  await requireAdmin();

  await revokeApiKey({ keyId });
}

/**
 * Revoke every internal key belonging to a user, for the demotion path in `setUserRole`.
 *
 * Deleted, not stamped: no surface has ever shown a revoked row, so a tombstone would only delay
 * this. `deleteApiKeysByIds` stamps each chunk revoked before it deletes it, so a chunk D1 refuses
 * is left dead rather than live, and the retention sweep collects it.
 *
 * Deliberately not built on `revokeApiKey`: that one is owner-authenticated and would refuse keys
 * belonging to the user being demoted, who is not the admin making the call. It also has no
 * caller-facing guard of its own — `setUserRole` is the only entry, and it proves admin first.
 * `setUserRole` still calls `updateAllSessionsOfUser` right after for the session side.
 */
export async function revokeInternalApiKeysForUser(userId: string): Promise<number> {
  const keys = await getDB().query.apiKeyTable.findMany({
    where: { userId },
    columns: { id: true, scopes: true },
  });

  const internalKeyIds = keys
    .filter((key) => key.scopes.some(isAdminScope))
    .map((key) => key.id);

  return deleteApiKeysByIds({ ids: internalKeyIds });
}
