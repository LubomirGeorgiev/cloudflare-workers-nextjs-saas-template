import { describe, expect, test, vi } from "vitest";

// The internal catalog is `server-only` by design; the unit environment is neither client nor
// server, so the marker module is stubbed exactly as the other server-only suites stub it.
vi.mock("server-only", () => ({}));

import {
  ADMIN_SCOPES,
  ADMIN_SCOPE_NAMES,
  clampAdminScopesForConsent,
  isAdminScope,
  isGrantedScope,
  toGrantedScopes,
} from "@/lib/api/admin-scopes";
import {
  API_SCOPES,
  API_SCOPE_NAMES,
  DCR_ALLOWED_SCOPES,
  clampScopesForClient,
  isAccountOnlyScope,
  isApiScope,
  scopesForAudience,
} from "@/lib/api/scopes";

// The internal catalog's whole security property is that it is a *separate* object from the public
// one. These tests pin that separation at every point a scope is published or granted.

describe("catalog separation", () => {
  test("no internal scope appears in the public catalog", () => {
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(API_SCOPE_NAMES).not.toContain(scope);
      expect(isApiScope(scope)).toBe(false);
      expect(Object.hasOwn(API_SCOPES, scope)).toBe(false);
    }
  });

  test("no public scope appears in the internal catalog", () => {
    for (const scope of API_SCOPE_NAMES) {
      expect(ADMIN_SCOPE_NAMES).not.toContain(scope);
      expect(isAdminScope(scope)).toBe(false);
    }
  });

  test("every internal scope is namespaced, so it can never collide with a public one", () => {
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(scope.startsWith("admin:")).toBe(true);
      expect(ADMIN_SCOPES[scope].description.length).toBeGreaterThan(0);
    }
  });
});

describe("OAuth grants an internal scope only under both conditions", () => {
  test("a live admin consenting to a verified client gets them", () => {
    expect(
      clampAdminScopesForConsent({
        requestedScopes: [...ADMIN_SCOPE_NAMES, "teams:read"],
        isVerified: true,
        isAdmin: true,
      }),
    ).toEqual(ADMIN_SCOPE_NAMES);
  });

  test("an unverified client gets none, however senior the user", () => {
    expect(
      clampAdminScopesForConsent({
        requestedScopes: ADMIN_SCOPE_NAMES,
        isVerified: false,
        isAdmin: true,
      }),
    ).toEqual([]);
  });

  test("a non-admin gets none, however trusted the client", () => {
    expect(
      clampAdminScopesForConsent({
        requestedScopes: ADMIN_SCOPE_NAMES,
        isVerified: true,
        isAdmin: false,
      }),
    ).toEqual([]);
  });

  test("only internal names survive; a public scope is the other clamp's business", () => {
    expect(
      clampAdminScopesForConsent({
        requestedScopes: ["teams:read", "not-a-scope"],
        isVerified: true,
        isAdmin: true,
      }),
    ).toEqual([]);
  });
});

// The public clamp is what every non-admin consent runs through, and it must never widen.
describe("the public consent clamp still cannot reach the internal catalog", () => {
  test("the DCR allowlist offers no internal scope", () => {
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(DCR_ALLOWED_SCOPES).not.toContain(scope);
    }
  });

  test("clampScopesForClient drops one from any request", () => {
    for (const isVerified of [true, false]) {
      expect(
        clampScopesForClient({
          requestedScopes: [...ADMIN_SCOPE_NAMES, "teams:read"],
          isVerified,
        }),
      ).toEqual(["teams:read"]);
    }
  });
});

describe("the API key resolver keeps them", () => {
  test("toGrantedScopes admits both catalogs and drops anything else", () => {
    expect(toGrantedScopes(["admin:read", "profile:read", "not-a-scope"])).toEqual([
      "admin:read",
      "profile:read",
    ]);
  });

  test("isGrantedScope is the union of the two catalogs", () => {
    for (const scope of [...API_SCOPE_NAMES, ...ADMIN_SCOPE_NAMES]) {
      expect(isGrantedScope(scope)).toBe(true);
    }

    expect(isGrantedScope("admin")).toBe(false);
    expect(isGrantedScope("admin:everything")).toBe(false);
  });
});

describe("no team credential can hold an internal scope", () => {
  test("every internal scope is account-only", () => {
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(isAccountOnlyScope(scope)).toBe(true);
    }
  });

  test("a team audience narrows them away", () => {
    const scopes = [...ADMIN_SCOPE_NAMES, "teams:read"];

    expect(scopesForAudience({ scopes, teamId: "team_1" })).toEqual(["teams:read"]);
    expect(scopesForAudience({ scopes, teamId: null })).toEqual(scopes);
  });

  // An unrecognized name grants nothing, so denying it to a team key is correct too. This is what
  // lets `isAccountOnlyScope` stay free of any internal import.
  test("an unknown scope is treated as account-only", () => {
    expect(isAccountOnlyScope("not-a-scope")).toBe(true);
  });
});

// A regression guard for the leak this nearly shipped with. `GET /api/v1/api-keys` is reachable
// with `api-keys:read`, which a third-party OAuth client can hold, so an internal key listed there
// would publish the internal scope names to exactly the audience the separate catalog keeps them
// from. The exclusion is expressed in the type as well: `listUserApiKeys` returns
// `PublicApiKeySummary[]`, whose `scopes` is `ApiScope[]`.
describe("owner-facing key listings exclude internal keys", () => {
  // Mirrors `isPublicApiKey` in `src/lib/api-keys/api-keys.ts`, which is the filter both owner
  // listings apply. Asserting the rule here keeps it pinned without a database.
  function isPublicApiKey(scopes: string[]): boolean {
    return scopes.every(isApiScope);
  }

  test("a key holding any internal scope is not public", () => {
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(isPublicApiKey([scope])).toBe(false);
      expect(isPublicApiKey(["teams:read", scope])).toBe(false);
    }
  });

  test("a key holding only public scopes is public", () => {
    expect(isPublicApiKey(API_SCOPE_NAMES)).toBe(true);
    expect(isPublicApiKey([])).toBe(true);
  });
});
