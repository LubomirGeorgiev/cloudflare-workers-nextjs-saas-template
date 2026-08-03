import { describe, expect, test } from "vitest";

import {
  API_SCOPES,
  API_SCOPE_NAMES,
  type ApiScope,
  DCR_ALLOWED_SCOPES,
  clampScopesForClient,
  describeApiScope,
  isApiScope,
  toApiScopes,
} from "@/lib/api/scopes";

describe("API scope catalog", () => {
  test("exposes every catalog key through the name list", () => {
    expect(API_SCOPE_NAMES).toEqual(Object.keys(API_SCOPES));
    expect(API_SCOPE_NAMES.length).toBeGreaterThan(0);
  });

  test("names every scope as resource:verb so consent and docs can group them", () => {
    for (const scope of API_SCOPE_NAMES) {
      expect(scope).toMatch(/^[a-z][a-z-]*:(read|write)$/);
    }
  });

  test("gives every scope a distinct human description for the consent screen", () => {
    const descriptions = API_SCOPE_NAMES.map(describeApiScope);

    for (const description of descriptions) {
      expect(description.trim().length).toBeGreaterThan(0);
    }

    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  test("narrows unknown strings out of the scope type", () => {
    const unknownScope = "definitely-not:a-scope";

    expect(isApiScope(unknownScope)).toBe(false);
    expect(API_SCOPE_NAMES.every((scope: ApiScope) => isApiScope(scope))).toBe(true);
  });

  test("does not treat inherited object properties as scopes", () => {
    expect(isApiScope("toString")).toBe(false);
    expect(isApiScope("constructor")).toBe(false);
  });
});

// Stored grants outlive the catalog, so this is the one place a snapshot's raw strings become
// scopes. Dropping is deliberate: a deleted scope must stop granting, not break the credential.
describe("stored scope validation", () => {
  test("keeps every catalog scope in the order it was granted", () => {
    expect(toApiScopes([...API_SCOPE_NAMES])).toEqual([...API_SCOPE_NAMES]);
  });

  test("drops names the catalog no longer knows about", () => {
    const [known] = API_SCOPE_NAMES;

    expect(toApiScopes([known, "removed-by-a-fork:read"])).toEqual([known]);
    expect(toApiScopes(["removed-by-a-fork:read"])).toEqual([]);
  });

  test("an empty grant stays empty rather than becoming unrestricted", () => {
    expect(toApiScopes([])).toEqual([]);
  });
});

// The anti-phishing ceiling for self-registered OAuth clients. Assertions derive from the
// catalog and the allowlist, so a fork that adds or renames scopes keeps them meaningful.
describe("consent scope clamping", () => {
  const restrictedScopes = API_SCOPE_NAMES.filter(
    (scope) => !DCR_ALLOWED_SCOPES.includes(scope),
  );

  test("the unverified allowlist is a strict subset of the catalog", () => {
    expect(DCR_ALLOWED_SCOPES.every((scope) => isApiScope(scope))).toBe(true);
    expect(restrictedScopes.length).toBeGreaterThan(0);
  });

  test("a verified client may be granted the whole catalog", () => {
    expect(
      clampScopesForClient({ requestedScopes: [...API_SCOPE_NAMES], isVerified: true }),
    ).toEqual([...API_SCOPE_NAMES]);
  });

  test("an unverified client loses every restricted scope it asks for", () => {
    const granted = clampScopesForClient({
      requestedScopes: [...API_SCOPE_NAMES],
      isVerified: false,
    });

    expect(granted).toEqual(DCR_ALLOWED_SCOPES);
    for (const scope of restrictedScopes) {
      expect(granted).not.toContain(scope);
    }
  });

  test("unknown scope names are dropped rather than passed through", () => {
    expect(
      clampScopesForClient({ requestedScopes: ["definitely-not:a-scope"], isVerified: true }),
    ).toEqual([]);
  });
});
