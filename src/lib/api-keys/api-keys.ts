import "server-only";

import { eq } from "drizzle-orm";

import {
  API_KEY_PREFIX_LIVE,
  MAX_API_KEYS_PER_TEAM,
  MAX_API_KEYS_PER_USER,
} from "@/constants";
import { getDB } from "@/db";
import { TEAM_PERMISSIONS, apiKeyTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { assertAccountAudience, getBearerPrincipal } from "@/lib/api/principal";
import { isApiScope, type ApiScope } from "@/lib/api/scopes";
import { didInsert, toUnixSeconds } from "@/lib/teams/team-writes";
import type { CreateApiKeySchema } from "@/schemas/api-key.schema";
import { generateApiKey } from "@/utils/api-key-format";
import { requireVerifiedEmail } from "@/utils/auth";
import { deleteApiKeyCache } from "@/utils/kv-api-key";
import { createRandomId } from "@/utils/random-token";
import { requireTeamPermission } from "@/utils/team-auth";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

// Prose, not a catalog key: only a machine caller can ever hit this refusal, and it reaches one
// verbatim as the RFC 9457 `detail`.
const ESCALATION_DETAIL =
  "A key cannot be granted scopes the creating credential does not itself hold.";

// Client-safe projection: never leaks `keyHash`, and there is no column holding the secret.
export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: string[];
  teamId: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

interface CreatedApiKey {
  key: ApiKeySummary;
  /** Returned exactly once, at creation; it is never recoverable afterwards. */
  secret: string;
}

interface CreateApiKeyParams {
  teamId?: string | null;
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
}

const SUMMARY_COLUMNS = {
  id: true,
  name: true,
  keyPrefix: true,
  last4: true,
  scopes: true,
  teamId: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

type ApiKeyRow = ApiKeySummary & { revokedAt: Date | null };

function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    last4: row.last4,
    scopes: row.scopes,
    teamId: row.teamId,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

// Scopes are stored as a grant snapshot, so an unknown string would silently become a permanent
// no-op grant. Reject it at the boundary and de-duplicate what survives.
function assertValidScopes(scopes: string[]): ApiScope[] {
  const unique = Array.from(new Set(scopes));

  if (unique.length === 0) {
    throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Settings.ApiKeys.errorScopesRequired" });
  }

  const valid = unique.filter(isApiScope);

  if (valid.length !== unique.length) {
    throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Settings.ApiKeys.errorInvalidScope" });
  }

  return valid;
}

// No privilege escalation: a bearer credential can only ever mint a key that is a subset of
// itself. A cookie session (no principal, or `scopes: null`) may grant the whole catalog.
function assertNoScopeEscalation(scopes: ApiScope[]): void {
  const granted = getBearerPrincipal()?.scopes;

  if (!granted) {
    return;
  }

  if (scopes.some((scope) => !granted.includes(scope))) {
    throw new ActionError("FORBIDDEN", ESCALATION_DETAIL);
  }
}

// Only a live key holds a slot: revoked and expired rows are history, not capacity. The guard is
// evaluated inside the INSERT so concurrent creates cannot both pass a stale count (D1 has no
// transactions — same pattern as team-writes.ts).
function buildCapacityGuard({
  userId,
  teamId,
  nowSec,
}: {
  userId: string;
  teamId: string | null;
  nowSec: number;
}): { predicate: string; binds: (string | number)[] } {
  const liveKey = `"revokedAt" IS NULL AND ("expiresAt" IS NULL OR "expiresAt" > ?)`;

  if (teamId) {
    return {
      predicate: `(SELECT COUNT(*) FROM api_key WHERE "teamId" = ? AND ${liveKey}) < ?`,
      binds: [teamId, nowSec, MAX_API_KEYS_PER_TEAM],
    };
  }

  return {
    predicate: `(SELECT COUNT(*) FROM api_key WHERE "userId" = ? AND "teamId" IS NULL AND ${liveKey}) < ?`,
    binds: [userId, nowSec, MAX_API_KEYS_PER_USER],
  };
}

// Expiry is collected in days by both the settings UI and the REST API, so neither caller has to
// agree with the server about time zones.
function apiKeyExpiryFromDays(days?: number | null): Date | null {
  return days ? new Date(Date.now() + days * DAY_IN_MS) : null;
}

/**
 * `createApiKey` from the validated request shape both write paths already parse, so the settings
 * action and the REST route share one translation instead of each mapping the fields themselves.
 */
export function createApiKeyFromInput(input: CreateApiKeySchema) {
  return createApiKey({
    teamId: input.teamId ?? null,
    name: input.name,
    scopes: input.scopes,
    expiresAt: apiKeyExpiryFromDays(input.expiresInDays),
  });
}

// Self-authenticating like its siblings: creation policy lives here, not in the transport, so
// every write path (settings action, REST, MCP, a future script) mints keys under the same rules.
export async function createApiKey({
  teamId = null,
  name,
  scopes,
  expiresAt = null,
}: CreateApiKeyParams): Promise<CreatedApiKey> {
  const session = await requireVerifiedEmail();
  const validScopes = assertValidScopes(scopes);

  // Minting credentials is account-level: a team key must not be able to widen its own audience
  // by issuing a key for another team, or a personal one. The route declares this too.
  assertAccountAudience();
  assertNoScopeEscalation(validScopes);

  if (teamId) {
    await requireTeamPermission(teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  }

  const userId = session.userId;
  const db = getDB();
  const d1 = db.$client;
  const id = `akey_${createRandomId()}`;
  const nowSec = toUnixSeconds(new Date());
  const generated = await generateApiKey({ prefix: API_KEY_PREFIX_LIVE });
  const guard = buildCapacityGuard({ userId, teamId, nowSec });

  const result = await d1
    .prepare(
      `INSERT INTO api_key
         ("id", "createdAt", "updatedAt", "updateCounter", "userId", "teamId", "name", "keyHash",
          "keyPrefix", "last4", "scopes", "expiresAt", "revokedAt", "lastUsedAt")
       SELECT ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL
       WHERE ${guard.predicate}`,
    )
    .bind(
      id,
      nowSec,
      nowSec,
      userId,
      teamId,
      name,
      generated.hash,
      generated.prefix,
      generated.last4,
      JSON.stringify(validScopes),
      expiresAt ? toUnixSeconds(expiresAt) : null,
      ...guard.binds,
    )
    .run();

  if (!didInsert(result)) {
    throw new ActionError("PRECONDITION_FAILED", teamId
      ? { key: "Client.Settings.ApiKeys.errorTeamLimitReached", params: { max: MAX_API_KEYS_PER_TEAM } }
      : { key: "Client.Settings.ApiKeys.errorUserLimitReached", params: { max: MAX_API_KEYS_PER_USER } });
  }

  return {
    secret: generated.secret,
    key: {
      id,
      name,
      keyPrefix: generated.prefix,
      last4: generated.last4,
      scopes: validScopes,
      teamId,
      createdAt: new Date(nowSec * 1000),
      lastUsedAt: null,
      expiresAt: expiresAt ?? null,
    },
  };
}

// Revoked rows stay in D1 as history but never surface: a revoked key is not something the owner
// can act on, and the row only exists so the hash can never be re-issued.
export async function listUserApiKeys(): Promise<ApiKeySummary[]> {
  const session = await requireVerifiedEmail();
  const db = getDB();

  const rows = await db.query.apiKeyTable.findMany({
    where: { userId: session.userId, teamId: { isNull: true }, revokedAt: { isNull: true } },
    columns: SUMMARY_COLUMNS,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toSummary);
}

export async function listTeamApiKeys({ teamId }: { teamId: string }): Promise<ApiKeySummary[]> {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  const db = getDB();

  const rows = await db.query.apiKeyTable.findMany({
    where: { teamId, revokedAt: { isNull: true } },
    columns: SUMMARY_COLUMNS,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toSummary);
}

// Revalidation target for the surface a key is rendered on; null for a personal key. Carries no
// authorization of its own, so only call it alongside an authorized read or write on the same key.
export async function getApiKeyTeamSlug({ keyId }: { keyId: string }): Promise<string | null> {
  const db = getDB();

  const row = await db.query.apiKeyTable.findFirst({
    where: { id: keyId },
    columns: { teamId: true },
    with: { team: { columns: { slug: true } } },
  });

  return row?.team?.slug ?? null;
}

// Re-scoping is a write on a live credential, so it answers to the same policy minting one does:
// account audience, no escalation, and the caller's team permission when the key belongs to a team.
export async function updateApiKeyScopes({
  keyId,
  scopes,
}: {
  keyId: string;
  scopes: string[];
}): Promise<ApiKeySummary> {
  const session = await requireVerifiedEmail();
  const validScopes = assertValidScopes(scopes);

  assertAccountAudience();
  assertNoScopeEscalation(validScopes);

  const db = getDB();
  const key = await db.query.apiKeyTable.findFirst({
    where: { id: keyId },
    columns: { ...SUMMARY_COLUMNS, userId: true, keyHash: true },
  });

  // Same response for "not yours", "does not exist", and "already revoked" so key ids cannot be
  // probed, and so a revoked row stays as unactionable as it is invisible.
  if (!key || key.revokedAt || (!key.teamId && key.userId !== session.userId)) {
    throw new ActionError("NOT_FOUND", { key: "Client.Settings.ApiKeys.errorKeyNotFound" });
  }

  if (key.teamId) {
    await requireTeamPermission(key.teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  }

  await db.update(apiKeyTable).set({ scopes: validScopes }).where(eq(apiKeyTable.id, keyId));

  // The KV snapshot embeds the granted scopes, so without this a narrowed key would keep its old
  // power until the cache TTL expired it.
  await deleteApiKeyCache({ keyHash: key.keyHash });

  return toSummary({ ...key, scopes: validScopes });
}

export async function revokeApiKey({ keyId }: { keyId: string }): Promise<{ success: true }> {
  const session = await requireVerifiedEmail();
  const db = getDB();

  const key = await db.query.apiKeyTable.findFirst({
    where: { id: keyId },
    columns: { id: true, userId: true, teamId: true, keyHash: true, revokedAt: true },
  });

  // Same response for "not yours" and "does not exist" so key ids cannot be probed.
  if (!key || (!key.teamId && key.userId !== session.userId)) {
    throw new ActionError("NOT_FOUND", { key: "Client.Settings.ApiKeys.errorKeyNotFound" });
  }

  if (key.teamId) {
    await requireTeamPermission(key.teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  }

  if (!key.revokedAt) {
    await db
      .update(apiKeyTable)
      .set({ revokedAt: new Date() })
      .where(eq(apiKeyTable.id, keyId));
  }

  // D1 is authoritative from here; deleting the snapshot is what makes revocation take effect
  // before the cache TTL would have expired it (still ≤60s of KV propagation).
  await deleteApiKeyCache({ keyHash: key.keyHash });

  return { success: true };
}
