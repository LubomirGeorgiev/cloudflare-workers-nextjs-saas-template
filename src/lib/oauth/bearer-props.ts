import "server-only";

import { isApiPrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { getOAuthGrantPrincipal } from "@/utils/kv-oauth-grant";

// What the OAuth provider hands to `apiHandlers` on `ctx.props` once a bearer credential has been
// accepted. Both credential types converge on `principalFromBearerProps` below, so every entry
// door (`/api/v1`, `/mcp`) builds one principal shape regardless of how the caller authenticated.

/** Set by `resolveExternalToken`; never persisted, so the resolved principal can ride along. */
export interface ApiKeyBearerProps {
  credentialKind: "api-key";
  principal: ApiPrincipal;
}

/**
 * Stamped at consent (`completeAuthorization`) and re-stamped per access token by the token
 * exchange callback. Deliberately minimal — permissions come from a user/team snapshot cached in
 * KV under a TTL and purged on session refresh or revocation, never from the grant itself.
 */
export interface OAuthBearerProps {
  credentialKind: "oauth-grant";
  userId: string;
  clientId: string;
  /** Added by the token exchange callback: the grant and the scopes of *this* access token. */
  grantId?: string;
  /** Raw as the provider stored them; validated against the catalog where the principal is built. */
  scopes?: string[];
}

type BearerProps = ApiKeyBearerProps | OAuthBearerProps;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

// Every field each variant needs is checked here, not just the discriminant: an OAuth grant's props
// have been through the provider's KV and JSON, and a half-populated blob that reached the
// principal builder would authenticate a request with fields nothing downstream can trust.
function readBearerProps(props: unknown): BearerProps | null {
  if (!props || typeof props !== "object") {
    return null;
  }

  const candidate = props as Record<string, unknown>;

  if (candidate.credentialKind === "api-key") {
    return isApiPrincipal(candidate.principal)
      ? { credentialKind: "api-key", principal: candidate.principal }
      : null;
  }

  if (candidate.credentialKind !== "oauth-grant") {
    return null;
  }
  if (typeof candidate.userId !== "string" || !candidate.userId) {
    return null;
  }
  if (typeof candidate.clientId !== "string" || !candidate.clientId) {
    return null;
  }
  if (candidate.grantId !== undefined && typeof candidate.grantId !== "string") {
    return null;
  }
  if (candidate.scopes !== undefined && !isStringArray(candidate.scopes)) {
    return null;
  }

  return {
    credentialKind: "oauth-grant",
    userId: candidate.userId,
    clientId: candidate.clientId,
    grantId: candidate.grantId,
    scopes: candidate.scopes,
  };
}

// The single credential-kind → principal dispatch. API keys carry their resolved principal; an
// OAuth grant carries only identity + scopes, so its snapshot is looked up (cached) per grant.
export async function principalFromBearerProps(props: unknown): Promise<ApiPrincipal | null> {
  const bearerProps = readBearerProps(props);
  if (!bearerProps) {
    return null;
  }

  return bearerProps.credentialKind === "api-key"
    ? bearerProps.principal
    : await getOAuthGrantPrincipal(bearerProps);
}
