interface ApiScopeDefinition {
  /** Human-readable grant shown on the OAuth consent screen and in the API docs. */
  description: string;
  /**
   * True when every operation this scope opens declares `audience: "account"`. Such a scope is
   * dead weight on a team key — the audience guard refuses it whatever the scope says — so a team
   * key is never granted one. Required, not optional, so a fork adding a scope has to decide.
   * `tests/integration/api-route-policy.test.ts` audits each flag against the real route table.
   */
  accountOnly: boolean;
}

// Coarse resource-level grants: the single source of truth for API keys, OAuth consent, and the
// OpenAPI security schemes. A scope only ever narrows the credential owner's live permissions —
// fine-grained authorization stays with TEAM_PERMISSIONS. Downstream projects append their own.
export const API_SCOPES = {
  "profile:read": {
    description: "Read your account profile, sessions, and preferences.",
    accountOnly: true,
  },
  "profile:write": {
    description: "Update your account profile and revoke your sessions.",
    accountOnly: true,
  },
  "teams:read": {
    description: "List the teams you belong to and read their details.",
    accountOnly: false,
  },
  "teams:write": {
    description: "Create teams and change team details.",
    accountOnly: false,
  },
  "members:read": {
    description: "List the members of your teams.",
    accountOnly: false,
  },
  "members:write": {
    description: "Change and remove members of your teams.",
    accountOnly: false,
  },
  "invites:write": {
    description: "Send and revoke invitations to your teams.",
    accountOnly: false,
  },
  "billing:read": {
    description: "Read the subscription and billing status of your teams.",
    accountOnly: false,
  },
  "api-keys:read": {
    description: "List the API keys on your account and when they were last used.",
    accountOnly: true,
  },
  "api-keys:write": {
    description: "Create and revoke API keys on your account.",
    accountOnly: true,
  },
} as const satisfies Record<string, ApiScopeDefinition>;

export type ApiScope = keyof typeof API_SCOPES;

export const API_SCOPE_NAMES = Object.keys(API_SCOPES) as ApiScope[];

export function isApiScope(value: string): value is ApiScope {
  return Object.hasOwn(API_SCOPES, value);
}

// The internal `admin:*` catalog lives in `./admin-scopes.ts`, which is `server-only`, and is
// deliberately NOT re-exported here. This module is imported by client components (the settings
// scope picker, the connected-apps scope grid), so anything defined here ships in public JavaScript.
// Keeping the two apart makes a leak a build error rather than a tree-shaking assumption.

export function describeApiScope(scope: ApiScope): string {
  return API_SCOPES[scope].description;
}

/**
 * A scope no team-scoped credential can ever exercise, because only account operations open it.
 *
 * Anything outside the public catalog answers true, which is what keeps this free of any internal
 * import: an internal scope is account-only by definition (the admin app refuses a team audience),
 * and an unrecognized name grants nothing anyway, so denying it to a team key is also correct.
 */
export function isAccountOnlyScope(scope: string): boolean {
  return isApiScope(scope) ? API_SCOPES[scope].accountOnly : true;
}

/** What a team key may hold, in catalog order; the whole catalog for a personal one. */
export const TEAM_KEY_SCOPES: ApiScope[] = API_SCOPE_NAMES.filter(
  (scope) => !isAccountOnlyScope(scope),
);

/**
 * The scopes a credential with this audience may hold. Granting a team key an account-only scope
 * writes a permission it can never use, so both the write paths and the principal resolver narrow
 * through here — the resolver too, because a key issued before this rule still holds those rows.
 */
export function scopesForAudience<Scope extends string>({
  scopes,
  teamId,
}: {
  scopes: Scope[];
  teamId: string | null;
}): Scope[] {
  return teamId ? scopes.filter((scope) => !isAccountOnlyScope(scope)) : scopes;
}

// Credential management is off-limits to unverified clients in both directions: minting keys is an
// obvious escalation, and enumerating them tells an attacker which credentials exist to target.
const DCR_DENIED_SCOPES: ApiScope[] = ["api-keys:read", "api-keys:write"];

// Anti-phishing ceiling for clients nobody has vouched for — which is every self-registration
// through open DCR. Registration is anonymous, so a convincing-looking client is cheap to create;
// what it may ask a user to approve is not. Verifying the app in /admin/oauth-apps lifts this.
export const DCR_ALLOWED_SCOPES: ApiScope[] = API_SCOPE_NAMES.filter(
  (scope) => !DCR_DENIED_SCOPES.includes(scope),
);

// Enforced in our consent handler, which decides the scope string passed to completeAuthorization,
// so the clamp holds no matter what the client requested.
export function clampScopesForClient({
  requestedScopes,
  isVerified,
}: {
  requestedScopes: string[];
  isVerified: boolean;
}): ApiScope[] {
  const allowed = isVerified ? API_SCOPE_NAMES : DCR_ALLOWED_SCOPES;

  return requestedScopes.filter((scope): scope is ApiScope =>
    isApiScope(scope) && allowed.includes(scope),
  );
}
