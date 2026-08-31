import "server-only";

import { isApiScope, type ApiScope } from "@/lib/api/scopes";

// The internal scope catalog. `server-only` is load-bearing, not decoration: `./scopes.ts` is
// imported by client components (the settings scope picker, the connected-apps scope grid), so
// anything defined there ships in public JavaScript. Keeping these names in a module a client
// component cannot import turns a leak into a build error instead of a tree-shaking assumption.
//
// The separation does the same work at every other publication point. `provider-config.ts`
// advertises `API_SCOPE_NAMES` as `scopesSupported` and in RFC 9728 resource metadata,
// `clampScopesForClient` filters consent against it, the API key request schema picklists it, and
// `buildApiSecuritySchemes` publishes it as the OAuth flow's scope map. None of them can name a
// scope that is not in that array, so hiding these needs no filter in any of those files.
//
// An `admin:*` scope is reachable two ways, and never sufficient on its own — `assertAdminPrincipal`
// re-reads the account's live role on every request, whichever way the credential was issued:
//
//   1. An API key minted by `createAdminApiKey`, from the admin panel, by a signed-in admin.
//   2. An OAuth grant, so agent clients can log in normally — but only under the clamp below.

export const ADMIN_SCOPES = {
  "admin:read": {
    description: "Read internal administrative data across every account on this deployment.",
  },
  "admin:write": {
    description:
      "Perform internal administrative operations across every account on this deployment.",
  },
} as const satisfies Record<string, { description: string }>;

export type AdminScope = keyof typeof ADMIN_SCOPES;

export const ADMIN_SCOPE_NAMES = Object.keys(ADMIN_SCOPES) as AdminScope[];

export function isAdminScope(value: string): value is AdminScope {
  return Object.hasOwn(ADMIN_SCOPES, value);
}

/** Anything a stored credential may legitimately carry: the public catalog plus the internal one. */
export type GrantedScope = ApiScope | AdminScope;

export function isGrantedScope(value: string): value is GrantedScope {
  return isApiScope(value) || isAdminScope(value);
}

/**
 * The one validation point between a stored grant and a principal. Both resolvers admit both
 * catalogs, so this is not the boundary: `clampAdminScopesForConsent` decides who receives an
 * internal scope, `assertAdminPrincipal` decides who may use one. Unknown names drop, never reject.
 */
export function toGrantedScopes(scopes: string[]): GrantedScope[] {
  return scopes.filter(isGrantedScope);
}


/**
 * What an OAuth consent may grant from this catalog. Both conditions are required:
 *
 *   - the consenting user is a live admin, because a grant can only ever narrow its owner's
 *     permissions and a non-admin has none of these to give; and
 *   - the client is verified, because these scopes address every account on the deployment, and a
 *     self-registered client with a convincing name is cheap to create. This is the same tier the
 *     public catalog already applies to `api-keys:*` through `DCR_ALLOWED_SCOPES` — the internal
 *     scopes sit at least as high.
 *
 * An admin verifies a client from the consent screen itself, so the check costs one deliberate
 * click at the moment the decision is being made, not a trip to another page.
 */
export function clampAdminScopesForConsent({
  requestedScopes,
  isVerified,
  isAdmin,
}: {
  requestedScopes: string[];
  isVerified: boolean;
  isAdmin: boolean;
}): AdminScope[] {
  if (!isAdmin || !isVerified) {
    return [];
  }

  return requestedScopes.filter(isAdminScope);
}

/** Whether a request is asking for anything internal at all, before any clamp decides. */
export function requestedAdminScopes(requestedScopes: string[]): AdminScope[] {
  return requestedScopes.filter(isAdminScope);
}

/** Descriptions for the consent screen, which is a client component and cannot import this file. */
export function describeAdminScopes(scopes: AdminScope[]): Record<string, string> {
  return Object.fromEntries(scopes.map((scope) => [scope, ADMIN_SCOPES[scope].description]));
}
