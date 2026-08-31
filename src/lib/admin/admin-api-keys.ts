import "server-only";

import { inArray } from "drizzle-orm";

import { API_KEY_PREFIX_ADMIN } from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable } from "@/db/schema";
import {
  apiKeyExpiryFromDays,
  issueApiKey,
  listOwnInternalApiKeys,
  revokeApiKey,
  type ApiKeySummary,
} from "@/lib/api-keys/api-keys";
import { ActionError } from "@/lib/action-error";
import { isAdminScope } from "@/lib/api/admin-scopes";
import type { CreateAdminApiKeySchema } from "@/schemas/admin-api-key.schema";
import { requireAdmin } from "@/utils/auth";

// D1 caps bound parameters at SQLite's 100 per statement, and a key id costs one. Expired rows are
// never swept and the capacity guard counts only live keys, so a user's internal key count has no
// ceiling — the revocation below chunks rather than trusting one.
const REVOKE_ID_CHUNK_SIZE = 50;

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
 * Revoked, not deleted, which is this codebase's rule for a spent credential: the row stays as
 * history and its hash can never be re-issued. A revoked key is invisible to every listing and
 * refused at the door, so it is gone in every sense that matters to a caller.
 *
 * Deliberately not built on `revokeApiKey`: that one is owner-authenticated and would refuse keys
 * belonging to the user being demoted, who is not the admin making the call. It also has no
 * caller-facing guard of its own — `setUserRole` is the only entry, and it proves admin first.
 *
 * The KV snapshots are NOT purged here. `setUserRole` calls `updateAllSessionsOfUser` immediately
 * after, which is the one purge site for bearer snapshots; purging here as well would be a second
 * KV fan-out over the same keys. Call it in that order or the snapshots outlive the revocation.
 */
export async function revokeInternalApiKeysForUser(userId: string): Promise<number> {
  const db = getDB();

  const keys = await db.query.apiKeyTable.findMany({
    where: { userId, revokedAt: { isNull: true } },
    columns: { id: true, scopes: true },
  });

  const internalKeyIds = keys
    .filter((key) => key.scopes.some(isAdminScope))
    .map((key) => key.id);

  if (internalKeyIds.length === 0) {
    return 0;
  }

  // One timestamp for the whole demotion, so chunking cannot make two keys revoked at once look
  // like two separate events. Every chunk is attempted even after one throws — a chunk left live is
  // a credential nobody can reach — and the first failure is rethrown once the rest are done.
  const revokedAt = new Date();
  let failure: unknown;

  for (let start = 0; start < internalKeyIds.length; start += REVOKE_ID_CHUNK_SIZE) {
    const chunk = internalKeyIds.slice(start, start + REVOKE_ID_CHUNK_SIZE);

    try {
      await db.update(apiKeyTable).set({ revokedAt }).where(inArray(apiKeyTable.id, chunk));
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    throw new Error("Internal API key chunk revocation failed", { cause: failure });
  }

  return internalKeyIds.length;
}
