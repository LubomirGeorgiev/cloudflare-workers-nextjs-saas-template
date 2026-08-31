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
import { toGrantedScopes, type GrantedScope } from "@/lib/api/admin-scopes";
import { isApiScope, scopesForAudience, type ApiScope } from "@/lib/api/scopes";
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
  /** Only the scopes the key can actually exercise; `toSummary` narrows the stored row. */
  scopes: GrantedScope[];
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

interface IssueApiKeyParams extends CreateApiKeyParams {
  /**
   * The catalog this door mints from. `issueApiKey` never names a catalog itself, so the public
   * door and the internal one share one creation policy and disagree on nothing but this predicate
   * and the prefix beside it.
   */
  isAllowedScope: (scope: string) => scope is GrantedScope;
  keyPrefix: string;
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

type ApiKeyRow = Omit<ApiKeySummary, "scopes"> & { scopes: string[]; revokedAt: Date | null };

// Narrowed exactly as the principal resolver narrows, so a key issued before the audience rule
// existed reads with the scopes it can actually use — on the settings page, in the REST listing,
// and during an incident review alike.
function toSummary(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    keyPrefix: row.keyPrefix,
    last4: row.last4,
    scopes: scopesForAudience({ scopes: toGrantedScopes(row.scopes), teamId: row.teamId }),
    teamId: row.teamId,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

// Scopes are stored as a grant snapshot, so an unknown string would silently become a permanent
// no-op grant. Reject it at the boundary and de-duplicate what survives.
function assertValidScopes({
  scopes,
  isAllowedScope,
}: {
  scopes: string[];
  isAllowedScope: (scope: string) => scope is GrantedScope;
}): GrantedScope[] {
  const unique = Array.from(new Set(scopes));

  if (unique.length === 0) {
    throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Settings.ApiKeys.errorScopesRequired" });
  }

  // A scope outside the door's catalog is not merely unauthorized, it is *unknown*: it fails the
  // same check a typo does, so a public door's refusal says nothing about an internal catalog.
  const valid = unique.filter(isAllowedScope);

  if (valid.length !== unique.length) {
    throw new ActionError("INPUT_PARSE_ERROR", { key: "Client.Settings.ApiKeys.errorInvalidScope" });
  }

  return valid;
}

// A team key is refused every account-level operation whatever its scopes, so granting it one
// writes a permission that can never be exercised. `scopesForAudience` owns the rule; the write
// path refuses what it drops, because dropping silently hands back a weaker key than was asked for.
function assertScopesFitAudience({
  scopes,
  teamId,
}: {
  scopes: GrantedScope[];
  teamId: string | null;
}): void {
  const usable = scopesForAudience({ scopes, teamId });

  if (usable.length === scopes.length) {
    return;
  }

  const refused = scopes.filter((scope) => !usable.includes(scope));

  throw new ActionError("INPUT_PARSE_ERROR", {
    key: "Client.Settings.ApiKeys.errorTeamKeyAccountScope",
    params: { scopes: refused.join(", ") },
  });
}

// No privilege escalation: a bearer credential can only ever mint a key that is a subset of
// itself. A cookie session (no principal, or `scopes: null`) may grant the whole catalog.
function assertNoScopeEscalation(scopes: GrantedScope[]): void {
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

// Expiry is collected in days by every door — the settings UI, the REST API, the admin panel — so
// no caller has to agree with the server about time zones.
export function apiKeyExpiryFromDays(days?: number | null): Date | null {
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

/**
 * The public door. Mints from the public catalog and nothing else, so the settings action, the REST
 * route, and MCP all refuse an unknown scope name without knowing another catalog exists.
 */
export function createApiKey(params: CreateApiKeyParams): Promise<CreatedApiKey> {
  return issueApiKey({ ...params, isAllowedScope: isApiScope, keyPrefix: API_KEY_PREFIX_LIVE });
}

// Self-authenticating like its siblings: creation policy lives here, not in the transport, so every
// write path (settings action, REST, MCP, the admin panel) mints keys under the same rules. The
// catalog is the one thing a door decides for itself; everything below applies to all of them.
export async function issueApiKey({
  teamId = null,
  name,
  scopes,
  expiresAt = null,
  isAllowedScope,
  keyPrefix,
}: IssueApiKeyParams): Promise<CreatedApiKey> {
  const session = await requireVerifiedEmail();
  const validScopes = assertValidScopes({ scopes, isAllowedScope });

  // Minting credentials is account-level: a team key must not be able to widen its own audience
  // by issuing a key for another team, or a personal one. The route declares this too.
  assertAccountAudience();
  assertNoScopeEscalation(validScopes);
  assertScopesFitAudience({ scopes: validScopes, teamId });

  if (teamId) {
    await requireTeamPermission(teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  }

  const userId = session.userId;
  const db = getDB();
  const d1 = db.$client;
  const id = `akey_${createRandomId()}`;
  const nowSec = toUnixSeconds(new Date());
  // The prefix comes from the door, never from the caller's intent: a door mints from one catalog,
  // so which prefix a key carries and which scopes it may hold are one decision made once.
  const generated = await generateApiKey({ prefix: keyPrefix });
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
async function listPersonalApiKeys(): Promise<ApiKeySummary[]> {
  const session = await requireVerifiedEmail();
  const db = getDB();

  const rows = await db.query.apiKeyTable.findMany({
    where: { userId: session.userId, teamId: { isNull: true }, revokedAt: { isNull: true } },
    columns: SUMMARY_COLUMNS,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toSummary);
}

/**
 * A key every one of whose scopes is in the public catalog. The owner-facing listings return this
 * narrower type, so the settings scope picker — which can only render public scopes — is handed a
 * value the type system already guarantees it can represent.
 */
export interface PublicApiKeySummary extends Omit<ApiKeySummary, "scopes"> {
  scopes: ApiScope[];
}

// The one classification the listings and the re-scope guard share, so no key is offered an edit
// control the guard then refuses. It reads a summary, whose scopes `toGrantedScopes` has already
// narrowed; a key mixing the two catalogs belongs with the internal ones.
function isPublicApiKey(key: ApiKeySummary): key is PublicApiKeySummary {
  return key.scopes.every(isApiScope);
}

/**
 * The owner-facing listing: account settings and `GET /api/v1/api-keys` both read it.
 *
 * Keys carrying a scope outside the public catalog are excluded, and that exclusion is load-bearing
 * rather than cosmetic. This response is reachable with `api-keys:read`, which a third-party OAuth
 * client can hold — listing an internal key here would publish the internal scope names to exactly
 * the audience the separate catalog exists to keep them from. Those keys are managed in the admin
 * panel, and an admin can still see and revoke any user's keys from the user detail page.
 */
export async function listUserApiKeys(): Promise<PublicApiKeySummary[]> {
  return (await listPersonalApiKeys()).filter(isPublicApiKey);
}

/** The complement, for the admin panel. Gated by `listAdminApiKeys`, which proves admin first. */
export async function listOwnInternalApiKeys(): Promise<ApiKeySummary[]> {
  return (await listPersonalApiKeys()).filter((key) => !isPublicApiKey(key));
}

/**
 * A team key can never hold an internal scope — those are account-only, so `toSummary` already
 * narrows them away for any row with a `teamId`. The filter states that rather than assuming it,
 * which is also what lets this return the type the team settings picker needs.
 */
export async function listTeamApiKeys({
  teamId,
}: {
  teamId: string;
}): Promise<PublicApiKeySummary[]> {
  await requireTeamPermission(teamId, TEAM_PERMISSIONS.MANAGE_API_KEYS);
  const db = getDB();

  const rows = await db.query.apiKeyTable.findMany({
    where: { teamId, revokedAt: { isNull: true } },
    columns: SUMMARY_COLUMNS,
    orderBy: { createdAt: "desc" },
  });

  return rows.map(toSummary).filter(isPublicApiKey);
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
  const validScopes = assertValidScopes({ scopes, isAllowedScope: isApiScope });

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

  assertScopesFitAudience({ scopes: validScopes, teamId: key.teamId });

  // Defense in depth: no UI offers this, but a caller that knows a key id reaches here, and this
  // path can only express public scopes, so re-scoping an internal key would silently strip it.
  // Classified exactly as the listings classify it, so what is shown and what is allowed agree.
  if (!isPublicApiKey(toSummary(key))) {
    throw new ActionError("FORBIDDEN", { key: "Client.Settings.ApiKeys.errorKeyNotEditable" });
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
