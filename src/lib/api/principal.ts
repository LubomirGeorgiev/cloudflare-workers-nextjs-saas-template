import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { ActionError } from "@/lib/action-error";
import type { ApiScope } from "@/lib/api/scopes";
import type { CurrentSession } from "@/types";
import type { KVSession } from "@/utils/kv-session";
import { getInitials } from "@/utils/name-initials";

// Prose, not catalog keys: these reach machine clients as an RFC 9457 `detail` and an MCP agent
// reads them verbatim. Naming the scope is what lets an agent ask for the right one.
const NO_PRINCIPAL_DETAIL = "This request carries no authenticated credential.";

function missingScopeDetail(scope: ApiScope): string {
  return `This credential is missing the required scope: ${scope}.`;
}

/**
 * Who a credential may act as. A team key is confined to the team it was created for; everything
 * else (personal key, OAuth grant, cookie session) acts for the whole account. Like a scope, an
 * audience only ever narrows the owner's live permissions — it never grants one.
 */
type ApiAudience = { type: "personal" } | { type: "team"; teamId: string };

export const PERSONAL_AUDIENCE: ApiAudience = { type: "personal" };

interface ApiPrincipalBase {
  userId: string;
  user: KVSession["user"];
  teams: KVSession["teams"];
  /** Always an array: a credential narrows the owner's permissions, it never widens them. */
  scopes: ApiScope[];
  /** Required rather than optional so every credential resolver has to decide what it is. */
  audience: ApiAudience;
}

export interface ApiKeyPrincipal extends ApiPrincipalBase {
  kind: "api-key";
  keyId: string;
}

export interface OAuthGrantPrincipal extends ApiPrincipalBase {
  kind: "oauth-grant";
  clientId: string;
  /** Absent only on a token minted before the exchange callback stamped it; such a token cannot
   * be cached or rate-limited per grant, so it falls back to account-wide handling. */
  grantId?: string;
}

// A discriminated union, not one wide shape: `keyId` exists exactly when the credential is a key.
// There is deliberately no cookie-session variant — a cookie caller never enters the ALS at all,
// and "no principal in scope" is what the guards below read as unrestricted.
export type ApiPrincipal = ApiKeyPrincipal | OAuthGrantPrincipal;

export function toApiAudience(teamId: string | null | undefined): ApiAudience {
  return teamId ? { type: "team", teamId } : PERSONAL_AUDIENCE;
}

function isApiAudience(value: unknown): value is ApiAudience {
  if (!value || typeof value !== "object") {
    return false;
  }

  const audience = value as Record<string, unknown>;
  if (audience.type === "personal") {
    return true;
  }

  return audience.type === "team" && typeof audience.teamId === "string" && !!audience.teamId;
}

// The provider hands props back as `unknown` — an OAuth grant's have been through KV and JSON, so
// nothing but this check stands between a malformed blob and a principal the guards will trust.
export function isApiPrincipal(value: unknown): value is ApiPrincipal {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate.userId !== "string" || !candidate.userId) {
    return false;
  }
  if (!candidate.user || typeof candidate.user !== "object") {
    return false;
  }
  if (!Array.isArray(candidate.teams) || !Array.isArray(candidate.scopes)) {
    return false;
  }
  if (!isApiAudience(candidate.audience)) {
    return false;
  }

  if (candidate.kind === "api-key") {
    return typeof candidate.keyId === "string" && !!candidate.keyId;
  }
  if (candidate.kind === "oauth-grant") {
    return typeof candidate.clientId === "string" && !!candidate.clientId;
  }

  return false;
}

const principalStorage = new AsyncLocalStorage<ApiPrincipal>();

export function runWithPrincipal<T>(principal: ApiPrincipal, fn: () => T): T {
  return principalStorage.run(principal, fn);
}

export function getBearerPrincipal(): ApiPrincipal | undefined {
  return principalStorage.getStore();
}

export function hasScope(principal: ApiPrincipal, scope: ApiScope): boolean {
  return principal.scopes.includes(scope);
}

// Fails closed: callers run inside the API/MCP layer, which always establishes a principal, so a
// missing store means the request was never authenticated rather than "unrestricted cookie user".
export function requireScope(scope: ApiScope): ApiPrincipal {
  const principal = getBearerPrincipal();

  if (!principal) {
    throw new ActionError("NOT_AUTHORIZED", NO_PRINCIPAL_DETAIL);
  }

  if (!hasScope(principal, scope)) {
    throw new ActionError("FORBIDDEN", missingScopeDetail(scope));
  }

  return principal;
}

/** The team a bearer credential is confined to, or `null` for an account-wide caller. */
export function getAudienceTeamId(): string | null {
  const audience = getBearerPrincipal()?.audience;

  return audience?.type === "team" ? audience.teamId : null;
}

export function isTeamInAudience(teamId: string | undefined): boolean {
  const audienceTeamId = getAudienceTeamId();

  return audienceTeamId === null || audienceTeamId === teamId;
}

// Team-scoped operations. Missing principal = cookie session, which has no audience to violate;
// a missing `teamId` on a team-audience credential fails closed rather than passing unchecked.
export function assertTeamAudience(teamId: string | undefined): void {
  const audienceTeamId = getAudienceTeamId();

  if (audienceTeamId === null || audienceTeamId === teamId) {
    return;
  }

  throw new ActionError("FORBIDDEN", {
    key: "Client.Settings.ApiKeys.errorTeamKeyOtherTeam",
    params: { teamId: audienceTeamId },
  });
}

/** Account-level operations: profile, sessions, key management — never reachable by a team key. */
export function assertAccountAudience(): void {
  const audienceTeamId = getAudienceTeamId();

  if (audienceTeamId === null) {
    return;
  }

  throw new ActionError("FORBIDDEN", {
    key: "Client.Settings.ApiKeys.errorTeamKeyAccountOnly",
    params: { teamId: audienceTeamId },
  });
}

// The bridge that lets every existing `src/lib/**` function serve bearer callers unchanged:
// `getCurrentSession` returns this instead of reading cookies when a principal is in scope.
export function principalToSession(principal: ApiPrincipal): CurrentSession {
  return {
    // Nothing is stored in KV for bearer credentials, so the storage fields are null rather than
    // invented: session-keyed writes narrow on `kind`, and expiry lives on the credential.
    kind: "bearer",
    id: null,
    createdAt: null,
    expiresAt: null,
    userId: principal.userId,
    user: {
      ...principal.user,
      initials: getInitials(`${principal.user.firstName} ${principal.user.lastName}`),
    },
    teams: principal.teams,
  };
}
